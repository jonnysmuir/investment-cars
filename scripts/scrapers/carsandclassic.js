/**
 * Cars & Classic scraper.
 *
 * Strategy:
 *  - Fetch browse page: https://www.carandclassic.com/list/{makeId}/{model}/
 *  - Extract Inertia.js JSON from <script data-page="app" type="application/json">
 *  - Parse props.classifieds.listings.data + props.auctions.listings.data
 *  - Prices are in pence (divide by 100)
 *  - Images on assets.carandclassic.com CDN with signed query params
 *  - URL format: /l/CXXXXXX is canonical
 */

const cheerio = require('cheerio');
const { fetchWithRetry, extractYear, normaliseTransmission, titleMatchesModel, today } = require('./base');

const SOURCE_NAME = 'Cars & Classic';
const MAX_PAGES = 10;

/**
 * Fetch and parse a single page of Cars & Classic listings.
 * Returns { classifieds, auctions, lastPage } or null on failure.
 */
async function fetchPage(url) {
  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  const scriptEl = $('script[data-page="app"]');
  if (!scriptEl.length) return null;

  const pageData = JSON.parse(scriptEl.html());
  const props = pageData.props || {};

  // C&C has two formats:
  // 1. Legacy /list/ pages: props.classifieds.listings.data + props.auctions.listings.data
  // 2. New /search pages: props.searchResults.data (mixed classifieds + auctions)
  const classifieds = props.classifieds?.listings?.data || props.classifieds?.data || [];
  const auctions = props.auctions?.listings?.data || props.auctions?.data || [];
  const searchResults = props.searchResults?.data || [];

  return {
    classifieds,
    auctions,
    searchResults,
    lastPage: props.classifieds?.listings?.last_page || props.searchResults?.last_page || props.searchResults?.meta?.last_page || 1,
    currentPage: props.classifieds?.listings?.current_page || props.searchResults?.current_page || props.searchResults?.meta?.current_page || 1,
  };
}

/**
 * Scrape Cars & Classic listings for a given model config.
 * @param {object} sourceConfig - { makeId, model }
 * @param {object} modelConfig  - { make, model, slug }
 * @returns {Array} Array of listing objects
 */
async function scrape(sourceConfig, modelConfig) {
  // Try both the legacy /list/ URL and the new /search URL
  const legacyUrl = `https://www.carandclassic.com/list/${sourceConfig.makeId}/${sourceConfig.model}/`;
  const searchUrl = `https://www.carandclassic.com/search?make=${encodeURIComponent(modelConfig.make.toLowerCase())}&model=${encodeURIComponent(sourceConfig.model)}`;
  const listings = [];
  const allowedCountries = sourceConfig.countries || ['GB'];
  const seenIds = new Set();

  // Helper to process items from any source
  function processItems(items, status) {
    let count = 0;
    for (const item of items) {
      if (item.id && seenIds.has(item.id)) continue;
      if (item.id) seenIds.add(item.id);
      const country = item.location?.countryCode;
      if (country && !allowedCountries.includes(country)) continue;
      // For search results, determine status from item type
      const itemStatus = item.type === 'auction' ? 'auction' : status;
      const listing = parseItem(item, itemStatus, modelConfig);
      if (listing) { listings.push(listing); count++; }
    }
    return count;
  }

  // Try legacy URL first, fall back to search URL
  const urlsToTry = [legacyUrl, searchUrl];

  for (const baseUrl of urlsToTry) {
    const isSearch = baseUrl.includes('/search?');
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      const pageUrl = pageNum > 1
        ? (isSearch ? `${baseUrl}&page=${pageNum}` : `${baseUrl}?page=${pageNum}`)
        : baseUrl;
      console.log(`  [Cars & Classic] Fetching: ${pageUrl}`);

      let pageResult;
      try {
        pageResult = await fetchPage(pageUrl);
      } catch (err) {
        console.warn(`  [Cars & Classic] Failed to fetch page ${pageNum}: ${err.message}`);
        break;
      }

      if (!pageResult) {
        console.warn('  [Cars & Classic] No Inertia.js data found');
        break;
      }

      let newCount = 0;
      newCount += processItems(pageResult.classifieds, 'active');
      newCount += processItems(pageResult.auctions, 'auction');
      newCount += processItems(pageResult.searchResults, 'active');

      if (pageNum > 1) {
        console.log(`  [Cars & Classic] Page ${pageNum}: ${newCount} new listings`);
      }

      // Stop if no new listings or reached the last page
      if (newCount === 0 || pageNum >= pageResult.lastPage) break;
    }

    // If we found listings from the first URL, skip the fallback
    if (listings.length > 0) break;
  }

  console.log(`  [Cars & Classic] Successfully scraped ${listings.length} listings`);
  return listings;
}

function parseItem(item, status, modelConfig) {
  try {
    const id = item.id;
    const slug = item.slug || `C${id}`;

    // Title
    let title = item.title || item.name || '';
    const year = item.year || extractYear(title);

    // Relevance check: title must contain all significant tokens from the model name.
    // C&C search can return loosely-related models (e.g. "328 GTS" for "166 Inter").
    if (!titleMatchesModel(title, modelConfig)) {
      console.warn(`  [Cars & Classic] Skipping non-matching listing: "${title}" for ${modelConfig.make} ${modelConfig.model}`);
      return null;
    }

    // Price: C&C stores prices in pence, either as a number or as { value, currency }
    let price = 'POA';
    const rawPrice = item.price || item.currentPrice || item.askingPrice;
    if (rawPrice && typeof rawPrice === 'object' && rawPrice.value > 0) {
      // Object format: { value: 11995000, currency: { name: "GBP", symbol: "£" } }
      const pounds = Math.round(rawPrice.value / 100);
      const symbol = rawPrice.currency?.symbol || '£';
      price = `${symbol}${pounds.toLocaleString('en-GB')}`;
    } else if (rawPrice && typeof rawPrice === 'number' && rawPrice > 0) {
      const pounds = Math.round(rawPrice / 100);
      price = `£${pounds.toLocaleString('en-GB')}`;
    } else if (rawPrice && typeof rawPrice === 'string') {
      const priceMatch = rawPrice.match(/[\d,]+/);
      if (priceMatch) price = `£${priceMatch[0]}`;
    }

    // Mileage — primary source is item.attributes.mileage (Inertia.js format)
    let mileage = 'N/A';
    const attrMileage = item.attributes?.mileage;
    if (attrMileage?.value != null && attrMileage.value > 0) {
      const val = Number(attrMileage.value).toLocaleString('en-GB');
      mileage = attrMileage.unit === 'km' ? `${val} km` : `${val} miles`;
    } else if (item.mileage != null && item.mileage > 0) {
      mileage = `${item.mileage.toLocaleString('en-GB')} miles`;
    } else if (item.odometer) {
      mileage = `${parseInt(item.odometer).toLocaleString('en-GB')} miles`;
    }

    // Transmission — primary source is item.attributes.transmissionType
    let transmission = 'Unknown';
    const attrTrans = item.attributes?.transmissionType;
    if (attrTrans) {
      transmission = normaliseTransmission(attrTrans);
    } else if (item.transmission) {
      transmission = normaliseTransmission(item.transmission);
    } else if (item.gearbox) {
      transmission = normaliseTransmission(item.gearbox);
    }

    // Image
    let image = '';
    if (item.image?.url) {
      image = item.image.url;
    } else if (item.images?.length > 0) {
      image = item.images[0].url || item.images[0];
    } else if (item.mainImage) {
      image = typeof item.mainImage === 'string' ? item.mainImage : item.mainImage.url || '';
    }
    // Ensure CDN URL has decent sizing
    if (image && image.includes('assets.carandclassic.com') && !image.includes('?')) {
      image += '?fit=fillmax&h=800&w=800&q=85';
    }

    // Source URL — use item.url (e.g. /car/C2021811) or build from slug
    const sourceUrl = item.url
      ? `https://www.carandclassic.com${item.url}`
      : `https://www.carandclassic.com/car/${slug}`;

    // Clean title
    if (year && !title.startsWith(String(year))) {
      title = `${year} ${title}`;
    }

    return {
      title: title.trim(),
      price,
      year,
      mileage,
      transmission,
      image,
      sourceUrl,
      sourceName: SOURCE_NAME,
      scrapedAt: today(),
    };
  } catch (err) {
    console.warn(`  [Cars & Classic] Failed to parse item: ${err.message}`);
    return null;
  }
}

module.exports = { scrape, SOURCE_NAME };
