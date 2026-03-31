# Collectorly — Project Guide for Claude Code

## Overview
Collectorly is a Node.js web app that tracks collector/investment car listings and auction results across the UK market. It scrapes live listings, tracks price history, and presents analysis through a polished frontend.

## Tech Stack
- **Backend**: Express.js v5 (`server.js`) — JSON API + static file serving
- **Auth**: Supabase Auth (email/password + Google OAuth) — `@supabase/supabase-js`
- **Database**: MySQL (Hostinger) via `mysql2/promise` connection pool (`db/connection.js`)
- **Scraping**: Playwright + Cheerio (4 scraper modules)
- **Email**: Nodemailer (Gmail) for daily refresh notifications
- **CI/CD**: GitHub Actions (`refresh-listings.yml`) — daily 3am UTC
- **Frontend**: Vanilla HTML/CSS/JS with dark/light theme, gold accent `#c9a84c`
- **Environment**: Config via `dotenv` — DB credentials in `.env` (gitignored)

## Project Structure
```
server.js                          # Express API server
db/
  connection.js                    # MySQL connection pool (mysql2/promise)
  setup.js                        # Run once to create click_events + users tables
middleware/
  auth.js                         # Supabase token verification (attachUser + requireAuth)
routes/
  tracking.js                     # GET /go — tracked redirect for outbound clicks
  admin.js                        # GET /admin/stats, GET /admin/dashboard
  auth.js                         # Auth API (callback, logout, me, refresh, preferences)
  watchlist.js                    # Watchlist CRUD API (all requireAuth)
  favourites.js                   # Favourites CRUD API (all requireAuth)
data/
  models.json                      # Master registry (slug, make, model, hero image, description, scraper configs)
  {slug}.json                      # Current listings per model
  history/{slug}.json              # Daily price snapshots (date + listings array)
  .state/{slug}.json               # Scraper state for unlisted detection (3+ day rule)
  glenmarch/                       # Glenmarch auction result archives
  collecting-cars-sold/            # Collecting Cars sold archives
  car-and-classic-sold/            # Car & Classic sold archives
public/
  index.html                       # Homepage/dashboard
  listings/index.html              # Model listing page
  analysis/index.html              # Analysis/charting page
  cars/{slug}/                     # 169 individual car model pages
  home-1/ through home-4/          # Homepage design iterations
  js/auth.js                       # Shared frontend auth client (Supabase init, nav updates)
  account/login/index.html         # Login/register page
  account/dashboard/index.html     # User dashboard (watchlist, favourites, preferences)
  account/reset-password/index.html # Password reset form
scripts/
  refresh.js                       # Main orchestrator (dedup, price tracking, unlisted detection)
  scrape-glenmarch.js              # Glenmarch auction scraper
  scrape-cc-sold.js                # Collecting Cars sold scraper
  scrape-cc-sold-bulk.js           # Collecting Cars bulk sold scraper
  scrape-cac-sold-bulk.js          # Car & Classic bulk sold scraper
  generate-pages.js                # Universal page generator (listing + analysis pages for all makes)
  generate-analysis-pages.js       # Analysis page generator (superseded by generate-pages.js)
  generate-ferrari-pages.js        # DEPRECATED — use generate-pages.js
  generate-mclaren-pages.js        # DEPRECATED — use generate-pages.js
  generate-lotus-pages.js          # DEPRECATED — use generate-pages.js
  send-email.js                    # Email notification sender
```

## Car Coverage
169 models across 13 makes: Ferrari (65), McLaren (21), Lotus (20), Porsche (11), BMW (10), Aston Martin (12), Lamborghini (9), Audi (7), Mercedes-AMG (6), Maserati (5), Alpine (2), Lexus (1: LFA).

## Data Sources
**Live Listings (4 scrapers):** PistonHeads, AutoTrader, Cars and Classic, Collecting Cars
**Auction History (3 sources):** Glenmarch (CSV/JSON), Collecting Cars (sold), Car & Classic (sold)
All filtered to GBP/UK market only.

## API Endpoints
- `GET /api/models` — All models grouped by make
- `GET /api/listings/:slug` — Current listings for a model
- `GET /api/history/:slug` — Price trends, distribution, listing prices, auction history, mileage, supply, variant/generation breakdowns
- `GET /api/homepage` — Aggregate dashboard (top appreciating/depreciating, most active, latest, recent auctions)
- `POST /api/contact` — Contact form
- `GET /go?url=...&platform=...&year=...&price=...&page=...` — Tracked outbound redirect (logs to MySQL, appends UTM params, 302 redirects)
- `GET /admin/stats` — Click analytics JSON (totals, by platform, top models, daily trend)
- `GET /admin/dashboard` — HTML dashboard displaying click stats
- `GET /api/watchlist` — User's watched models with filter-aware stats and filter summaries (requires auth)
- `POST /api/watchlist` — Add model to watchlist with optional filters JSON (requires auth). Supports multiple entries per model with different filters.
- `PUT /api/watchlist/:id` — Update filters and/or notification prefs for a specific watchlist entry (requires auth)
- `DELETE /api/watchlist/:id` — Remove a specific watchlist entry (requires auth)
- `GET /api/favourites` — User's saved listings with current state; optional `?slug=` filter (requires auth)
- `POST /api/favourites` — Save a listing to favourites (requires auth)
- `DELETE /api/favourites/:id` — Remove a saved listing (requires auth)

## Key Server Logic & Conventions
- **Variant normalisation**: Maps listing titles → categories (Scuderia, Pista, Spider, Convertible, GTS, etc.)
- **Generation resolution**: For multi-gen models (e.g. BMW M3 → E30/E36/E46/F80/G80) via title pattern matching or year ranges
- **Smart listing prices**: De-duplicates price history — only emits first appearance, price changes, and last appearance per listing
- **Annual change**: Compares current median to ~365-day-ago median for trend percentages
- **Unlisted detection**: Listings must be missing for 3+ consecutive days before being marked unlisted (prevents false positives from scraper failures)

## Frontend Conventions
- Dark/light theme toggle
- Gold accent colour: `#c9a84c`
- All prices in GBP (£)

## Git Rules
- **NEVER push to GitHub without explicit permission from the user.** Always ask first.
- **Do NOT edit `.github/workflows/refresh-listings.yml` directly** — Claude Code cannot modify this file in the repo. Instead, whenever a change is needed to this file, **output the entire file contents** so the user can copy and paste it into GitHub manually. Always print the full file, not just a diff or snippet.

## GitHub Actions Workflow
1. Runs daily at 3am UTC (or manual trigger)
2. Installs Playwright Chromium
3. Runs `scripts/refresh.js` across all models
4. Commits data changes as "Collectorly Bot"
5. Creates a GitHub Issue with refresh summary (truncated to ~64K chars if needed; full summary always available as workflow artifact)
6. Sends email notification via Gmail
7. Safeguard against mass unlisting from scraper failures
- **Summary optimisation**: The summary table only includes models with activity (new/updated/unlisted/errors). Zero-change models are counted but omitted to keep the issue body within GitHub's 65536 char limit.

## Health Monitoring
- **Per-run log**: `data/.health/YYYY-MM-DD.json` — date, duration, per-source stats (totalResults, modelsWithResults, modelsWithZero, modelsWithErrors). Auto-cleaned after 30 days.
- **Rolling baseline**: `data/.health/baseline.json` — 7-day rolling average per source per model, `consecutiveZeros` counter, `lastSeen` date.
- **Anomaly detection** (requires 3+ days of baseline data):
  - **CRITICAL**: Source has >30% of configured models at zero AND those models had baseline results (source-level failure)
  - **WARNING**: Model at zero from a source for 3+ consecutive days, source otherwise healthy (broken URL)
  - **INFO**: Model >50% below baseline average (gradual degradation)
- **Email redesign** (`scripts/send-email.js`): Reads `scripts/email-data.json` (structured data from refresh). 5 sections: status banner (green/amber/red), source health table, anomaly alerts, summary stats with baseline comparison, detailed per-model changes.
- **Subject line prefix**: `[CRITICAL]` or `[WARNING]` prepended when anomalies detected.
- **Health module**: `scripts/health.js` exports `collectRunStats()`, `updateBaseline()`, `detectAnomalies()`, `getComparisons()`.

## Body Type Conventions
- **`bodyType` is a scraped field** stored on each listing (like mileage and transmission). All 4 scrapers extract it via `normaliseBodyType()` in `base.js`, with structured data preferred and title inference as fallback.
- **Frontend pages use `l.bodyType` for filtering**, falling back to a page-specific `getBody(title)` function for listings that haven't been re-scraped yet.
- **Normalised body types**: Coupe, Saloon, Convertible, Estate, Targa, Speedster, SUV.
- **All convertible-roof cars must use "Convertible"** — including "roadster", "spider", "spyder", "cabriolet", "volante", "drop top", "aperta", "barchetta", "cab". Normalise all of these to "Convertible".
- **Exceptions — do NOT normalise to Convertible:**
  - **"Targa"** — remains its own body type (partially removable roof, retains roll bar)
  - **"Speedster"** — remains its own body type (distinct low-windscreen open design)
- **"Touring" is ambiguous** — means "Estate" for BMW but is a trim package for Porsche (GT3 Touring). The global `normaliseBodyType()` does NOT map "touring" → Estate. Handle it model-specifically (e.g. in BMW M3's `getBody()` function).
- **"Estate" in the global normaliser** covers: "estate", "wagon", "shooting brake" (unambiguous terms only).
- **BMW M3 body inference** uses door count ("2dr" → Coupe, "4dr" → Saloon) and generation codes (E30/E36/E46/E92 → Coupe, E93 → Convertible, E90/F80/G80 → Saloon, E91/F81/G81 → Estate).

## Title Matching & Exclusion Patterns
- **`titleMatchesModel()`** in `base.js` is the shared title relevance filter used by all 4 scrapers and the post-scrape validation pass in `refresh.js`.
- **`excludePatterns`** — an optional array of regex strings in `models.json` per model. If any pattern matches the title, the listing is rejected before positive matching runs. Used for models with short/ambiguous names (M3, M8, 911, GT, F1, F8).
- **Short token tightening** — alphanumeric tokens ≤3 chars (e.g. "M3", "F8", "P1") require exact word boundary with NO trailing digits. "M3" matches "M3 Competition" but not "M340i" or "M3.0".
- **Post-scrape validation** in `refresh.js` re-validates all scraped listings as a safety net, tracks rejected/borderline listings, and flags high rejection rates (>30%) as a search URL issue in the summary.
- **When adding a new model with a short or ambiguous name**: always add `excludePatterns` to prevent false positives from related models. Check existing patterns on BMW M3, BMW M8, Porsche 911, McLaren GT/GTS/F1 for examples.
- **Audit script**: `node scripts/audit-listings.js` scans all existing data files against the current matching logic and generates `scripts/audit-report.md` listing potential false positives.

## Universal Page Generator
- **`scripts/generate-pages.js`** is the single make-agnostic page generator. It replaces the old per-make generators (ferrari, mclaren, lotus) which are now deprecated.
- **Usage**: `node scripts/generate-pages.js` (all new), `--slug porsche-boxster` (single), `--make Porsche` (by make), `--force` (overwrite existing)
- **Generates both listing and analysis pages**, creates data/history files, and auto-updates `public/analysis/index.html` with the full model list.
- **Default filter config** for new models: getBody returns null (relies on scraped bodyType), getVariant returns 'standard', getTransmission detects manual/DCT/automatic. Filters with only 1 option auto-hide via `minDistinct: 2`.
- **models.json fields for page generation**: `heroYears`, `heroEngine`, `heroBhp` (hero subtitle), optional `pageConfig` for custom filter functions.

## AutoTrader Make-Level Batching
- **Full refreshes use make-level batch scraping** for AutoTrader. Instead of 170+ per-model requests, `scrapeMake()` in `autotrader.js` does one broad search per make (~13 requests) and matches results to models via `titleMatchesModel`.
- **Single-model refreshes** (`--slug`) still use the per-model `scrape()` path with Phase 1 (friendly URL / Apollo cache) and Phase 2 (search pagination).
- **`--make` flag** in `refresh.js` allows refreshing all models for a single make: `node scripts/refresh.js --make BMW`.
- **Anti-detection measures** across all scrapers:
  - Fresh browser context per make/model with realistic viewport, locale, timezone
  - Randomised delays between page loads (3-7s), between makes (10-20s), between batches (2-5s)
  - Randomised make ordering so scrape pattern differs daily
  - Updated user agent string
- **Phase 2 URL fix**: `autotrader.js` now parses make/model slugs from `sourceConfig.searchUrl` instead of using `modelConfig.model` directly, fixing broken URLs for models with parentheses/accents.
- **Fallback warning**: If a make-level search returns 0 results (likely blocked), a clear warning appears in the summary.
- **Apollo pass visits ALL model URLs** (no limit) so rare models buried deep in make-level search still get coverage. The make-level search (Phase 2) supplements this with additional listings found in broad pagination.
- **Search page title extraction** captures both the make/series line AND the trim/variant line from card DOM nodes (e.g. "BMW 8 Series" + "M8 Competition 4.4 V8 2dr"), ensuring model matching works even for sub-models filed under a parent series.

## Important Patterns
- When adding a new car model: add entry to `data/models.json` with slug, make, model, heroImage, heroCredit, description, heroYears, heroEngine, heroBhp, sources, and excludePatterns if needed. Then run `node scripts/generate-pages.js --slug {slug}`.
- When adding a new make: just add entries to `models.json` and run `generate-pages.js --make {Make}`. No new script needed.
- When adding a new scraper: follow the Playwright + Cheerio pattern used by existing scrapers, respect rate limiting
- When modifying the frontend: maintain dark/light theme compatibility, use the gold accent for highlights
- Page generators create static HTML pages per car model — re-run after adding new models
- **Analysis index is auto-updated** by `generate-pages.js` — no manual editing of `public/analysis/index.html` needed.

## Click Tracking System
- **Outbound links go through `/go`** — all 111 car pages use `trackUrl()` in `renderSourceLinks()` to route external listing links through the `/go` redirect endpoint
- **Query params, not path params** — listing IDs are not globally unique (sequential per-model), so the redirect uses query parameters (`url`, `platform`, `year`, `price`, `page`) instead of `/go/:listingId`
- **Make/model derived server-side** — the `/go` route extracts the slug from the `page` query param and looks up make/model from `models.json` via `getModelsMap()`
- **Domain allowlist** — `routes/tracking.js` has an `ALLOWED_DOMAINS` array to prevent open-redirect abuse; update it when adding new listing sources
- **Non-blocking DB writes** — click logging is fire-and-forget so redirects are never slowed by database latency
- **Session tracking** — anonymous `_clk_sid` cookie (UUID v4, 30-day expiry) set via `cookie-parser`; no full session library needed
- **UTM parameters** — appended to all outbound URLs: `utm_source=collectorly.io`, `utm_medium=referral`, `utm_campaign=listing_click`
- **Prices stored in pence** — `car_price` column is INT representing pence to avoid decimal issues
- **Admin dashboard** — `/admin/dashboard` uses the same dark theme and gold accent as the main site
- **DB setup** — run `node db/setup.js` once to create the `click_events` table; uses `CREATE TABLE IF NOT EXISTS`
- **No debug endpoints in production** — temporary routes like `/admin/db-check` and verbose error details in `/admin/stats` were used during initial DB setup and have been removed. Keep error responses generic (no `err.message`/`err.code` in JSON) to avoid leaking database internals to the browser. Use server-side `console.error` for diagnostics instead.

## Node.js Environment
- **Node path**: `~/bin/node` (v22.14.0)
- **npm is broken** — the `~/bin/npm` symlink points to a missing `../lib/cli.js`. Use `node ~/lib/node_modules/npm/bin/npm-cli.js` as a workaround to run npm commands.

## User Authentication (Supabase)
- **Provider**: Supabase Auth handles sign-up, login, OAuth (Google), password reset, and token management.
- **Supabase project URL**: `https://trizhaljovbewffvwxpb.supabase.co`
- **Frontend client**: Supabase JS loaded from CDN (`@supabase/supabase-js@2`), initialised in `public/js/auth.js` with the anon key.
- **Server-side**: `@supabase/supabase-js` with the secret key (`SUPABASE_SECRET_KEY`) for token verification in `middleware/auth.js`.
- **User data**: Stored in the `users` table in the existing MySQL database (not Supabase DB). Supabase user UUID is the primary key.
- **Session flow**: Frontend authenticates with Supabase → receives tokens → `POST /api/auth/callback` sends tokens to server → server verifies with Supabase, upserts MySQL user, sets HTTP-only cookies → subsequent requests use cookies.
- **Cookies**: `sb-access-token` (1h, HTTP-only, Secure, SameSite=Lax) and `sb-refresh-token` (7d, same flags).
- **Middleware**: `attachUser` runs on every request (non-blocking); `requireAuth` returns 401 on protected routes.
- **Auth API endpoints**:
  - `POST /api/auth/callback` — Verify token, upsert user, set cookies
  - `POST /api/auth/logout` — Clear auth cookies
  - `GET /api/auth/me` — Return user profile (requires auth)
  - `POST /api/auth/refresh` — Refresh access token
  - `PUT /api/auth/preferences` — Update alert settings (requires auth)
- **Nav integration**: Every page loads `auth.js` which checks `/api/auth/me` on load and updates the nav (shows "Sign In" or user dropdown).

### Hostinger Environment Variables
These must be set on Hostinger in addition to the existing DB credentials:
- `SUPABASE_URL` — `https://trizhaljovbewffvwxpb.supabase.co`
- `SUPABASE_ANON_KEY` — The anon/public key (safe for frontend)
- `SUPABASE_SECRET_KEY` — The service role secret key (server-side only, never expose to frontend)

### Supabase Dashboard Configuration Required
- **Redirect URLs**: Add these to Supabase Auth → URL Configuration → Redirect URLs:
  - `https://collectorly.io/account/login`
  - `https://collectorly.io/account/reset-password`
  - `http://localhost:3000/account/login` (for local dev)
  - `http://localhost:3000/account/reset-password` (for local dev)
- **Google OAuth**: Already configured in Supabase dashboard.

### Privacy Policy
- User auth stores email, display name, avatar URL, and auth provider in MySQL. A privacy policy update is needed to disclose this data collection to comply with GDPR.

## Watchlist Filter System
- **Watchlist entries store a `filters` JSON column** alongside the model slug. This allows watching specific configurations like "BMW M3 E46 Manual".
- **Multiple entries per model**: A user can have multiple watchlist entries for the same model with different filters (e.g. "M3 E46 Manual" and "M3 G80").
- **Filters JSON structure**: `{ yearMin, yearMax, generation, variant, transmission, bodyType, source }`. Null/absent keys mean "any". `filters: null` means "all variants".
- **API uses entry ID**: PUT and DELETE endpoints use the watchlist entry `id` (not slug) since multiple entries per model are allowed.
- **Filter-aware stats**: GET /api/watchlist returns `listingCount` and `median` computed from listings matching the saved filters.
- **Generation data on listing pages**: Embedded as `data-generations` attribute on the hero-banner element by the page generator. Used for both the listing filter UI (Generation pill row, auto-hidden via `minDistinct: 2` for models without generations) and the watchlist edit panel's generation dropdown.
- **Generation filter logic**: `getGeneration(listing)` in the listing page JS checks title patterns first, then falls back to year ranges from `_generationsData`. This is defined in the first `<script>` block alongside `FILTER_CONFIG`, while `_generationsData` is parsed just before it. The second `<script>` block (watchlist) also references `_generationsData` — this works because top-level `const` is shared across `<script>` tags.
- **Backward compatibility**: Existing entries with `filters IS NULL` are treated as "All variants".
- **SQL ALTER statements** (run in phpMyAdmin for existing databases):
  ```sql
  ALTER TABLE watchlist ADD COLUMN filters JSON NULL AFTER model_slug;
  ALTER TABLE watchlist DROP INDEX unique_user_model;
  ALTER TABLE watchlist ADD INDEX idx_user_slug (user_id, model_slug);
  ```

## Common Pitfalls
- Scraper failures can cause false "unlisted" detections — the 3-day rule in `.state/` files prevents this
- Always test scrapers against live sites as selectors change frequently
- Keep `models.json` as the single source of truth for car definitions
- When adding new listing source platforms, update the `ALLOWED_DOMAINS` array in `routes/tracking.js` and the `normalisePlatform()` mapping
- The universal generator (`generate-pages.js`) reads the Ferrari 458 listing template and F430 analysis template — the `trackUrl()` and `renderSourceLinks()` functions are in the 458 template, so changes to tracking link format only need to be made there before re-running the generator.
- **Hero images must be verified URLs** — when adding new models, do NOT guess Wikimedia Commons filenames. Search for the actual file page on Commons and verify the thumbnail URL returns HTTP 200 before using it. Guessed URLs will 404.
- **Cars & Classic makeIds** — Aston Martin: 7, BMW: 10, Ferrari: 20, Lamborghini: 26, Lotus: 29, Maserati: 30, Mercedes: 31, Porsche: 35, Audi: 108, Lexus: 497, McLaren: 2180, Alpine: 2158. Find new makeIds by searching `carandclassic.com/list/{makeId}/` or checking the URL when browsing by make.
- **Analysis index page is auto-updated** by `generate-pages.js` — the hardcoded `models` array in `public/analysis/index.html` is replaced with the full sorted model list from `models.json` every time the generator runs.
