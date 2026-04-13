/**
 * AutoTrader scraper — uses Playwright (headless Chromium).
 *
 * Two modes:
 *
 * 1. Per-model scrape (used for --slug single-model refreshes):
 *    Phase 1 — Friendly URL (sourceConfig.searchUrl)
 *     - Extract listings from Apollo GraphQL cache (rich data)
 *    Phase 2 — Search URL (parsed from sourceConfig.searchUrl) with pagination
 *     - Paginate through search pages, extract from DOM
 *     - Merge with Phase 1 results, preferring Apollo data
 *
 * 2. Make-level batch scrape (used for full refreshes):
 *    - Single broad search per make (no model filter) with pagination
 *    - Results matched to individual models via titleMatchesModel
 *    - Drastically reduces total AutoTrader requests (13 make-level
 *      searches vs 170+ per-model searches)
 */

const { extractYear, normaliseTransmission, normaliseBodyType, titleMatchesModel, today, sleep } = require('./base');

const SOURCE_NAME = 'AutoTrader';
const MAX_PAGES = 10;
const MAX_MAKE_PAGES = 25;   // Higher limit for make-level (covers many models)
const DEFAULT_POSTCODE = 'SW1A1AA';
const DEFAULT_RADIUS = 1500;

// Makes where body type is ambiguous in titles — run per-model body-type searches
const MAKE_LEVEL_BODY_SPLITS = {
  'BMW': ['Coupe', 'Convertible', 'Saloon', 'Estate'],
  'Mercedes-AMG': ['Coupe', 'Convertible', 'Saloon', 'Estate'],
};
const PER_MODEL_BODY_SPLITS = {
  'BMW': ['Coupe', 'Convertible', 'Saloon', 'Estate'],
  'Mercedes-AMG': ['Coupe', 'Convertible', 'Saloon', 'Estate'],
};

/**
 * Determine which body types to search for a given model.
 * Uses bodyTypeRules to narrow down — e.g. BMW M2 only needs Coupe.
 */
function getRelevantBodyTypes(modelConfig, allSplits) {
  const rules = modelConfig.bodyTypeRules;
  if (!rules) return allSplits;

  const relevant = new Set();
  if (rules.defaultBodyType) relevant.add(rules.defaultBodyType);
  if (rules.generationOverrides) {
    for (const bt of Object.values(rules.generationOverrides)) relevant.add(bt);
  }
  if (rules.titlePatterns) {
    for (const bt of Object.keys(rules.titlePatterns)) {
      // Normalise: "Gran Coupe" is in normaliseBodyType but also valid as filter
      const norm = bt === 'Gran Coupe' ? 'Coupe' : bt;
      relevant.add(norm);
    }
  }

  // Filter to only body types that are in the split list
  const filtered = allSplits.filter(bt => relevant.has(bt));
  return filtered.length > 0 ? filtered : allSplits;
}

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const { chromium } = require('playwright');
  browser = await chromium.launch({ headless: true });
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Create a fresh browser context with realistic fingerprinting.
 */
async function createContext(b) {
  return b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });
}

/**
 * Randomised delay for anti-detection.
 */
function randomDelay(minMs, maxMs) {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

/**
 * Extract advert data from the Apollo GraphQL cache (available on friendly URL pages).
 */
async function extractApolloAdverts(page) {
  return page.evaluate(() => {
    const state = window.AT_APOLLO_STATE;
    if (!state || !state.ROOT_QUERY) return null;

    const root = state.ROOT_QUERY;
    const searchData = root.search;
    if (!searchData) return null;

    const adverts = [];
    const seen = new Set();

    function findAdverts(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) findAdverts(item);
        return;
      }
      if (obj.id && obj.title && obj.year != null && obj.price != null) {
        if (!seen.has(obj.id)) {
          seen.add(obj.id);
          adverts.push({
            id: String(obj.id),
            title: obj.title,
            year: obj.year,
            price: obj.price,
            mileage: obj.mileage?.mileage || null,
            image: obj.imageList?.images?.[0]?.url || null,
            bodyType: obj.bodyType || obj.vehicleType || null,
          });
        }
      }
      for (const [key, val] of Object.entries(obj)) {
        if (key === '__typename') continue;
        findAdverts(val);
      }
    }

    findAdverts(searchData);
    return adverts;
  });
}

/**
 * Extract listing data from search page DOM text nodes.
 * @param {object} page - Playwright page
 * @param {string} make - Car make name (e.g., "Ferrari") for accurate title detection
 * Returns array of { id, title, price, year, mileage, image }.
 */
async function extractSearchPageListings(page, make) {
  return page.evaluate((makeName) => {
    const links = [...document.querySelectorAll('a[href*="/car-details/"]')];
    const seenIds = new Set();
    const results = [];
    const makePattern = new RegExp(makeName, 'i');

    for (const link of links) {
      const m = link.href.match(/car-details\/(\d+)/);
      if (!m || seenIds.has(m[1])) continue;
      seenIds.add(m[1]);

      // Walk up to find the card container
      let container = link.closest('li') || link.closest('article');
      if (!container) {
        container = link;
        for (let i = 0; i < 8; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;
          const hasImage = container.querySelector('img');
          const text = container.textContent || '';
          if (hasImage && text.includes('miles') && /£/.test(text)) break;
        }
      }

      // Collect text nodes
      const texts = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node;
      while (node = walker.nextNode()) {
        const t = node.textContent.trim();
        if (t && t.length > 1) texts.push(t);
      }

      // Find the make+model line and variant/trim line
      let titleParts = [];
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        if (makePattern.test(t)) {
          titleParts.push(t);
          // Always include the next line (trim/variant) unless it's a price
          // e.g. "BMW 8 Series" + "M8 Competition 4.4 V8 2dr"
          if (texts[i + 1] && !texts[i + 1].includes('£') && !/^Save|^Toggle|^Loading/i.test(texts[i + 1])) {
            titleParts.push(texts[i + 1]);
          }
          break;
        }
      }

      // Extract price
      let price = '';
      for (const t of texts) {
        const pm = t.match(/^£[\d,]+$/);
        if (pm) { price = pm[0]; break; }
      }

      // Extract mileage
      let mileage = '';
      for (const t of texts) {
        const mm = t.match(/([\d,]+)\s*miles/i);
        if (mm) { mileage = t; break; }
      }

      // Extract year from "2015 (15 reg)" pattern
      let year = null;
      for (const t of texts) {
        const ym = t.match(/^(\d{4})\s*\(/);
        if (ym) { year = parseInt(ym[1]); break; }
      }

      // Image
      const img = container.querySelector('img[src*="atcdn"]');

      // Extract body type from spec text (AutoTrader cards show "Coupe", "Convertible" etc.)
      let bodyType = null;
      const bodyPatterns = /\b(coupe|coupé|convertible|cabriolet|saloon|sedan|estate|hatchback|suv|roadster|targa|speedster)\b/i;
      for (const t of texts) {
        const bm = t.match(bodyPatterns);
        if (bm) { bodyType = bm[1]; break; }
      }

      const title = titleParts.join(' ').trim();

      results.push({
        id: m[1],
        title: title || '',
        price: price || 'POA',
        year,
        mileage: mileage || 'N/A',
        image: img ? img.src : '',
        bodyType: bodyType || null,
      });
    }

    return results;
  }, make);
}

/**
 * Parse make and model slugs from a sourceConfig.searchUrl.
 * e.g. "https://www.autotrader.co.uk/cars/used/bmw/m3/" → { make: "bmw", model: "m3" }
 */
function parseMakeModelFromUrl(searchUrl) {
  try {
    const url = new URL(searchUrl);
    // Friendly URL format: /cars/used/{make}/{model}/
    const pathParts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    // Expected: ["cars", "used", "bmw", "m3"] or similar
    const usedIdx = pathParts.indexOf('used');
    if (usedIdx >= 0 && pathParts[usedIdx + 1] && pathParts[usedIdx + 2]) {
      return { make: pathParts[usedIdx + 1], model: pathParts[usedIdx + 2] };
    }
    // Also try /car-search? URL params
    const makeParam = url.searchParams.get('make');
    const modelParam = url.searchParams.get('model');
    if (makeParam && modelParam) {
      return { make: makeParam, model: modelParam };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Scrape AutoTrader listings for a single model (per-model mode).
 * Used for --slug single-model refreshes.
 */
async function scrape(sourceConfig, modelConfig) {
  console.log(`  [AutoTrader] Fetching: ${sourceConfig.searchUrl}`);

  const b = await getBrowser();
  const context = await createContext(b);
  const page = await context.newPage();

  try {
    const apolloMap = new Map();  // id → Apollo data (rich)
    const searchMap = new Map();  // id → DOM-scraped data (basic)

    // ── Phase 1: Friendly URL for Apollo cache data ──
    await page.goto(sourceConfig.searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!window.AT_APOLLO_STATE, { timeout: 15000 }).catch(() => {
      console.warn('  [AutoTrader] Apollo state not found within timeout, continuing with search pages');
    });

    const apolloAdverts = await extractApolloAdverts(page);
    if (apolloAdverts) {
      for (const a of apolloAdverts) {
        apolloMap.set(a.id, a);
      }
      console.log(`  [AutoTrader] Friendly URL: ${apolloMap.size} listings from Apollo cache`);
    }

    // ── Phase 2: Search URL with pagination for complete results ──
    // Parse make/model from the known-good sourceConfig.searchUrl instead of using modelConfig.model
    const parsed = parseMakeModelFromUrl(sourceConfig.searchUrl);
    let searchBaseUrl;
    if (parsed) {
      searchBaseUrl = `https://www.autotrader.co.uk/car-search?postcode=${DEFAULT_POSTCODE}&radius=${DEFAULT_RADIUS}&make=${encodeURIComponent(parsed.make)}&model=${encodeURIComponent(parsed.model)}&advertising-location=at_cars`;
    } else {
      // Fallback: use modelConfig directly (may not be perfect for all models)
      searchBaseUrl = `https://www.autotrader.co.uk/car-search?postcode=${DEFAULT_POSTCODE}&radius=${DEFAULT_RADIUS}&make=${encodeURIComponent(modelConfig.make)}&model=${encodeURIComponent(modelConfig.model)}&advertising-location=at_cars`;
    }

    const perModelSplits = PER_MODEL_BODY_SPLITS[modelConfig.make];
    const relevantBTs = perModelSplits ? getRelevantBodyTypes(modelConfig, perModelSplits) : null;
    const perModelVariants = relevantBTs
      ? relevantBTs.map(bt => ({ url: `${searchBaseUrl}&body-type=${bt}`, bodyType: bt }))
      : [{ url: searchBaseUrl, bodyType: null }];

    if (relevantBTs) {
      console.log(`  [AutoTrader] Scraping ${relevantBTs.length} body type splits (${relevantBTs.join(', ')})`);
    }

    for (const variant of perModelVariants) {
      const label = variant.bodyType ? `${variant.bodyType}` : 'all';

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const pageUrl = `${variant.url}&page=${pageNum}`;
        console.log(`  [AutoTrader] Fetching search page ${pageNum}${variant.bodyType ? ` (${variant.bodyType})` : ''}`);

        await randomDelay(3000, 7000);

        try {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForSelector('a[href*="/car-details/"]', { timeout: 15000 }).catch(() => {});
        } catch (navErr) {
          console.warn(`  [AutoTrader] Navigation failed for page ${pageNum} (${label}): ${navErr.message}`);
          break;
        }

        const pageListings = await extractSearchPageListings(page, modelConfig.make);

        // Tag each listing with the body type from the URL filter
        if (variant.bodyType) {
          for (const listing of pageListings) {
            listing.bodyType = variant.bodyType;
          }
        }

        let newCount = 0;
        for (const listing of pageListings) {
          if (!searchMap.has(listing.id) && !apolloMap.has(listing.id)) {
            newCount++;
          }
          if (!searchMap.has(listing.id)) {
            searchMap.set(listing.id, listing);
          }
        }

        console.log(`  [AutoTrader] Search page ${pageNum}${variant.bodyType ? ` (${variant.bodyType})` : ''}: ${pageListings.length} listings (${newCount} new)`);

        if (pageListings.length === 0 || newCount === 0) break;
      }

      // Delay between body type splits
      if (perModelSplits && variant !== perModelVariants[perModelVariants.length - 1]) {
        await randomDelay(3000, 7000);
      }
    }

    // ── Merge results ──
    const allIds = new Set([...apolloMap.keys(), ...searchMap.keys()]);
    console.log(`  [AutoTrader] Total: ${allIds.size} unique listings (${apolloMap.size} with rich data)`);

    const listings = [];
    for (const id of allIds) {
      const listing = buildListing(id, apolloMap.get(id), searchMap.get(id), modelConfig);
      if (listing) listings.push(listing);
    }

    console.log(`  [AutoTrader] Successfully scraped ${listings.length} listings`);
    return listings;
  } catch (err) {
    console.error(`  [AutoTrader] SCRAPER FAILURE: ${err.message}`);
    return [];
  } finally {
    await context.close();
  }
}

/**
 * Make-level batch scrape: search AutoTrader for an entire make at once,
 * then match results to individual models via titleMatchesModel.
 *
 * @param {string} make - Make name (e.g. "Ferrari", "BMW")
 * @param {Array} modelConfigs - Array of modelConfig objects for this make
 * @returns {Object} Map of slug → Array of listing objects
 */
async function scrapeMake(make, modelConfigs) {
  console.log(`\n  [AutoTrader Batch] Scraping make: ${make} (${modelConfigs.length} models)`);

  const b = await getBrowser();
  let context = await createContext(b);
  let page = await context.newPage();

  // Result map: slug → listings
  const resultsBySlug = {};
  for (const mc of modelConfigs) {
    resultsBySlug[mc.slug] = [];
  }

  try {
    const allListings = new Map(); // id → { apollo?, search? }

    // ── Phase 1: Friendly URL for each model's Apollo cache ──
    // Visit every model URL to get rich Apollo data (full titles, body type, etc.)
    // This ensures rare models buried deep in make-level search still get coverage.
    const modelsForApollo = modelConfigs
      .filter(mc => mc.sources?.autotrader?.searchUrl);

    for (const mc of modelsForApollo) {
      const searchUrl = mc.sources.autotrader.searchUrl;
      console.log(`  [AutoTrader Batch] Apollo pass: ${mc.model}`);

      await randomDelay(3000, 7000);

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => !!window.AT_APOLLO_STATE, { timeout: 15000 }).catch(() => {});

        const apolloAdverts = await extractApolloAdverts(page);
        if (apolloAdverts) {
          for (const a of apolloAdverts) {
            if (!allListings.has(a.id)) {
              allListings.set(a.id, { apollo: a });
            }
          }
          console.log(`  [AutoTrader Batch] Apollo: ${apolloAdverts.length} listings for ${mc.model}`);
        }
      } catch (err) {
        console.warn(`  [AutoTrader Batch] Apollo pass failed for ${mc.model}: ${err.message}`);
      }
    }

    // ── Phase 2: Search with pagination ──
    const bodyTypeSplits = MAKE_LEVEL_BODY_SPLITS[make];

    if (bodyTypeSplits) {
      // Per-model + per-body-type scraping (targeted, avoids make-level pagination limits)
      console.log(`  [AutoTrader Batch] ${make}: per-model body type scraping`);

      let modelIdx = 0;
      for (const mc of modelsForApollo) {
        const parsed = parseMakeModelFromUrl(mc.sources.autotrader.searchUrl);
        if (!parsed) continue;

        const modelSearchBase = `https://www.autotrader.co.uk/car-search?postcode=${DEFAULT_POSTCODE}&radius=${DEFAULT_RADIUS}&make=${encodeURIComponent(parsed.make)}&model=${encodeURIComponent(parsed.model)}&advertising-location=at_cars`;
        const relevantBodyTypes = getRelevantBodyTypes(mc, bodyTypeSplits);

        const modelCounts = {};
        for (const bodyType of relevantBodyTypes) {
          const searchUrl = `${modelSearchBase}&body-type=${bodyType}`;
          let btTotal = 0;

          for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
            const pageUrl = `${searchUrl}&page=${pageNum}`;
            console.log(`  [AutoTrader Batch] ${mc.model} ${bodyType} p${pageNum}`);

            await randomDelay(3000, 7000);

            try {
              await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await page.waitForSelector('a[href*="/car-details/"]', { timeout: 15000 }).catch(() => {});
            } catch (navErr) {
              console.warn(`  [AutoTrader Batch] Navigation failed: ${mc.model} ${bodyType} p${pageNum}: ${navErr.message}`);
              break;
            }

            const pageListings = await extractSearchPageListings(page, make);

            // Tag each listing with the body type from the URL filter
            for (const listing of pageListings) {
              listing.bodyType = bodyType;
            }

            let newCount = 0;
            for (const listing of pageListings) {
              if (!allListings.has(listing.id)) {
                newCount++;
                allListings.set(listing.id, { search: listing });
              } else if (!allListings.get(listing.id).search) {
                allListings.get(listing.id).search = listing;
              }
            }

            btTotal += newCount;
            if (pageListings.length === 0 || newCount === 0) break;
          }

          modelCounts[bodyType] = btTotal;

          // Delay between body type searches for the same model
          await randomDelay(2000, 5000);
        }

        const countStr = Object.entries(modelCounts).map(([bt, n]) => `${bt} ${n}`).join(', ');
        const modelTotal = Object.values(modelCounts).reduce((a, b) => a + b, 0);
        console.log(`  [AutoTrader Batch] ${mc.model}: ${countStr} = ${modelTotal} total`);

        modelIdx++;
        // Longer delay between models, fresh context every 5 models
        if (modelIdx < modelsForApollo.length) {
          await randomDelay(10000, 20000);
          if (modelIdx % 5 === 0) {
            console.log(`  [AutoTrader Batch] Rotating browser context`);
            await context.close();
            context = await createContext(b);
            page = await context.newPage();
          }
        }
      }
    } else {
      // Standard make-level search (no body type splits)
      const searchBaseUrl = `https://www.autotrader.co.uk/car-search?postcode=${DEFAULT_POSTCODE}&radius=${DEFAULT_RADIUS}&make=${encodeURIComponent(make)}&advertising-location=at_cars`;

      for (let pageNum = 1; pageNum <= MAX_MAKE_PAGES; pageNum++) {
        const pageUrl = `${searchBaseUrl}&page=${pageNum}`;
        console.log(`  [AutoTrader Batch] Search page ${pageNum} for ${make}`);

        await randomDelay(3000, 7000);

        try {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForSelector('a[href*="/car-details/"]', { timeout: 15000 }).catch(() => {});
        } catch (navErr) {
          console.warn(`  [AutoTrader Batch] Navigation failed for page ${pageNum}: ${navErr.message}`);
          break;
        }

        const pageListings = await extractSearchPageListings(page, make);

        let newCount = 0;
        for (const listing of pageListings) {
          if (!allListings.has(listing.id)) {
            newCount++;
            allListings.set(listing.id, { search: listing });
          } else if (!allListings.get(listing.id).search) {
            allListings.get(listing.id).search = listing;
          }
        }

        console.log(`  [AutoTrader Batch] Page ${pageNum}: ${pageListings.length} listings (${newCount} new)`);

        if (pageListings.length === 0 || newCount === 0) break;
      }
    }

    console.log(`  [AutoTrader Batch] Total unique listings for ${make}: ${allListings.size}`);

    // ── Match listings to models ──
    let matched = 0;
    let unmatched = 0;

    for (const [id, data] of allListings) {
      const apollo = data.apollo;
      const search = data.search;

      // Try each model config to find a match
      let assignedToModel = false;
      for (const mc of modelConfigs) {
        if (!mc.sources?.autotrader) continue;

        const listing = buildListing(id, apollo, search, mc);
        if (listing) {
          resultsBySlug[mc.slug].push(listing);
          assignedToModel = true;
          matched++;
          break; // Assign to first matching model only
        }
      }

      if (!assignedToModel) unmatched++;
    }

    console.log(`  [AutoTrader Batch] Matched: ${matched}, Unmatched: ${unmatched}`);

    // Check for models that got 0 results
    for (const mc of modelConfigs) {
      if (!mc.sources?.autotrader) continue;
      const count = resultsBySlug[mc.slug].length;
      if (count === 0) {
        console.warn(`  [AutoTrader Batch] ${mc.make} ${mc.model}: 0 listings matched`);
      } else {
        console.log(`  [AutoTrader Batch] ${mc.make} ${mc.model}: ${count} listings`);
      }
    }

    // Check for total failure (0 listings found = likely blocked)
    if (allListings.size === 0) {
      console.error(`  [AutoTrader Batch] ⚠ AutoTrader appears to be blocking requests — make-level search for ${make} returned 0 results`);
    }

    return resultsBySlug;
  } catch (err) {
    console.error(`  [AutoTrader Batch] SCRAPER FAILURE for ${make}: ${err.message}`);
    return resultsBySlug;
  } finally {
    await context.close();
  }
}

/**
 * Build a normalised listing object from Apollo and/or search data.
 * Returns null if the listing doesn't match the model.
 */
function buildListing(id, apollo, search, modelConfig) {
  const sourceUrl = `https://www.autotrader.co.uk/car-details/${id}`;

  if (apollo) {
    const title = cleanTitle(apollo.title, apollo.year);
    if (!titleMatchesModel(title, modelConfig)) return null;

    let image = apollo.image || '';
    if (image) image = image.replace(/\{resize\}/g, 'w640');

    const price = apollo.price > 0
      ? `£${apollo.price.toLocaleString('en-GB')}`
      : 'POA';

    const mileage = apollo.mileage
      ? `${apollo.mileage.toLocaleString('en-GB')} miles`
      : 'N/A';

    return {
      title,
      price,
      year: apollo.year,
      mileage,
      transmission: normaliseTransmission(apollo.title),
      bodyType: normaliseBodyType(apollo.bodyType || title),
      image,
      sourceUrl,
      sourceName: SOURCE_NAME,
      scrapedAt: today(),
    };
  }

  if (search) {
    const year = search.year || extractYear(search.title);
    const title = cleanTitle(search.title, year);
    if (!titleMatchesModel(title, modelConfig)) return null;

    let image = search.image || '';
    if (image) image = image.replace(/\{resize\}/g, 'w640');

    const rawBodyType = search.bodyType || title;

    return {
      title,
      price: search.price || 'POA',
      year,
      mileage: search.mileage || 'N/A',
      transmission: normaliseTransmission(search.title),
      bodyType: normaliseBodyType(rawBodyType),
      image,
      sourceUrl,
      sourceName: SOURCE_NAME,
      scrapedAt: today(),
    };
  }

  return null;
}

function cleanTitle(raw, year) {
  let title = raw.trim();
  if (year && !title.startsWith(String(year))) {
    title = title.replace(new RegExp(`\\b${year}\\b`), '').trim();
    title = `${year} ${title}`;
  }
  return title;
}

module.exports = { scrape, scrapeMake, closeBrowser, SOURCE_NAME };
