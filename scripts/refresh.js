#!/usr/bin/env node
/**
 * Collectorly Listings Refresh Orchestrator
 *
 * Reads data/models.json, runs scrapers for each model/source,
 * merges with existing data (dedup, price tracking, unlisted detection),
 * writes updated JSON, and generates a summary report.
 *
 * Usage:
 *   node scripts/refresh.js                    # refresh all models
 *   node scripts/refresh.js --slug ferrari-f430  # refresh one model
 */

const fs = require('fs');
const path = require('path');
const { parsePrice, formatPrice, sourceUrlToId, today } = require('./scrapers/base');

// ── Scrapers ──────────────────────────────────────────────────────────────
const pistonheads = require('./scrapers/pistonheads');
const autotrader = require('./scrapers/autotrader');
const carsandclassic = require('./scrapers/carsandclassic');
const collectingcars = require('./scrapers/collectingcars');

const SCRAPERS = {
  pistonheads,
  autotrader,
  carsandclassic,
  collectingcars,
};

// ── Paths ─────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_DIR = path.join(DATA_DIR, '.state');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');
const SUMMARY_FILE = path.join(__dirname, 'summary.md');

// Days a listing must be missing before being marked as unlisted
const UNLISTED_THRESHOLD = 3;

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ Collectorly Listings Refresh ═══');
  console.log(`Date: ${today()}\n`);

  // Parse args
  const args = process.argv.slice(2);
  const slugFilter = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

  // Load model registry
  const modelsData = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  let models = modelsData.models;

  if (slugFilter) {
    models = models.filter(m => m.slug === slugFilter);
    if (models.length === 0) {
      console.error(`No model found with slug: ${slugFilter}`);
      process.exit(1);
    }
  }

  // Ensure state directory exists
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const summary = {
    date: today(),
    models: [],
    totalNew: 0,
    totalUpdated: 0,
    totalUnlisted: 0,
    totalErrors: 0,
    hasChanges: false,
  };

  // Process each model
  for (const modelConfig of models) {
    console.log(`\n── ${modelConfig.make} ${modelConfig.model} ──`);

    const modelSummary = await processModel(modelConfig);
    summary.models.push(modelSummary);
    summary.totalNew += modelSummary.newCount;
    summary.totalUpdated += modelSummary.updatedCount;
    summary.totalUnlisted += modelSummary.unlistedCount;
    summary.totalErrors += modelSummary.errors.length;
    if (modelSummary.newCount > 0 || modelSummary.updatedCount > 0 || modelSummary.unlistedCount > 0) {
      summary.hasChanges = true;
    }
  }

  // Clean up Playwright browser
  try {
    await autotrader.closeBrowser();
  } catch {
    // Ignore
  }

  // Write summary
  const summaryMd = generateSummaryMarkdown(summary);
  fs.writeFileSync(SUMMARY_FILE, summaryMd, 'utf8');

  // Set GitHub Actions outputs
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${summary.hasChanges}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary_short=${summary.totalNew} new, ${summary.totalUpdated} updated, ${summary.totalUnlisted} unlisted\n`);
  }

  // Set environment variable for workflow
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `HAS_CHANGES=${summary.hasChanges}\n`);
  }

  console.log('\n═══ Summary ═══');
  console.log(`New: ${summary.totalNew} | Updated: ${summary.totalUpdated} | Unlisted: ${summary.totalUnlisted} | Errors: ${summary.totalErrors}`);
  console.log(`Changes: ${summary.hasChanges}`);
  console.log(`Summary written to: ${SUMMARY_FILE}`);
}

// ── Process a Single Model ────────────────────────────────────────────────
async function processModel(modelConfig) {
  const { slug, sources } = modelConfig;

  const result = {
    make: modelConfig.make,
    model: modelConfig.model,
    slug,
    newCount: 0,
    updatedCount: 0,
    unlistedCount: 0,
    errors: [],
    newListings: [],
    priceChanges: [],
    unlistedListings: [],
  };

  // Load existing data
  const dataFile = path.join(DATA_DIR, `${slug}.json`);
  let existingData;
  try {
    existingData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    console.log(`  No existing data for ${slug}, starting fresh`);
    existingData = { listings: [] };
  }

  // Always ensure metadata is up-to-date from models.json
  existingData.model = `${modelConfig.make} ${modelConfig.model}`;
  existingData.slug = slug;
  existingData.heroImage = modelConfig.heroImage;
  existingData.heroCredit = modelConfig.heroCredit;
  existingData.description = modelConfig.description;

  // Load state (tracks missing-since counters)
  const stateFile = path.join(STATE_DIR, `${slug}.json`);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    state = { missingSince: {} }; // sourceUrl → { count, firstMissed }
  }

  // Run all configured scrapers for this model
  const scrapedListings = [];

  for (const [sourceName, sourceConfig] of Object.entries(sources)) {
    const scraper = SCRAPERS[sourceName];
    if (!scraper) {
      console.warn(`  Unknown scraper: ${sourceName}`);
      continue;
    }

    try {
      const results = await scraper.scrape(sourceConfig, modelConfig);
      scrapedListings.push(...results);
    } catch (err) {
      console.error(`  [${sourceName}] Error: ${err.message}`);
      result.errors.push({ source: sourceName, error: err.message });
    }
  }

  console.log(`  Total scraped: ${scrapedListings.length} listings from all sources`);

  // Build a map of existing listings by source URL
  const existingBySourceUrl = new Map();
  for (const listing of existingData.listings) {
    for (const src of (listing.sources || [])) {
      existingBySourceUrl.set(src.url, listing);
    }
  }

  // Build a set of all source URLs found in this scrape
  const foundSourceUrls = new Set(scrapedListings.map(l => l.sourceUrl));

  // ── Merge Logic ──────────────────────────────────────────────────────

  // Track which existing listings got matched
  const matchedExistingIds = new Set();

  for (const scraped of scrapedListings) {
    const existingListing = existingBySourceUrl.get(scraped.sourceUrl);

    if (existingListing) {
      // ── Existing listing: check for updates ──
      matchedExistingIds.add(existingListing.id);

      // Price change detection
      const oldPrice = parsePrice(existingListing.price);
      const newPrice = parsePrice(scraped.price);
      if (oldPrice && newPrice && oldPrice !== newPrice) {
        // Log price history
        if (!existingListing.priceHistory) {
          existingListing.priceHistory = [];
        }
        existingListing.priceHistory.push({
          price: existingListing.price,
          date: today(),
        });
        existingListing.price = scraped.price;
        result.updatedCount++;
        result.priceChanges.push({
          title: existingListing.title,
          oldPrice: existingListing.price,
          newPrice: scraped.price,
          direction: newPrice < oldPrice ? 'reduced' : 'increased',
        });
      }

      // Update image if the existing one is empty
      if (!existingListing.image && scraped.image) {
        existingListing.image = scraped.image;
      }

      // Clear any missing-since counter
      delete state.missingSince[scraped.sourceUrl];

      // Ensure listing is active if it was unlisted but has reappeared
      if (existingListing.status === 'unlisted') {
        existingListing.status = 'active';
        delete existingListing.unlistedDate;
      }

    } else {
      // ── New listing: check it doesn't duplicate an existing one ──
      const duplicate = findDuplicate(scraped, existingData.listings);

      if (duplicate) {
        // Add as additional source to existing listing
        matchedExistingIds.add(duplicate.id);
        if (!duplicate.sources.some(s => s.url === scraped.sourceUrl)) {
          duplicate.sources.push({
            name: scraped.sourceName,
            url: scraped.sourceUrl,
          });
        }
        // Clear missing-since
        delete state.missingSince[scraped.sourceUrl];
      } else {
        // Genuinely new listing
        const newId = String(getNextId(existingData.listings));
        const newListing = {
          id: newId,
          title: scraped.title,
          price: scraped.price,
          year: scraped.year,
          mileage: scraped.mileage,
          transmission: scraped.transmission,
          image: scraped.image,
          featured: false,
          dateAdded: today(),
          status: 'active',
          sources: [{
            name: scraped.sourceName,
            url: scraped.sourceUrl,
          }],
        };
        existingData.listings.push(newListing);
        result.newCount++;
        result.newListings.push({ title: scraped.title, source: scraped.sourceName });
      }
    }
  }

  // ── Detect unlisted listings ──────────────────────────────────────────
  for (const listing of existingData.listings) {
    if (listing.status !== 'active') continue;

    // Check if ALL source URLs for this listing are missing from the scrape
    const allSourcesMissing = listing.sources.every(src => !foundSourceUrls.has(src.url));

    if (allSourcesMissing && listing.sources.length > 0) {
      // Use the first source URL as the key
      const key = listing.sources[0].url;

      if (!state.missingSince[key]) {
        state.missingSince[key] = { count: 1, firstMissed: today() };
      } else {
        state.missingSince[key].count++;
      }

      if (state.missingSince[key].count >= UNLISTED_THRESHOLD) {
        listing.status = 'unlisted';
        listing.unlistedDate = today();
        delete state.missingSince[key];
        result.unlistedCount++;
        result.unlistedListings.push({ title: listing.title });
      }
    } else {
      // Listing still found — clear any missing counter
      for (const src of listing.sources) {
        delete state.missingSince[src.url];
      }
    }
  }

  // ── Write updated data ────────────────────────────────────────────────
  fs.writeFileSync(dataFile, JSON.stringify(existingData, null, 2) + '\n', 'utf8');
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');

  console.log(`  Results: ${result.newCount} new, ${result.updatedCount} updated, ${result.unlistedCount} unlisted, ${result.errors.length} errors`);
  return result;
}

// ── Deduplication ─────────────────────────────────────────────────────────
/**
 * Check if a scraped listing is a duplicate of an existing one.
 * Matches on: same year + similar price (within 5%) + overlapping title words.
 */
function findDuplicate(scraped, existingListings) {
  const scrapedPrice = parsePrice(scraped.price);
  const scrapedYear = scraped.year;

  for (const existing of existingListings) {
    if (existing.status === 'sold') continue;

    // Never merge with a listing that already has a source from the same site.
    // If Cars & Classic has 5 listings, they are 5 different cars, not duplicates.
    // Duplicates are the *same* car appearing on *different* sites.
    if (existing.sources.some(s => s.name === scraped.sourceName)) continue;

    // Year must match
    if (existing.year !== scrapedYear) continue;

    // Price must be within 5% — both must have a real price
    const existingPrice = parsePrice(existing.price);
    if (!scrapedPrice || !existingPrice) continue;
    const ratio = scrapedPrice / existingPrice;
    if (ratio < 0.95 || ratio > 1.05) continue;

    // Title similarity: check if key words overlap
    const scrapedWords = titleWords(scraped.title);
    const existingWords = titleWords(existing.title);
    const overlap = scrapedWords.filter(w => existingWords.includes(w)).length;
    const minWords = Math.min(scrapedWords.length, existingWords.length);
    if (minWords > 0 && overlap / minWords >= 0.5) {
      return existing;
    }
  }

  return null;
}

function titleWords(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['for', 'sale', 'the', 'and', 'with'].includes(w));
}

function getNextId(listings) {
  const maxId = listings.reduce((max, l) => {
    const n = parseInt(l.id);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
  return maxId + 1;
}

// ── Summary Markdown ──────────────────────────────────────────────────────
function generateSummaryMarkdown(summary) {
  const lines = [];
  lines.push(`## Listings Refresh — ${summary.date}\n`);

  if (!summary.hasChanges) {
    lines.push('No changes detected.\n');
    return lines.join('\n');
  }

  // Summary table
  lines.push('| Model | New | Price Updates | No Longer Listed | Errors |');
  lines.push('|-------|-----|-------------|-----------------|--------|');
  for (const m of summary.models) {
    lines.push(`| ${m.make} ${m.model} | ${m.newCount} | ${m.updatedCount} | ${m.unlistedCount} | ${m.errors.length} |`);
  }
  lines.push('');

  // Details
  for (const m of summary.models) {
    if (m.newCount === 0 && m.updatedCount === 0 && m.unlistedCount === 0 && m.errors.length === 0) continue;

    lines.push(`### ${m.make} ${m.model}\n`);

    if (m.newListings.length > 0) {
      lines.push('**New listings:**');
      for (const l of m.newListings) {
        lines.push(`- ${l.title} (via ${l.source})`);
      }
      lines.push('');
    }

    if (m.priceChanges.length > 0) {
      lines.push('**Price changes:**');
      for (const p of m.priceChanges) {
        const arrow = p.direction === 'reduced' ? '↓' : '↑';
        lines.push(`- ${p.title}: ${p.oldPrice} → ${p.newPrice} ${arrow}`);
      }
      lines.push('');
    }

    if (m.unlistedListings.length > 0) {
      lines.push('**No longer listed:**');
      for (const l of m.unlistedListings) {
        lines.push(`- ${l.title}`);
      }
      lines.push('');
    }

    if (m.errors.length > 0) {
      lines.push('**Errors:**');
      for (const e of m.errors) {
        lines.push(`- ${e.source}: ${e.error}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Email Summary (plain text for nodemailer) ─────────────────────────────
function generateEmailBody(summary) {
  const lines = [];
  lines.push(`Collectorly Listings Refresh — ${summary.date}\n`);
  lines.push(`New: ${summary.totalNew} | Price updates: ${summary.totalUpdated} | No longer listed: ${summary.totalUnlisted} | Errors: ${summary.totalErrors}\n`);

  for (const m of summary.models) {
    if (m.newCount === 0 && m.updatedCount === 0 && m.unlistedCount === 0 && m.errors.length === 0) continue;
    lines.push(`\n--- ${m.make} ${m.model} ---`);
    for (const l of m.newListings) lines.push(`  NEW: ${l.title} (${l.source})`);
    for (const p of m.priceChanges) {
      const arrow = p.direction === 'reduced' ? 'DOWN' : 'UP';
      lines.push(`  PRICE ${arrow}: ${p.title}: ${p.oldPrice} -> ${p.newPrice}`);
    }
    for (const l of m.unlistedListings) lines.push(`  UNLISTED: ${l.title}`);
    for (const e of m.errors) lines.push(`  ERROR: ${e.source} - ${e.error}`);
  }

  return lines.join('\n');
}

// Export for use by email script
module.exports = { generateEmailBody };

// Only run when executed directly (not when required)
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
