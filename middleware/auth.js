const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

/**
 * Attaches req.user from Supabase token (header or cookie).
 * Never blocks — sets req.user = null if no valid session.
 */
async function attachUser(req, res, next) {
  req.user = null;

  const token =
    req.headers.authorization?.replace('Bearer ', '') ||
    req.cookies?.['sb-access-token'];

  if (!token) return next();

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      req.user = user;
    }
  } catch {
    // Token invalid or Supabase unreachable — continue without user
  }

  next();
}

/**
 * Returns 401 if no authenticated user on the request.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

module.exports = { attachUser, requireAuth };
