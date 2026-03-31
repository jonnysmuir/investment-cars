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
  'www.glenmarch.com': 3000,
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
 * Parse a mileage string like "22,000 miles" or "16,000 km" → number (in miles), or null.
 */
function parseMileage(str) {
  if (!str || /n\/a|low mileage/i.test(str)) return null;
  const cleaned = str.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num === 0) return null;
  if (/km/i.test(str)) return Math.round(num * 0.621371);
  return num;
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
 * Normalise body type strings to consistent values.
 * Per CLAUDE.md: all convertible-roof cars → "Convertible", except Targa and Speedster.
 */
function normaliseBodyType(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase();
  // Exceptions first — these are their own body types
  if (/\btarga\b/.test(s)) return 'Targa';
  if (/\bspeedster\b/.test(s)) return 'Speedster';
  // All convertible-roof types → "Convertible"
  if (/convertible|cabrio(?:let)?|\broadster\b|\bspider\b|\bspyder\b|drop\s*(?:top|head)|\bopen\s*top\b|\bvolante\b|\baperta\b|\bbarchetta\b|\bcab\b|\bdrophead\b|\bdrop-head\b|\bdcv\b/i.test(s)) return 'Convertible';
  // Coupe variants (Gran Coupe counts as Coupe)
  if (/\bcoupe\b|\bcoupé\b|\bberlinetta\b|\bhatchback\b|\bgran\s*coup[eé]\b/i.test(s)) return 'Coupe';
  // Saloon / Sedan
  if (/\bsaloon\b|\bsedan\b/i.test(s)) return 'Saloon';
  // Door-count inference (only when no other body type clue matched)
  if (/\b4\s*(?:dr|door)\b/i.test(s)) return 'Saloon';
  if (/\b5\s*(?:dr|door)\b/i.test(s)) return 'Estate';
  // Estate / Wagon / Touring (BMW-specific: "Touring" means Estate)
  if (/\bestate\b|\bwagon\b|\bshooting[\s.-]*brake\b|\btouring\b/i.test(s)) return 'Estate';
  // SUV
  if (/\bsuv\b|\bcrossover\b/i.test(s)) return 'SUV';
  return null;
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

/**
 * Check whether a listing title plausibly matches a target model.
 *
 * Cars & Classic (and sometimes other sources) return loosely related listings
 * that don't actually match the model being searched.  This function verifies
 * that all tokens from the model name appear in the title.
 *
 * Uses modelConfig.matchModel (if set) instead of modelConfig.model for matching.
 * This allows display names like "575M Maranello" while matching on just "575M".
 *
 * Matching rules:
 *  1. Quick pass — if the full model name (spaces removed) appears as a contiguous
 *     substring, it's a match (handles "F12BERLINETTA", "328GTS", "F430Spider" etc.)
 *  2. Token-based check — every token must appear in the title:
 *     - Tokens containing digits: left word-boundary, allow optional leading letter
 *       and trailing alpha chars.  "400" matches "400i", "F430" matches "430".
 *       Also tries digits-only extraction for ≥3-digit cores ("575m" → "575").
 *     - Pure-alpha tokens: strict word-boundary, but allow a trailing "i"
 *       (common Italian injection/variant suffix). "BB" matches "BBi", "GT" ≠ "GTO".
 */
function titleMatchesModel(title, modelConfig) {
  if (!title || !modelConfig?.model) return false;

  const stripAccents = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titleNorm = stripAccents(title).toLowerCase();

  // 0. Exclusion patterns — reject before any positive matching
  if (modelConfig.excludePatterns && modelConfig.excludePatterns.length > 0) {
    for (const pattern of modelConfig.excludePatterns) {
      if (new RegExp(pattern, 'i').test(title)) return false;
    }
  }

  const modelName = stripAccents(modelConfig.matchModel || modelConfig.model).toLowerCase();

  // 1. Quick contiguous check (spaces stripped)
  const modelCompact = modelName.replace(/\s+/g, '');
  if (titleNorm.replace(/\s+/g, '').includes(modelCompact)) return true;

  // 2. Tokenise — all tokens are required
  const filler = new Set(['the', 'and', 'di', 'del', 'by']);
  const tokens = modelName.split(/[\s/]+/).filter(t => t.length > 0 && !filler.has(t));
  if (tokens.length === 0) return false;

  function tokenMatches(token) {
    const hasDigit = /\d/.test(token);

    if (hasDigit) {
      // For short alphanumeric tokens (e.g. "M3", "F8", "P1"), require exact word
      // boundary match with NO trailing digits. "M3" must NOT match "M340i" or "M3.0"
      // but SHOULD match "M3 Competition" or "M3".
      if (token.length <= 3) {
        const escaped = esc(token);
        // Match token at word boundary, optionally followed by alpha (not digits)
        // e.g. M3 → matches "M3", "M3 Comp", but not "M340", "M3.0"
        if (new RegExp(`\\b${escaped}(?![0-9.])`, 'i').test(titleNorm)) return true;
        return false;
      }

      // Allow optional leading single letter + trailing alpha chars.
      // e.g. "f430" matches "F430", "430", "430Spider", "F430Spider"
      const escaped = esc(token);
      if (new RegExp(`\\b${escaped}[a-z]*\\b`, 'i').test(titleNorm)) return true;
      // Also try without leading single letter (F430 → 430, F12 → 12)
      // But only if the stripped result is long enough to be meaningful (≥2 chars).
      // "M3" → "3" is too short and would false-positive on engine sizes like "3.0".
      const stripped = token.replace(/^[a-z]/i, '');
      if (stripped !== token && stripped.length >= 2) {
        if (new RegExp(`\\b[a-z]?${esc(stripped)}[a-z]*\\b`, 'i').test(titleNorm)) return true;
      }
      // Also try digits-only core for ≥3 digits (e.g. "575m" → "575")
      const digitsOnly = token.replace(/[^0-9]/g, '');
      if (digitsOnly.length >= 3 && digitsOnly !== token && digitsOnly !== stripped) {
        if (new RegExp(`\\b[a-z]?${esc(digitsOnly)}[a-z]*\\b`, 'i').test(titleNorm)) return true;
      }
      return false;
    }

    // Pure-alpha token: strict word boundary, but allow trailing "i" (injection suffix)
    // "BB" matches "BB", "BBi" but NOT "BBS". "GT" matches "GT", "GTi" but NOT "GTO"/"GTB".
    const escaped = esc(token);
    return new RegExp(`\\b${escaped}i?\\b`, 'i').test(titleNorm);
  }

  for (const token of tokens) {
    if (!tokenMatches(token)) return false;
  }

  return true;
}

module.exports = {
  rateLimit,
  sleep,
  fetchWithRetry,
  parsePrice,
  parseMileage,
  formatPrice,
  extractYear,
  normaliseTransmission,
  normaliseBodyType,
  sourceUrlToId,
  isImageValid,
  titleMatchesModel,
  today,
  DEFAULT_UA,
};
