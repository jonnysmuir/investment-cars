/**
 * routes/auth.js
 *
 * Auth API endpoints for Supabase-based authentication.
 * User profiles stored in MySQL; Supabase handles tokens.
 */

const { Router } = require('express');
const { createClient } = require('@supabase/supabase-js');
const pool = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
};

/**
 * POST /api/auth/callback
 * Called after Supabase auth completes on the frontend.
 * Verifies token, upserts user in MySQL, sets HTTP-only cookies.
 */
router.post('/callback', async (req, res) => {
  const { access_token, refresh_token } = req.body;

  if (!access_token) {
    return res.status(400).json({ error: 'Missing access_token' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(access_token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Determine auth provider
    const provider = user.app_metadata?.provider || 'email';

    // Upsert user in MySQL
    await pool.query(
      `INSERT INTO users (id, email, display_name, avatar_url, auth_provider, last_login)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         email = VALUES(email),
         display_name = VALUES(display_name),
         avatar_url = VALUES(avatar_url),
         auth_provider = VALUES(auth_provider),
         last_login = NOW()`,
      [
        user.id,
        user.email,
        user.user_metadata?.full_name || user.user_metadata?.name || null,
        user.user_metadata?.avatar_url || null,
        provider,
      ]
    );

    // Set cookies
    res.cookie('sb-access-token', access_token, { ...COOKIE_OPTS, maxAge: 60 * 60 * 1000 });
    if (refresh_token) {
      res.cookie('sb-refresh-token', refresh_token, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });
    }

    // Return user profile from MySQL
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Auth callback error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * POST /api/auth/logout
 * Clears auth cookies.
 */
router.post('/logout', (req, res) => {
  res.clearCookie('sb-access-token', { path: '/' });
  res.clearCookie('sb-refresh-token', { path: '/' });
  res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Returns current user profile from MySQL.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Auth /me error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * POST /api/auth/refresh
 * Uses refresh token to get a new access token, updates cookie.
 */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.['sb-refresh-token'];
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      res.clearCookie('sb-access-token', { path: '/' });
      res.clearCookie('sb-refresh-token', { path: '/' });
      return res.status(401).json({ error: 'Refresh failed' });
    }

    res.cookie('sb-access-token', data.session.access_token, { ...COOKIE_OPTS, maxAge: 60 * 60 * 1000 });
    res.cookie('sb-refresh-token', data.session.refresh_token, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true });
  } catch (err) {
    console.error('Auth refresh error:', err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

/**
 * PUT /api/auth/preferences
 * Updates alert preferences for the authenticated user.
 */
router.put('/preferences', requireAuth, async (req, res) => {
  const { alert_frequency, alerts_enabled } = req.body;

  const updates = [];
  const values = [];

  if (alert_frequency !== undefined) {
    if (!['instant', 'daily', 'weekly'].includes(alert_frequency)) {
      return res.status(400).json({ error: 'Invalid alert_frequency' });
    }
    updates.push('alert_frequency = ?');
    values.push(alert_frequency);
  }

  if (alerts_enabled !== undefined) {
    updates.push('alerts_enabled = ?');
    values.push(Boolean(alerts_enabled));
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No preferences to update' });
  }

  values.push(req.user.id);

  try {
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Auth preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

module.exports = router;
