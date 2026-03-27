# Collectorly — Project Guide for Claude Code

## Overview
Collectorly is a Node.js web app that tracks collector/investment car listings and auction results across the UK market. It scrapes live listings, tracks price history, and presents analysis through a polished frontend.

## Tech Stack
- **Backend**: Express.js v5 (`server.js`) — JSON API + static file serving
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
  setup.js                        # Run once to create click_events table
routes/
  tracking.js                     # GET /go — tracked redirect for outbound clicks
  admin.js                        # GET /admin/stats, GET /admin/dashboard
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
5. Creates a GitHub Issue with refresh summary
6. Sends email notification via Gmail
7. Safeguard against mass unlisting from scraper failures

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

## Common Pitfalls
- Scraper failures can cause false "unlisted" detections — the 3-day rule in `.state/` files prevents this
- Always test scrapers against live sites as selectors change frequently
- Keep `models.json` as the single source of truth for car definitions
- When adding new listing source platforms, update the `ALLOWED_DOMAINS` array in `routes/tracking.js` and the `normalisePlatform()` mapping
- The universal generator (`generate-pages.js`) reads the Ferrari 458 listing template and F430 analysis template — the `trackUrl()` and `renderSourceLinks()` functions are in the 458 template, so changes to tracking link format only need to be made there before re-running the generator.
- **Hero images must be verified URLs** — when adding new models, do NOT guess Wikimedia Commons filenames. Search for the actual file page on Commons and verify the thumbnail URL returns HTTP 200 before using it. Guessed URLs will 404.
- **Cars & Classic makeIds** — Aston Martin: 7, BMW: 10, Ferrari: 20, Lamborghini: 26, Lotus: 29, Maserati: 30, Mercedes: 31, Porsche: 35, Audi: 108, Lexus: 497, McLaren: 2180, Alpine: 2158. Find new makeIds by searching `carandclassic.com/list/{makeId}/` or checking the URL when browsing by make.
- **Analysis index page is auto-updated** by `generate-pages.js` — the hardcoded `models` array in `public/analysis/index.html` is replaced with the full sorted model list from `models.json` every time the generator runs.
