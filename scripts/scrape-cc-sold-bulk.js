#!/usr/bin/env node
/**
 * scrape-cc-sold-bulk.js — Bulk scrape Collecting Cars sold results via Typesense API.
 *
 * Directly queries the public Typesense search API to fetch all sold auction results.
 * No browser needed — just HTTP requests.
 *
 * Usage:
 *   node scripts/scrape-cc-sold-bulk.js                    # all makes
 *   node scripts/scrape-cc-sold-bulk.js --make Ferrari     # single make
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { extractYear, sleep } = require('./scrapers/base');

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'collecting-cars-sold');
const ALL_MAKES = ['Ferrari', 'McLaren', 'BMW', 'Lamborghini', 'Lexus'];
const API_KEY = 'pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1';
const PER_PAGE = 250;

// ── Parse CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}
const singleMake = getArg('--make');
const makes = singleMake ? [singleMake] : ALL_MAKES;

// ── HTTP helper ─────────────────────────────────────────────────────────

function postJSON(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'dora.production.collecting.com',
      path: `/multi_search?x-typesense-api-key=${API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(data),
        'Referer': 'https://collectingcars.com/',
      },
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Main ────────────────────────────────────────────────────────────────

async function scrapeMake(make) {
  console.log(`\n═══ ${make} ═══`);

  const allHits = [];
  let pageNum = 1;
  let totalFound = 0;

  while (true) {
    const result = await postJSON({
      searches: [{
        collection: 'production_cars',
        q: make,
        query_by: 'title,productMake',
        filter_by: `listingStage:=[\`sold\`] && lotType:=car && productMake:=${make}`,
        per_page: PER_PAGE,
        page: pageNum,
      }],
    });

    const searchResult = result.results?.[0];
    if (!searchResult || searchResult.error) {
      console.error(`  API error:`, searchResult?.error || 'no results');
      break;
    }

    if (pageNum === 1) {
      totalFound = searchResult.found;
      console.log(`  Total found: ${totalFound}`);
    }

    const hits = searchResult.hits || [];
    if (hits.length === 0) break;

    allHits.push(...hits);
    console.log(`  Page ${pageNum}: +${hits.length} (${allHits.length}/${totalFound})`);

    if (allHits.length >= totalFound) break;
    pageNum++;
    await sleep(500);
  }

  // Transform hits to our format
  const listings = [];
  for (const hit of allHits) {
    const doc = hit.document;

    const price = doc.currentBid || doc.priceSold || null;
    const currency = (doc.currencyCode || 'gbp').toUpperCase();

    let soldDate = null;
    const dateStr = doc.dtSoldUTC || doc.dtAuctionEndedUTC;
    if (dateStr) {
      const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
      if (match) soldDate = match[1];
    }

    const year = doc.productYear || extractYear(doc.title || '');
    const title = doc.title || '';
    const modelRe = new RegExp(`^\\d{4}\\s+${make}\\s+`, 'i');
    const model = title.replace(modelRe, '').replace(/\s*-\s*.*$/, '').trim() || title;

    listings.push({
      year,
      make,
      model,
      title,
      price,
      currency,
      sold: true,
      date: soldDate,
      source: 'Collecting Cars',
    });
  }

  // Summary
  const gbp = listings.filter(l => l.currency === 'GBP');
  const withPrice = listings.filter(l => l.price);
  const dates = listings.map(l => l.date).filter(Boolean).sort();
  console.log(`  Results: ${listings.length} (${gbp.length} GBP, ${withPrice.length} with price)`);
  if (dates.length) console.log(`  Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  // Save
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = path.join(OUTPUT_DIR, `${make.toLowerCase()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(listings, null, 2) + '\n');
  console.log(`  ✓ Saved → ${outFile}`);

  return listings.length;
}

async function main() {
  console.log('═══ Collecting Cars Bulk Sold Scraper (API) ═══');
  console.log(`Makes: ${makes.join(', ')}`);

  let totalResults = 0;
  for (const make of makes) {
    try {
      const count = await scrapeMake(make);
      totalResults += count;
    } catch (err) {
      console.error(`  ✗ Error scraping ${make}:`, err.message);
    }
    await sleep(1000);
  }

  console.log(`\n═══ Done: ${totalResults} total results across ${makes.length} makes ═══`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
