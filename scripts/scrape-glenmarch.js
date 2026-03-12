#!/usr/bin/env node
/**
 * scrape-glenmarch.js — Bulk scraper for Glenmarch auction results
 *
 * Fetches historical sold/unsold auction data for collector cars to
 * feed Collectorly's analysis pages with historic pricing.
 *
 * Usage:
 *   node scripts/scrape-glenmarch.js                          # all 6 makes
 *   node scripts/scrape-glenmarch.js --make Ferrari            # single make
 *   node scripts/scrape-glenmarch.js --make McLaren --pages 2  # test run
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { fetchWithRetry, rateLimit, sleep } = require('./scrapers/base');

// ── Config ───────────────────────────────────────────────────────────────
const MAKES = ['Ferrari', 'McLaren', 'BMW', 'Lamborghini', 'Porsche', 'Lexus'];
const PER_PAGE = 100;
const BASE_URL = 'https://www.glenmarch.com/cars/results/quick';
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'glenmarch');

// Rough fixed exchange rates → GBP (for trend analysis, not precise conversion)
const TO_GBP = {
  GBP: 1,
  EUR: 0.86,
  USD: 0.79,
  CHF: 0.89,
  AUD: 0.52,
  CAD: 0.58,
  SEK: 0.074,
  DKK: 0.115,
  NOK: 0.074,
  NZD: 0.48,
  ZAR: 0.044,
  BRL: 0.14,
  ARS: 0.00075,
  HKD: 0.10,
  JPY: 0.0053,
  QAR: 0.22,
  AED: 0.22,
  SAR: 0.21,
};

// ── Parse CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const makeFilter = args.includes('--make') ? args[args.indexOf('--make') + 1] : null;
const pageLimit = args.includes('--pages') ? parseInt(args[args.indexOf('--pages') + 1], 10) : Infinity;

if (makeFilter && !MAKES.includes(makeFilter)) {
  console.error(`Unknown make: ${makeFilter}. Available: ${MAKES.join(', ')}`);
  process.exit(1);
}

const makesToScrape = makeFilter ? [makeFilter] : MAKES;

// ── Price parsing ────────────────────────────────────────────────────────

/**
 * Parse a Glenmarch price string into { price, currency, sold, estimateLow, estimateHigh }
 *
 * Formats:
 *   "£1,310,000"                          → sold, GBP
 *   "€905,000"                            → sold, EUR
 *   "US$123,200"                          → sold, USD
 *   "A$144,000"                           → sold, AUD
 *   "C$50,000"                            → sold, CAD
 *   "CHF83,000"                           → sold, CHF
 *   "Estimate €150,000 - €200,000 (unsold)" → unsold, EUR estimate
 *   "Estimate £70,000 - £90,000"          → unsold/estimate
 */
function parseGlenmarchPrice(raw) {
  if (!raw) return null;

  const isUnsold = raw.toLowerCase().includes('unsold') || raw.toLowerCase().startsWith('estimate');

  if (isUnsold) {
    // Extract estimate range
    const nums = raw.match(/[\d,]+/g);
    if (!nums || nums.length === 0) return null;
    const currency = detectCurrency(raw);
    const low = parseInt(nums[0].replace(/,/g, ''), 10);
    const high = nums.length > 1 ? parseInt(nums[1].replace(/,/g, ''), 10) : low;
    return { price: Math.round((low + high) / 2), currency, sold: false, estimateLow: low, estimateHigh: high };
  }

  // Sold price
  const currency = detectCurrency(raw);
  const numMatch = raw.match(/[\d,]+/);
  if (!numMatch) return null;
  const price = parseInt(numMatch[0].replace(/,/g, ''), 10);
  return { price, currency, sold: true };
}

function detectCurrency(str) {
  if (str.includes('US$')) return 'USD';
  if (str.includes('A$')) return 'AUD';
  if (str.includes('C$')) return 'CAD';
  if (str.includes('NZ$')) return 'NZD';
  if (str.includes('HK$')) return 'HKD';
  if (str.includes('CHF')) return 'CHF';
  if (str.includes('SEK')) return 'SEK';
  if (str.includes('DKK')) return 'DKK';
  if (str.includes('NOK')) return 'NOK';
  if (str.includes('R$')) return 'BRL';
  if (str.includes('¥') || str.includes('JPY')) return 'JPY';
  if (str.includes('€')) return 'EUR';
  if (str.includes('£')) return 'GBP';
  if (str.includes('$')) return 'USD'; // fallback for bare $
  return 'UNKNOWN';
}

function toGBP(price, currency) {
  const rate = TO_GBP[currency];
  if (!rate) return null;
  return Math.round(price * rate);
}

// ── Date parsing ─────────────────────────────────────────────────────────

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

/**
 * Parse Glenmarch date strings like "6 - 7 March, 2026" or "27 February, 2026"
 * Returns YYYY-MM-DD (uses first date in range)
 */
function parseGlenmarchDate(raw) {
  if (!raw || !raw.trim()) return null;

  // Match: optional "day -" then day month, year
  const match = raw.match(/(\d{1,2})\s*(?:-\s*\d{1,2}\s+)?(\w+),?\s*(\d{4})/);
  if (!match) return null;

  const day = match[1].padStart(2, '0');
  const monthStr = match[2].toLowerCase();
  const year = match[3];
  const month = MONTHS[monthStr];
  if (!month) return null;

  return `${year}-${month}-${day}`;
}

// ── HTML parsing ─────────────────────────────────────────────────────────

function parseResultsPage(html, make) {
  const $ = cheerio.load(html);
  const results = [];

  $('div.car_grid_item').each((i, el) => {
    const card = $(el);

    // Title: "2018 Ferrari 488 GTB"
    const titleRaw = card.find('.make').text().trim();
    if (!titleRaw) return;

    // Extract year
    const yearMatch = titleRaw.match(/^(\d{4})\s+/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    // Extract model (everything after "year make ")
    const makeRegex = new RegExp(`^\\d{4}\\s+${make}\\s+`, 'i');
    const model = titleRaw.replace(makeRegex, '').trim() || titleRaw;

    // Price
    const priceRaw = card.find('.price').text().trim();
    const priceData = parseGlenmarchPrice(priceRaw);
    if (!priceData) return; // skip if we can't parse a price at all

    // Date
    const dateRaw = card.find('.date').text().trim();
    const date = parseGlenmarchDate(dateRaw);

    results.push({
      year,
      make,
      model,
      title: titleRaw,
      price: priceData.price,
      currency: priceData.currency,
      priceGBP: toGBP(priceData.price, priceData.currency),
      sold: priceData.sold,
      ...(priceData.estimateLow != null && { estimateLow: priceData.estimateLow }),
      ...(priceData.estimateHigh != null && { estimateHigh: priceData.estimateHigh }),
      date,
    });
  });

  return results;
}

function getLastPage(html) {
  const $ = cheerio.load(html);
  let maxPage = 1;
  $('a').each((i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/page=(\d+)/);
    if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
  });
  return maxPage;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function scrapeMake(make) {
  const allResults = [];
  let page = 1;
  let emptyStreak = 0;

  console.log(`\n══ ${make} ══`);

  while (page <= pageLimit) {
    const pageUrl = `${BASE_URL}/${encodeURIComponent(make)}?limit=${PER_PAGE}&unsold=1&page=${page}`;
    console.log(`  Fetching page ${page}...`);

    await rateLimit(pageUrl);
    try {
      const html = await fetchWithRetry(pageUrl);
      const results = parseResultsPage(html, make);

      if (results.length === 0) {
        emptyStreak++;
        console.log(`  Page ${page}: empty (streak ${emptyStreak}/3)`);
        if (emptyStreak >= 3) {
          console.log(`  Stopping: 3 consecutive empty pages`);
          break;
        }
        page++;
        continue;
      }

      emptyStreak = 0;
      allResults.push(...results);
      console.log(`  Page ${page}: +${results.length} (${allResults.length} total)`);
    } catch (err) {
      console.error(`  Page ${page}: ERROR - ${err.message}`);
    }

    page++;
  }

  // Save incrementally per make
  const outFile = path.join(OUTPUT_DIR, `${make.toLowerCase()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2) + '\n');

  const soldCount = allResults.filter(r => r.sold).length;
  const unsoldCount = allResults.filter(r => !r.sold).length;
  console.log(`  ✓ ${make}: ${allResults.length} results (${soldCount} sold, ${unsoldCount} unsold) → ${outFile}`);

  return allResults;
}

async function main() {
  console.log('═══ Glenmarch Bulk Auction Scraper ═══');
  console.log(`Makes: ${makesToScrape.join(', ')}`);
  console.log(`Page limit: ${pageLimit === Infinity ? 'none' : pageLimit}`);
  console.log(`Output: ${OUTPUT_DIR}/`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const allData = [];

  for (const make of makesToScrape) {
    try {
      const results = await scrapeMake(make);
      allData.push(...results);
    } catch (err) {
      console.error(`\n  FATAL ERROR for ${make}: ${err.message}`);
    }
  }

  // Write combined CSV
  if (allData.length > 0) {
    const csvPath = path.join(OUTPUT_DIR, 'all-results.csv');
    const headers = ['year', 'make', 'model', 'title', 'price', 'currency', 'priceGBP', 'sold', 'date', 'estimateLow', 'estimateHigh'];
    const csvRows = [headers.join(',')];

    for (const r of allData) {
      const row = headers.map(h => {
        const val = r[h];
        if (val == null) return '';
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return String(val);
      });
      csvRows.push(row.join(','));
    }

    fs.writeFileSync(csvPath, csvRows.join('\n') + '\n');
    console.log(`\n✓ Combined CSV: ${csvPath} (${allData.length} rows)`);
  }

  // Summary
  console.log('\n═══ Summary ═══');
  const byMake = {};
  allData.forEach(r => { byMake[r.make] = (byMake[r.make] || 0) + 1; });
  Object.entries(byMake).forEach(([m, c]) => console.log(`  ${m}: ${c}`));
  console.log(`  Total: ${allData.length}`);

  const soldTotal = allData.filter(r => r.sold).length;
  console.log(`  Sold: ${soldTotal} | Unsold: ${allData.length - soldTotal}`);

  const byCurrency = {};
  allData.forEach(r => { byCurrency[r.currency] = (byCurrency[r.currency] || 0) + 1; });
  console.log('  Currencies:', Object.entries(byCurrency).map(([c, n]) => `${c}:${n}`).join(' '));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
