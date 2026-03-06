/**
 * AutoTrader scraper — uses Playwright (headless Chromium).
 *
 * Strategy:
 *  - Navigate to the friendly URL: /cars/used/{make}/{model}
 *  - Extract structured JSON from <script> tags containing listing data
 *  - Map listing IDs to image hashes
 *  - Image URLs: m.atcdn.co.uk/a/media/w640/HASH.jpg
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

    // Extract all page HTML to find structured listing data in <script> tags
    const pageContent = await page.content();

    // Method 1: Try to find listing data in structured JSON within script tags
    const listings = [];

    // Extract listing cards from the rendered DOM
    const cardData = await page.evaluate(() => {
      const cards = [];
      // AutoTrader renders listing cards with various selectors
      const articleEls = document.querySelectorAll('article[data-standout-type], section[data-testid="trader-seller-listing"]');

      articleEls.forEach(el => {
        try {
          const titleEl = el.querySelector('h3 a, a[href*="/car-details/"]');
          const priceEl = el.querySelector('[data-testid="search-listing-price"], .product-card-pricing__price');
          const imgEl = el.querySelector('img[src*="atcdn"], img[data-src*="atcdn"]');
          const linkEl = el.querySelector('a[href*="/car-details/"]');

          const title = titleEl?.textContent?.trim() || '';
          const price = priceEl?.textContent?.trim() || '';
          const image = imgEl?.src || imgEl?.dataset?.src || '';
          const href = linkEl?.href || '';

          // Extract specs
          const specEls = el.querySelectorAll('li, [data-testid*="spec"]');
          const specs = [...specEls].map(s => s.textContent.trim()).join(' | ');

          if (title && href) {
            cards.push({ title, price, image, href, specs });
          }
        } catch {
          // Skip malformed cards
        }
      });

      return cards;
    });

    console.log(`  [AutoTrader] Found ${cardData.length} listing cards in DOM`);

    // Also try extracting from script tags (more reliable for image data)
    const scriptData = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script')];
      for (const s of scripts) {
        const text = s.textContent;
        if (text.includes('"stockResponse"') || text.includes('"searchResults"') || text.includes('"results"')) {
          return text;
        }
      }
      return null;
    });

    // Parse structured data if available
    const imageMap = new Map(); // listingId → imageUrl
    if (scriptData) {
      // Extract id-to-image mappings
      const idImageRegex = /"id"\s*:\s*"(\d+)"[\s\S]*?"images"\s*:\s*\[([\s\S]*?)\]/g;
      let match;
      while ((match = idImageRegex.exec(scriptData)) !== null) {
        const id = match[1];
        const imagesBlock = match[2];
        const hashMatch = imagesBlock.match(/"([a-f0-9]{32})"/);
        if (hashMatch) {
          imageMap.set(id, `https://m.atcdn.co.uk/a/media/w640/${hashMatch[1]}.jpg`);
        }
      }
    }

    // Process DOM cards into listings
    for (const card of cardData) {
      const listingIdMatch = card.href.match(/car-details\/(\d+)/);
      const listingId = listingIdMatch ? listingIdMatch[1] : null;

      // Get best image URL
      let image = card.image;
      if (listingId && imageMap.has(listingId)) {
        image = imageMap.get(listingId);
      }
      // Clean up image URL: replace {resize} placeholder
      if (image) {
        image = image.replace(/\{resize\}/g, 'w640');
      }

      // Parse price
      let price = 'POA';
      const priceMatch = card.price.match(/£[\d,]+/);
      if (priceMatch) price = priceMatch[0];

      const year = extractYear(card.title);

      // Mileage from specs
      let mileage = 'N/A';
      const mileageMatch = card.specs.match(/([\d,]+)\s*miles/i);
      if (mileageMatch) mileage = `${mileageMatch[1]} miles`;

      // Transmission from specs or title
      let transmission = 'Unknown';
      const allText = card.title + ' ' + card.specs;
      transmission = normaliseTransmission(allText);

      const sourceUrl = listingId
        ? `https://www.autotrader.co.uk/car-details/${listingId}`
        : card.href;

      listings.push({
        title: cleanTitle(card.title, year),
        price,
        year,
        mileage,
        transmission,
        image: image || '',
        sourceUrl,
        sourceName: SOURCE_NAME,
        scrapedAt: today(),
      });
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
