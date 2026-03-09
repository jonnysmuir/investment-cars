# Adding New Listing Pages - Checklist & Lessons Learnt

> **Purpose:** Consult this document every time you add new blank listing pages to Collectorly.
> It captures hard-won lessons from the Ferrari batch (March 2025) where 59 pages were created
> with empty scraper sources, causing the daily refresh to silently skip them for a full cycle.

---

## Pre-Flight Checklist

Before generating or committing any new listing pages, confirm **every** item:

- [ ] **Each model in `models.json` has a populated `sources` object** (not `{}`)
- [ ] **Each source config matches the scraper's expected format** (see reference below)
- [ ] **Scraper slugs/IDs have been verified** against the actual platform URLs
- [ ] **Era-appropriate scrapers are assigned** (vintage cars won't appear on AutoTrader)
- [ ] **Hero images sourced from Wikimedia Commons** (or another CC-licensed source) for each model
- [ ] **The GitHub Actions timeout (90 mins) can accommodate the new models** (especially if adding many AutoTrader/Playwright sources)
- [ ] **Test at least 2-3 models locally** with `node scripts/refresh.js --slug {slug}` before pushing

---

## The Golden Rule

**A listing page without scraper sources is invisible to the daily refresh.**

The page will render fine in the browser, but `refresh.js` will never fetch listings for it.
There is now a safety guard in `refresh.js` that logs skipped models, but the real fix is
always to configure sources correctly from the start.

---

## Source Configuration Reference

### 1. Cars & Classic (`carsandclassic`)

```json
{
  "makeId": 20,
  "model": "testarossa",
  "countries": ["GB"]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `makeId` | Yes | Numeric ID. Ferrari = 20, Lamborghini = 26, Porsche = 42, BMW = 7. Find others at `carandclassic.com/list/{makeId}/` |
| `model` | Yes | Lowercase, use `+` for spaces (e.g. `"250+gto"`, `"dino+246"`). Check the URL on the site. |
| `countries` | No | Defaults to `["GB"]`. Add `"IE"`, `"DE"` etc. to widen search. |

**How to find the right values:** Browse to `carandclassic.com`, search for the car, and read the URL:
`/list/20/testarossa/` means `makeId: 20`, `model: "testarossa"`.

---

### 2. Collecting Cars (`collectingcars`)

```json
{
  "searchUrl": "https://www.collectingcars.com/search?make=Ferrari&model=Testarossa"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `searchUrl` | Yes | Full URL. `make` and `model` params are case-sensitive and must match the site's naming. Use `%20` or `+` for spaces. |

**How to find the right values:** Search on `collectingcars.com` and copy the URL from the results page.

---

### 3. PistonHeads (`pistonheads`)

```json
{
  "searchUrl": "https://www.pistonheads.com/buy/ferrari/testarossa",
  "alternateUrls": [
    "https://www.pistonheads.com/buy/ferrari/512-tr"
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `searchUrl` | Yes | Primary search URL. Slug is platform-specific (see quirks below). |
| `alternateUrls` | No | Array of additional URLs to scrape. Use when PistonHeads splits variants across different slugs (e.g. 812 Superfast vs 812 GTS, F430 Coupe vs F430 Spider). |

**PistonHeads slug quirks (Ferrari):**
- F355 is listed as `355` (not `f355`)
- 812 is listed as `superfast` (not `812`)
- All Dino variants share the slug `dino`
- 208 GTB is grouped under `308`
- 575M is `575`, Superamerica is `575-superamerica`
- F430 is split: `430-coupe` and `430-spider`

**How to find the right values:** Browse `pistonheads.com/buy/{make}/` and find the model. The URL slug is what you need. If the model doesn't exist on PH, don't add a PistonHeads source.

---

### 4. AutoTrader (`autotrader`)

```json
{
  "searchUrl": "https://www.autotrader.co.uk/cars/used/ferrari/testarossa"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `searchUrl` | Yes | Friendly browse URL. Used for Phase 1 (Apollo cache extraction). |

**Important:** Even if the friendly URL is slightly wrong, AutoTrader's Phase 2 fallback
constructs a search URL from `modelConfig.make` and `modelConfig.model` (from `models.json`),
so results will still be found. However, getting the friendly URL right improves Phase 1 speed.

**AutoTrader slug quirks (Ferrari):**
- F12 is `f12-berlinetta`
- 812 is `812-superfast`
- F8 Tributo is `f8-tributo`
- 575M is `575m-maranello`
- 296 is `296-gtb`
- 12 Cilindri is `12cilindri` (no hyphen — `12-cilindri` silently falls back to generic Ferrari page)

**How to find the right values:** Search on `autotrader.co.uk` and copy the browse URL.

---

## Era-Based Scraper Assignment

Not every car belongs on every platform. Use this as a guide:

| Era | Typical Scrapers | Rationale |
|-----|-----------------|-----------|
| **Pre-1970** (vintage/classic) | C&C + Collecting Cars | Too old/rare for PH and AT dealer listings |
| **1970s** | C&C + Collecting Cars + PistonHeads | Starting to appear on enthusiast platforms |
| **1980s** | C&C + CC + PH + some AutoTrader | Popular classics, increasingly on dealer sites |
| **1990s onwards** | All four scrapers | Modern enough for all platforms |

Use judgement — a rare limited edition from 2010 might not be on AutoTrader, while a popular
1980s classic (e.g. Testarossa) will be on all four.

---

## Common Mistakes to Avoid

### 1. Empty sources (`sources: {}`)
**What happens:** The model appears in `models.json` but the daily refresh skips it entirely.
The listing page stays blank forever. There's now a console warning for this, but it's still wrong.

### 2. Wrong makeId for Cars & Classic
**What happens:** The scraper fetches listings for the wrong manufacturer. Double-check the ID.

### 3. Wrong PistonHeads slug
**What happens:** The scraper returns zero results. PH slugs are idiosyncratic — always verify
by browsing the site. Use `alternateUrls` when PH splits body styles into separate pages.

### 4. Forgetting `alternateUrls` for PistonHeads
**What happens:** You only get half the listings. If a model has coupe and spider/GTS variants
listed separately on PH, you need the secondary URL in `alternateUrls`.

### 5. Adding too many Playwright-heavy sources at once
**What happens:** The GitHub Actions workflow exceeds its 30-minute timeout. AutoTrader and
Collecting Cars (sold results) use Playwright. If adding 50+ models with these sources,
monitor the first refresh run and increase the timeout if needed.

### 6. Not testing locally before pushing
**What happens:** Bad URLs, wrong slugs, or config typos go undetected until the next daily run.
Always test a few models locally first:
```bash
# Test a single model (note: the flag is --slug, NOT --model)
/Users/jonnymuir/bin/node scripts/refresh.js --slug ferrari-testarossa
```

### 7. Forgetting hero images
**What happens:** The listing page loads with a blank/black hero banner — looks broken and unprofessional.

---

## Hero Images

Every listing page needs a `heroImage` URL and `heroCredit` string, set in both `models.json` and the
corresponding `data/{slug}.json` file. The image is loaded dynamically by the page JavaScript.

### Where to source images

1. **Wikimedia Commons** (preferred) — search `commons.wikimedia.org` for the car model.
   Use the thumbnail URL format: `https://upload.wikimedia.org/wikipedia/commons/thumb/{hash}/{filename}/1920px-{filename}`
   Credit format: `Wikimedia Commons / CC BY-SA 4.0` (adjust licence as appropriate).

2. **Manufacturer CDN** — Ferrari models use `cdn.ferrari.com` URLs. Check if the manufacturer
   provides press images. Credit the manufacturer (e.g. `Ferrari S.p.A.`).

### Tips

- Use the **Wikimedia API** to get the correct thumbnail URL if guessing the hash path:
  `https://en.wikipedia.org/w/api.php?action=query&titles=File:{filename}&prop=imageinfo&iiprop=url&iiurlwidth=1920&format=json`
- Prefer **exterior shots** showing the full car (not interiors, details, or engine bays).
- Use **1920px width** thumbnails for consistency.
- If no image exists on Wikimedia Commons (e.g. very rare variants like the McLaren 625C),
  leave `heroImage` empty — the page will still work, just without a hero banner.

---

## Updating the Generator Script

If using `scripts/generate-ferrari-pages.js` (or a similar generator) for future batches,
**update it to include source configurations**, not just `sources: {}`. The generator should
accept source configs in its MODELS array and write them into `models.json`.

The original Ferrari generator wrote `sources: {}` for all 59 models, which caused the issue
that prompted this document.

---

## Quick-Add Workflow

When adding a single new model manually:

1. **Create the listing page** (copy an existing template, update model name/specs/variants)
2. **Create the empty data file** (`data/{slug}.json` with `{"listings": []}`)
3. **Add entry to `models.json`** with **fully populated `sources`**
4. **Test locally:** `node scripts/refresh.js` and verify listings appear
5. **Check the page in browser** to confirm listings render correctly
6. **Commit and push**

When adding a batch of models:

1. Write a generator script (or extend the existing one)
2. **Include source configs in the script** — never generate with `sources: {}`
3. Run the generator
4. Test 3-5 models locally across different eras/scraper combinations
5. Monitor the first daily refresh run after pushing

---

## Known Make IDs (Cars & Classic)

| Make | makeId |
|------|--------|
| Ferrari | 20 |
| Lamborghini | 26 |
| Porsche | 42 |
| BMW | 7 |
| Aston Martin | 5 |
| McLaren | 2180 |
| Mercedes-Benz | 32 |
| Jaguar | 24 |

To find others: browse `carandclassic.com`, search for the make, and read the URL.
