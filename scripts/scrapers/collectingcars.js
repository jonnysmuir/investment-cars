/**
 * Collecting Cars scraper.
 *
 * Strategy — active listings:
 *  - Direct scraping is Cloudflare-blocked (403).
 *  - Use the Wayback Machine API to find archived versions.
 *  - Image CDN (images.collectingcars.com) is publicly accessible.
 *  - Falls back gracefully if no archive snapshot exists.
 *
 * Strategy — sold results:
 *  - The /buy/ page works with Playwright (no Cloudflare challenge).
 *  - Navigate to sold results, search by make+model, parse card data.
 *  - Images available from collectingcars CDN (images.collectingcars.com
 *    or collectingcars.imgix.net for older listings).
 */

const cheerio = require('cheerio');
const { fetchWithRetry, extractYear, normaliseTransmission, normaliseBodyType, today, sleep } = require('./base');

const SOURCE_NAME = 'Collecting Cars';

// ── Playwright browser (shared, lazy-initialised) ────────────────────────
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
 * Scrape Collecting Cars listings via Wayback Machine.
 * @param {object} sourceConfig - { searchUrl }
 * @param {object} modelConfig  - { make, model, slug }
 * @returns {Array} Array of listing objects
 */
async function scrape(sourceConfig, modelConfig) {
  console.log(`  [Collecting Cars] Checking Wayback Machine for: ${sourceConfig.searchUrl}`);

  // Step 1: Check if Wayback Machine has a recent snapshot
  const waybackApiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(sourceConfig.searchUrl)}`;

  let snapshotUrl;
  try {
    const response = await fetchWithRetry(waybackApiUrl);
    const data = JSON.parse(response);
    const snapshot = data?.archived_snapshots?.closest;

    if (!snapshot || !snapshot.available) {
      console.warn('  [Collecting Cars] No Wayback Machine snapshot available');
      return [];
    }

    snapshotUrl = snapshot.url;
    // Ensure we use the raw version (id_ prefix removes Wayback toolbar)
    snapshotUrl = snapshotUrl.replace(/\/web\/(\d+)\//, '/web/$1id_/');
    console.log(`  [Collecting Cars] Found snapshot: ${snapshotUrl}`);
  } catch (err) {
    console.warn(`  [Collecting Cars] Wayback API failed: ${err.message}`);
    return [];
  }

  // Step 2: Fetch the archived page
  let html;
  try {
    html = await fetchWithRetry(snapshotUrl);
  } catch (err) {
    console.warn(`  [Collecting Cars] Failed to fetch snapshot: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const listings = [];

  // Step 3: Parse listing data from the archived page
  // Collecting Cars uses various card layouts for search results
  $('a[href*="/lot/"], a[href*="/catalogue/"]').each((_, el) => {
    try {
      const href = $(el).attr('href') || '';
      // Resolve relative URLs and strip Wayback prefix
      let originalUrl = href;
      const waybackStrip = href.match(/\/web\/\d+(?:id_)?\/(.+)/);
      if (waybackStrip) originalUrl = waybackStrip[1];
      if (!originalUrl.startsWith('http')) {
        originalUrl = `https://www.collectingcars.com${originalUrl}`;
      }

      // Skip if we've already seen this URL
      if (listings.some(l => l.sourceUrl === originalUrl)) return;

      // Try to get data from the card
      const card = $(el).closest('[class*="card"], [class*="lot"], article') || $(el);
      const title = card.find('h2, h3, [class*="title"]').first().text().trim() ||
                    $(el).text().trim();

      if (!title) return;

      // Quick relevance check
      const titleLower = title.toLowerCase();
      const modelLower = modelConfig.model.toLowerCase();
      const makeLower = modelConfig.make.toLowerCase();
      if (!titleLower.includes(makeLower) && !titleLower.includes(modelLower)) return;

      const year = extractYear(title);

      // Price
      let price = 'POA';
      const priceEl = card.find('[class*="price"]').first().text().trim();
      const priceMatch = priceEl.match(/[£$€][\d,]+/);
      if (priceMatch) price = priceMatch[0];

      // Image
      let image = '';
      const imgEl = card.find('img').first();
      if (imgEl.length) {
        image = imgEl.attr('src') || imgEl.attr('data-src') || '';
        // Strip Wayback prefix from image URL
        const imgWayback = image.match(/\/web\/\d+(?:id_)?\/(.+)/);
        if (imgWayback) image = imgWayback[1];
        // Ensure images.collectingcars.com URLs have good quality params
        if (image.includes('collectingcars.com') && !image.includes('?')) {
          image += '?w=640&fit=clip&crop=edges&auto=format,compress&cs=srgb&q=85';
        }
      }

      // Specs (often limited in search results)
      let mileage = 'N/A';
      let transmission = 'Unknown';
      const specText = card.text();
      const mileageMatch = specText.match(/([\d,]+)\s*(?:miles|km)/i);
      if (mileageMatch) mileage = `${mileageMatch[1]} miles`;
      transmission = normaliseTransmission(specText);

      listings.push({
        title: year && !title.startsWith(String(year)) ? `${year} ${title}` : title,
        price,
        year,
        mileage,
        transmission,
        bodyType: normaliseBodyType(title),
        image,
        sourceUrl: originalUrl,
        sourceName: SOURCE_NAME,
        scrapedAt: today(),
      });
    } catch {
      // Skip malformed entries
    }
  });

  console.log(`  [Collecting Cars] Successfully scraped ${listings.length} listings`);
  return listings;
}

/**
 * Scrape sold/completed auction results via Playwright.
 * Navigates to the /buy/ page with "Sold" filter, searches by make+model,
 * and parses listing cards.
 *
 * @param {object} sourceConfig - (unused for sold, kept for API consistency)
 * @param {object} modelConfig  - { make, model, slug }
 * @returns {Array} Array of sold listing objects
 */
async function scrapeSold(sourceConfig, modelConfig) {
  const searchQuery = `${modelConfig.make} ${modelConfig.model}`.replace(/é/g, 'e');
  console.log(`  [Collecting Cars Sold] Searching for: ${searchQuery}`);

  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  const page = await context.newPage();

  try {
    // Navigate to the sold results page
    const url = 'https://collectingcars.com/buy/?refinementList%5BlistingStage%5D%5B0%5D=sold';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    // Type search query to filter by make+model
    const searchInput = await page.$('input[type="search"], input[placeholder*="Search"], input[class*="search"]');
    if (!searchInput) {
      console.warn('  [Collecting Cars Sold] Search input not found');
      return [];
    }
    await searchInput.fill(searchQuery);
    await sleep(4000);

    // Scroll to load all results (handles lazy loading / infinite scroll)
    let prevCount = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(2000);
      const count = await page.evaluate(() =>
        new Set([...document.querySelectorAll('a[href*="/for-sale/"]')].map(a => a.href)).size
      );
      if (count === prevCount) break;
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

        // Date and price from countdown pill spans
        const pills = link.querySelectorAll('span');
        let date = '';
        let price = '';
        for (const span of pills) {
          const titleAttr = span.getAttribute('title') || '';
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

    console.log(`  [Collecting Cars Sold] Found ${rawListings.length} raw results`);

    // Filter and transform listings
    const makeLower = modelConfig.make.toLowerCase();
    const modelLower = modelConfig.model.toLowerCase().replace(/é/g, 'e');
    const listings = [];

    for (const raw of rawListings) {
      // Relevance check — title or URL must contain make or model
      const titleLower = raw.title.toLowerCase().replace(/é/g, 'e');
      const hrefLower = raw.href.toLowerCase();
      if (!titleLower.includes(modelLower) && !hrefLower.includes(modelLower.replace(/\s+/g, '-'))) continue;

      // Skip non-car items (wheels, plates, memorabilia)
      if (/\b(set of\b.*\bwheels?|wheels?\b.*\bset\b|number plate|luggage set|brochure)\b/i.test(raw.title)) continue;
      // Also skip if the URL slug doesn't start with a year (non-car items)
      const urlSlug = raw.href.split('/for-sale/')[1] || '';
      if (urlSlug && !/^\d{4}-/.test(urlSlug)) continue;

      // Parse date DD/MM/YY → YYYY-MM-DD
      let soldDate = '';
      if (raw.date) {
        const [dd, mm, yy] = raw.date.split('/');
        const year = parseInt(yy) < 50 ? `20${yy}` : `19${yy}`;
        soldDate = `${year}-${mm}-${dd}`;
      }

      // Parse sold price (may be empty if behind login wall)
      const soldPrice = raw.price || '';

      // Clean image URL — ensure quality params
      let image = raw.image;
      if (image && (image.includes('collectingcars.com') || image.includes('collectingcars.imgix.net'))) {
        // Standardise quality params
        image = image.replace(/\?.*$/, '') + '?w=640&fit=clip&crop=edges&auto=format,compress&cs=srgb&q=85';
      }

      const year = extractYear(raw.title);
      const title = raw.title.trim();

      listings.push({
        title: year && !title.startsWith(String(year)) ? `${year} ${title}` : title,
        soldPrice,
        soldDate,
        year,
        mileage: 'N/A',
        transmission: normaliseTransmission(raw.title),
        bodyType: normaliseBodyType(raw.title),
        image,
        sourceUrl: raw.href,
        sourceName: SOURCE_NAME,
        scrapedAt: today(),
      });
    }

    console.log(`  [Collecting Cars Sold] ${listings.length} relevant sold listings after filtering`);
    return listings;
  } catch (err) {
    console.warn(`  [Collecting Cars Sold] Failed: ${err.message}`);
    return [];
  } finally {
    await context.close();
  }
}

module.exports = { scrape, scrapeSold, closeBrowser, SOURCE_NAME };
