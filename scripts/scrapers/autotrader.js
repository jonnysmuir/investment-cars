/**
 * AutoTrader scraper — uses Playwright (headless Chromium).
 *
 * Strategy:
 *  Phase 1 — Friendly URL (/cars/used/{make}/{model})
 *   - Extract listings from Apollo GraphQL cache (rich data: title, year, price, mileage, images)
 *   - This typically yields ~12 results
 *
 *  Phase 2 — Search URL (/car-search?...) with pagination
 *   - Build a search URL using make/model from the friendly URL
 *   - Paginate through ?page=1, ?page=2, etc.
 *   - Extract listing data from DOM text nodes (no Apollo cache on search pages)
 *   - Merge with Phase 1 results, preferring Apollo data when available
 *
 * IMPORTANT: Individual /car-details/ID pages are fully JS-rendered (Apollo/React)
 * and return no useful data via fetch. Must use the search/friendly URL.
 */

const { extractYear, normaliseTransmission, titleMatchesModel, today, sleep } = require('./base');

const SOURCE_NAME = 'AutoTrader';
const MAX_PAGES = 10;
const DEFAULT_POSTCODE = 'SW1A1AA';
const DEFAULT_RADIUS = 1500;

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
      // Look for text containing the make name (e.g., "Ferrari 458")
      // followed by the trim line (e.g., "4.5 Speciale A Spider F1 DCT Euro 5 2dr")
      let titleParts = [];
      for (let i = 0; i < texts.length; i++) {
        const t = texts[i];
        if (makePattern.test(t)) {
          titleParts.push(t);
          // Check next text for variant/trim (starts with a digit like "4.5 ...")
          if (texts[i + 1] && !texts[i + 1].includes('£') && /^\d/.test(texts[i + 1])) {
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

      const title = titleParts.join(' ').trim();

      results.push({
        id: m[1],
        title: title || '',
        price: price || 'POA',
        year,
        mileage: mileage || 'N/A',
        image: img ? img.src : '',
      });
    }

    return results;
  }, make);
}

/**
 * Scrape AutoTrader listings for a given model config.
 */
async function scrape(sourceConfig, modelConfig) {
  console.log(`  [AutoTrader] Fetching: ${sourceConfig.searchUrl}`);

  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    const apolloMap = new Map();  // id → Apollo data (rich)
    const searchMap = new Map();  // id → DOM-scraped data (basic)

    // ── Phase 1: Friendly URL for Apollo cache data ──
    await page.goto(sourceConfig.searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await sleep(2000);

    const apolloAdverts = await extractApolloAdverts(page);
    if (apolloAdverts) {
      for (const a of apolloAdverts) {
        apolloMap.set(a.id, a);
      }
      console.log(`  [AutoTrader] Friendly URL: ${apolloMap.size} listings from Apollo cache`);
    }

    // ── Phase 2: Search URL with pagination for complete results ──
    const searchBaseUrl = `https://www.autotrader.co.uk/car-search?postcode=${DEFAULT_POSTCODE}&radius=${DEFAULT_RADIUS}&make=${encodeURIComponent(modelConfig.make)}&model=${encodeURIComponent(modelConfig.model)}&advertising-location=at_cars`;

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const pageUrl = `${searchBaseUrl}&page=${pageNum}`;
      console.log(`  [AutoTrader] Fetching search page ${pageNum}`);

      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 60000 });
      await sleep(2000);

      const pageListings = await extractSearchPageListings(page, modelConfig.make);

      let newCount = 0;
      for (const listing of pageListings) {
        if (!searchMap.has(listing.id) && !apolloMap.has(listing.id)) {
          newCount++;
        }
        if (!searchMap.has(listing.id)) {
          searchMap.set(listing.id, listing);
        }
      }

      console.log(`  [AutoTrader] Search page ${pageNum}: ${pageListings.length} listings (${newCount} new)`);

      if (pageListings.length === 0 || newCount === 0) break;
    }

    // ── Merge results ──
    // Collect all unique IDs, preferring Apollo data
    const allIds = new Set([...apolloMap.keys(), ...searchMap.keys()]);
    console.log(`  [AutoTrader] Total: ${allIds.size} unique listings (${apolloMap.size} with rich data)`);

    const listings = [];
    for (const id of allIds) {
      const sourceUrl = `https://www.autotrader.co.uk/car-details/${id}`;
      const apollo = apolloMap.get(id);
      const search = searchMap.get(id);

      if (apollo) {
        // Rich data from Apollo cache
        const title = cleanTitle(apollo.title, apollo.year);
        if (!titleMatchesModel(title, modelConfig)) {
          console.warn(`  [AutoTrader] Skipping non-matching listing: "${title}" for ${modelConfig.make} ${modelConfig.model}`);
          continue;
        }

        let image = apollo.image || '';
        if (image) image = image.replace(/\{resize\}/g, 'w640');

        const price = apollo.price > 0
          ? `£${apollo.price.toLocaleString('en-GB')}`
          : 'POA';

        const mileage = apollo.mileage
          ? `${apollo.mileage.toLocaleString('en-GB')} miles`
          : 'N/A';

        listings.push({
          title,
          price,
          year: apollo.year,
          mileage,
          transmission: normaliseTransmission(apollo.title),
          image,
          sourceUrl,
          sourceName: SOURCE_NAME,
          scrapedAt: today(),
        });
      } else if (search) {
        // Basic data from search page DOM
        const year = search.year || extractYear(search.title);
        const title = cleanTitle(search.title, year);
        if (!titleMatchesModel(title, modelConfig)) {
          console.warn(`  [AutoTrader] Skipping non-matching listing: "${title}" for ${modelConfig.make} ${modelConfig.model}`);
          continue;
        }

        let image = search.image || '';
        if (image) image = image.replace(/\{resize\}/g, 'w640');

        listings.push({
          title,
          price: search.price || 'POA',
          year,
          mileage: search.mileage || 'N/A',
          transmission: normaliseTransmission(search.title),
          image,
          sourceUrl,
          sourceName: SOURCE_NAME,
          scrapedAt: today(),
        });
      }
    }

    console.log(`  [AutoTrader] Successfully scraped ${listings.length} listings`);
    return listings;
  } catch (err) {
    console.warn(`  [AutoTrader] Failed: ${err.message}`);
    return [];
  } finally {
    await context.close();
  }
}

function cleanTitle(raw, year) {
  let title = raw.trim();
  if (year && !title.startsWith(String(year))) {
    title = title.replace(new RegExp(`\\b${year}\\b`), '').trim();
    title = `${year} ${title}`;
  }
  return title;
}

module.exports = { scrape, closeBrowser, SOURCE_NAME };
