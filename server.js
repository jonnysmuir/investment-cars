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
  if (/scuderia\s*16m/i.test(t)) return 'Scuderia 16M';
  if (/scuderia|gtc/i.test(t)) return 'Scuderia';
  if (/challenge|gt3/i.test(t)) return 'Challenge';
  if (/spider|spyder|cabriolet/i.test(t)) return 'Spider';
  if (/coup[eé]|coupe/i.test(t)) return 'Coupe';
  // If no explicit body type, default to Coupe for F430-like names
  if (/f\s?430/i.test(t) && !/(spider|spyder)/i.test(t)) return 'Coupe';
  return null;
}

app.get('/api/history/:slug', (req, res) => {
  const { slug } = req.params;

  if (slug.includes('..') || slug.includes('/')) {
    return res.status(400).json({ error: 'Invalid slug.' });
  }

  const filePath = path.join(__dirname, 'data', 'history', `${slug}.json`);

  // Load main listings file for title-based variant lookup
  let listingTitles = {};
  try {
    const mainData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `${slug}.json`), 'utf8'));
    for (const l of mainData.listings || []) {
      listingTitles[l.id] = l.title || '';
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

      // Latest snapshot distribution with variant info
      const latestSnapshot = history[history.length - 1];
      const distribution = (latestSnapshot && latestSnapshot.listings.length > 0)
        ? latestSnapshot.listings
            .map(l => ({ price: l.price, variant: normaliseVariant(listingTitles[l.id]) }))
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
              tracker.set(l.id, {
                firstDate: snapshot.date,
                lastDate: snapshot.date,
                lastPrice: l.price,
                variant,
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
          // Always emit first-seen point
          listingPrices.push({ ...t.points[0], variant: v });
          // Emit any mid-range price changes (skip first, already added)
          for (let i = 1; i < t.points.length; i++) {
            listingPrices.push({ ...t.points[i], variant: v });
          }
          // Emit last-seen point if it differs from the last recorded point
          const lastRecorded = t.points[t.points.length - 1];
          if (t.lastDate !== lastRecorded.date) {
            listingPrices.push({ date: t.lastDate, price: t.lastPrice, variant: v });
          }
        }
      }

      // ── Glenmarch auction history ──────────────────────────────────────
      const auctionHistory = loadAuctionHistory(slug);

      // Normalise auction history variants
      for (const a of auctionHistory) {
        a.variant = normaliseVariant(a.variant) || a.variant;
      }

      // Price vs mileage data (current listings with numeric mileage)
      const mileageData = (latestSnapshot && latestSnapshot.listings.length > 0)
        ? latestSnapshot.listings
            .filter(l => l.mileage && l.mileage > 0)
            .map(l => ({
              price: l.price,
              mileage: l.mileage,
              variant: normaliseVariant(listingTitles[l.id]),
            }))
        : [];

      // Supply trend: listing count per day with variant breakdown
      const supplyTrend = history.map(snapshot => {
        const byVariant = {};
        for (const l of snapshot.listings) {
          const v = normaliseVariant(listingTitles[l.id]) || 'Other';
          byVariant[v] = (byVariant[v] || 0) + 1;
        }
        return { date: snapshot.date, total: snapshot.listings.length, byVariant };
      });

      res.json({ trend, distribution, listingPrices, auctionHistory, mileageData, supplyTrend });
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
      _modelsCache[m.slug] = { make: m.make, model: m.model };
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
  const ccFile = path.join(__dirname, 'data', 'collecting-cars-sold', `${slug}.json`);
  let ccResults = [];
  try {
    const ccData = JSON.parse(fs.readFileSync(ccFile, 'utf8'));
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
  const cacFile = path.join(__dirname, 'data', 'car-and-classic-sold', `${slug}.json`);
  let cacResults = [];
  try {
    const cacData = JSON.parse(fs.readFileSync(cacFile, 'utf8'));
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
