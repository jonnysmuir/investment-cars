/**
 * PistonHeads scraper.
 *
 * Strategy:
 *  - Fetch search page HTML (server-rendered listing links)
 *  - Extract individual listing URLs
 *  - Fetch each listing page to get details + og:image
 *
 * Search URLs return HTML with listing links like /buy/listing/12345678
 * Individual listing pages have og:image, title, price, specs in HTML.
 */

const cheerio = require('cheerio');
const { fetchWithRetry, extractYear, normaliseTransmission, today } = require('./base');

const SOURCE_NAME = 'PistonHeads';

/**
 * Scrape PistonHeads listings for a given model config.
 * @param {object} sourceConfig - { searchUrl, alternateUrls? }
 * @param {object} modelConfig  - { make, model, slug }
 * @returns {Array} Array of listing objects
 */
async function scrape(sourceConfig, modelConfig) {
  const urls = [sourceConfig.searchUrl, ...(sourceConfig.alternateUrls || [])];
  const allListingUrls = new Set();

  // Step 1: Gather listing URLs from search pages
  for (const searchUrl of urls) {
    try {
      console.log(`  [PistonHeads] Fetching search: ${searchUrl}`);
      const html = await fetchWithRetry(searchUrl);
      const $ = cheerio.load(html);

      // Extract listing links — they follow the pattern /buy/listing/XXXXXXXX
      $('a[href*="/buy/listing/"]').each((_, el) => {
        const href = $(el).attr('href');
        const match = href.match(/\/buy\/listing\/(\d+)/);
        if (match) {
          allListingUrls.add(`https://www.pistonheads.com/buy/listing/${match[1]}`);
        }
      });
    } catch (err) {
      console.warn(`  [PistonHeads] Failed to fetch search page ${searchUrl}: ${err.message}`);
    }
  }

  console.log(`  [PistonHeads] Found ${allListingUrls.size} listing URLs`);
  if (allListingUrls.size === 0) return [];

  // Step 2: Fetch each listing page for details
  const listings = [];
  const listingUrlArray = [...allListingUrls];

  // Process in batches of 5
  for (let i = 0; i < listingUrlArray.length; i += 5) {
    const batch = listingUrlArray.slice(i, i + 5);
    const batchResults = await Promise.allSettled(
      batch.map(url => scrapeListing(url, modelConfig))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        listings.push(result.value);
      }
    }
  }

  console.log(`  [PistonHeads] Successfully scraped ${listings.length} listings`);
  return listings;
}

async function scrapeListing(url, modelConfig) {
  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    // Extract key data
    const title = $('title').text().trim().replace(/\s*\|.*$/, '').replace(/\s*-\s*PistonHeads.*$/i, '');
    const ogImage = $('meta[property="og:image"]').attr('content') || '';

    // Quick sanity check: does the title relate to the model?
    const makeModel = `${modelConfig.make} ${modelConfig.model}`.toLowerCase();
    const titleLower = title.toLowerCase();
    // Allow partial matches (e.g. "430" for "F430", "murcielago" for "Murciélago")
    const modelLower = modelConfig.model.toLowerCase();
    const modelShort = modelConfig.model.replace(/^[A-Z]-?/i, '').toLowerCase();
    if (!titleLower.includes(modelLower) && !titleLower.includes(modelShort)) {
      console.warn(`  [PistonHeads] Skipping non-matching listing: "${title}" for ${makeModel}`);
      return null;
    }

    // Extract price from page
    let price = 'POA';
    const priceEl = $('[class*="price"]').first().text().trim();
    const priceMatch = priceEl.match(/£[\d,]+/);
    if (priceMatch) price = priceMatch[0];

    // Try to get specs
    const specText = $('body').text();
    const yearVal = extractYear(title);

    // Mileage
    let mileage = 'N/A';
    const mileageMatch = specText.match(/([\d,]+)\s*miles/i);
    if (mileageMatch) mileage = `${mileageMatch[1]} miles`;

    // Transmission
    let transmission = 'Unknown';
    const transMatch = specText.match(/(?:gearbox|transmission)[:\s]*([\w\s-]+?)(?:\n|,|<)/i);
    if (transMatch) {
      transmission = normaliseTransmission(transMatch[1]);
    } else if (/manual/i.test(specText) && !/auto|f1|e-gear/i.test(specText.slice(0, 2000))) {
      transmission = '6-Speed Manual';
    } else if (/f1|automated/i.test(specText.slice(0, 2000))) {
      transmission = 'F1 Automated Manual';
    } else if (/e-gear/i.test(specText.slice(0, 2000))) {
      transmission = 'E-Gear';
    }

    return {
      title: cleanTitle(title, modelConfig),
      price,
      year: yearVal,
      mileage,
      transmission,
      image: ogImage,
      sourceUrl: url,
      sourceName: SOURCE_NAME,
      scrapedAt: today(),
    };
  } catch (err) {
    console.warn(`  [PistonHeads] Failed to scrape listing ${url}: ${err.message}`);
    return null;
  }
}

function cleanTitle(raw, modelConfig) {
  // Remove common suffixes and clean up
  let title = raw
    .replace(/\s*\|\s*PistonHeads.*/i, '')
    .replace(/\s*for\s*sale\s*/i, '')
    .replace(/\s*-\s*Used\s*$/i, '')
    .trim();

  // Ensure year is at the front if present
  const year = extractYear(title);
  if (year && !title.startsWith(String(year))) {
    title = title.replace(new RegExp(`\\b${year}\\b`), '').trim();
    title = `${year} ${title}`;
  }

  return title;
}

module.exports = { scrape, SOURCE_NAME };
