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
  portfolio.js                    # Portfolio CRUD API with valuation logic (all requireAuth)
data/
  models.json                      # Master registry (slug, make, model, hero image, description, scraper configs)
  {slug}.json                      # Current listings per model
  history/{slug}.json              # Daily price snapshots (date + listings array)
  .state/{slug}.json               # Scraper state for unlisted detection (3+ day rule)
  glenmarch/                       # Glenmarch auction result archives
  collecting-cars-sold/            # Collecting Cars sold archives
  car-and-classic-sold/            # Car & Classic sold archives
public/
  index.html                       # Homepage (single, fetches /api/homepage)
  listings/index.html              # Model listing page
  analysis/index.html              # Analysis/charting page
  cars/{slug}/                     # 168 individual car model pages
  contact/index.html               # Contact form page
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
168 models across 13 makes: Ferrari (65), McLaren (21), Lotus (20), Porsche (11), BMW (10), Aston Martin (11), Lamborghini (9), Audi (7), Mercedes-AMG (6), Maserati (5), Alpine (2), Lexus (1: LFA).

### Models with Generations
21 models have generation data in `models.json` enabling the Generation filter on listing pages:
- **BMW**: M2 (F87/G87), M3 (E30/E36/E46/E9x/F80/G80), M4 (F82/G82), M5 (E28/E34/E39/E60/F10/F90), M6 (E24/E63-E64/F06-F12-F13), Z4 (E85/E89/G29)
- **Porsche**: 911 (930/935/964/965/993/996/997/991.1/991.2/992.1/992.2), Boxster (986/987/981/718), Cayman (987c/981c/718), Cayenne (E1/E2/E3)
- **Audi**: R8 (Type 42/Type 4S), RS3 (8P/8V/8Y), RS4 (B5/B7/B8/B9), RS5 (B8/B9), RS6 (C5/C6/C7/C8), RS7 (C7/C8)
- **Mercedes-AMG**: C63 (W204/W205/W206), E63 (W211/W212/W213), GT (C190/C192)
- **Aston Martin**: DBS (Original/V12), Vantage (V8 Vantage/New Vantage/New Vantage II)

**Note**: Lamborghini Huracán variants (LP610, EVO, STO, Tecnica, Sterrato) should be handled via the variant filter system in a future update, not generations.

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
- `GET /api/portfolio` — User's portfolio with valuations, gain/loss, and portfolio totals (requires auth)
- `GET /api/portfolio/:id` — Single portfolio entry with full details and valuation (requires auth)
- `GET /api/portfolio/:id/history` — Historical valuation data points for a specific car, filtered by car characteristics from `data/history/{slug}.json` (requires auth)
- `POST /api/portfolio` — Add a car to portfolio. Body: `{ modelSlug, year, variant, generation, transmission, bodyType, purchasePrice, purchaseDate, mileageAtPurchase, currentMileage, colour, notes }`. Validates modelSlug exists in models.json (requires auth)
- `PUT /api/portfolio/:id` — Update a car's details (requires auth)
- `DELETE /api/portfolio/:id` — Remove a car from portfolio. Also deletes the car's photo from Supabase Storage if one exists (requires auth)
- `POST /api/portfolio/upload-photo` — Upload a car photo (multipart/form-data with `photo` field and optional `portfolioId`). Validates JPEG/PNG/WebP, max 5MB. Returns `{ photoUrl }` (requires auth)

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
- **Body type data quality varies by source**:
  - **AutoTrader Apollo cache** (first ~12 listings per model): Best — `obj.bodyType` field is rich and accurate.
  - **AutoTrader search pages**: Limited — tries to extract body type from card text, falls back to title. Many AutoTrader titles omit body type (e.g. "2018 BMW M4 3.0 BiTurbo DCT Euro 6 (s/s) 2dr").
  - **Cars & Classic**: Good — `item.attributes.bodyType` from Inertia.js data, with multiple fallbacks.
  - **PistonHeads**: Moderate — regex extracts from "Body type: X" spec text on listing pages.
  - **Collecting Cars**: Title-only — no structured body type data available; falls back to specText then title.
- **Audit script**: `node scripts/audit-body-types.js` scans all data files and generates `scripts/body-type-audit.md` with body type distribution, null rates, and suspected misclassification per model.
- **Frontend pages use `l.bodyType` for filtering**, falling back to a page-specific `getBody(title)` function for listings that haven't been re-scraped yet.
- **Normalised body types**: Coupe, Gran Coupe, Saloon, Convertible, Estate, Targa, Speedster, SUV.
- **"Gran Coupe"** is a distinct body type (BMW 4-door coupes like M6 Gran Coupe, M8 Gran Coupe). Checked before generic "Coupe" in `normaliseBodyType()`.
- **All convertible-roof cars must use "Convertible"** — including "roadster", "spider", "spyder", "cabriolet", "volante", "drop top", "aperta", "barchetta", "cab". Normalise all of these to "Convertible".
- **Exceptions — do NOT normalise to Convertible:**
  - **"Targa"** — remains its own body type (partially removable roof, retains roll bar)
  - **"Speedster"** — remains its own body type (distinct low-windscreen open design)
- **"Touring" → Estate** in the global `normaliseBodyType()`. This is correct for BMW (M3/M5 Touring = Estate) and doesn't conflict with Porsche GT3 Touring since Porsche Touring is a trim, not a body type (the GT3 Touring's title also contains "Coupe" which matches first).
- **"Estate" in the global normaliser** covers: "estate", "wagon", "shooting brake" (unambiguous terms only).

### Model-Specific Body Type Rules (bodyTypeRules)
- **`bodyTypeRules`** in `models.json` provides model-specific inference when scraper and title-based detection both return null.
- **Structure**: `{ defaultBodyType, generationOverrides: { genName: bodyType }, titlePatterns: { bodyType: [patterns] } }`
- **`inferBodyType(title, modelConfig, generation)`** in `base.js` applies rules in order: (1) `normaliseBodyType(title)`, (2) model title patterns, (3) generation override, (4) model default.
- **Currently configured for BMW**: M1, 1M, M2, M3, M4, M5, M6, M8, Z4, Z8. Reduced BMW null body types from ~95% to ~0%.
- **When adding bodyTypeRules for a new model**: determine the default body type (most common variant), add generation overrides where a generation is exclusively one body type (e.g. G80 M3 = Saloon), and add title patterns for keywords that appear in listing titles.
- **Backfill script**: `node scripts/fix-body-types.js` re-runs `inferBodyType` against all existing listings. Run after adding or modifying bodyTypeRules.

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
- **When adding generation filters to a model**: This is a standard procedure:
  1. Add a `generations` array to the model's entry in `models.json`. Each generation needs: `name`, `years` (two-element array), `patterns` (array of title-matching strings).
  2. For each generation, find a hero image on Wikimedia Commons. Search the relevant category (e.g. `Category:BMW_M5_E39`). Use the Wikimedia API: `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=...&srnamespace=6&format=json` to find files, then `?action=query&titles=File:...&prop=imageinfo&iiprop=url|user|extmetadata&format=json` to get metadata.
  3. Add `image` (1920px thumbnail URL) and `credit` ("Author / License") fields to each generation object.
  4. Verify the thumbnail URL returns HTTP 200: `curl -sI "URL" | head -1`.
  5. Run `node scripts/generate-pages.js --slug {slug} --force` to regenerate the page.
  6. The generation filter row auto-appears on the listing page (via `minDistinct: 2`), and the hero image swaps on generation selection via `data-generation-images` attribute.

## Click Tracking System
- **Outbound links go through `/go`** — all 168 car pages use `trackUrl()` in `renderSourceLinks()` to route external listing links through the `/go` redirect endpoint
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

## Portfolio Tracker
- **Portfolio table** stores cars users own with purchase details (price in whole pounds, date, mileage, colour, notes) and car characteristics (year, variant, generation, transmission, body_type).
- **Valuation logic** (`routes/portfolio.js`): Loads `data/{slug}.json`, filters active listings by the car's year (+-2), generation, transmission, and body type. Computes median of filtered prices as the estimated value. Falls back to unfiltered model median with `broadEstimate: true` if fewer than 3 comparable listings.
- **History endpoint**: Reads `data/history/{slug}.json`, filters each daily snapshot by car characteristics, computes median per date to produce a time series of `{ date, estimatedValue, listingCount }` points.
- **Portfolio totals**: GET /api/portfolio returns per-car valuations plus aggregate `totalPurchasePrice`, `totalEstimatedValue`, `totalGainLoss`, `totalGainLossPercent`.
- **Dashboard UI**: Summary bar (total value, invested, gain/loss, car count), car cards with sparkline SVG charts, inline edit forms, add car form with cascading Make/Model/Generation dropdowns, and per-car photo thumbnails.
- **Photo upload**: Cars can have an optional photo stored in the Supabase Storage public bucket `portfolio-photos`. Photos are uploaded through the backend via `multer` (memory storage, 5MB limit, JPEG/PNG/WebP only). File paths are namespaced per user: `{userId}/{portfolioId}-{timestamp}.{ext}`. The frontend Add/Edit forms show a drag-and-drop zone; preview is generated client-side with `URL.createObjectURL()` and the actual upload happens on form submit. When a photo is replaced or removed, the old file is deleted from storage in the PUT handler. When a portfolio car is deleted, its photo is also deleted. Car cards show the photo as a 120x80 thumbnail with a dark placeholder fallback showing the car name when no photo exists.
- **Existing DBs need this ALTER**: `ALTER TABLE portfolio ADD COLUMN photo_url VARCHAR(500) NULL AFTER notes;`
- **Required Supabase setup**: Create a public bucket named `portfolio-photos` in the Supabase dashboard (Storage → New bucket → make public). The server uses `SUPABASE_SECRET_KEY` (already set) to upload via the Supabase JS client.
- **SQL for phpMyAdmin** (run once for existing databases):
  ```sql
  CREATE TABLE IF NOT EXISTS portfolio (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    model_slug VARCHAR(100) NOT NULL,
    year INT NULL,
    variant VARCHAR(200) NULL,
    generation VARCHAR(50) NULL,
    transmission VARCHAR(50) NULL,
    body_type VARCHAR(50) NULL,
    purchase_price INT NULL,
    purchase_date DATE NULL,
    mileage_at_purchase INT NULL,
    current_mileage INT NULL,
    colour VARCHAR(100) NULL,
    notes TEXT NULL,
    photo_url VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_slug (model_slug)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  ```

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

## Homepage
- **Single homepage** at `public/index.html` — the old `home-1/` through `home-4/` variants have been deleted.
- **Data source**: Fetches `GET /api/homepage` on page load (cached 1-min TTL in server.js). No build-time generation needed.
- **Hero section** contains: headline, subtitle, two CTA buttons, stats bar (models/listings/auctions), "Find a Model" search with typeahead, and the sign-up CTA. The search input uses translucent glass styling (`rgba` backgrounds, `backdrop-filter: blur`) to overlay the hero image. Hero height is `min-height: 85vh`.
- **Sections below hero**: CTA/Sign Up (auth-aware), Browse by Make (horizontal scroll), Market at a Glance (snapshot cards), Featured Models (top 4 by listing count), Recently Added (6 latest listings).
- **Auth-aware CTA**: Checks `/api/auth/me` and swaps "Create Free Account" → "Go to Dashboard" for logged-in users.
- **Mobile nav**: Hamburger toggle on viewports ≤768px — the `.nav-right` div toggles `.open` class.
- **Image fallbacks**: All model/listing images use `onerror` handlers to show a dark placeholder with the model name instead of broken image icons.
- **Contact page**: `public/contact/index.html` — standalone page with the contact form (previously embedded in the homepage). All nav "Get in Touch" links across the site now point to `/contact`.
- **Navigation**: Main nav is: Listings, Analysis, Sign In/user dropdown, theme toggle. No more Home 1-4 links.

## Common Pitfalls
- Scraper failures can cause false "unlisted" detections — the 3-day rule in `.state/` files prevents this
- Always test scrapers against live sites as selectors change frequently
- Keep `models.json` as the single source of truth for car definitions
- When adding new listing source platforms, update the `ALLOWED_DOMAINS` array in `routes/tracking.js` and the `normalisePlatform()` mapping
- The universal generator (`generate-pages.js`) reads the Ferrari 458 listing template and F430 analysis template — the `trackUrl()` and `renderSourceLinks()` functions are in the 458 template, so changes to tracking link format only need to be made there before re-running the generator.
- **Hero images must be verified URLs** — when adding new models, do NOT guess Wikimedia Commons filenames. Search for the actual file page on Commons and verify the thumbnail URL returns HTTP 200 before using it. Guessed URLs will 404.
- **Do NOT use manufacturer CDN URLs** (ferrari.com, porsche.com, lamborghini.com, etc.) for hero images — they block hotlinking with 403 errors. Always use Wikimedia Commons images instead. Run `node scripts/audit-hero-images.js` to check for broken images.
- **Do NOT change the BMW M3 or Porsche 911 hero images** unless explicitly asked by the user. The M3 uses a curated BMW AG press photo showing all generations together, and the 911 uses a Porsche AG heritage shot. These are intentionally chosen and working despite being manufacturer CDN URLs.
- **Cars & Classic makeIds** — Aston Martin: 7, BMW: 10, Ferrari: 20, Lamborghini: 26, Lotus: 29, Maserati: 30, Mercedes: 31, Porsche: 35, Audi: 108, Lexus: 497, McLaren: 2180, Alpine: 2158. Find new makeIds by searching `carandclassic.com/list/{makeId}/` or checking the URL when browsing by make.
- **Analysis index page is auto-updated** by `generate-pages.js` — the hardcoded `models` array in `public/analysis/index.html` is replaced with the full sorted model list from `models.json` every time the generator runs.
- **Vantage consolidation** — `aston-martin-v8-vantage` was merged into `aston-martin-vantage` with generation filters (V8 Vantage / New Vantage / New Vantage II). The old V8 Vantage slug, page, and data files no longer exist. Any old bookmarks or links to `/cars/aston-martin-v8-vantage/` will 404.
- **Generation filter on listing pages** uses `_generationsData` parsed from the `data-generations` attribute on the hero banner. The `getGeneration()` function checks title patterns first, then falls back to year ranges. The generation filter row auto-hides via `minDistinct: 2` for models without generations. Generation images swap the hero image via `data-generation-images` attribute.
