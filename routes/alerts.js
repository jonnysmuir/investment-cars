/**
 * routes/alerts.js
 *
 * One-click unsubscribe from user alert emails. The link is included in
 * every alert email and MUST work without the user being logged in, since
 * users typically click it straight from their inbox on a different device.
 *
 * Tokens are HMAC-SHA256 signed with UNSUBSCRIBE_SECRET. The payload is
 * the user id; we verify the signature and flip alerts_enabled to false
 * for that user. No auth middleware on this router.
 */

const { Router } = require('express');
const pool = require('../db/connection');
const { buildUnsubscribeToken, verifyUnsubscribeToken } = require('../scripts/lib/unsubscribe-token');

const router = Router();

function confirmationPage(message, subtitle = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <title>Unsubscribe — Collectorly</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 0;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #141414; border: 1px solid #2a2a2a; border-radius: 12px;
            padding: 48px 56px; max-width: 520px; text-align: center; }
    .brand { color: #c9a84c; font-size: 14px; letter-spacing: 0.15em; font-weight: 600;
             text-transform: uppercase; margin-bottom: 24px; }
    h1 { font-size: 24px; margin: 0 0 16px; font-weight: 600; }
    p { margin: 0 0 12px; color: #a0a0a0; line-height: 1.6; }
    a.btn { display: inline-block; margin-top: 24px; padding: 10px 20px;
            background: #c9a84c; color: #0a0a0a; text-decoration: none;
            border-radius: 6px; font-weight: 600; font-size: 14px; }
    a.btn:hover { background: #d6b658; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">COLLECTORLY</div>
    <h1>${message}</h1>
    ${subtitle ? `<p>${subtitle}</p>` : ''}
    <a class="btn" href="/account/dashboard">Manage preferences</a>
  </div>
</body>
</html>`;
}

/**
 * GET /api/alerts/unsubscribe?token=...
 * Verifies the signed token, flips alerts_enabled to FALSE for the user,
 * and returns a simple HTML confirmation page.
 */
router.get('/unsubscribe', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).type('html').send(
      confirmationPage('Invalid unsubscribe link', 'This link is missing its token.')
    );
  }

  const userId = verifyUnsubscribeToken(String(token));
  if (!userId) {
    return res.status(400).type('html').send(
      confirmationPage('Invalid unsubscribe link', 'This link is invalid or has expired.')
    );
  }

  try {
    const [result] = await pool.query(
      'UPDATE users SET alerts_enabled = FALSE WHERE id = ?',
      [userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).type('html').send(
        confirmationPage('Account not found', "We couldn't find the account for this link.")
      );
    }
    return res.type('html').send(
      confirmationPage(
        "You've been unsubscribed from Collectorly alerts.",
        'You can re-enable them at any time from your dashboard.'
      )
    );
  } catch (err) {
    console.error('Unsubscribe error:', err);
    return res.status(500).type('html').send(
      confirmationPage('Something went wrong', 'Please try again later.')
    );
  }
});

// Re-export the token helpers so other modules (the alert script) can build tokens
router.buildUnsubscribeToken = buildUnsubscribeToken;

module.exports = router;
