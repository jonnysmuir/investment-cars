/**
 * routes/watchlist.js
 *
 * Watchlist API — lets authenticated users watch car models with optional
 * filter preferences. Supports multiple watches per model with different
 * filter configurations (e.g. "BMW M3 E46 Manual" and "BMW M3 G80").
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

// ── Filter helpers ──────────────────────────────────────────────────────────

/**
 * Normalise a filters object: remove keys with null/undefined values,
 * return null if empty or all null.
 */
function normaliseFilters(f) {
  if (!f || typeof f !== 'object') return null;
  const clean = {};
  for (const [k, v] of Object.entries(f)) {
    if (v !== null && v !== undefined && v !== '') {
      clean[k] = v;
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/**
 * Compare two filter objects for equality.
 * Both null = match. Normalises before comparing.
 */
function filtersMatch(a, b) {
  const na = normaliseFilters(a);
  const nb = normaliseFilters(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  const keysA = Object.keys(na).sort();
  const keysB = Object.keys(nb).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (String(na[keysA[i]]) !== String(nb[keysB[i]])) return false;
  }
  return true;
}

/**
 * Resolve generation for a listing using title pattern matching + year fallback.
 * Same logic as server.js resolveGeneration().
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

/**
 * Check if a listing matches a set of saved filters.
 * Returns true if the listing passes all active filter criteria.
 */
function listingMatchesFilters(listing, filters, generations) {
  if (!filters) return true; // No filters = matches everything

  // Year range
  if (filters.yearMin && listing.year && listing.year < filters.yearMin) return false;
  if (filters.yearMax && listing.year && listing.year > filters.yearMax) return false;

  // Body type
  if (filters.bodyType) {
    const listingBody = (listing.bodyType || '').toLowerCase();
    if (listingBody !== filters.bodyType.toLowerCase()) return false;
  }

  // Transmission
  if (filters.transmission) {
    const lt = (listing.transmission || '').toLowerCase();
    const ft = filters.transmission.toLowerCase();
    if (!lt.includes(ft) && !ft.includes('manual') !== !lt.includes('manual')) {
      // Simple match: if filter says "manual", listing must contain "manual"
      // Otherwise match by inclusion
      if (ft.includes('manual') && !lt.includes('manual')) return false;
      if (!ft.includes('manual') && lt.includes('manual')) return false;
    }
  }

  // Generation
  if (filters.generation && generations) {
    const listingGen = resolveGeneration(listing.title, listing.year, generations);
    if (listingGen !== filters.generation) return false;
  }

  // Source
  if (filters.source) {
    const sources = (listing.sources || []).map(s => s.name);
    if (!sources.includes(filters.source)) return false;
  }

  // Variant (use simple title matching)
  if (filters.variant) {
    const title = (listing.title || '').toLowerCase();
    const variant = filters.variant.toLowerCase();
    if (!title.includes(variant)) return false;
  }

  return true;
}

/**
 * Read model data file, filter active listings by saved filters,
 * compute listing count and median price.
 */
function getFilteredModelStats(slug, filters) {
  try {
    const filePath = path.join(__dirname, '..', 'data', `${slug}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const modelsMap = getModelsMap();
    const modelInfo = modelsMap[slug] || {};
    const generations = modelInfo.generations || null;

    let active = (data.listings || []).filter(l => l.status === 'active');

    // Apply saved filters
    if (filters) {
      active = active.filter(l => listingMatchesFilters(l, filters, generations));
    }

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

/**
 * Build a human-readable summary string from a filters object.
 * E.g. "E46 · Manual · Coupe" or "2006–2012 · Manual" or "All variants"
 */
function buildFilterSummary(filters) {
  if (!filters || Object.keys(filters).length === 0) return 'All variants';

  const parts = [];

  // Year range
  if (filters.yearMin && filters.yearMax) {
    parts.push(`${filters.yearMin}\u2013${filters.yearMax}`);
  } else if (filters.yearMin) {
    parts.push(`${filters.yearMin}+`);
  } else if (filters.yearMax) {
    parts.push(`Up to ${filters.yearMax}`);
  }

  // Generation
  if (filters.generation) parts.push(filters.generation);

  // Variant
  if (filters.variant) parts.push(filters.variant);

  // Transmission
  if (filters.transmission) parts.push(filters.transmission);

  // Body type (capitalise first letter)
  if (filters.bodyType) {
    parts.push(filters.bodyType.charAt(0).toUpperCase() + filters.bodyType.slice(1));
  }

  // Source
  if (filters.source) parts.push(filters.source);

  return parts.length > 0 ? parts.join(' \u00b7 ') : 'All variants';
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/watchlist
 * Returns the user's watched models with live filtered stats and filter summaries.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM watchlist WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );

    const modelsMap = getModelsMap();
    const watchlist = rows.map(row => {
      const f = normaliseFilters(row.filters);
      const stats = getFilteredModelStats(row.model_slug, f);
      const modelInfo = modelsMap[row.model_slug] || {};
      return {
        ...row,
        filters: f,
        displayName: modelInfo.make && modelInfo.model
          ? `${modelInfo.make} ${modelInfo.model}`
          : row.model_slug,
        heroImage: modelInfo.heroImage || '',
        filterSummary: buildFilterSummary(f),
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
 * Add a model (with optional filters) to the user's watchlist.
 * Checks for duplicate entries with matching filters via app-level comparison.
 */
router.post('/', requireAuth, async (req, res) => {
  const { slug, filters: rawFilters, notifyNewListings = true, notifyPriceDrops = true } = req.body;

  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' });
  }

  const filters = normaliseFilters(rawFilters);

  try {
    // Check for duplicate: same user, same slug, matching filters
    const [existing] = await pool.query(
      'SELECT id, filters FROM watchlist WHERE user_id = ? AND model_slug = ?',
      [req.user.id, slug]
    );

    for (const row of existing) {
      if (filtersMatch(row.filters, filters)) {
        return res.status(409).json({ error: 'Already watching this configuration', existingId: row.id });
      }
    }

    const [result] = await pool.query(
      `INSERT INTO watchlist (user_id, model_slug, filters, notify_new_listings, notify_price_drops)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, slug, filters ? JSON.stringify(filters) : null, notifyNewListings, notifyPriceDrops]
    );

    res.status(201).json({
      success: true,
      id: result.insertId,
      filterSummary: buildFilterSummary(filters),
    });
  } catch (err) {
    console.error('Watchlist POST error:', err);
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

/**
 * PUT /api/watchlist/:id
 * Update filters and/or notification preferences for a specific watchlist entry.
 */
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { filters: rawFilters, notifyNewListings, notifyPriceDrops } = req.body;

  const updates = [];
  const values = [];

  if (rawFilters !== undefined) {
    const filters = normaliseFilters(rawFilters);
    updates.push('filters = ?');
    values.push(filters ? JSON.stringify(filters) : null);
  }
  if (notifyNewListings !== undefined) {
    updates.push('notify_new_listings = ?');
    values.push(Boolean(notifyNewListings));
  }
  if (notifyPriceDrops !== undefined) {
    updates.push('notify_price_drops = ?');
    values.push(Boolean(notifyPriceDrops));
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(id, req.user.id);

  try {
    const [result] = await pool.query(
      `UPDATE watchlist SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Watchlist entry not found' });
    }

    // Return updated entry
    const [rows] = await pool.query('SELECT * FROM watchlist WHERE id = ?', [id]);
    const entry = rows[0];
    const f = normaliseFilters(entry.filters);
    res.json({
      success: true,
      filterSummary: buildFilterSummary(f),
    });
  } catch (err) {
    console.error('Watchlist PUT error:', err);
    res.status(500).json({ error: 'Failed to update watchlist entry' });
  }
});

/**
 * DELETE /api/watchlist/:id
 * Remove a specific watchlist entry (verified by user_id).
 */
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      'DELETE FROM watchlist WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Watchlist entry not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Watchlist DELETE error:', err);
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

module.exports = router;
