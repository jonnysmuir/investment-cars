/**
 * scripts/lib/unsubscribe-token.js
 *
 * HMAC-signed tokens for one-click unsubscribe links. The token format is:
 *
 *   base64url(userId) + "." + base64url(hmac_sha256(userId, SECRET))
 *
 * Used by routes/alerts.js (server-side verification) and
 * scripts/send-user-alerts.js (token generation per email).
 *
 * SECURITY: The secret must live in UNSUBSCRIBE_SECRET. If it's missing,
 * token verification always fails — we refuse to fall back to an insecure
 * default so a misconfigured environment can't silently disable every
 * user's alerts.
 */

const crypto = require('crypto');

function getSecret() {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret || secret.length < 16) return null;
  return secret;
}

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = 4 - (str.length % 4 || 4);
  const padded = str + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(userId, secret) {
  return crypto.createHmac('sha256', secret).update(String(userId)).digest();
}

/**
 * Build a signed unsubscribe token for a given user id.
 * Returns null if no secret is configured (caller should omit the
 * unsubscribe link in that case, or fail loudly).
 */
function buildUnsubscribeToken(userId) {
  const secret = getSecret();
  if (!secret) return null;
  const sig = sign(userId, secret);
  return `${b64urlEncode(String(userId))}.${b64urlEncode(sig)}`;
}

/**
 * Verify a token. Returns the user id on success, or null on failure.
 * Uses constant-time comparison to avoid timing side-channels.
 */
function verifyUnsubscribeToken(token) {
  const secret = getSecret();
  if (!secret || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  let userId, sigBuf;
  try {
    userId = b64urlDecode(parts[0]).toString('utf8');
    sigBuf = b64urlDecode(parts[1]);
  } catch {
    return null;
  }
  if (!userId) return null;
  const expected = sign(userId, secret);
  if (expected.length !== sigBuf.length) return null;
  if (!crypto.timingSafeEqual(expected, sigBuf)) return null;
  return userId;
}

module.exports = { buildUnsubscribeToken, verifyUnsubscribeToken };
