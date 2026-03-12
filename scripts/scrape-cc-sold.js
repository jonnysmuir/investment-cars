#!/usr/bin/env node
/**
 * scrape-cc-sold.js — Scrape Collecting Cars sold auction results for a model.
 *
 * Uses Playwright to navigate to a pre-filtered sold results page and extract
 * all listing data (title, price, date, year).
 *
 * Usage:
 *   node scripts/scrape-cc-sold.js --url "https://collectingcars.com/buy?query=Ferrari+F430&..." --slug ferrari-f430
 */

const fs = require('fs');
const path = require('path');
const { extractYear, normaliseTransmission, sleep } = require('./scrapers/base');

// ── Parse CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const searchUrl = getArg('--url');
const slug = getArg('--slug');

if (!searchUrl || !slug) {
  console.error('Usage: node scripts/scrape-cc-sold.js --url "<collecting-cars-url>" --slug <model-slug>');
  process.exit(1);
}

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'collecting-cars-sold');

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ Collecting Cars Sold Scraper ═══');
  console.log(`URL: ${searchUrl}`);
  console.log(`Slug: ${slug}`);
  console.log();

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to sold results page...');
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    // Scroll to load all results (handles infinite scroll / lazy loading)
    let prevCount = 0;
    let scrollAttempts = 0;
    const MAX_SCROLL = 30; // up to 30 scroll attempts for large result sets

    for (let i = 0; i < MAX_SCROLL; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(2000);

      const count = await page.evaluate(() =>
        new Set([...document.querySelectorAll('a[href*="/for-sale/"]')].map(a => a.href)).size
      );

      console.log(`  Scroll ${i + 1}: ${count} results loaded`);

      if (count === prevCount) {
        scrollAttempts++;
        if (scrollAttempts >= 3) break; // 3 consecutive unchanged = done
      } else {
        scrollAttempts = 0;
      }
      prevCount = count;
    }

    // Extract listing data from cards
    const rawListings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      const allLinks = document.querySelectorAll('a[href*="/for-sale/"]');
      for (const link of allLinks) {
        const href = link.href;
        if (seen.has(href)) continue;
        seen.add(href);

        // Image and alt text (title) from the card's img element
        const img = link.querySelector('img');
        const title = img?.alt || '';
        const image = img?.src || '';

        // Date and price from pill spans
        const pills = link.querySelectorAll('span');
        let date = '';
        let price = '';
        for (const span of pills) {
          const text = span.textContent?.trim() || '';
          if (/^\d{2}\/\d{2}\/\d{2}$/.test(text)) {
            date = text;
          } else if (/^[£$€]/.test(text)) {
            price = text;
          }
        }

        results.push({ href, title, image, date, price });
      }
      return results;
    });

    console.log(`\nRaw results extracted: ${rawListings.length}`);

    // Filter and transform
    const listings = [];

    for (const raw of rawListings) {
      // Skip non-car items
      if (/\b(set of\b.*\bwheels?|wheels?\b.*\bset\b|number plate|luggage set|brochure|memorabilia)\b/i.test(raw.title)) continue;
      const urlSlug = raw.href.split('/for-sale/')[1] || '';
      if (urlSlug && !/^\d{4}-/.test(urlSlug)) continue;

      // Parse date DD/MM/YY → YYYY-MM-DD
      let soldDate = null;
      if (raw.date) {
        const [dd, mm, yy] = raw.date.split('/');
        const year = parseInt(yy) < 50 ? `20${yy}` : `19${yy}`;
        soldDate = `${year}-${mm}-${dd}`;
      }

      // Parse sold price
      let price = null;
      let currency = 'GBP';
      if (raw.price) {
        if (raw.price.includes('$')) currency = 'USD';
        if (raw.price.includes('€')) currency = 'EUR';
        const numMatch = raw.price.match(/[\d,]+/);
        if (numMatch) {
          price = parseInt(numMatch[0].replace(/,/g, ''), 10);
        }
      }

      const year = extractYear(raw.title);
      const title = raw.title.trim();
      const model = title.replace(/^\d{4}\s+Ferrari\s+/i, '').trim() || title;

      listings.push({
        year,
        make: 'Ferrari',
        model,
        title: year && !title.startsWith(String(year)) ? `${year} ${title}` : title,
        price,
        currency,
        sold: true,
        date: soldDate,
        sourceUrl: raw.href,
      });
    }

    console.log(`Filtered results: ${listings.length}`);

    // Summary
    const withPrice = listings.filter(l => l.price);
    const gbp = listings.filter(l => l.currency === 'GBP');
    const dates = listings.map(l => l.date).filter(Boolean).sort();
    console.log(`\n═══ Summary ═══`);
    console.log(`  Total: ${listings.length}`);
    console.log(`  With price: ${withPrice.length}`);
    console.log(`  GBP: ${gbp.length}`);
    if (dates.length > 0) {
      console.log(`  Date range: ${dates[0]} → ${dates[dates.length - 1]}`);
    }

    // Show sample
    console.log(`\nSample results:`);
    listings.slice(0, 10).forEach(r => {
      const priceStr = r.price ? `£${r.price.toLocaleString()}` : 'N/A';
      console.log(`  ${r.date || 'no date'} | ${priceStr} | ${r.title}`);
    });

    // Save
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outFile = path.join(OUTPUT_DIR, `${slug}.json`);
    fs.writeFileSync(outFile, JSON.stringify(listings, null, 2) + '\n');
    console.log(`\n✓ Saved ${listings.length} results → ${outFile}`);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
