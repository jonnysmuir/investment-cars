/**
 * scripts/lib/valuation.js
 *
 * Shared valuation helpers for portfolio cars. Used by both routes/portfolio.js
 * (live API) and scripts/send-user-alerts.js (nightly alert engine) to avoid
 * duplicating the filtering and median-calculation logic.
 *
 * Everything in here is pure — it takes data in, returns numbers out, and
 * never touches the database or the filesystem directly. The caller passes
 * in the already-loaded listings / generations / models map.
 */

const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// ── Low-level helpers ────────────────────────────────────────────────────────

function parsePrice(price) {
  if (price === null || price === undefined) return null;
  if (typeof price === 'number') return price > 0 ? Math.round(price) : null;
  const s = String(price).replace(/[^0-9]/g, '');
  const n = s ? parseInt(s, 10) : null;
  return n && n > 0 ? n : null;
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Resolve the generation of a listing based on its title/year and the
 * model's generation config. Tries title pattern match first, then
 * falls back to year range.
 */
function resolveGeneration(text, year, generations) {
  if (!generations || generations.length === 0) return null;
  if (text) {
    for (const gen of generations) {
      for (const pat of gen.patterns) {
        const re = new RegExp(`\\b${pat}\\b`, 'i');
        if (re.test(text)) return gen.name;
      }
    }
  }
  if (year) {
    for (const gen of generations) {
      if (year >= gen.years[0] && year <= gen.years[1]) return gen.name;
    }
  }
  return null;
}

// ── Models map (cached) ──────────────────────────────────────────────────────

let _modelsCache = null;
function getModelsMap() {
  if (_modelsCache) return _modelsCache;
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'models.json'), 'utf8');
    const { models } = JSON.parse(raw);
    _modelsCache = {};
    for (const m of models) {
      _modelsCache[m.slug] = {
        make: m.make,
        model: m.model,
        heroImage: m.heroImage || '',
        generations: m.generations || null,
      };
    }
    return _modelsCache;
  } catch {
    return {};
  }
}

// ── Car ↔ listing matching ───────────────────────────────────────────────────

/**
 * Filter listings to those that match a portfolio car's characteristics.
 * Only considers active listings. Applies year (±2), generation,
 * transmission, and body type filters.
 */
function filterListingsForCar(listings, car, generations) {
  return listings.filter(l => {
    if (l.status && l.status !== 'active') return false;

    // Year: ±2 years
    if (car.year && l.year) {
      if (Math.abs(l.year - car.year) > 2) return false;
    }

    // Generation
    if (car.generation && generations) {
      const listingGen = resolveGeneration(l.title, l.year, generations);
      if (listingGen !== car.generation) return false;
    }

    // Transmission — manual vs automatic bucketing
    if (car.transmission) {
      const lt = (l.transmission || '').toLowerCase();
      const ct = car.transmission.toLowerCase();
      if (ct.includes('manual') && !lt.includes('manual')) return false;
      if (!ct.includes('manual') && lt.includes('manual')) return false;
      if (!ct.includes('manual') && !lt.includes(ct) && !ct.includes(lt)) return false;
    }

    // Body type
    if (car.body_type) {
      const lb = (l.bodyType || '').toLowerCase();
      if (lb && lb !== car.body_type.toLowerCase()) return false;
    }

    return true;
  });
}

// ── Public valuation API ─────────────────────────────────────────────────────

/**
 * Load a model's live listings file from disk. Returns [] on error.
 */
function loadModelListings(slug) {
  try {
    const filePath = path.join(DATA_DIR, `${slug}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.listings || [];
  } catch {
    return [];
  }
}

/**
 * Load a model's history snapshots from disk. Returns [] if no history.
 */
function loadModelHistory(slug) {
  try {
    const historyPath = path.join(DATA_DIR, 'history', `${slug}.json`);
    if (!fs.existsSync(historyPath)) return [];
    return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Estimate the current value of a portfolio car using live listings.
 * Falls back to unfiltered model median if fewer than 3 comparables match.
 *
 * Returns { estimatedValue, comparableCount, broadEstimate, marketMedian }.
 */
function getEstimatedValue(slug, car) {
  const listings = loadModelListings(slug);
  const modelsMap = getModelsMap();
  const modelInfo = modelsMap[slug] || {};
  const generations = modelInfo.generations || null;

  const active = listings.filter(l => l.status === 'active');
  const allPrices = active.map(l => parsePrice(l.price)).filter(Boolean);
  const marketMedian = median(allPrices);

  const filtered = filterListingsForCar(active, car, generations);
  const filteredPrices = filtered.map(l => parsePrice(l.price)).filter(Boolean);

  if (filteredPrices.length >= 3) {
    return {
      estimatedValue: median(filteredPrices),
      comparableCount: filteredPrices.length,
      broadEstimate: false,
      marketMedian,
    };
  }

  return {
    estimatedValue: marketMedian,
    comparableCount: allPrices.length,
    broadEstimate: true,
    marketMedian,
  };
}

/**
 * Compute a historical valuation for a car from a specific history snapshot.
 * Snapshot listings in data/history/{slug}.json have a slimmer shape than
 * live listings — they omit `title`, so generation resolution falls back to
 * year ranges only. This matches the behaviour of the live portfolio
 * history endpoint.
 *
 * Returns null if fewer than 3 comparables were available on that date
 * (we don't broaden to the full market median for historical points; an
 * unreliable historical value is worse than no value).
 */
function valuateSnapshotForCar(snapshot, car, generations) {
  if (!snapshot || !snapshot.listings) return null;
  const filtered = filterListingsForCar(snapshot.listings, car, generations);
  const prices = filtered.map(l => parsePrice(l.price)).filter(Boolean);
  if (prices.length < 3) return null;
  return {
    date: snapshot.date,
    estimatedValue: median(prices),
    listingCount: prices.length,
  };
}

/**
 * Return the historical valuation for a car at or before the given cutoff date.
 * Walks the history from most-recent backwards and returns the first snapshot
 * on-or-before `cutoffDate` (YYYY-MM-DD) that has enough comparables.
 * Returns null if no such snapshot exists.
 */
function getHistoricalValue(slug, car, cutoffDate) {
  const history = loadModelHistory(slug);
  if (history.length === 0) return null;

  const modelsMap = getModelsMap();
  const modelInfo = modelsMap[slug] || {};
  const generations = modelInfo.generations || null;

  // Walk from newest back to oldest
  for (let i = history.length - 1; i >= 0; i--) {
    const snap = history[i];
    if (!snap.date) continue;
    if (snap.date > cutoffDate) continue;
    const v = valuateSnapshotForCar(snap, car, generations);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Build the full history time-series for a car (used by the live
 * portfolio history API). Returns an array of { date, estimatedValue,
 * listingCount } for every snapshot that had ≥1 comparable.
 */
function buildCarHistorySeries(slug, car) {
  const history = loadModelHistory(slug);
  if (history.length === 0) return [];

  const modelsMap = getModelsMap();
  const modelInfo = modelsMap[slug] || {};
  const generations = modelInfo.generations || null;

  const out = [];
  for (const snap of history) {
    const filtered = filterListingsForCar(snap.listings || [], car, generations);
    const prices = filtered.map(l => parsePrice(l.price)).filter(Boolean);
    if (prices.length > 0) {
      out.push({
        date: snap.date,
        estimatedValue: median(prices),
        listingCount: prices.length,
      });
    }
  }
  return out;
}

module.exports = {
  // low-level
  parsePrice,
  median,
  resolveGeneration,
  filterListingsForCar,
  // loading
  getModelsMap,
  loadModelListings,
  loadModelHistory,
  // high-level
  getEstimatedValue,
  getHistoricalValue,
  buildCarHistorySeries,
};
