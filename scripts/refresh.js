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
 *   node scripts/refresh.js --make BMW           # refresh all models for a make
 */

const fs = require('fs');
const path = require('path');
const { parsePrice, parseMileage, formatPrice, sourceUrlToId, titleMatchesModel, today, sleep } = require('./scrapers/base');

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
const HISTORY_DIR = path.join(DATA_DIR, 'history');
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
  const makeFilter = args.includes('--make') ? args[args.indexOf('--make') + 1] : null;

  // Load model registry
  const modelsData = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  let models = modelsData.models;

  if (slugFilter) {
    models = models.filter(m => m.slug === slugFilter);
    if (models.length === 0) {
      console.error(`No model found with slug: ${slugFilter}`);
      process.exit(1);
    }
  } else if (makeFilter) {
    models = models.filter(m => m.make.toLowerCase() === makeFilter.toLowerCase());
    if (models.length === 0) {
      console.error(`No models found for make: ${makeFilter}`);
      process.exit(1);
    }
    console.log(`Filtered to make: ${makeFilter} (${models.length} models)\n`);
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

  // ── AutoTrader make-level batching ──────────────────────────────────────
  // For full refreshes (no --slug), batch AutoTrader by make to reduce requests.
  // Single-model refreshes use the per-model scrape path.
  const isSingleModel = !!slugFilter;
  let autotraderBatchResults = {};  // slug → listings

  if (!isSingleModel) {
    // Group models by make for AutoTrader batching
    const makeGroups = {};
    for (const mc of models) {
      if (!mc.sources?.autotrader) continue;
      const make = mc.make;
      if (!makeGroups[make]) makeGroups[make] = [];
      makeGroups[make].push(mc);
    }

    const makes = Object.keys(makeGroups);
    // Randomise make order so scrape pattern differs each day
    for (let i = makes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [makes[i], makes[j]] = [makes[j], makes[i]];
    }

    console.log(`\n═══ AutoTrader Make-Level Batch Scrape ═══`);
    console.log(`Processing ${makes.length} makes: ${makes.join(', ')}\n`);

    for (const make of makes) {
      const modelConfigs = makeGroups[make];
      try {
        const results = await autotrader.scrapeMake(make, modelConfigs);
        Object.assign(autotraderBatchResults, results);
      } catch (err) {
        console.error(`  [AutoTrader Batch] Fatal error for ${make}: ${err.message}`);
        // Initialise empty results for all models in this make
        for (const mc of modelConfigs) {
          if (!autotraderBatchResults[mc.slug]) {
            autotraderBatchResults[mc.slug] = [];
          }
        }
      }

      // Randomised delay between makes (10-20 seconds)
      if (makes.indexOf(make) < makes.length - 1) {
        const delayMs = 10000 + Math.random() * 10000;
        console.log(`  [AutoTrader Batch] Waiting ${Math.round(delayMs / 1000)}s before next make...\n`);
        await sleep(delayMs);
      }
    }

    console.log(`\n═══ Per-Model Scrape (non-AutoTrader sources) ═══\n`);
  }

  // Process each model (skip models with no scraper sources configured)
  let skippedCount = 0;
  for (const modelConfig of models) {
    const sources = modelConfig.sources || {};
    if (Object.keys(sources).length === 0) {
      skippedCount++;
      continue;
    }

    console.log(`\n── ${modelConfig.make} ${modelConfig.model} ──`);

    const modelSummary = await processModel(modelConfig, isSingleModel, autotraderBatchResults);
    summary.models.push(modelSummary);
    summary.totalNew += modelSummary.newCount;
    summary.totalUpdated += modelSummary.updatedCount;
    summary.totalUnlisted += modelSummary.unlistedCount;
    summary.totalErrors += modelSummary.errors.length;
    if (modelSummary.newCount > 0 || modelSummary.updatedCount > 0 || modelSummary.unlistedCount > 0 || (modelSummary.notices && modelSummary.notices.length > 0)) {
      summary.hasChanges = true;
    }
  }

  if (skippedCount > 0) {
    console.log(`\nSkipped ${skippedCount} models with no scraper sources configured.`);
  }

  // Clean up Playwright browsers
  try {
    await autotrader.closeBrowser();
  } catch {
    // Ignore
  }
  try {
    await collectingcars.closeBrowser();
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
async function processModel(modelConfig, isSingleModel, autotraderBatchResults) {
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
    notices: [],
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

  // Run scrapers for this model
  const scrapedListings = [];

  for (const [sourceName, sourceConfig] of Object.entries(sources)) {
    // For AutoTrader in batch mode, use pre-scraped results
    if (sourceName === 'autotrader' && !isSingleModel && autotraderBatchResults[slug]) {
      const batchListings = autotraderBatchResults[slug];
      scrapedListings.push(...batchListings);
      console.log(`  [AutoTrader] ${batchListings.length} listings (from make-level batch)`);
      continue;
    }

    const scraper = SCRAPERS[sourceName];
    if (!scraper) {
      console.warn(`  Unknown scraper: ${sourceName}`);
      continue;
    }

    // Add randomised delay between scraper calls for anti-detection
    if (scrapedListings.length > 0) {
      await sleep(2000 + Math.random() * 3000);
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

  // ── Post-scrape validation ─────────────────────────────────────────────
  // Re-validate all scraped listings through titleMatchesModel + excludePatterns.
  // Scrapers already do this, but this is a safety net that also catches
  // borderline cases and tracks rejection rates.
  const preValidationCount = scrapedListings.length;
  const rejected = [];
  const borderline = [];
  for (let i = scrapedListings.length - 1; i >= 0; i--) {
    const listing = scrapedListings[i];
    const title = listing.title || '';

    // Check exclude patterns
    const excluded = (modelConfig.excludePatterns || []).some(p => new RegExp(p, 'i').test(title));
    if (excluded) {
      rejected.push({ title, source: listing.sourceName, reason: 'excludePattern' });
      scrapedListings.splice(i, 1);
      continue;
    }

    // Check title matches model
    if (!titleMatchesModel(title, modelConfig)) {
      // Also allow generation pattern matches (same logic as PistonHeads)
      const genPatterns = (modelConfig.generations || []).flatMap(g => g.patterns || []).map(p => p.toLowerCase());
      const titleNorm = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const matchesGen = genPatterns.some(p => {
        const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        return re.test(titleNorm);
      });
      if (!matchesGen) {
        rejected.push({ title, source: listing.sourceName, reason: 'titleMatchesModel' });
        scrapedListings.splice(i, 1);
        continue;
      }
    }

    // Borderline check: title contains a different model from the same make
    const makeLower = modelConfig.make.toLowerCase();
    const modelLower = (modelConfig.matchModel || modelConfig.model).toLowerCase();
    if (title.toLowerCase().includes(makeLower)) {
      // Look for other model identifiers from the same make that aren't our model
      const otherModelPattern = new RegExp(`\\b${makeLower}\\s+(\\S+)`, 'i');
      const match = title.match(otherModelPattern);
      if (match && match[1].toLowerCase() !== modelLower && !modelLower.includes(match[1].toLowerCase())) {
        borderline.push({ title, source: listing.sourceName, detected: match[1] });
      }
    }
  }

  const rejectedCount = preValidationCount - scrapedListings.length;
  if (rejectedCount > 0) {
    console.log(`  Post-validation: rejected ${rejectedCount}/${preValidationCount} listings`);
    for (const r of rejected) {
      console.log(`    ✗ "${r.title}" (${r.source}) — ${r.reason}`);
    }
    result.notices.push(`Post-validation rejected ${rejectedCount}/${preValidationCount} scraped listings`);
    result.rejectedListings = rejected;
  }
  if (borderline.length > 0) {
    console.log(`  Borderline listings (${borderline.length}):`);
    for (const b of borderline) {
      console.log(`    ? "${b.title}" (${b.source}) — detected "${b.detected}"`);
    }
    result.borderlineListings = borderline;
  }

  // Flag high rejection rate as a potential search URL issue
  if (preValidationCount > 0) {
    const rejectionRate = rejectedCount / preValidationCount;
    if (rejectionRate > 0.3) {
      const pct = Math.round(rejectionRate * 100);
      const msg = `High rejection rate: ${pct}% of scraped listings rejected — search URLs may need tightening`;
      console.warn(`  ⚠ ${msg}`);
      result.notices.push(msg);
    }
  }

  console.log(`  Validated: ${scrapedListings.length} listings passed post-validation`);

  // ── Scrape Collecting Cars sold results ────────────────────────────────
  if (sources.collectingcars) {
    try {
      const soldResults = await collectingcars.scrapeSold(sources.collectingcars, modelConfig);
      mergeSoldResults(soldResults, existingData, result);
    } catch (err) {
      console.error(`  [Collecting Cars Sold] Error: ${err.message}`);
      result.errors.push({ source: 'Collecting Cars (sold)', error: err.message });
    }
  }

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

  // Pick the more descriptive title (longer, with variant/trim info)
  function betterTitle(existingTitle, scrapedTitle) {
    if (!scrapedTitle) return existingTitle;
    if (!existingTitle) return scrapedTitle;
    // Strip filler words for comparison
    const clean = t => t.replace(/\b(used|for sale)\b/gi, '').replace(/\s+/g, ' ').trim();
    const a = clean(existingTitle);
    const b = clean(scrapedTitle);
    // Prefer the longer, more descriptive title
    return b.length > a.length ? scrapedTitle : existingTitle;
  }

  // Track which existing listings got matched
  const matchedExistingIds = new Set();

  for (const scraped of scrapedListings) {
    const existingListing = existingBySourceUrl.get(scraped.sourceUrl);

    if (existingListing) {
      // ── Existing listing: check for updates ──
      matchedExistingIds.add(existingListing.id);

      // Price change detection
      const oldPriceNum = parsePrice(existingListing.price);
      const newPriceNum = parsePrice(scraped.price);
      if (oldPriceNum && newPriceNum && oldPriceNum !== newPriceNum) {
        // Log price history
        if (!existingListing.priceHistory) {
          existingListing.priceHistory = [];
        }
        existingListing.priceHistory.push({
          price: existingListing.price,
          date: today(),
        });
        const oldPriceStr = existingListing.price;
        existingListing.price = scraped.price;
        result.updatedCount++;
        result.priceChanges.push({
          title: existingListing.title,
          oldPrice: oldPriceStr,
          newPrice: scraped.price,
          direction: newPriceNum < oldPriceNum ? 'reduced' : 'increased',
        });
      }

      // Update title if scraped version is more descriptive
      existingListing.title = betterTitle(existingListing.title, scraped.title);

      // Update mileage/transmission if currently missing
      if ((!existingListing.mileage || existingListing.mileage === 'N/A') && scraped.mileage && scraped.mileage !== 'N/A') {
        existingListing.mileage = scraped.mileage;
      }
      if ((!existingListing.transmission || existingListing.transmission === 'Unknown') && scraped.transmission && scraped.transmission !== 'Unknown') {
        existingListing.transmission = scraped.transmission;
      }
      if (!existingListing.bodyType && scraped.bodyType) {
        existingListing.bodyType = scraped.bodyType;
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
        // Update title if scraped version is more descriptive
        duplicate.title = betterTitle(duplicate.title, scraped.title);
        // Backfill image if missing
        if (!duplicate.image && scraped.image) {
          duplicate.image = scraped.image;
        }
        // Backfill mileage/transmission if missing
        if ((!duplicate.mileage || duplicate.mileage === 'N/A') && scraped.mileage && scraped.mileage !== 'N/A') {
          duplicate.mileage = scraped.mileage;
        }
        if ((!duplicate.transmission || duplicate.transmission === 'Unknown') && scraped.transmission && scraped.transmission !== 'Unknown') {
          duplicate.transmission = scraped.transmission;
        }
        if (!duplicate.bodyType && scraped.bodyType) {
          duplicate.bodyType = scraped.bodyType;
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
          bodyType: scraped.bodyType || null,
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

  // ── Scraper failure detection ─────────────────────────────────────────
  // If a scraper returned 0 results but we have many active listings from
  // that source, it's likely a scraper failure — skip unlisting for those.
  const activeBySource = {};
  for (const listing of existingData.listings) {
    if (listing.status !== 'active') continue;
    for (const src of listing.sources || []) {
      activeBySource[src.name] = (activeBySource[src.name] || 0) + 1;
    }
  }
  const scrapedBySource = {};
  for (const s of scrapedListings) {
    scrapedBySource[s.sourceName] = (scrapedBySource[s.sourceName] || 0) + 1;
  }
  const failedSources = new Set();
  const MIN_LISTINGS_FOR_CHECK = 10;
  for (const [sourceName, activeCount] of Object.entries(activeBySource)) {
    const scrapedCount = scrapedBySource[sourceName] || 0;
    if (activeCount >= MIN_LISTINGS_FOR_CHECK && scrapedCount === 0) {
      failedSources.add(sourceName);
      const msg = `${sourceName} returned 0 results but had ${activeCount} active listings — scraper failure suspected, skipping unlisting for this source`;
      console.warn(`  ⚠ ${msg}`);
      result.notices.push(msg);
    }
  }

  // ── Detect unlisted listings ──────────────────────────────────────────
  for (const listing of existingData.listings) {
    if (listing.status !== 'active') continue;

    // Check if ALL source URLs for this listing are missing from the scrape
    const allSourcesMissing = listing.sources.every(src => !foundSourceUrls.has(src.url));

    if (allSourcesMissing && listing.sources.length > 0) {
      // If any of this listing's sources are in the failed set, skip unlisting
      const hasFailedSource = listing.sources.some(src => failedSources.has(src.name));
      if (hasFailedSource) continue;

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

  // ── Save daily price snapshot for analysis ──────────────────────────
  saveSnapshot(slug, existingData);

  console.log(`  Results: ${result.newCount} new, ${result.updatedCount} updated, ${result.unlistedCount} unlisted, ${result.errors.length} errors`);
  return result;
}

// ── Daily Price Snapshot ─────────────────────────────────────────────────
/**
 * Save a daily price snapshot for this model.
 * Records every active listing's price data for aggregate analysis.
 */
function saveSnapshot(slug, existingData) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  const historyFile = path.join(HISTORY_DIR, `${slug}.json`);

  let history;
  try {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  } catch {
    history = [];
  }

  const dateStr = today();

  // Build snapshot from active listings only
  const activeListings = (existingData.listings || []).filter(l => l.status === 'active');

  const snapshot = {
    date: dateStr,
    listings: activeListings.map(l => ({
      id: l.id,
      price: parsePrice(l.price),
      year: l.year || null,
      mileage: parseMileage(l.mileage),
      transmission: l.transmission || 'Unknown',
      status: 'active',
    })).filter(l => l.price !== null),
  };

  // Idempotent: replace today's entry if re-run, otherwise append
  const existingIndex = history.findIndex(s => s.date === dateStr);
  if (existingIndex >= 0) {
    history[existingIndex] = snapshot;
  } else {
    history.push(snapshot);
  }

  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2) + '\n', 'utf8');
  console.log(`  Snapshot: ${snapshot.listings.length} active listings recorded for ${dateStr}`);
}

// ── Sold Results Merge ───────────────────────────────────────────────────
/**
 * Merge scraped sold results into existing data.
 * Matches by source URL; adds new sold listings, backfills images on existing.
 */
function mergeSoldResults(soldListings, existingData, result) {
  // Build lookup of existing listings by source URL
  const existingByUrl = new Map();
  for (const listing of existingData.listings) {
    for (const src of (listing.sources || [])) {
      existingByUrl.set(src.url, listing);
    }
  }

  for (const sold of soldListings) {
    const existing = existingByUrl.get(sold.sourceUrl);

    if (existing) {
      // Update image if missing
      if (!existing.image && sold.image) {
        existing.image = sold.image;
      }
      // Update soldPrice/soldDate if missing
      if (!existing.soldPrice && sold.soldPrice) {
        existing.soldPrice = sold.soldPrice;
      }
      if (!existing.soldDate && sold.soldDate) {
        existing.soldDate = sold.soldDate;
      }
      // Ensure status and price field are set
      if (existing.status !== 'sold') {
        existing.status = 'sold';
      }
      if (!existing.price || existing.price === 'POA') {
        existing.price = 'Sold';
      }
    } else {
      // New sold listing
      const newId = String(getNextId(existingData.listings));
      existingData.listings.push({
        id: newId,
        title: sold.title,
        price: 'Sold',
        year: sold.year,
        mileage: sold.mileage || 'N/A',
        transmission: sold.transmission || 'Unknown',
        bodyType: sold.bodyType || null,
        image: sold.image || '',
        featured: false,
        dateAdded: today(),
        status: 'sold',
        soldPrice: sold.soldPrice || '',
        soldDate: sold.soldDate || '',
        sources: [{ name: sold.sourceName, url: sold.sourceUrl }],
      });
      result.newCount++;
      result.newListings.push({ title: sold.title, source: 'Collecting Cars (sold)' });
    }
  }
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

  // Collect all notices across models
  const allNotices = [];
  for (const m of summary.models) {
    for (const notice of (m.notices || [])) {
      allNotices.push(`**${m.make} ${m.model}:** ${notice}`);
    }
  }
  if (allNotices.length > 0) {
    lines.push('### ⚠️ Notices\n');
    for (const n of allNotices) {
      lines.push(`- ${n}`);
    }
    lines.push('');
  }

  if (!summary.hasChanges && allNotices.length === 0) {
    lines.push('No changes detected.\n');
    return lines.join('\n');
  }

  // Summary totals
  lines.push(`**Totals:** ${summary.totalNew} new | ${summary.totalUpdated} price updates | ${summary.totalUnlisted} no longer listed | ${summary.totalErrors} errors\n`);

  // Summary table — only models with activity
  const activeModels = summary.models.filter(m => m.newCount > 0 || m.updatedCount > 0 || m.unlistedCount > 0 || m.errors.length > 0);
  if (activeModels.length > 0) {
    lines.push('| Model | New | Price Updates | No Longer Listed | Errors |');
    lines.push('|-------|-----|-------------|-----------------|--------|');
    for (const m of activeModels) {
      lines.push(`| ${m.make} ${m.model} | ${m.newCount} | ${m.updatedCount} | ${m.unlistedCount} | ${m.errors.length} |`);
    }
    lines.push('');
  }

  const inactiveCount = summary.models.length - activeModels.length;
  if (inactiveCount > 0) {
    lines.push(`*${inactiveCount} models with no changes omitted.*\n`);
  }

  // Details
  for (const m of summary.models) {
    const hasRejected = m.rejectedListings && m.rejectedListings.length > 0;
    const hasBorderline = m.borderlineListings && m.borderlineListings.length > 0;
    if (m.newCount === 0 && m.updatedCount === 0 && m.unlistedCount === 0 && m.errors.length === 0 && !hasRejected && !hasBorderline) continue;

    lines.push(`### ${m.make} ${m.model}\n`);

    if (hasRejected) {
      lines.push('**Rejected listings (false positives filtered):**');
      for (const r of m.rejectedListings) {
        lines.push(`- ✗ ${r.title} (via ${r.source}) — ${r.reason}`);
      }
      lines.push('');
    }

    if (hasBorderline) {
      lines.push('**Borderline listings (review recommended):**');
      for (const b of m.borderlineListings) {
        lines.push(`- ? ${b.title} (via ${b.source}) — detected "${b.detected}"`);
      }
      lines.push('');
    }

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

  let result = lines.join('\n');

  // GitHub Issues have a 65536 character body limit — truncate if needed
  const MAX_ISSUE_CHARS = 64000; // leave headroom
  if (result.length > MAX_ISSUE_CHARS) {
    result = result.slice(0, MAX_ISSUE_CHARS) + '\n\n---\n*Summary truncated — full details in the workflow artifact.*\n';
  }

  return result;
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
