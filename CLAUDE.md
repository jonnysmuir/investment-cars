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
  cars/{slug}/                     # 91 individual car model pages
  home-1/ through home-4/          # Homepage design iterations
scripts/
  refresh.js                       # Main orchestrator (dedup, price tracking, unlisted detection)
  scrape-glenmarch.js              # Glenmarch auction scraper
  scrape-cc-sold.js                # Collecting Cars sold scraper
  scrape-cc-sold-bulk.js           # Collecting Cars bulk sold scraper
  scrape-cac-sold-bulk.js          # Car & Classic bulk sold scraper
  generate-analysis-pages.js       # Car model page generator
  generate-ferrari-pages.js        # Ferrari-specific page generator
  generate-mclaren-pages.js        # McLaren-specific page generator
  send-email.js                    # Email notification sender
```

## Car Coverage
91 models across 6 makes: Ferrari (65), McLaren (21), BMW (2: M3, M8), Lamborghini (1: Murciélago), Lexus (1: LFA), Porsche (1: 911).

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

## Important Patterns
- When adding a new car model: add entry to `data/models.json` with slug, make, model, hero image, description, and search URLs per source
- When adding a new scraper: follow the Playwright + Cheerio pattern used by existing scrapers, respect rate limiting
- When modifying the frontend: maintain dark/light theme compatibility, use the gold accent for highlights
- Page generators create static HTML pages per car model — re-run after adding new models

## Click Tracking System
- **Outbound links go through `/go`** — all 91 car pages use `trackUrl()` in `renderSourceLinks()` to route external listing links through the `/go` redirect endpoint
- **Query params, not path params** — listing IDs are not globally unique (sequential per-model), so the redirect uses query parameters (`url`, `platform`, `year`, `price`, `page`) instead of `/go/:listingId`
- **Make/model derived server-side** — the `/go` route extracts the slug from the `page` query param and looks up make/model from `models.json` via `getModelsMap()`
- **Domain allowlist** — `routes/tracking.js` has an `ALLOWED_DOMAINS` array to prevent open-redirect abuse; update it when adding new listing sources
- **Non-blocking DB writes** — click logging is fire-and-forget so redirects are never slowed by database latency
- **Session tracking** — anonymous `_clk_sid` cookie (UUID v4, 30-day expiry) set via `cookie-parser`; no full session library needed
- **UTM parameters** — appended to all outbound URLs: `utm_source=collectorly.io`, `utm_medium=referral`, `utm_campaign=listing_click`
- **Prices stored in pence** — `car_price` column is INT representing pence to avoid decimal issues
- **Admin dashboard** — `/admin/dashboard` uses the same dark theme and gold accent as the main site
- **DB setup** — run `node db/setup.js` once to create the `click_events` table; uses `CREATE TABLE IF NOT EXISTS`

## Node.js Environment
- **Node path**: `~/bin/node` (v22.14.0)
- **npm is broken** — the `~/bin/npm` symlink points to a missing `../lib/cli.js`. Use `node ~/lib/node_modules/npm/bin/npm-cli.js` as a workaround to run npm commands.

## Common Pitfalls
- Scraper failures can cause false "unlisted" detections — the 3-day rule in `.state/` files prevents this
- Always test scrapers against live sites as selectors change frequently
- Keep `models.json` as the single source of truth for car definitions
- When adding new listing source platforms, update the `ALLOWED_DOMAINS` array in `routes/tracking.js` and the `normalisePlatform()` mapping
- Page generators (`generate-ferrari-pages.js`, `generate-mclaren-pages.js`) read the Ferrari 458 template — the `trackUrl()` and `renderSourceLinks()` functions are in that template, so changes to tracking link format only need to be made there before re-running generators
