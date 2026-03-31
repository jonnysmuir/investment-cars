/**
 * public/js/auth.js
 *
 * Shared auth client loaded on every page.
 * Initialises Supabase, checks session, updates nav.
 */

const SUPABASE_URL = 'https://trizhaljovbewffvwxpb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyaXpoYWxqb3ZiZXdmZnZ3eHBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Nzk0MjAsImV4cCI6MjA5MDQ1NTQyMH0.V8eXxduMvy3HLQy6G0LGn10civibeofMAYvZysWV38s';

let _supabase = null;

function getSupabase() {
  if (!_supabase && window.supabase) {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

async function signInWithGoogle() {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/account/login' },
  });
  if (error) console.error('Google sign-in error:', error.message);
}

async function signInWithEmail(email, password) {
  const sb = getSupabase();
  if (!sb) return { error: 'Supabase not loaded' };
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  await sendSessionToServer(data.session);
  return { user: data.user };
}

async function signUp(email, password, displayName) {
  const sb = getSupabase();
  if (!sb) return { error: 'Supabase not loaded' };
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: displayName } },
  });
  if (error) return { error: error.message };
  if (data.session) {
    await sendSessionToServer(data.session);
  }
  return { user: data.user, needsConfirmation: !data.session };
}

async function signOut() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

async function resetPassword(email) {
  const sb = getSupabase();
  if (!sb) return { error: 'Supabase not loaded' };
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/account/reset-password',
  });
  if (error) return { error: error.message };
  return { success: true };
}

async function updatePassword(newPassword) {
  const sb = getSupabase();
  if (!sb) return { error: 'Supabase not loaded' };
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { success: true };
}

// ── Session management ───────────────────────────────────────────────────────

async function sendSessionToServer(session) {
  if (!session) return;
  try {
    const resp = await fetch('/api/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
    });
    return await resp.json();
  } catch (err) {
    console.error('Failed to sync session:', err);
  }
}

async function getCurrentUser() {
  try {
    const resp = await fetch('/api/auth/me');
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.user;
  } catch {
    return null;
  }
}

async function refreshSession() {
  try {
    const resp = await fetch('/api/auth/refresh', { method: 'POST' });
    return resp.ok;
  } catch {
    return false;
  }
}

// ── OAuth callback handler ───────────────────────────────────────────────────

async function handleOAuthCallback() {
  const sb = getSupabase();
  if (!sb) return false;

  // Supabase puts tokens in the URL hash after OAuth redirect
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return false;

  try {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error || !session) return false;

    await sendSessionToServer(session);
    return true;
  } catch {
    return false;
  }
}

// ── Nav update ───────────────────────────────────────────────────────────────

function updateNav(user) {
  const authLink = document.getElementById('authLink');
  if (!authLink) return;

  if (!user) {
    authLink.href = '/account/login';
    authLink.textContent = 'Sign In';
    authLink.className = 'auth-link';
    // Remove any existing dropdown
    const existing = document.getElementById('authDropdown');
    if (existing) existing.remove();
    return;
  }

  const displayName = user.display_name || user.email.split('@')[0];
  authLink.href = '/account/dashboard';
  authLink.textContent = displayName;
  authLink.className = 'auth-link auth-logged-in';

  // Create dropdown if it doesn't exist
  if (!document.getElementById('authDropdown')) {
    const dropdown = document.createElement('div');
    dropdown.id = 'authDropdown';
    dropdown.className = 'auth-dropdown';
    dropdown.innerHTML = `
      <a href="/account/dashboard">My Dashboard</a>
      <a href="#" id="authSignOut">Sign Out</a>
    `;
    authLink.parentElement.style.position = 'relative';
    authLink.parentElement.appendChild(dropdown);

    // Toggle dropdown on click
    authLink.addEventListener('click', (e) => {
      e.preventDefault();
      dropdown.classList.toggle('auth-dropdown-open');
    });

    // Sign out handler
    document.getElementById('authSignOut').addEventListener('click', (e) => {
      e.preventDefault();
      signOut();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!authLink.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('auth-dropdown-open');
      }
    });
  }
}

// ── Init on page load ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Handle OAuth redirect first
  const wasCallback = await handleOAuthCallback();
  if (wasCallback) {
    // Redirect after OAuth callback — honour ?redirect= param if present
    const oauthRedirect = new URLSearchParams(window.location.search).get('redirect');
    window.location.href = oauthRedirect || '/account/dashboard';
    return;
  }

  // Check current session
  const user = await getCurrentUser();
  updateNav(user);

  // If not logged in, try refreshing the token
  if (!user) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const retryUser = await getCurrentUser();
      updateNav(retryUser);
    }
  }
});
