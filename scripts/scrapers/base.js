/**
 * Shared scraper utilities — rate limiting, retries, parsing helpers.
 */

const https = require('https');
const http = require('http');

// ── Rate Limiter ──────────────────────────────────────────────────────────
// Tracks last request time per domain to enforce minimum delays.
const domainTimestamps = {};
const DOMAIN_DELAYS = {
  'www.pistonheads.com': 2000,
  'www.autotrader.co.uk': 3000,
  'www.carandclassic.com': 2000,
  'www.collectingcars.com': 2000,
  'archive.org': 1500,
  default: 1500,
};

async function rateLimit(url) {
  const domain = new URL(url).hostname;
  const delay = DOMAIN_DELAYS[domain] || DOMAIN_DELAYS.default;
  const last = domainTimestamps[domain] || 0;
  const wait = Math.max(0, delay - (Date.now() - last));
  if (wait > 0) await sleep(wait);
  domainTimestamps[domain] = Date.now();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── HTTP Fetch with retries ───────────────────────────────────────────────
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  const { headers = {}, followRedirects = true } = options;
  const finalHeaders = {
    'User-Agent': DEFAULT_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
    ...headers,
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rateLimit(url);
      const html = await httpGet(url, finalHeaders, followRedirects);
      return html;
    } catch (err) {
      const isLast = attempt === maxRetries;
      if (isLast) throw err;
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(`  [retry ${attempt}/${maxRetries}] ${url} — ${err.message}, waiting ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

function httpGet(url, headers, followRedirects = true, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      if (followRedirects && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        const redirectUrl = new URL(res.headers.location, url).toString();
        return resolve(httpGet(redirectUrl, headers, followRedirects, maxRedirects - 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`Timeout for ${url}`)); });
  });
}

// ── Parsing Helpers ───────────────────────────────────────────────────────

/**
 * Parse a price string like "£85,995" → number 85995, or null for POA/N/A.
 */
function parsePrice(str) {
  if (!str || /poa|tba|on\s*request|ask/i.test(str)) return null;
  const cleaned = str.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Format a number as a GBP price string: 85995 → "£85,995"
 */
function formatPrice(num) {
  if (num == null) return 'POA';
  return '£' + num.toLocaleString('en-GB');
}

/**
 * Extract year from a title string like "2007 Ferrari F430..."
 */
function extractYear(title) {
  const m = title.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0]) : null;
}

/**
 * Normalise transmission strings to consistent values.
 */
function normaliseTransmission(raw) {
  if (!raw) return 'Unknown';
  const lower = raw.toLowerCase();
  if (/manual|6[\s-]?speed\s*man|gated/i.test(lower) && !/auto|f1|e[\s-]?gear|dct|sequential/i.test(lower)) {
    return '6-Speed Manual';
  }
  if (/e[\s-]?gear/i.test(lower)) return 'E-Gear';
  if (/f1|automated|semi[\s-]?auto|paddle|dct/i.test(lower)) return 'F1 Automated Manual';
  if (/auto/i.test(lower)) return 'Automatic';
  return 'Unknown';
}

/**
 * Generate a stable ID from a source URL so we can track listings across runs.
 */
function sourceUrlToId(sourceUrl) {
  // Extract the unique part of the URL for each source
  const url = sourceUrl.toLowerCase();

  // PistonHeads: /buy/listing/19955605 → ph-19955605
  const phMatch = url.match(/pistonheads\.com\/buy\/listing\/(\d+)/);
  if (phMatch) return `ph-${phMatch[1]}`;

  // AutoTrader: /car-details/202602210103239 → at-202602210103239
  const atMatch = url.match(/autotrader\.co\.uk\/car-details\/(\d+)/);
  if (atMatch) return `at-${atMatch[1]}`;

  // Cars & Classic: /car/C2019411 or /l/C2019411 → cc-C2019411
  const ccMatch = url.match(/carandclassic\.com\/(?:car|l)\/(C\d+)/);
  if (ccMatch) return `cc-${ccMatch[1]}`;

  // Collecting Cars: /lot/xxxxx → col-xxxxx
  const colMatch = url.match(/collectingcars\.com\/(?:lot|catalogue)\/([^/?]+)/);
  if (colMatch) return `col-${colMatch[1]}`;

  // Fallback: hash the URL
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `url-${Math.abs(hash)}`;
}

/**
 * Check if an image URL is reachable (HEAD request, returns true/false).
 */
async function isImageValid(url) {
  try {
    return await new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method: 'HEAD', timeout: 10000 }, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  } catch {
    return false;
  }
}

/**
 * Get today's date as YYYY-MM-DD string.
 */
function today() {
  return new Date().toISOString().split('T')[0];
}

module.exports = {
  rateLimit,
  sleep,
  fetchWithRetry,
  parsePrice,
  formatPrice,
  extractYear,
  normaliseTransmission,
  sourceUrlToId,
  isImageValid,
  today,
  DEFAULT_UA,
};
