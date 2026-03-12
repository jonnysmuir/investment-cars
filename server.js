const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  console.log('New contact submission:', { name, email, message });

  res.json({ success: true, message: 'Thanks for reaching out! We\'ll be in touch.' });
});

app.get('/api/models', (req, res) => {
  const filePath = path.join(__dirname, 'data', 'models.json');

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to load models.' });
    }

    try {
      const { models } = JSON.parse(data);
      // Group by make, return label + slug for each
      const grouped = {};
      const makeDisplay = {}; // preserve original casing e.g. "BMW" not "Bmw"
      for (const m of models) {
        const key = m.make.toLowerCase();
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({ label: m.model, slug: m.slug });
        if (!makeDisplay[key]) makeDisplay[key] = m.make;
      }
      // Sort models within each make alphabetically
      for (const key of Object.keys(grouped)) {
        grouped[key].sort((a, b) => a.label.localeCompare(b.label));
      }
      res.json({ makes: makeDisplay, models: grouped });
    } catch {
      res.status(500).json({ error: 'Invalid models data.' });
    }
  });
});

app.get('/api/listings/:slug', (req, res) => {
  const { slug } = req.params;

  if (slug.includes('..') || slug.includes('/')) {
    return res.status(400).json({ error: 'Invalid listing slug.' });
  }

  const filePath = path.join(__dirname, 'data', `${slug}.json`);

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Listing not found.' });
      }
      return res.status(500).json({ error: 'Failed to load listings.' });
    }

    try {
      res.json(JSON.parse(data));
    } catch {
      res.status(500).json({ error: 'Invalid listing data.' });
    }
  });
});

// Normalise a variant string (from title or auction data) into a clean category.
// Returns null if no specific variant can be determined.
function normaliseVariant(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  // Specific named variants (check before generic body types)
  if (/scuderia\s*16m/i.test(t)) return 'Scuderia 16M';
  if (/scuderia/i.test(t)) return 'Scuderia';
  if (/challenge\b/i.test(t)) return 'Challenge';
  if (/speciale/i.test(t)) return 'Speciale';
  if (/pista/i.test(t)) return 'Pista';
  if (/performante/i.test(t)) return 'Performante';
  if (/super\s*veloce|\bsv\b|\bsvj\b/i.test(t)) return 'SV';
  if (/competizione/i.test(t)) return 'Competizione';
  if (/\bgto\b/i.test(t)) return 'GTO';
  if (/\bgts\b/i.test(t)) return 'GTS';
  if (/\bgt\b/i.test(t) && !/spider|spyder|gran turismo/i.test(t)) return 'GT';
  if (/\blt\b|longtail/i.test(t)) return 'LT';

  // Generic body types
  if (/spider|spyder/i.test(t)) return 'Spider';
  if (/roadster/i.test(t)) return 'Roadster';
  if (/cabrio|convertible|drop\s*head|aperta/i.test(t)) return 'Convertible';
  if (/berlinetta/i.test(t)) return 'Berlinetta';
  if (/coup[eé]|coupe/i.test(t)) return 'Coupe';

  return null;
}

// Resolve generation for multi-generation models (e.g. BMW M3 E30/E36/E46/E9x/F80/G80).
// Tries title pattern match first, then falls back to year-range.
// Returns generation name or null.
function resolveGeneration(text, year, generations) {
  if (!generations || generations.length === 0) return null;

  // 1. Try title pattern match (e.g. "(E46)" or "E46" in text)
  if (text) {
    for (const gen of generations) {
      for (const pat of gen.patterns) {
        const re = new RegExp(`\\b${pat}\\b`, 'i');
        if (re.test(text)) return gen.name;
      }
    }
  }

  // 2. Fall back to year range
  if (year) {
    for (const gen of generations) {
      if (year >= gen.years[0] && year <= gen.years[1]) return gen.name;
    }
  }

  return null;
}

app.get('/api/history/:slug', (req, res) => {
  const { slug } = req.params;

  if (slug.includes('..') || slug.includes('/')) {
    return res.status(400).json({ error: 'Invalid slug.' });
  }

  const filePath = path.join(__dirname, 'data', 'history', `${slug}.json`);

  // Load model config for generations (if any)
  const modelsMap = getModelsMap();
  const modelInfo = modelsMap[slug];
  const generations = modelInfo?.generations || null;

  // Load main listings file for title-based variant/generation lookup
  let listingTitles = {};
  let listingYears = {};
  try {
    const mainData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `${slug}.json`), 'utf8'));
    for (const l of mainData.listings || []) {
      listingTitles[l.id] = l.title || '';
      listingYears[l.id] = l.year || null;
    }
  } catch { /* no main data file */ }

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err && err.code !== 'ENOENT') {
      return res.status(500).json({ error: 'Failed to load history.' });
    }

    try {
      const history = err ? [] : JSON.parse(data);

      // Compute aggregate stats per day (per-listing data reserved for premium)
      const trend = history.map(snapshot => {
        const prices = snapshot.listings.map(l => l.price).sort((a, b) => a - b);
        const count = prices.length;

        if (count === 0) {
          return { date: snapshot.date, count: 0, median: null, mean: null, min: null, max: null };
        }

        const sum = prices.reduce((a, b) => a + b, 0);
        const mean = Math.round(sum / count);
        const median = count % 2 === 0
          ? Math.round((prices[count / 2 - 1] + prices[count / 2]) / 2)
          : prices[Math.floor(count / 2)];

        return { date: snapshot.date, count, median, mean, min: prices[0], max: prices[count - 1] };
      });

      // Latest snapshot distribution with variant + generation info
      const latestSnapshot = history[history.length - 1];
      const distribution = (latestSnapshot && latestSnapshot.listings.length > 0)
        ? latestSnapshot.listings
            .map(l => ({
              price: l.price,
              variant: normaliseVariant(listingTitles[l.id]),
              generation: resolveGeneration(listingTitles[l.id], l.year || listingYears[l.id], generations),
            }))
            .sort((a, b) => a.price - b.price)
        : null;

      // Smart listing prices: first appearance, last appearance (before
      // disappearing), and any price-change dates — avoids flooding the
      // chart with one dot per listing per day.
      const listingPrices = [];
      if (history.length > 0) {
        // Track each listing across snapshots: { firstDate, lastDate, prices: [{date,price}] }
        const tracker = new Map();
        const snapshotDates = history.map(s => s.date);

        for (const snapshot of history) {
          const idsInSnapshot = new Set();
          for (const l of snapshot.listings) {
            idsInSnapshot.add(l.id);
            if (!tracker.has(l.id)) {
              const variant = normaliseVariant(listingTitles[l.id]);
              const generation = resolveGeneration(listingTitles[l.id], l.year || listingYears[l.id], generations);
              tracker.set(l.id, {
                firstDate: snapshot.date,
                lastDate: snapshot.date,
                lastPrice: l.price,
                variant,
                generation,
                points: [{ date: snapshot.date, price: l.price }],
              });
            } else {
              const t = tracker.get(l.id);
              t.lastDate = snapshot.date;
              // Record a point only if the price changed
              if (l.price !== t.lastPrice) {
                t.points.push({ date: snapshot.date, price: l.price });
                t.lastPrice = l.price;
              }
            }
          }
          // Mark listings that disappeared after this snapshot
          for (const [id, t] of tracker) {
            if (!idsInSnapshot.has(id) && !t.gone) {
              t.gone = true;
            }
          }
        }

        const lastSnapshotDate = snapshotDates[snapshotDates.length - 1];
        for (const t of tracker.values()) {
          const v = t.variant;
          const g = t.generation;
          // Always emit first-seen point
          listingPrices.push({ ...t.points[0], variant: v, generation: g });
          // Emit any mid-range price changes (skip first, already added)
          for (let i = 1; i < t.points.length; i++) {
            listingPrices.push({ ...t.points[i], variant: v, generation: g });
          }
          // Emit last-seen point if it differs from the last recorded point
          const lastRecorded = t.points[t.points.length - 1];
          if (t.lastDate !== lastRecorded.date) {
            listingPrices.push({ date: t.lastDate, price: t.lastPrice, variant: v, generation: g });
          }
        }
      }

      // ── Glenmarch auction history ──────────────────────────────────────
      const auctionHistory = loadAuctionHistory(slug);

      // Normalise auction history variants and resolve generations
      for (const a of auctionHistory) {
        a.generation = resolveGeneration(a.variant, a.year, generations);
        a.variant = normaliseVariant(a.variant) || null;
      }

      // Price vs mileage data — collect from ALL snapshots (de-duped by listing id, latest price wins)
      const mileageMap = new Map();
      const currentIds = latestSnapshot ? new Set(latestSnapshot.listings.map(l => l.id)) : new Set();
      for (const snapshot of history) {
        for (const l of snapshot.listings) {
          if (l.mileage && l.mileage > 0) {
            mileageMap.set(l.id, {
              price: l.price,
              mileage: l.mileage,
              variant: normaliseVariant(listingTitles[l.id]),
              generation: resolveGeneration(listingTitles[l.id], l.year || listingYears[l.id], generations),
              active: currentIds.has(l.id),
            });
          }
        }
      }
      const mileageData = Array.from(mileageMap.values());

      // Supply trend: listing count per day with variant + generation breakdown
      const supplyTrend = history.map(snapshot => {
        const byVariant = {};
        const byGeneration = {};
        for (const l of snapshot.listings) {
          const v = normaliseVariant(listingTitles[l.id]) || 'Other';
          byVariant[v] = (byVariant[v] || 0) + 1;
          if (generations) {
            const g = resolveGeneration(listingTitles[l.id], l.year || listingYears[l.id], generations) || 'Other';
            byGeneration[g] = (byGeneration[g] || 0) + 1;
          }
        }
        const entry = { date: snapshot.date, total: snapshot.listings.length, byVariant };
        if (generations) entry.byGeneration = byGeneration;
        return entry;
      });

      // Return generations list so frontend can build filter buttons
      const generationNames = generations ? generations.map(g => g.name) : null;

      res.json({ trend, distribution, listingPrices, auctionHistory, mileageData, supplyTrend, generations: generationNames });
    } catch {
      res.status(500).json({ error: 'Invalid history data.' });
    }
  });
});

// ── Glenmarch auction data helper ──────────────────────────────────────────
let _modelsCache = null;

function getModelsMap() {
  if (_modelsCache) return _modelsCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'models.json'), 'utf8');
    const { models } = JSON.parse(raw);
    _modelsCache = {};
    for (const m of models) {
      _modelsCache[m.slug] = { make: m.make, model: m.model, generations: m.generations || null };
    }
    return _modelsCache;
  } catch {
    return {};
  }
}

function loadAuctionHistory(slug) {
  const modelsMap = getModelsMap();
  const modelInfo = modelsMap[slug];
  if (!modelInfo) return [];

  let matched;

  // 1. Prefer model-specific Glenmarch file (e.g. data/glenmarch/ferrari-f430.json)
  const modelFile = path.join(__dirname, 'data', 'glenmarch', `${slug}.json`);
  try {
    matched = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
  } catch {
    // 2. Fall back to make-level file with model matching
    const makeFile = path.join(__dirname, 'data', 'glenmarch', `${modelInfo.make.toLowerCase()}.json`);
    try {
      const allResults = JSON.parse(fs.readFileSync(makeFile, 'utf8'));
      const modelName = modelInfo.model.toLowerCase();
      const numericPart = modelName.replace(/[^0-9]/g, '');

      matched = allResults.filter(r => {
        const gm = r.model.toLowerCase();
        if (gm.includes(modelName) || modelName.includes(gm)) return true;
        if (numericPart && numericPart.length >= 3) {
          const gmNum = gm.replace(/[^0-9]/g, '');
          if (gmNum === numericPart) return true;
        }
        return false;
      });
    } catch {
      return [];
    }
  }

  // Filter Glenmarch to GBP-only (UK auctions)
  const glenmarchResults = matched
    .filter(r => r.date && r.currency === 'GBP')
    .map(r => ({
      date: r.date,
      price: r.price,
      sold: r.sold,
      variant: r.model,
      year: r.year,
      source: 'Glenmarch',
    }));

  // 3. Also load Collecting Cars sold data if available
  let ccResults = [];
  try {
    // Prefer model-specific file, fall back to make-level file with model matching
    const ccModelFile = path.join(__dirname, 'data', 'collecting-cars-sold', `${slug}.json`);
    const ccMakeFile = path.join(__dirname, 'data', 'collecting-cars-sold', `${modelInfo.make.toLowerCase()}.json`);
    let ccData;
    try {
      ccData = JSON.parse(fs.readFileSync(ccModelFile, 'utf8'));
    } catch {
      const allCC = JSON.parse(fs.readFileSync(ccMakeFile, 'utf8'));
      const modelName = modelInfo.model.toLowerCase();
      const numericPart = modelName.replace(/[^0-9]/g, '');
      ccData = allCC.filter(r => {
        const rm = (r.model || '').toLowerCase();
        if (rm.includes(modelName) || modelName.includes(rm)) return true;
        if (numericPart && numericPart.length >= 3) {
          const rmNum = rm.replace(/[^0-9]/g, '');
          if (rmNum === numericPart) return true;
        }
        return false;
      });
    }
    ccResults = ccData
      .filter(r => r.date && r.price && r.currency === 'GBP')
      .map(r => ({
        date: r.date,
        price: r.price,
        sold: true,
        variant: r.model,
        year: r.year,
        source: 'Collecting Cars',
      }));
  } catch {
    // No CC data for this model
  }

  // 4. Also load Car & Classic sold data if available
  let cacResults = [];
  try {
    const cacModelFile = path.join(__dirname, 'data', 'car-and-classic-sold', `${slug}.json`);
    const cacMakeFile = path.join(__dirname, 'data', 'car-and-classic-sold', `${modelInfo.make.toLowerCase()}.json`);
    let cacData;
    try {
      cacData = JSON.parse(fs.readFileSync(cacModelFile, 'utf8'));
    } catch {
      const allCAC = JSON.parse(fs.readFileSync(cacMakeFile, 'utf8'));
      const modelName = modelInfo.model.toLowerCase();
      const numericPart = modelName.replace(/[^0-9]/g, '');
      cacData = allCAC.filter(r => {
        const rm = (r.model || '').toLowerCase();
        if (rm.includes(modelName) || modelName.includes(rm)) return true;
        if (numericPart && numericPart.length >= 3) {
          const rmNum = rm.replace(/[^0-9]/g, '');
          if (rmNum === numericPart) return true;
        }
        return false;
      });
    }
    cacResults = cacData
      .filter(r => r.date && r.price && r.currency === 'GBP')
      .map(r => ({
        date: r.date,
        price: r.price,
        sold: r.sold,
        variant: r.model,
        year: r.year,
        source: 'Car & Classic',
      }));
  } catch {
    // No Car & Classic data for this model
  }

  // Merge and sort chronologically
  return [...glenmarchResults, ...ccResults, ...cacResults]
    .sort((a, b) => a.date.localeCompare(b.date));
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
