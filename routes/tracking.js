/**
 * routes/tracking.js
 *
 * GET /go — Tracked redirect for outbound listing clicks.
 *
 * Query parameters:
 *   url      (required) — destination URL
 *   platform — source platform display name (e.g. "PistonHeads")
 *   year     — car year
 *   price    — price in pounds (raw number or formatted string)
 *   page     — page on our site the click came from (e.g. "/cars/bmw-m3")
 *
 * The route:
 *  1. Reads/sets an anonymous session cookie (_clk_sid, 30-day expiry)
 *  2. Derives car make/model from the page slug via models.json
 *  3. Fires off a non-blocking INSERT into click_events
 *  4. Appends UTM params to the destination URL
 *  5. 302-redirects the user
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const pool = require('../db/connection');

const router = express.Router();

// ── Allowed destination domains (prevent open-redirect abuse) ────────────────
const ALLOWED_DOMAINS = [
  'pistonheads.com',
  'autotrader.co.uk',
  'carandclassic.com',
  'collectingcars.com',
  'collecting.cars',
  'silverstoneauctions.com',
  'carsandbids.com',
  'bonhams.com',
  'rmsothebys.com',
  'bfrauctions.com',
];

// ── Platform name → slug normalisation ───────────────────────────────────────
function normalisePlatform(name) {
  if (!name) return 'unknown';
  const lower = name.toLowerCase().trim();
  const map = {
    'pistonheads': 'pistonheads',
    'autotrader': 'autotrader',
    'cars and classic': 'cars-and-classic',
    'collecting cars': 'collecting-cars',
    'silverstone auctions': 'silverstone-auctions',
    'cars and bids': 'cars-and-bids',
    'bonhams': 'bonhams',
    'rm sothebys': 'rm-sothebys',
    'bfr auctions': 'bfr-auctions',
  };
  return map[lower] || lower.replace(/\s+/g, '-');
}

// ── Load models map for make/model lookup from slug ──────────────────────────
let modelsMap = null;

function getModelsMap() {
  if (modelsMap) return modelsMap;
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'models.json'), 'utf8');
    const { models } = JSON.parse(raw);
    modelsMap = {};
    for (const m of models) {
      modelsMap[m.slug] = { make: m.make, model: m.model };
    }
    return modelsMap;
  } catch {
    return {};
  }
}

// ── Extract slug from page path (e.g. "/cars/bmw-m3" → "bmw-m3") ────────────
function slugFromPage(pagePath) {
  if (!pagePath) return null;
  const match = pagePath.match(/\/cars\/([^/]+)/);
  return match ? match[1] : null;
}

// ── Parse price string to pence ──────────────────────────────────────────────
function priceToPence(raw) {
  if (!raw) return null;
  const str = String(raw).replace(/[£,\s]/g, '');
  const num = parseFloat(str);
  if (isNaN(num) || num <= 0) return null;
  // If value looks like it's already in pounds (> 100), convert to pence
  return Math.round(num * 100);
}

// ── Check if URL host matches an allowed domain ──────────────────────────────
function isAllowedUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

// ── Session cookie middleware ─────────────────────────────────────────────────
// Sets a 30-day anonymous session ID if one doesn't exist.
function ensureSession(req, res, next) {
  let sid = req.cookies && req.cookies._clk_sid;
  if (!sid) {
    sid = uuidv4();
    res.cookie('_clk_sid', sid, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      sameSite: 'lax',
    });
  }
  req.sessionId = sid;
  next();
}

// ── GET /go — Tracked redirect ───────────────────────────────────────────────
router.get('/go', ensureSession, (req, res) => {
  const { url: destUrl, platform, year, price, page } = req.query;

  // Must have a destination URL
  if (!destUrl) {
    return res.redirect('/');
  }

  // Validate destination is a known external domain
  if (!isAllowedUrl(destUrl)) {
    return res.redirect('/');
  }

  // Derive make/model from the source page slug
  const slug = slugFromPage(page);
  const models = getModelsMap();
  const modelInfo = slug ? models[slug] : null;
  const carMake = modelInfo ? modelInfo.make : null;
  const carModel = modelInfo ? modelInfo.model : null;

  // Fire-and-forget: log click event to MySQL (don't block the redirect)
  pool.execute(
    `INSERT INTO click_events
      (session_id, car_make, car_model, car_year, car_price,
       destination_platform, destination_url, source_page, referrer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.sessionId,
      carMake,
      carModel,
      year ? parseInt(year, 10) || null : null,
      priceToPence(price),
      normalisePlatform(platform),
      destUrl,
      page || null,
      req.get('referer') || null,
    ]
  ).catch(err => {
    // Log but never block the redirect
    console.error('Click tracking error:', err.message);
  });

  // Append UTM parameters to the destination URL
  try {
    const dest = new URL(destUrl);
    dest.searchParams.set('utm_source', 'collectorly.io');
    dest.searchParams.set('utm_medium', 'referral');
    dest.searchParams.set('utm_campaign', 'listing_click');
    return res.redirect(302, dest.toString());
  } catch {
    // If URL parsing fails, redirect as-is
    return res.redirect(302, destUrl);
  }
});

module.exports = router;
