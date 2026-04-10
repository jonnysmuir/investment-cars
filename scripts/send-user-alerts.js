#!/usr/bin/env node
/**
 * scripts/send-user-alerts.js
 *
 * User digest alert engine. Runs after each daily refresh in GitHub Actions
 * (see .github/workflows/refresh-listings.yml). On each invocation it:
 *
 *   1. Reads every user with alerts_enabled = TRUE from MySQL.
 *   2. Filters to those eligible TODAY by alert_frequency:
 *        - daily:    always
 *        - weekly:   only on Sundays (local day-of-week === 0)
 *        - monthly:  only on the 1st of the month
 *   3. For each eligible user, scans their watchlist and portfolio for
 *      relevant changes within the lookback window:
 *        - daily:   changes today
 *        - weekly:  changes in the last 7 days
 *        - monthly: changes in the last 30 days
 *   4. Skips users with no content (no empty emails).
 *   5. Sends a branded HTML digest via Gmail SMTP with a 2s delay between
 *      sends to stay under Gmail rate limits. Errors on one user never
 *      block the rest of the queue.
 *
 * Usage:
 *   node scripts/send-user-alerts.js                    # send alerts for all eligible users
 *   node scripts/send-user-alerts.js --dry-run          # build digests but don't send
 *   node scripts/send-user-alerts.js --user <id>        # target a single user (ignores frequency check)
 *   node scripts/send-user-alerts.js --force-frequency  # ignore the day-of-week/month gate (send weekly/monthly today)
 *
 * The --user flag combined with --force-frequency is useful for testing
 * (e.g. send yourself a weekly digest on a Wednesday to review layout).
 *
 * Required env vars:
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME  — MySQL connection
 *   GMAIL_USER, GMAIL_APP_PASSWORD           — Gmail SMTP
 *   UNSUBSCRIBE_SECRET                       — HMAC secret for unsubscribe tokens
 *   SITE_URL (optional)                      — defaults to https://collectorly.io
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const pool = require('../db/connection');
const {
  parsePrice,
  getModelsMap,
  loadModelListings,
  getEstimatedValue,
  getHistoricalValue,
} = require('./lib/valuation');
const { buildUnsubscribeToken } = require('./lib/unsubscribe-token');
const { buildDigestEmail, buildPlainText, subjectLine } = require('./lib/alert-email');

const SITE_URL = process.env.SITE_URL || 'https://collectorly.io';
const SUMMARY_PATH = path.join(__dirname, 'alert-summary.md');
const SEND_DELAY_MS = 2000;
const MAX_LISTINGS_PER_GROUP = 5;
const PORTFOLIO_CHANGE_THRESHOLD = 0.02; // 2%

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false, user: null, forceFrequency: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force-frequency') args.forceFrequency = true;
    else if (a === '--user') args.user = argv[++i];
    else if (a.startsWith('--user=')) args.user = a.slice(7);
  }
  return args;
}

// ── Date helpers ────────────────────────────────────────────────────────────

function ymd(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysAgo(today, n) {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return d;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function longDate(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function shortDate(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Window definitions per frequency.
 *   listingStartDate  — earliest dateAdded we consider (inclusive)
 *   portfolioCutoff   — snapshot date to compare today's portfolio valuation against
 *   dateLabel         — pretty string for the email header
 */
function computeLookback(frequency, today) {
  if (frequency === 'daily') {
    const yesterday = daysAgo(today, 1);
    return {
      listingStartDate: ymd(today),
      portfolioCutoff: ymd(yesterday),
      dateLabel: longDate(today),
    };
  }
  if (frequency === 'weekly') {
    const start = daysAgo(today, 6); // last 7 days inclusive of today
    return {
      listingStartDate: ymd(start),
      portfolioCutoff: ymd(daysAgo(today, 7)),
      dateLabel: `${shortDate(start)} to ${longDate(today)}`,
    };
  }
  if (frequency === 'monthly') {
    const start = daysAgo(today, 29); // last 30 days inclusive
    return {
      listingStartDate: ymd(start),
      portfolioCutoff: ymd(daysAgo(today, 30)),
      dateLabel: `${MONTHS[today.getMonth()]} ${today.getFullYear()}`,
    };
  }
  throw new Error(`Unknown frequency: ${frequency}`);
}

// ── Eligibility gate ────────────────────────────────────────────────────────

function isEligibleToday(freq, today, forceFrequency) {
  if (forceFrequency) return true;
  if (freq === 'daily') return true;
  if (freq === 'weekly') return today.getDay() === 0;   // Sunday
  if (freq === 'monthly') return today.getDate() === 1; // 1st of the month
  return false;
}

// ── Watchlist filter matching (yearMin/yearMax style) ───────────────────────

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

function listingMatchesWatchlistFilters(listing, filters, generations) {
  if (!filters) return true;

  if (filters.yearMin && listing.year && listing.year < filters.yearMin) return false;
  if (filters.yearMax && listing.year && listing.year > filters.yearMax) return false;

  if (filters.bodyType) {
    const lb = (listing.bodyType || '').toLowerCase();
    if (lb !== filters.bodyType.toLowerCase()) return false;
  }

  if (filters.transmission) {
    const lt = (listing.transmission || '').toLowerCase();
    const ft = filters.transmission.toLowerCase();
    if (ft.includes('manual') && !lt.includes('manual')) return false;
    if (!ft.includes('manual') && lt.includes('manual')) return false;
  }

  if (filters.generation && generations) {
    const g = resolveGeneration(listing.title, listing.year, generations);
    if (g !== filters.generation) return false;
  }

  if (filters.source) {
    const sources = (listing.sources || []).map(s => s.name);
    if (!sources.includes(filters.source)) return false;
  }

  if (filters.variant) {
    const title = (listing.title || '').toLowerCase();
    if (!title.includes(filters.variant.toLowerCase())) return false;
  }

  return true;
}

function buildFilterSummary(filters) {
  if (!filters || Object.keys(filters).length === 0) return 'All variants';
  const parts = [];
  if (filters.yearMin && filters.yearMax) parts.push(`${filters.yearMin}\u2013${filters.yearMax}`);
  else if (filters.yearMin) parts.push(`${filters.yearMin}+`);
  else if (filters.yearMax) parts.push(`Up to ${filters.yearMax}`);
  if (filters.generation) parts.push(filters.generation);
  if (filters.variant) parts.push(filters.variant);
  if (filters.transmission) parts.push(filters.transmission);
  if (filters.bodyType) parts.push(filters.bodyType.charAt(0).toUpperCase() + filters.bodyType.slice(1));
  if (filters.source) parts.push(filters.source);
  return parts.length > 0 ? parts.join(' \u00b7 ') : 'All variants';
}

function parseFiltersColumn(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Listings/drops detection per watchlist entry ────────────────────────────

function findNewListingsForEntry(listings, entry, lookback, generations) {
  const filters = parseFiltersColumn(entry.filters);
  const out = [];
  for (const l of listings) {
    if (l.status !== 'active') continue;
    if (!l.dateAdded) continue;
    if (l.dateAdded < lookback.listingStartDate) continue;
    if (!listingMatchesWatchlistFilters(l, filters, generations)) continue;
    out.push(l);
  }
  return out;
}

function findDropForListing(listing, lookbackStartDate) {
  const ph = listing.priceHistory || [];
  const current = parsePrice(listing.price);
  if (!current || ph.length === 0) return null;

  // Baseline = last priceHistory entry strictly before the lookback window.
  let baseline = null;
  for (let i = ph.length - 1; i >= 0; i--) {
    if (ph[i].date < lookbackStartDate) {
      baseline = parsePrice(ph[i].price);
      break;
    }
  }
  if (!baseline) return null;
  if (baseline <= current) return null;
  return { oldPrice: baseline, newPrice: current, drop: baseline - current };
}

function findPriceDropsForEntry(listings, entry, lookback, generations) {
  const filters = parseFiltersColumn(entry.filters);
  const out = [];
  for (const l of listings) {
    if (l.status !== 'active') continue;
    if (!listingMatchesWatchlistFilters(l, filters, generations)) continue;
    const d = findDropForListing(l, lookback.listingStartDate);
    if (d) out.push({ listing: l, ...d });
  }
  return out;
}

// ── Listing display helpers ─────────────────────────────────────────────────

function primarySource(listing) {
  const s = (listing.sources || [])[0];
  return {
    name: s?.name || 'Source',
    url: s?.url || `${SITE_URL}/cars/${listing._slug || ''}`,
  };
}

function listingPageUrl(slug) {
  return `${SITE_URL}/cars/${slug}`;
}

// ── Build digest for one user ───────────────────────────────────────────────

async function buildDigestForUser(user, today) {
  const frequency = user.alert_frequency;
  const lookback = computeLookback(frequency, today);
  const modelsMap = getModelsMap();

  // ── Watchlist ────────────────────────────────────────────────────────────
  const [watchlistRows] = await pool.query(
    'SELECT * FROM watchlist WHERE user_id = ?',
    [user.id]
  );

  // We cache loaded listings per slug so we hit the disk once per model.
  const listingsCache = new Map();
  const getListings = (slug) => {
    if (listingsCache.has(slug)) return listingsCache.get(slug);
    const listings = loadModelListings(slug);
    listingsCache.set(slug, listings);
    return listings;
  };

  const newListingsSection = [];
  const priceDropsSection = [];

  for (const entry of watchlistRows) {
    const modelInfo = modelsMap[entry.model_slug];
    if (!modelInfo) continue;
    const displayName = `${modelInfo.make} ${modelInfo.model}`;
    const generations = modelInfo.generations || null;
    const listings = getListings(entry.model_slug);
    const filters = parseFiltersColumn(entry.filters);
    const filterSummary = buildFilterSummary(filters);

    // New listings
    if (entry.notify_new_listings) {
      const matches = findNewListingsForEntry(listings, entry, lookback, generations);
      if (matches.length > 0) {
        // Cap at MAX_LISTINGS_PER_GROUP
        const capped = matches.slice(0, MAX_LISTINGS_PER_GROUP).map(l => {
          const s = primarySource(l);
          return {
            title: l.title,
            price: l.price,
            source: s.name,
            url: s.url,
          };
        });
        newListingsSection.push({
          displayName,
          filterSummary,
          count: matches.length,
          listings: capped,
          listingPageUrl: listingPageUrl(entry.model_slug),
        });
      }
    }

    // Price drops
    if (entry.notify_price_drops) {
      const drops = findPriceDropsForEntry(listings, entry, lookback, generations);
      if (drops.length > 0) {
        const capped = drops.slice(0, MAX_LISTINGS_PER_GROUP).map(d => {
          const s = primarySource(d.listing);
          return {
            title: d.listing.title,
            oldPrice: d.oldPrice,
            newPrice: d.newPrice,
            dropAmount: d.drop,
            source: s.name,
            url: s.url,
          };
        });
        priceDropsSection.push({ displayName, drops: capped });
      }
    }
  }

  // ── Portfolio value changes ──────────────────────────────────────────────
  const [portfolioRows] = await pool.query(
    'SELECT * FROM portfolio WHERE user_id = ?',
    [user.id]
  );

  const portfolioChanges = [];
  let totalCurrent = 0;
  let totalPrevious = 0;
  let anyPortfolioValuation = false;

  for (const car of portfolioRows) {
    const modelInfo = modelsMap[car.model_slug];
    if (!modelInfo) continue;
    const displayName = `${modelInfo.make} ${modelInfo.model}`;

    const currentVal = getEstimatedValue(car.model_slug, car);
    if (!currentVal.estimatedValue) continue;

    const historical = getHistoricalValue(car.model_slug, car, lookback.portfolioCutoff);
    if (!historical || !historical.estimatedValue) continue; // skip rather than error per spec

    anyPortfolioValuation = true;
    totalCurrent += currentVal.estimatedValue;
    totalPrevious += historical.estimatedValue;

    const change = currentVal.estimatedValue - historical.estimatedValue;
    const pct = (change / historical.estimatedValue) * 100;
    if (Math.abs(pct) < PORTFOLIO_CHANGE_THRESHOLD * 100) continue;

    portfolioChanges.push({
      displayName,
      year: car.year,
      previousValue: historical.estimatedValue,
      newValue: currentVal.estimatedValue,
      change,
      changePercent: pct,
    });
  }

  let portfolioBlock = null;
  if (portfolioChanges.length > 0) {
    portfolioBlock = {
      changes: portfolioChanges,
      totals: anyPortfolioValuation ? {
        previous: totalPrevious,
        current: totalCurrent,
        change: totalCurrent - totalPrevious,
        changePercent: totalPrevious > 0 ? ((totalCurrent - totalPrevious) / totalPrevious) * 100 : 0,
      } : null,
    };
  }

  // ── Skip if nothing worth sending ────────────────────────────────────────
  const hasAnything =
    (portfolioBlock !== null) ||
    newListingsSection.length > 0 ||
    priceDropsSection.length > 0;

  if (!hasAnything) return null;

  // ── Unsubscribe token ────────────────────────────────────────────────────
  const token = buildUnsubscribeToken(user.id);
  const unsubscribeUrl = token ? `${SITE_URL}/api/alerts/unsubscribe?token=${encodeURIComponent(token)}` : null;

  return {
    frequency,
    dateLabel: lookback.dateLabel,
    portfolio: portfolioBlock,
    newListings: newListingsSection,
    priceDrops: priceDropsSection,
    unsubscribeUrl,
    dashboardUrl: `${SITE_URL}/account/dashboard`,
  };
}

// ── Email sending ───────────────────────────────────────────────────────────

function makeTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

async function sendDigest(transporter, user, digest) {
  const html = buildDigestEmail(digest);
  const text = buildPlainText(digest);
  const subject = subjectLine(digest.frequency, digest.dateLabel);
  await transporter.sendMail({
    from: `"Collectorly" <${process.env.GMAIL_USER}>`,
    to: user.email,
    subject,
    html,
    text,
  });
}

// ── Summary writer ──────────────────────────────────────────────────────────

function writeSummary(stats) {
  const lines = [];
  lines.push(`# Alert Engine Summary — ${ymd(new Date())}`);
  lines.push('');
  lines.push(`- Users checked: **${stats.usersChecked}**`);
  lines.push(`- Eligible today: **${stats.eligible}**`);
  lines.push(`- With content to send: **${stats.withContent}**`);
  lines.push(`- Emails sent: **${stats.sent}**`);
  lines.push(`- Skipped (no content): **${stats.skippedEmpty}**`);
  lines.push(`- Errors: **${stats.errors.length}**`);
  lines.push(`- Dry run: **${stats.dryRun ? 'yes' : 'no'}**`);

  if (stats.sentDetails.length > 0) {
    lines.push('');
    lines.push('## Sent');
    for (const d of stats.sentDetails) {
      const parts = [];
      if (d.portfolioChanges) parts.push(`${d.portfolioChanges} portfolio changes`);
      if (d.newListings) parts.push(`${d.newListings} new-listing groups`);
      if (d.priceDropGroups) parts.push(`${d.priceDropGroups} price-drop groups`);
      lines.push(`- ${d.email} (${d.frequency}) — ${parts.join(', ') || 'content'}`);
    }
  }

  if (stats.errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    for (const e of stats.errors) {
      lines.push(`- **${e.email || e.userId}**: ${e.message}`);
    }
  }

  fs.writeFileSync(SUMMARY_PATH, lines.join('\n') + '\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date();

  const stats = {
    usersChecked: 0,
    eligible: 0,
    withContent: 0,
    sent: 0,
    skippedEmpty: 0,
    errors: [],
    dryRun: args.dryRun,
    sentDetails: [],
  };

  console.log(`=== User Alert Engine === (${ymd(today)})`);
  console.log(`  dry-run: ${args.dryRun}`);
  console.log(`  force-frequency: ${args.forceFrequency}`);
  if (args.user) console.log(`  target user: ${args.user}`);

  // ── Pre-flight env checks ────────────────────────────────────────────────
  if (!process.env.UNSUBSCRIBE_SECRET) {
    console.warn('⚠  UNSUBSCRIBE_SECRET not set — emails will not include an unsubscribe link.');
  }
  const transporter = makeTransporter();
  if (!transporter && !args.dryRun) {
    console.warn('⚠  GMAIL_USER / GMAIL_APP_PASSWORD not set — forcing dry-run mode.');
    args.dryRun = true;
    stats.dryRun = true;
  }

  // ── Fetch users ──────────────────────────────────────────────────────────
  let users;
  try {
    if (args.user) {
      const [rows] = await pool.query(
        'SELECT * FROM users WHERE id = ? AND alerts_enabled = TRUE',
        [args.user]
      );
      users = rows;
    } else {
      const [rows] = await pool.query(
        'SELECT * FROM users WHERE alerts_enabled = TRUE'
      );
      users = rows;
    }
  } catch (err) {
    console.error('Failed to load users:', err.message);
    await pool.end();
    process.exit(1);
  }

  stats.usersChecked = users.length;
  console.log(`  ${users.length} user${users.length === 1 ? '' : 's'} with alerts enabled`);

  // ── Per-user processing ──────────────────────────────────────────────────
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const eligible = args.user ? true : isEligibleToday(user.alert_frequency, today, args.forceFrequency);
    if (!eligible) continue;
    stats.eligible++;

    let digest;
    try {
      digest = await buildDigestForUser(user, today);
    } catch (err) {
      console.error(`✗ ${user.email}: failed to build digest: ${err.message}`);
      stats.errors.push({ email: user.email, userId: user.id, message: `build: ${err.message}` });
      continue;
    }

    if (!digest) {
      console.log(`  - ${user.email} (${user.alert_frequency}): no content, skipping`);
      stats.skippedEmpty++;
      continue;
    }

    stats.withContent++;

    const detail = {
      email: user.email,
      frequency: user.alert_frequency,
      portfolioChanges: digest.portfolio ? digest.portfolio.changes.length : 0,
      newListings: digest.newListings.length,
      priceDropGroups: digest.priceDrops.length,
    };

    if (args.dryRun) {
      console.log(`  → ${user.email} (${user.alert_frequency}): would send — ${detail.portfolioChanges} portfolio, ${detail.newListings} new-listing groups, ${detail.priceDropGroups} price-drop groups`);
      stats.sentDetails.push(detail);
      continue;
    }

    try {
      await sendDigest(transporter, user, digest);
      console.log(`  ✓ ${user.email} (${user.alert_frequency}): sent`);
      stats.sent++;
      stats.sentDetails.push(detail);
    } catch (err) {
      console.error(`  ✗ ${user.email}: send failed: ${err.message}`);
      stats.errors.push({ email: user.email, userId: user.id, message: `send: ${err.message}` });
    }

    // Rate limit — 2s between sends (skipped for the last user)
    if (i < users.length - 1) {
      await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    }
  }

  // ── Summary output ───────────────────────────────────────────────────────
  writeSummary(stats);

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Users checked:       ${stats.usersChecked}`);
  console.log(`  Eligible today:      ${stats.eligible}`);
  console.log(`  With content:        ${stats.withContent}`);
  console.log(`  Emails ${args.dryRun ? '(dry-run)' : 'sent   '}:     ${args.dryRun ? stats.withContent : stats.sent}`);
  console.log(`  Skipped (empty):     ${stats.skippedEmpty}`);
  console.log(`  Errors:              ${stats.errors.length}`);
  console.log('');
  console.log(`  Summary written to scripts/alert-summary.md`);

  if (process.env.GITHUB_ACTIONS) {
    console.log('');
    console.log('::notice::Alert engine: ' + (args.dryRun ? `${stats.withContent} eligible (dry-run)` : `${stats.sent} sent, ${stats.errors.length} errors`));
  }

  await pool.end();
  process.exit(stats.errors.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
