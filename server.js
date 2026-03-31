require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const trackingRoutes = require('./routes/tracking');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const watchlistRoutes = require('./routes/watchlist');
const favouritesRoutes = require('./routes/favourites');
const { attachUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

// Click-tracking redirect and admin dashboard
app.use(trackingRoutes);
app.use('/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/favourites', favouritesRoutes);

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
  if (/\btarga\b/i.test(t)) return 'Targa';
  if (/\bspeedster\b/i.test(t)) return 'Speedster';
  if (/spider|spyder/i.test(t)) return 'Spider';
  if (/roadster/i.test(t)) return 'Roadster';
  if (/cabrio|cabriolet|convertible|drop\s*head|aperta/i.test(t)) return 'Convertible';
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

      // Hero image (and per-generation images if available)
      const heroImage = modelInfo?.heroImage || '';
      const heroCredit = modelInfo?.heroCredit || '';
      const generationImages = generations
        ? Object.fromEntries(generations.filter(g => g.image).map(g => [g.name, { image: g.image, credit: g.credit || '' }]))
        : null;

      res.json({ trend, distribution, listingPrices, auctionHistory, mileageData, supplyTrend, generations: generationNames, heroImage, heroCredit, generationImages });
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
      _modelsCache[m.slug] = { make: m.make, model: m.model, generations: m.generations || null, heroImage: m.heroImage || '', heroCredit: m.heroCredit || '' };
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

// ── Homepage aggregate data ──────────────────────────────────────────────────
let _homepageCache = null;
let _homepageCacheTime = 0;
const HOMEPAGE_CACHE_TTL = 60000; // 1 minute

app.get('/api/homepage', (req, res) => {
  const now = Date.now();
  if (_homepageCache && (now - _homepageCacheTime) < HOMEPAGE_CACHE_TTL) {
    return res.json(_homepageCache);
  }

  try {
    const modelsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'models.json'), 'utf8'));
    const models = modelsRaw.models;

    // Count by make
    const makeCounts = {};
    const makeDisplay = {};
    for (const m of models) {
      const key = m.make.toLowerCase();
      makeCounts[key] = (makeCounts[key] || 0) + 1;
      if (!makeDisplay[key]) makeDisplay[key] = m.make;
    }

    // Gather per-model stats
    let totalListings = 0;
    let totalAuction = 0;
    const modelStats = [];

    for (const m of models) {
      // Current listings
      let listingCount = 0;
      let heroImage = m.heroImage || '';
      let heroCredit = m.heroCredit || '';
      let description = m.description || '';
      try {
        const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `${m.slug}.json`), 'utf8'));
        const active = (d.listings || []).filter(l => l.status === 'active');
        listingCount = active.length;
        if (d.heroImage) heroImage = d.heroImage;
        if (d.heroCredit) heroCredit = d.heroCredit;
        if (d.description) description = d.description;
      } catch {}
      totalListings += listingCount;

      // Price history for trend calculation
      let median = null, mean = null, lowest = null, highest = null;
      let annualChange = null;
      let recentListings = [];
      try {
        const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'history', `${m.slug}.json`), 'utf8'));
        if (hist.length > 0) {
          const latest = hist[hist.length - 1];
          const prices = latest.listings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
          if (prices.length > 0) {
            const sum = prices.reduce((a, b) => a + b, 0);
            mean = Math.round(sum / prices.length);
            median = prices.length % 2 === 0
              ? Math.round((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)
              : prices[Math.floor(prices.length / 2)];
            lowest = prices[0];
            highest = prices[prices.length - 1];
          }

          // Annual change: compare latest median to ~365 days ago
          if (hist.length > 30) {
            const latestDate = new Date(latest.date);
            const yearAgo = new Date(latestDate);
            yearAgo.setFullYear(yearAgo.getFullYear() - 1);
            const yearAgoStr = yearAgo.toISOString().split('T')[0];
            // Find closest snapshot to a year ago
            let closest = null;
            let closestDiff = Infinity;
            for (const snap of hist) {
              const diff = Math.abs(new Date(snap.date) - yearAgo);
              if (diff < closestDiff) { closestDiff = diff; closest = snap; }
            }
            if (closest && closestDiff < 90 * 24 * 60 * 60 * 1000) {
              const oldPrices = closest.listings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
              if (oldPrices.length > 0) {
                const oldMedian = oldPrices.length % 2 === 0
                  ? Math.round((oldPrices[oldPrices.length / 2 - 1] + oldPrices[oldPrices.length / 2]) / 2)
                  : oldPrices[Math.floor(oldPrices.length / 2)];
                if (oldMedian > 0) {
                  annualChange = Math.round(((median - oldMedian) / oldMedian) * 1000) / 10;
                }
              }
            }
          }
        }
      } catch {}

      // Count auction results
      let auctionCount = 0;
      const auctionData = loadAuctionHistory(m.slug);
      auctionCount = auctionData.length;
      totalAuction += auctionCount;

      // Recent sold auctions (last 5)
      const recentAuctions = auctionData
        .filter(a => a.sold)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3);

      modelStats.push({
        slug: m.slug,
        make: m.make,
        model: m.model,
        displayName: `${m.make} ${m.model}`,
        heroImage,
        heroCredit,
        description,
        listingCount,
        auctionCount,
        median,
        mean,
        lowest,
        highest,
        annualChange,
        recentAuctions,
      });
    }

    // Top movers (by annual change, only models with data)
    const movers = modelStats
      .filter(m => m.annualChange !== null && m.listingCount >= 2)
      .sort((a, b) => b.annualChange - a.annualChange);
    const topAppreciating = movers.slice(0, 8);
    const topDepreciating = movers.filter(m => m.annualChange < 0).sort((a, b) => a.annualChange - b.annualChange).slice(0, 5);

    // Most active (by listing count)
    const mostActive = modelStats
      .filter(m => m.listingCount > 0)
      .sort((a, b) => b.listingCount - a.listingCount)
      .slice(0, 8);

    // Recently added listings (across all models)
    const recentListings = [];
    for (const m of models) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `${m.slug}.json`), 'utf8'));
        for (const l of (d.listings || [])) {
          if (l.status === 'active' && l.dateAdded) {
            recentListings.push({
              ...l,
              modelSlug: m.slug,
              modelName: `${m.make} ${m.model}`,
              heroImage: d.heroImage || m.heroImage || '',
            });
          }
        }
      } catch {}
    }
    recentListings.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
    const latestListings = recentListings.slice(0, 12);

    // Latest auction results
    const allRecentAuctions = modelStats
      .flatMap(m => m.recentAuctions.map(a => ({ ...a, modelSlug: m.slug, modelName: m.displayName, heroImage: m.heroImage })))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10);

    const result = {
      totalModels: models.length,
      totalListings,
      totalAuction,
      makes: Object.entries(makeDisplay).map(([key, display]) => ({
        key,
        name: display,
        count: makeCounts[key],
        // Use first model's hero as make representative
        heroImage: models.find(m => m.make.toLowerCase() === key)?.heroImage || '',
      })),
      topAppreciating,
      topDepreciating,
      mostActive,
      latestListings,
      allRecentAuctions,
      allModels: modelStats.map(m => ({
        slug: m.slug, make: m.make, model: m.model, displayName: m.displayName,
        heroImage: m.heroImage, listingCount: m.listingCount, median: m.median, annualChange: m.annualChange,
      })),
    };

    _homepageCache = result;
    _homepageCacheTime = now;
    res.json(result);
  } catch (err) {
    console.error('Homepage API error:', err);
    res.status(500).json({ error: 'Failed to load homepage data.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
