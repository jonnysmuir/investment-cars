#!/usr/bin/env node
/**
 * scrape-cac-sold-bulk.js — Bulk scrape Car & Classic sold auction results by make.
 *
 * Scrapes all sold auction results for a given make (or all makes).
 * Car & Classic auction cards show title, price, mileage in card text.
 * Dates require visiting individual listing pages (ISO dates in HTML).
 *
 * Usage:
 *   node scripts/scrape-cac-sold-bulk.js                      # all makes
 *   node scripts/scrape-cac-sold-bulk.js --make Ferrari       # single make
 *   node scripts/scrape-cac-sold-bulk.js --make Ferrari --skip-dates  # faster, no date extraction
 */

const fs = require('fs');
const path = require('path');
const { extractYear, sleep } = require('./scrapers/base');

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'car-and-classic-sold');

const ALL_MAKES = ['Ferrari', 'McLaren', 'BMW', 'Lamborghini', 'Lexus'];

// ── Parse CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const singleMake = getArg('--make');
const skipDates = args.includes('--skip-dates');
const makes = singleMake ? [singleMake] : ALL_MAKES;

// ── Main ────────────────────────────────────────────────────────────────

async function scrapeMake(page, make) {
  console.log(`\n═══ ${make} ═══`);

  const searchUrl = `https://www.carandclassic.com/auctions/results?q=${encodeURIComponent(make)}`;
  console.log(`URL: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);

  // Collect all cards across pages
  let allCards = [];
  let pageNum = 1;

  while (true) {
    const cards = await page.evaluate((makeName) => {
      const results = [];
      for (const article of document.querySelectorAll('article')) {
        // Find the auction link (href contains /auctions/ and a slug)
        const links = [...article.querySelectorAll('a[href*="/auctions/"]')];
        const link = links.find(a => /\/auctions\/\d{4}-/.test(a.href));
        if (!link) continue;
        const href = link.href;

        const text = article.textContent || '';

        // Must contain the make name and "Sold"
        if (!text.toLowerCase().includes(makeName.toLowerCase())) continue;
        if (!text.includes('Sold')) continue;

        // Extract title — find the link with the longest text
        const titleLink = links.reduce((best, l) =>
          l.textContent.trim().length > best.textContent.trim().length ? l : best
        , links[0]);
        const title = titleLink?.textContent?.trim()
          ?.replace(/\d{4,5}cc.*$/, '')  // strip "5500cc · Petrol..." suffix
          ?.trim() || '';

        // Extract price (£XX,XXX or €XX,XXX)
        const priceMatch = text.match(/[£€$]([\d,]+)/);
        const priceText = priceMatch ? priceMatch[0] : '';

        // Extract mileage
        const mileageMatch = text.match(/([\d,]+)\s*(miles?|kilometres?)/i);
        const mileageText = mileageMatch ? mileageMatch[0] : '';
        const isKm = mileageMatch ? /kilomet/i.test(mileageMatch[2]) : false;

        results.push({ href, title, priceText, mileageText, isKm });
      }
      return results;
    }, make);

    console.log(`  Page ${pageNum}: ${cards.length} sold ${make} results`);
    allCards.push(...cards);

    // Check for next page link
    const hasNext = await page.evaluate(() => {
      const nextLink = document.querySelector('a[rel="next"]');
      if (nextLink) { nextLink.click(); return true; }
      // Also try pagination buttons
      const pags = [...document.querySelectorAll('nav a, .pagination a')];
      const next = pags.find(a => a.textContent.trim() === '›' || a.textContent.trim() === 'Next');
      if (next) { next.click(); return true; }
      return false;
    });

    if (!hasNext) break;
    await sleep(3000);
    pageNum++;
    if (pageNum > 50) break;
  }

  // Deduplicate
  const seen = new Set();
  allCards = allCards.filter(c => {
    if (seen.has(c.href)) return false;
    seen.add(c.href);
    return true;
  });
  console.log(`  Unique sold results: ${allCards.length}`);

  if (allCards.length === 0) {
    console.log(`  No results for ${make}`);
    return 0;
  }

  // Transform cards and optionally fetch dates
  const listings = [];
  for (let i = 0; i < allCards.length; i++) {
    const card = allCards[i];
    const year = extractYear(card.title);

    // Parse price
    let price = null;
    let currency = 'GBP';
    if (card.priceText) {
      if (card.priceText.includes('€')) currency = 'EUR';
      if (card.priceText.includes('$')) currency = 'USD';
      const numMatch = card.priceText.match(/[\d,]+/);
      if (numMatch) price = parseInt(numMatch[0].replace(/,/g, ''), 10);
    }

    // Parse mileage
    let mileage = null;
    if (card.mileageText) {
      const num = card.mileageText.replace(/,/g, '').match(/(\d+)/);
      if (num) {
        mileage = parseInt(num[1], 10);
        if (card.isKm) mileage = Math.round(mileage * 0.621371); // convert km to miles
      }
    }

    // Model — strip "YYYY Make " prefix
    const modelRe = new RegExp(`^\\d{4}\\s+${make}\\s+`, 'i');
    const model = card.title.replace(modelRe, '').trim() || card.title;

    // Fetch date from listing page
    let soldDate = null;
    if (!skipDates) {
      try {
        await page.goto(card.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(800);
        soldDate = await page.evaluate(() => {
          const html = document.documentElement.innerHTML;
          const isoMatch = html.match(/(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/);
          return isoMatch ? isoMatch[1] : null;
        });
      } catch { /* skip */ }

      if ((i + 1) % 10 === 0 || i === allCards.length - 1) {
        console.log(`  Dates: ${i + 1}/${allCards.length}`);
      }
    }

    listings.push({
      year,
      make,
      model,
      title: card.title,
      price,
      currency,
      priceGBP: currency === 'GBP' ? price : null,
      sold: true,
      date: soldDate,
      mileage,
      source: 'Car & Classic',
    });
  }

  // Summary
  const gbp = listings.filter(l => l.currency === 'GBP');
  const withDate = listings.filter(l => l.date);
  const dates = listings.map(l => l.date).filter(Boolean).sort();
  console.log(`  Results: ${listings.length} (${gbp.length} GBP, ${withDate.length} with dates)`);
  if (dates.length) console.log(`  Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  // Save
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = path.join(OUTPUT_DIR, `${make.toLowerCase()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(listings, null, 2) + '\n');
  console.log(`  ✓ Saved → ${outFile}`);

  return listings.length;
}

async function main() {
  console.log('═══ Car & Classic Bulk Sold Scraper ═══');
  console.log(`Makes: ${makes.join(', ')}`);
  if (skipDates) console.log('⚡ Skipping date extraction (--skip-dates)');

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  const page = await context.newPage();

  let totalResults = 0;
  for (const make of makes) {
    try {
      const count = await scrapeMake(page, make);
      totalResults += count;
    } catch (err) {
      console.error(`  ✗ Error scraping ${make}:`, err.message);
    }
    if (makes.indexOf(make) < makes.length - 1) {
      console.log('  Pausing 5s between makes...');
      await sleep(5000);
    }
  }

  await context.close();
  await browser.close();

  console.log(`\n═══ Done: ${totalResults} total results across ${makes.length} makes ═══`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
