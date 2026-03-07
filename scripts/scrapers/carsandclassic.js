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
const { fetchWithRetry, extractYear, normaliseTransmission, today } = require('./base');

const SOURCE_NAME = 'Cars & Classic';

/**
 * Scrape Cars & Classic listings for a given model config.
 * @param {object} sourceConfig - { makeId, model }
 * @param {object} modelConfig  - { make, model, slug }
 * @returns {Array} Array of listing objects
 */
async function scrape(sourceConfig, modelConfig) {
  const browseUrl = `https://www.carandclassic.com/list/${sourceConfig.makeId}/${sourceConfig.model}/`;
  console.log(`  [Cars & Classic] Fetching: ${browseUrl}`);

  let html;
  try {
    html = await fetchWithRetry(browseUrl);
  } catch (err) {
    console.warn(`  [Cars & Classic] Failed to fetch browse page: ${err.message}`);
    return [];
  }

  const $ = cheerio.load(html);

  // Extract Inertia.js JSON data
  const scriptEl = $('script[data-page="app"]');
  if (!scriptEl.length) {
    console.warn('  [Cars & Classic] No Inertia.js data found');
    return [];
  }

  let pageData;
  try {
    pageData = JSON.parse(scriptEl.html());
  } catch (err) {
    console.warn(`  [Cars & Classic] Failed to parse Inertia.js JSON: ${err.message}`);
    return [];
  }

  const props = pageData.props || {};
  const listings = [];

  // Country filter — default to GB only
  const allowedCountries = sourceConfig.countries || ['GB'];

  // Process classified (buy-now) listings
  const classifiedData = props.classifieds?.listings?.data || [];
  for (const item of classifiedData) {
    const country = item.location?.countryCode;
    if (country && !allowedCountries.includes(country)) continue;
    const listing = parseItem(item, 'active', modelConfig);
    if (listing) listings.push(listing);
  }

  // Process auction listings
  const auctionData = props.auctions?.listings?.data || [];
  for (const item of auctionData) {
    const country = item.location?.countryCode;
    if (country && !allowedCountries.includes(country)) continue;
    const listing = parseItem(item, 'auction', modelConfig);
    if (listing) listings.push(listing);
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
