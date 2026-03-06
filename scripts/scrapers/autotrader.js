/**
 * AutoTrader scraper — uses Playwright (headless Chromium).
 *
 * Strategy:
 *  - Navigate to the friendly URL: /cars/used/{make}/{model}
 *  - Extract listing IDs from DOM cards ([data-testid="atds-vehicle-card"])
 *  - Read rich listing data (title, year, price, mileage, images) from
 *    window.AT_APOLLO_STATE — AutoTrader's Apollo GraphQL cache
 *  - Fall back to DOM scraping if Apollo data is unavailable
 *
 * IMPORTANT: Individual /car-details/ID pages are fully JS-rendered (Apollo/React)
 * and return no useful data via fetch. Must use the search/friendly URL.
 */

const { extractYear, normaliseTransmission, today, sleep } = require('./base');

const SOURCE_NAME = 'AutoTrader';

let browser = null;

/**
 * Get or create the shared Playwright browser instance.
 */
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const { chromium } = require('playwright');
  browser = await chromium.launch({ headless: true });
  return browser;
}

/**
 * Close the shared browser (call after all AT scraping is done).
 */
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Scrape AutoTrader listings for a given model config.
 * @param {object} sourceConfig - { searchUrl }
 * @param {object} modelConfig  - { make, model, slug }
 * @returns {Array} Array of listing objects
 */
async function scrape(sourceConfig, modelConfig) {
  console.log(`  [AutoTrader] Fetching: ${sourceConfig.searchUrl}`);

  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(sourceConfig.searchUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await sleep(2000);

    const listings = [];

    // Step 1: Get listing IDs from DOM cards
    const cardIds = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-testid="atds-vehicle-card"]');
      return [...cards].map(c => {
        const link = c.querySelector('a[href*="/car-details/"]');
        const href = link?.href || '';
        const match = href.match(/car-details\/(\d+)/);
        return match ? match[1] : null;
      }).filter(Boolean);
    });

    console.log(`  [AutoTrader] Found ${cardIds.length} listing cards in DOM`);
    if (cardIds.length === 0) return [];

    // Step 2: Extract rich data from Apollo GraphQL cache (window.AT_APOLLO_STATE)
    const apolloAdverts = await page.evaluate(() => {
      const state = window.AT_APOLLO_STATE;
      if (!state || !state.ROOT_QUERY) return null;

      const root = state.ROOT_QUERY;
      const searchData = root.search;
      if (!searchData) return null;

      // Recursively find all advert objects in the Apollo cache
      const adverts = [];
      const seen = new Set();

      function findAdverts(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (const item of obj) findAdverts(item);
          return;
        }
        // An advert has id, title, year, and price
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

    // Build a map of id → apollo data for quick lookup
    const apolloMap = new Map();
    if (apolloAdverts) {
      for (const a of apolloAdverts) {
        apolloMap.set(a.id, a);
      }
      console.log(`  [AutoTrader] Found ${apolloMap.size} listings in Apollo cache`);
    }

    // Step 3: For each DOM card, build listing from Apollo data (or fall back to DOM)
    const seenIds = new Set();
    for (const id of cardIds) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const sourceUrl = `https://www.autotrader.co.uk/car-details/${id}`;
      const apollo = apolloMap.get(id);

      if (apollo) {
        // Rich data from Apollo cache
        let image = apollo.image || '';
        if (image) image = image.replace(/\{resize\}/g, 'w640');

        const price = apollo.price > 0
          ? `£${apollo.price.toLocaleString('en-GB')}`
          : 'POA';

        const mileage = apollo.mileage
          ? `${apollo.mileage.toLocaleString('en-GB')} miles`
          : 'N/A';

        const transmission = normaliseTransmission(apollo.title);

        listings.push({
          title: cleanTitle(apollo.title, apollo.year),
          price,
          year: apollo.year,
          mileage,
          transmission,
          image,
          sourceUrl,
          sourceName: SOURCE_NAME,
          scrapedAt: today(),
        });
      } else {
        // Fallback: scrape from DOM card directly
        const fallback = await page.evaluate((listingId) => {
          const cards = document.querySelectorAll('[data-testid="atds-vehicle-card"]');
          for (const c of cards) {
            const link = c.querySelector('a[href*="/car-details/"]');
            if (!link || !link.href.includes(listingId)) continue;

            // Build title from h3 + p to avoid concatenation issue
            const h3 = link.querySelector('h3');
            const p = link.querySelector('p');
            const title = [h3?.textContent?.trim(), p?.textContent?.trim()].filter(Boolean).join(' ');

            const cardText = c.textContent || '';
            const priceMatch = cardText.match(/£[\d,]+/);
            const imgEl = c.querySelector('img[src*="atcdn"], img[data-src*="atcdn"]');

            return {
              title,
              price: priceMatch ? priceMatch[0] : '',
              image: imgEl?.src || imgEl?.dataset?.src || '',
            };
          }
          return null;
        }, id);

        if (fallback) {
          const year = extractYear(fallback.title);
          let image = fallback.image;
          if (image) image = image.replace(/\{resize\}/g, 'w640');

          listings.push({
            title: cleanTitle(fallback.title, year),
            price: fallback.price || 'POA',
            year,
            mileage: 'N/A',
            transmission: normaliseTransmission(fallback.title),
            image: image || '',
            sourceUrl,
            sourceName: SOURCE_NAME,
            scrapedAt: today(),
          });
        }
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
  // Ensure year is at the front
  if (year && !title.startsWith(String(year))) {
    title = title.replace(new RegExp(`\\b${year}\\b`), '').trim();
    title = `${year} ${title}`;
  }
  return title;
}

module.exports = { scrape, closeBrowser, SOURCE_NAME };
