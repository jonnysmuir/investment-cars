/**
 * Collecting Cars scraper.
 *
 * Strategy:
 *  - Direct scraping is Cloudflare-blocked (403).
 *  - Use the Wayback Machine API to find archived versions.
 *  - Image CDN (images.collectingcars.com) is publicly accessible.
 *  - Falls back gracefully if no archive snapshot exists.
 */

const cheerio = require('cheerio');
const { fetchWithRetry, extractYear, normaliseTransmission, today } = require('./base');

const SOURCE_NAME = 'Collecting Cars';

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

module.exports = { scrape, SOURCE_NAME };
