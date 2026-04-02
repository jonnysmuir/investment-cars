/**
 * routes/portfolio.js
 *
 * Portfolio API — lets authenticated users track cars they own, see estimated
 * current values based on market data, and track gain/loss since purchase.
 *
 * All endpoints require authentication via requireAuth middleware.
 */

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// ── Models cache ────────────────────────────────────────────────────────────

let _modelsCache = null;
function getModelsMap() {
  if (_modelsCache) return _modelsCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'models.json'), 'utf8');
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

// ── Generation resolver ─────────────────────────────────────────────────────

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

// ── Valuation helpers ───────────────────────────────────────────────────────

function parsePrice(price) {
  if (!price) return null;
  const s = String(price).replace(/[^0-9]/g, '');
  const n = s ? parseInt(s, 10) : null;
  return n && n > 0 ? n : null;
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Filter listings to match a portfolio car's characteristics.
 */
function filterListingsForCar(listings, car, generations) {
  return listings.filter(l => {
    if (l.status !== 'active') return false;

    // Year: +-2 years
    if (car.year && l.year) {
      if (Math.abs(l.year - car.year) > 2) return false;
    }

    // Generation
    if (car.generation && generations) {
      const listingGen = resolveGeneration(l.title, l.year, generations);
      if (listingGen !== car.generation) return false;
    }

    // Transmission
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

/**
 * Get estimated current value for a portfolio car.
 * Returns { estimatedValue, comparableCount, broadEstimate, marketMedian }.
 */
function getEstimatedValue(slug, car) {
  try {
    const filePath = path.join(__dirname, '..', 'data', `${slug}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const modelsMap = getModelsMap();
    const modelInfo = modelsMap[slug] || {};
    const generations = modelInfo.generations || null;

    const activeListings = (data.listings || []).filter(l => l.status === 'active');

    // All active prices for market median
    const allPrices = activeListings.map(l => parsePrice(l.price)).filter(Boolean);
    const marketMedian = median(allPrices);

    // Filtered prices for car-specific estimate
    const filtered = filterListingsForCar(activeListings, car, generations);
    const filteredPrices = filtered.map(l => parsePrice(l.price)).filter(Boolean);

    if (filteredPrices.length >= 3) {
      return {
        estimatedValue: median(filteredPrices),
        comparableCount: filteredPrices.length,
        broadEstimate: false,
        marketMedian,
      };
    }

    // Fallback to unfiltered median
    return {
      estimatedValue: marketMedian,
      comparableCount: allPrices.length,
      broadEstimate: true,
      marketMedian,
    };
  } catch {
    return { estimatedValue: null, comparableCount: 0, broadEstimate: true, marketMedian: null };
  }
}

/**
 * Enrich a portfolio DB row with valuation data and display name.
 */
function enrichPortfolioEntry(row) {
  const modelsMap = getModelsMap();
  const modelInfo = modelsMap[row.model_slug] || {};
  const displayName = modelInfo.make && modelInfo.model
    ? `${modelInfo.make} ${modelInfo.model}`
    : row.model_slug;

  const valuation = getEstimatedValue(row.model_slug, row);

  let gainLoss = null;
  let gainLossPercent = null;
  if (row.purchase_price && valuation.estimatedValue) {
    gainLoss = valuation.estimatedValue - row.purchase_price;
    gainLossPercent = Math.round((gainLoss / row.purchase_price) * 1000) / 10;
  }

  return {
    ...row,
    displayName,
    heroImage: modelInfo.heroImage || '',
    estimatedValue: valuation.estimatedValue,
    comparableCount: valuation.comparableCount,
    broadEstimate: valuation.broadEstimate,
    marketMedian: valuation.marketMedian,
    gainLoss,
    gainLossPercent,
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/portfolio
 * Returns all cars in the user's portfolio with valuations and portfolio totals.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM portfolio WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    const cars = rows.map(enrichPortfolioEntry);

    let totalPurchasePrice = 0;
    let totalEstimatedValue = 0;
    for (const car of cars) {
      if (car.purchase_price) totalPurchasePrice += car.purchase_price;
      if (car.estimatedValue) totalEstimatedValue += car.estimatedValue;
    }

    const totalGainLoss = totalEstimatedValue - totalPurchasePrice;
    const totalGainLossPercent = totalPurchasePrice > 0
      ? Math.round((totalGainLoss / totalPurchasePrice) * 1000) / 10
      : null;

    res.json({
      portfolio: cars,
      totals: {
        totalPurchasePrice,
        totalEstimatedValue,
        totalGainLoss,
        totalGainLossPercent,
        carCount: cars.length,
      },
    });
  } catch (err) {
    console.error('Portfolio GET error:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

/**
 * GET /api/portfolio/:id
 * Returns a single portfolio entry with full details and valuation.
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM portfolio WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }
    res.json({ car: enrichPortfolioEntry(rows[0]) });
  } catch (err) {
    console.error('Portfolio GET/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch car' });
  }
});

/**
 * GET /api/portfolio/:id/history
 * Returns historical valuation data points for a specific car.
 */
router.get('/:id/history', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM portfolio WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const car = rows[0];
    const historyPath = path.join(__dirname, '..', 'data', 'history', `${car.model_slug}.json`);

    if (!fs.existsSync(historyPath)) {
      return res.json({ history: [] });
    }

    const snapshots = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    const modelsMap = getModelsMap();
    const modelInfo = modelsMap[car.model_slug] || {};
    const generations = modelInfo.generations || null;

    const history = [];
    for (const snapshot of snapshots) {
      const filtered = filterListingsForCar(snapshot.listings || [], car, generations);
      const prices = filtered.map(l => parsePrice(l.price)).filter(Boolean);

      if (prices.length > 0) {
        history.push({
          date: snapshot.date,
          estimatedValue: median(prices),
          listingCount: prices.length,
        });
      }
    }

    res.json({ history });
  } catch (err) {
    console.error('Portfolio history error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * POST /api/portfolio
 * Add a car to the user's portfolio.
 */
router.post('/', requireAuth, async (req, res) => {
  const {
    modelSlug, year, variant, generation, transmission, bodyType,
    purchasePrice, purchaseDate, mileageAtPurchase, currentMileage,
    colour, notes,
  } = req.body;

  if (!modelSlug) {
    return res.status(400).json({ error: 'Missing modelSlug' });
  }

  const modelsMap = getModelsMap();
  if (!modelsMap[modelSlug]) {
    return res.status(400).json({ error: 'Unknown model slug' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO portfolio (user_id, model_slug, year, variant, generation, transmission, body_type, purchase_price, purchase_date, mileage_at_purchase, current_mileage, colour, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, modelSlug,
        year || null, variant || null, generation || null, transmission || null,
        bodyType || null, purchasePrice || null, purchaseDate || null,
        mileageAtPurchase || null, currentMileage || null,
        colour || null, notes || null,
      ]
    );

    const [rows] = await pool.query('SELECT * FROM portfolio WHERE id = ?', [result.insertId]);
    res.status(201).json({ car: enrichPortfolioEntry(rows[0]) });
  } catch (err) {
    console.error('Portfolio POST error:', err);
    res.status(500).json({ error: 'Failed to add car' });
  }
});

/**
 * PUT /api/portfolio/:id
 * Update a car's details.
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const [existing] = await pool.query(
      'SELECT * FROM portfolio WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const allowedFields = [
      'year', 'variant', 'generation', 'transmission', 'body_type',
      'purchase_price', 'purchase_date', 'mileage_at_purchase', 'current_mileage',
      'colour', 'notes',
    ];

    // Map camelCase request keys to snake_case DB columns
    const fieldMap = {
      bodyType: 'body_type',
      purchasePrice: 'purchase_price',
      purchaseDate: 'purchase_date',
      mileageAtPurchase: 'mileage_at_purchase',
      currentMileage: 'current_mileage',
    };

    const updates = [];
    const values = [];
    for (const [key, val] of Object.entries(req.body)) {
      const col = fieldMap[key] || key;
      if (allowedFields.includes(col)) {
        updates.push(`${col} = ?`);
        values.push(val === '' ? null : val);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(req.params.id, req.user.id);
    await pool.query(
      `UPDATE portfolio SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );

    const [rows] = await pool.query('SELECT * FROM portfolio WHERE id = ?', [req.params.id]);
    res.json({ car: enrichPortfolioEntry(rows[0]) });
  } catch (err) {
    console.error('Portfolio PUT error:', err);
    res.status(500).json({ error: 'Failed to update car' });
  }
});

/**
 * DELETE /api/portfolio/:id
 * Remove a car from the user's portfolio.
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM portfolio WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Portfolio DELETE error:', err);
    res.status(500).json({ error: 'Failed to remove car' });
  }
});

module.exports = router;
