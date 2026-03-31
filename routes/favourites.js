/**
 * routes/favourites.js
 *
 * Favourites API — lets authenticated users save individual listings.
 * All endpoints require authentication via requireAuth middleware.
 */

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// Helper: look up a listing's current state from data file
function getListingState(modelSlug, listingId) {
  try {
    const filePath = path.join(__dirname, '..', 'data', `${modelSlug}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const listing = (data.listings || []).find(l => String(l.id) === String(listingId));
    if (!listing) return { currentStatus: 'unlisted', currentPrice: null };
    return {
      currentStatus: listing.status || 'active',
      currentPrice: listing.price || null,
    };
  } catch {
    return { currentStatus: 'unknown', currentPrice: null };
  }
}

// Helper: get model display name
let _modelsCache = null;
function getModelsMap() {
  if (_modelsCache) return _modelsCache;
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'models.json'), 'utf8');
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

/**
 * GET /api/favourites
 * Returns the user's saved listings with current state.
 * Optional query param: ?slug=model-slug to filter by model.
 */
router.get('/', requireAuth, async (req, res) => {
  const { slug } = req.query;

  try {
    let query = 'SELECT * FROM favourites WHERE user_id = ?';
    const params = [req.user.id];

    if (slug) {
      query += ' AND model_slug = ?';
      params.push(slug);
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await pool.query(query, params);

    const modelsMap = getModelsMap();
    const favourites = rows.map(row => {
      const state = getListingState(row.model_slug, row.listing_id);
      const modelInfo = modelsMap[row.model_slug] || {};
      return {
        ...row,
        displayName: modelInfo.make && modelInfo.model
          ? `${modelInfo.make} ${modelInfo.model}`
          : row.model_slug,
        currentPrice: state.currentPrice,
        currentStatus: state.currentStatus,
      };
    });

    res.json({ favourites });
  } catch (err) {
    console.error('Favourites GET error:', err);
    res.status(500).json({ error: 'Failed to fetch favourites' });
  }
});

/**
 * POST /api/favourites
 * Save a listing to favourites.
 */
router.post('/', requireAuth, async (req, res) => {
  const { modelSlug, listingId, sourceUrl, title, priceAtSave, imageUrl } = req.body;

  if (!modelSlug || !listingId) {
    return res.status(400).json({ error: 'Missing modelSlug or listingId' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO favourites (user_id, model_slug, listing_id, source_url, title, price_at_save, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, modelSlug, listingId, sourceUrl || null, title || null, priceAtSave || null, imageUrl || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Listing already saved' });
    }
    console.error('Favourites POST error:', err);
    res.status(500).json({ error: 'Failed to save listing' });
  }
});

/**
 * DELETE /api/favourites/:id
 * Remove a saved listing (only if owned by the user).
 */
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      'DELETE FROM favourites WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Favourite not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Favourites DELETE error:', err);
    res.status(500).json({ error: 'Failed to remove favourite' });
  }
});

module.exports = router;
