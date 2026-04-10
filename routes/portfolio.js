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
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const pool = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const {
  getModelsMap,
  getEstimatedValue,
  buildCarHistorySeries,
} = require('../scripts/lib/valuation');

const router = Router();

// ── Supabase Storage client ─────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const STORAGE_BUCKET = 'portfolio-photos';

// Multer: memory storage, 5MB limit, image types only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
  },
});

/**
 * Parse a Supabase storage public URL into a storage path.
 * Returns null if not a recognisable public URL for our bucket.
 */
function storagePathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.substring(idx + marker.length);
}

async function deletePhotoFromStorage(photoUrl) {
  const storagePath = storagePathFromPublicUrl(photoUrl);
  if (!storagePath) return;
  try {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
  } catch (err) {
    console.error('Failed to delete photo from storage:', err.message);
  }
}

// ── Enrichment ──────────────────────────────────────────────────────────────

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
    const history = buildCarHistorySeries(rows[0].model_slug, rows[0]);
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
      'model_slug', 'year', 'variant', 'generation', 'transmission', 'body_type',
      'purchase_price', 'purchase_date', 'mileage_at_purchase', 'current_mileage',
      'colour', 'notes', 'photo_url',
    ];

    // Map camelCase request keys to snake_case DB columns
    const fieldMap = {
      modelSlug: 'model_slug',
      bodyType: 'body_type',
      purchasePrice: 'purchase_price',
      purchaseDate: 'purchase_date',
      mileageAtPurchase: 'mileage_at_purchase',
      currentMileage: 'current_mileage',
      photoUrl: 'photo_url',
    };

    // Validate model_slug if provided
    if (req.body.modelSlug) {
      const modelsMap = getModelsMap();
      if (!modelsMap[req.body.modelSlug]) {
        return res.status(400).json({ error: 'Unknown model slug' });
      }
    }

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

    // If photo_url is being changed or cleared, delete the old one from storage
    const oldPhotoUrl = existing[0].photo_url;
    const newPhotoUrl = req.body.photoUrl !== undefined ? req.body.photoUrl : req.body.photo_url;
    if (oldPhotoUrl && newPhotoUrl !== undefined && newPhotoUrl !== oldPhotoUrl) {
      await deletePhotoFromStorage(oldPhotoUrl);
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
    // Fetch the photo_url before deleting so we can clean up storage
    const [existing] = await pool.query(
      'SELECT photo_url FROM portfolio WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const [result] = await pool.query(
      'DELETE FROM portfolio WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }

    // Clean up photo from Supabase Storage (non-blocking — don't fail the delete if storage fails)
    if (existing[0].photo_url) {
      deletePhotoFromStorage(existing[0].photo_url);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Portfolio DELETE error:', err);
    res.status(500).json({ error: 'Failed to remove car' });
  }
});

/**
 * POST /api/portfolio/upload-photo
 * Upload a photo for a portfolio car. Accepts multipart/form-data with
 * a single "photo" field and an optional "portfolioId" field to namespace
 * the filename. Returns the public URL of the uploaded image.
 */
router.post('/upload-photo', requireAuth, (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Max 5MB.' });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      // Determine extension from mime type
      const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const ext = extMap[req.file.mimetype] || 'bin';
      const portfolioId = req.body.portfolioId || 'new';
      const timestamp = Date.now();
      const filePath = `${req.user.id}/${portfolioId}-${timestamp}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        return res.status(500).json({ error: 'Failed to upload photo' });
      }

      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);

      res.json({ photoUrl: urlData.publicUrl });
    } catch (err) {
      console.error('Portfolio upload-photo error:', err);
      res.status(500).json({ error: 'Failed to upload photo' });
    }
  });
});

module.exports = router;
