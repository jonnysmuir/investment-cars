/**
 * routes/watchlist.js
 *
 * Watchlist API — lets authenticated users watch car models.
 * All endpoints require authentication via requireAuth middleware.
 */

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// Helper: read model data file and compute stats
function getModelStats(slug) {
  try {
    const filePath = path.join(__dirname, '..', 'data', `${slug}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const active = (data.listings || []).filter(l => l.status === 'active');
    const prices = active.map(l => {
      const p = String(l.price || '').replace(/[^0-9]/g, '');
      return p ? parseInt(p, 10) : null;
    }).filter(p => p && p > 0).sort((a, b) => a - b);

    const count = prices.length;
    const median = count > 0
      ? (count % 2 === 0
        ? Math.round((prices[count / 2 - 1] + prices[count / 2]) / 2)
        : prices[Math.floor(count / 2)])
      : null;

    return { listingCount: active.length, median };
  } catch {
    return { listingCount: 0, median: null };
  }
}

// Helper: get model display name from models.json
let _modelsCache = null;
function getModelsMap() {
  if (_modelsCache) return _modelsCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'models.json'), 'utf8');
    const { models } = JSON.parse(raw);
    _modelsCache = {};
    for (const m of models) {
      _modelsCache[m.slug] = { make: m.make, model: m.model, heroImage: m.heroImage || '' };
    }
    return _modelsCache;
  } catch {
    return {};
  }
}

/**
 * GET /api/watchlist
 * Returns the user's watched models with live stats.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM watchlist WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    const modelsMap = getModelsMap();
    const watchlist = rows.map(row => {
      const stats = getModelStats(row.model_slug);
      const modelInfo = modelsMap[row.model_slug] || {};
      return {
        ...row,
        displayName: modelInfo.make && modelInfo.model
          ? `${modelInfo.make} ${modelInfo.model}`
          : row.model_slug,
        heroImage: modelInfo.heroImage || '',
        listingCount: stats.listingCount,
        median: stats.median,
      };
    });

    res.json({ watchlist });
  } catch (err) {
    console.error('Watchlist GET error:', err);
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

/**
 * POST /api/watchlist
 * Add a model to the user's watchlist.
 */
router.post('/', requireAuth, async (req, res) => {
  const { slug, notifyNewListings = true, notifyPriceDrops = true } = req.body;

  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' });
  }

  try {
    await pool.query(
      `INSERT INTO watchlist (user_id, model_slug, notify_new_listings, notify_price_drops)
       VALUES (?, ?, ?, ?)`,
      [req.user.id, slug, notifyNewListings, notifyPriceDrops]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Already watching this model' });
    }
    console.error('Watchlist POST error:', err);
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

/**
 * PUT /api/watchlist/:slug
 * Update notification preferences for a watched model.
 */
router.put('/:slug', requireAuth, async (req, res) => {
  const { slug } = req.params;
  const { notifyNewListings, notifyPriceDrops } = req.body;

  const updates = [];
  const values = [];

  if (notifyNewListings !== undefined) {
    updates.push('notify_new_listings = ?');
    values.push(Boolean(notifyNewListings));
  }
  if (notifyPriceDrops !== undefined) {
    updates.push('notify_price_drops = ?');
    values.push(Boolean(notifyPriceDrops));
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No preferences to update' });
  }

  values.push(req.user.id, slug);

  try {
    const [result] = await pool.query(
      `UPDATE watchlist SET ${updates.join(', ')} WHERE user_id = ? AND model_slug = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Not watching this model' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Watchlist PUT error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

/**
 * DELETE /api/watchlist/:slug
 * Remove a model from the user's watchlist.
 */
router.delete('/:slug', requireAuth, async (req, res) => {
  const { slug } = req.params;

  try {
    const [result] = await pool.query(
      'DELETE FROM watchlist WHERE user_id = ? AND model_slug = ?',
      [req.user.id, slug]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Not watching this model' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Watchlist DELETE error:', err);
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

module.exports = router;
