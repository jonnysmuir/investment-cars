#!/usr/bin/env node
/**
 * Universal Page Generator
 *
 * Generates listing pages and analysis pages for all models in data/models.json.
 * Replaces the per-make generators (generate-ferrari-pages.js, generate-mclaren-pages.js,
 * generate-lotus-pages.js) with a single make-agnostic script.
 *
 * Also auto-updates public/analysis/index.html with the full model list.
 *
 * Usage:
 *   node scripts/generate-pages.js                         # All models, skip existing
 *   node scripts/generate-pages.js --slug porsche-boxster  # Single model
 *   node scripts/generate-pages.js --make Porsche          # All for a make
 *   node scripts/generate-pages.js --force                  # Overwrite existing pages
 *   node scripts/generate-pages.js --analysis-only          # Only analysis pages + index
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LISTING_TEMPLATE_PATH = path.join(ROOT, 'public/cars/ferrari-458/index.html');
const ANALYSIS_TEMPLATE_PATH = path.join(ROOT, 'public/analysis/ferrari-f430/index.html');
const MODELS_JSON_PATH = path.join(ROOT, 'data/models.json');
const ANALYSIS_INDEX_PATH = path.join(ROOT, 'public/analysis/index.html');
const DATA_DIR = path.join(ROOT, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const force = args.includes('--force');
const analysisOnly = args.includes('--analysis-only');
const slugIdx = args.indexOf('--slug');
const makeIdx = args.indexOf('--make');
const filterSlug = slugIdx !== -1 ? args[slugIdx + 1] : null;
const filterMake = makeIdx !== -1 ? args[makeIdx + 1] : null;

// ── Generic variant order for analysis pages ─────────────────────────────────
const GENERIC_VARIANT_ORDER = [
  'Coupe', 'Berlinetta', 'Spider', 'Roadster', 'Convertible',
  'GT', 'GTS', 'GTO', 'GTR',
  'Speciale', 'Pista', 'Scuderia', 'Scuderia 16M', 'Challenge',
  'Competizione', 'Performante', 'SV', 'LT',
  'Standard', 'Other',
];

// ── Default filter config for new models ─────────────────────────────────────

const DEFAULT_BODY_LABELS = { coupe: 'Coupe', convertible: 'Convertible', saloon: 'Saloon', estate: 'Estate', targa: 'Targa', speedster: 'Speedster', suv: 'SUV' };
const DEFAULT_BODY_ORDER = ['coupe', 'convertible', 'saloon', 'estate', 'targa', 'speedster', 'suv'];
const DEFAULT_VARIANT_LABELS = { standard: 'Standard' };
const DEFAULT_VARIANT_ORDER = ['standard'];
const DEFAULT_TRANSMISSION_LABELS = { manual: 'Manual', dct: 'DCT/Dual-Clutch', automatic: 'Automatic', unknown: 'Unknown' };
const DEFAULT_TRANSMISSION_ORDER = ['manual', 'dct', 'automatic', 'unknown'];

const DEFAULT_GET_BODY = `return null;`;
const DEFAULT_GET_VARIANT = `return 'standard';`;
const DEFAULT_GET_TRANSMISSION = `const s = str.toLowerCase();
      if (/manual|6.speed.*man|gated/i.test(s) && !/auto|dct|sequential|paddle|f1|e.gear/i.test(s)) return 'manual';
      if (/dct|dual.clutch|pdk|ssg|s.tronic|e.gear|f1|sequential|paddle/i.test(s)) return 'dct';
      if (/auto|tiptronic|torque.converter/i.test(s)) return 'automatic';
      return 'unknown';`;

// ── Load templates and models ────────────────────────────────────────────────
if (!fs.existsSync(LISTING_TEMPLATE_PATH)) {
  console.error(`Listing template not found: ${LISTING_TEMPLATE_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(ANALYSIS_TEMPLATE_PATH)) {
  console.error(`Analysis template not found: ${ANALYSIS_TEMPLATE_PATH}`);
  process.exit(1);
}

const listingTemplate = fs.readFileSync(LISTING_TEMPLATE_PATH, 'utf8');
const analysisTemplate = fs.readFileSync(ANALYSIS_TEMPLATE_PATH, 'utf8');
const modelsData = JSON.parse(fs.readFileSync(MODELS_JSON_PATH, 'utf8'));

// ── Filter models ────────────────────────────────────────────────────────────
let models = modelsData.models;
if (filterSlug) {
  models = models.filter(m => m.slug === filterSlug);
  if (models.length === 0) {
    console.error(`No model found with slug: ${filterSlug}`);
    process.exit(1);
  }
}
if (filterMake) {
  models = models.filter(m => m.make.toLowerCase() === filterMake.toLowerCase());
  if (models.length === 0) {
    console.error(`No models found for make: ${filterMake}`);
    process.exit(1);
  }
}

// Skip template models themselves
const TEMPLATE_SLUGS = new Set(['ferrari-458', 'ferrari-f430']);

// ── Listing page generation ──────────────────────────────────────────────────

function generateListingPage(m) {
  const displayName = `${m.make} ${m.model}`;
  const heroYears = m.heroYears || '';
  const heroEngine = m.heroEngine || '';
  const heroBhp = m.heroBhp || '';

  // Resolve filter config (use model's pageConfig if present, otherwise defaults)
  const pc = m.pageConfig || {};
  const getBody = pc.getBody || DEFAULT_GET_BODY;
  const getVariant = pc.getVariant || DEFAULT_GET_VARIANT;
  const getTransmission = pc.getTransmission || DEFAULT_GET_TRANSMISSION;
  const bodyLabels = pc.bodyLabels || DEFAULT_BODY_LABELS;
  const bodyOrder = pc.bodyOrder || DEFAULT_BODY_ORDER;
  const variantLabels = pc.variantLabels || DEFAULT_VARIANT_LABELS;
  const variantOrder = pc.variantOrder || DEFAULT_VARIANT_ORDER;
  const transLabels = pc.transmissionLabels || DEFAULT_TRANSMISSION_LABELS;
  const transOrder = pc.transmissionOrder || DEFAULT_TRANSMISSION_ORDER;

  let html = listingTemplate;

  // A. <title> tag
  html = html.replace(
    /<title>Ferrari 458 Listings — Collectorly<\/title>/,
    `<title>${displayName} Listings \u2014 Collectorly</title>`
  );

  // B. Hero banner
  html = html.replace(/alt="Ferrari 458"/, `alt="${displayName}"`);
  html = html.replace(
    /<h1 class="hero-model-name">Ferrari 458<\/h1>/,
    `<h1 class="hero-model-name">${displayName}</h1>`
  );

  // Hero specs subtitle
  if (heroYears && heroEngine && heroBhp) {
    html = html.replace(
      /<p class="hero-model-years">2009 — 2015 &middot; 4\.5L V8 &middot; 562 BHP<\/p>/,
      `<p class="hero-model-years">${heroYears} &middot; ${heroEngine} &middot; ${heroBhp}</p>`
    );
  } else {
    html = html.replace(
      /<p class="hero-model-years">2009 — 2015 &middot; 4\.5L V8 &middot; 562 BHP<\/p>/,
      `<p class="hero-model-years"></p>`
    );
  }

  // B2. Generation data attribute on hero-banner
  const generationsJson = m.generations
    ? JSON.stringify(m.generations.map(g => ({ name: g.name, years: g.years, patterns: g.patterns })))
        .replace(/&/g, '&amp;').replace(/'/g, '&#39;')
    : '[]';
  html = html.replace(
    /data-generations="[^"]*"/,
    `data-generations='${generationsJson}'`
  );

  // C. Analysis link
  html = html.replace(
    /href="\/analysis\/ferrari-458"/,
    `href="/analysis/${m.slug}"`
  );

  // D. Auction empty text
  html = html.replace(
    /No Ferrari 458 auctions/,
    `No ${displayName} auctions`
  );

  // E. API fetch URL
  html = html.replace(
    /fetch\('\/api\/listings\/ferrari-458'\)/,
    `fetch('/api/listings/${m.slug}')`
  );

  // F. getBody(), getVariant(), getTransmissionGroup() functions
  html = html.replace(
    /function getBody\(title\) \{[\s\S]*?\n    \}\n/,
    `function getBody(title) {\n      ${getBody}\n    }\n`
  );
  html = html.replace(
    /function getVariant\(title\) \{[^}]+\}/,
    `function getVariant(title) {\n      ${getVariant}\n    }`
  );
  html = html.replace(
    /function getTransmissionGroup\(str\) \{[^}]+\}/,
    `function getTransmissionGroup(str) {\n      if (!str) return '${transOrder[0]}';\n      ${getTransmission}\n    }`
  );

  // G. FILTER_CONFIG
  const hasMultipleBodies = Object.keys(bodyLabels).length >= 2;
  const bodyMinDistinct = hasMultipleBodies ? '' : ', minDistinct: 2';

  const newFilterConfig = `const FILTER_CONFIG = {
      generation:   { detect: l => getGeneration(l), labels: _generationLabels, sortOrder: _generationOrder, mode: 'single', minDistinct: 2 },
      year:         { detect: l => l.year ? String(l.year) : null, labels: {}, sortOrder: null, mode: 'multi' },
      body:         { detect: l => (l.bodyType || '').toLowerCase() || getBody(l.title), labels: ${JSON.stringify(bodyLabels)}, sortOrder: ${JSON.stringify(bodyOrder)}, mode: 'single'${bodyMinDistinct} },
      variant:      { detect: l => getVariant(l.title), labels: ${JSON.stringify(variantLabels)}, sortOrder: ${JSON.stringify(variantOrder)}, mode: 'single', minDistinct: 2 },
      transmission: { detect: l => getTransmissionGroup(l.transmission), labels: ${JSON.stringify(transLabels)}, sortOrder: ${JSON.stringify(transOrder)}, mode: 'single' },
      source:       { detect: l => (l.sources||[]).map(s => s.name), labels: {}, sortOrder: ['PistonHeads','AutoTrader','Cars & Classic'], mode: 'single', isMultiValue: true },
    }`;

  html = html.replace(
    /const FILTER_CONFIG = \{[\s\S]*?\n    \}/,
    newFilterConfig
  );

  return html;
}

// ── Analysis page generation ─────────────────────────────────────────────────

function generateAnalysisPage(m) {
  const displayName = `${m.make} ${m.model}`;
  let html = analysisTemplate;

  // 1. Page title
  html = html.replace(
    /<title>Ferrari F430 Market Analysis — Collectorly<\/title>/,
    `<title>${displayName} Market Analysis \u2014 Collectorly</title>`
  );

  // 2. Hero banner
  html = html.replace(
    /<h1 class="hero-model-name">Ferrari F430<\/h1>/,
    `<h1 class="hero-model-name">${displayName}</h1>`
  );
  html = html.replace(/alt="Ferrari F430"/, `alt="${displayName}"`);

  // 3. CTA link to listings page
  html = html.replace(/href="\/cars\/ferrari-f430"/g, `href="/cars/${m.slug}"`);

  // 4. API fetch URL
  html = html.replace(
    /fetch\('\/api\/history\/ferrari-f430'\)/,
    `fetch('/api/history/${m.slug}')`
  );

  // 5. Variant sort order → generic
  html = html.replace(
    /const variantOrder = \[.*?\];/,
    `const variantOrder = ${JSON.stringify(GENERIC_VARIANT_ORDER)};`
  );

  return html;
}

// ── Analysis index auto-update ───────────────────────────────────────────────

function updateAnalysisIndex(allModels) {
  if (!fs.existsSync(ANALYSIS_INDEX_PATH)) {
    console.warn('Analysis index not found, skipping auto-update');
    return;
  }

  let html = fs.readFileSync(ANALYSIS_INDEX_PATH, 'utf8');

  // Sort models: alphabetically by make, then by model within make
  const sorted = [...allModels].sort((a, b) => {
    const makeComp = a.make.localeCompare(b.make);
    if (makeComp !== 0) return makeComp;
    return a.model.localeCompare(b.model);
  });

  // Build the new models array
  const entries = sorted.map(m => {
    const modelStr = m.model.replace(/'/g, "\\'");
    return `      { slug: '${m.slug}', make: '${m.make}', model: '${modelStr}' }`;
  });
  const newArray = `const models = [\n${entries.join(',\n')}\n    ]`;

  // Replace the existing models array
  html = html.replace(
    /const models = \[[\s\S]*?\n    \]/,
    newArray
  );

  fs.writeFileSync(ANALYSIS_INDEX_PATH, html, 'utf8');
  console.log(`  Updated analysis index with ${sorted.length} models`);
}

// ── Main execution ───────────────────────────────────────────────────────────

console.log('=== Universal Page Generator ===\n');

let listingPagesCreated = 0;
let listingPagesSkipped = 0;
let analysisPagesCreated = 0;
let dataFilesCreated = 0;
let historyFilesCreated = 0;
const errors = [];

for (const m of models) {
  // Skip template models
  if (TEMPLATE_SLUGS.has(m.slug)) continue;

  const displayName = `${m.make} ${m.model}`;

  // ── Listing page ────────────────────────────────────────────────────────
  if (!analysisOnly) {
    const pageDir = path.join(ROOT, 'public/cars', m.slug);
    const pagePath = path.join(pageDir, 'index.html');

    if (fs.existsSync(pagePath) && !force) {
      listingPagesSkipped++;
    } else {
      try {
        fs.mkdirSync(pageDir, { recursive: true });
        const html = generateListingPage(m);
        fs.writeFileSync(pagePath, html, 'utf8');
        listingPagesCreated++;
        console.log(`  OK    ${m.slug} (listing)`);
      } catch (err) {
        errors.push({ slug: m.slug, type: 'listing', error: err.message });
        console.error(`  FAIL  ${m.slug} (listing): ${err.message}`);
      }
    }

    // ── Data file ───────────────────────────────────────────────────────
    const dataPath = path.join(DATA_DIR, `${m.slug}.json`);
    if (!fs.existsSync(dataPath)) {
      const dataContent = {
        model: displayName,
        slug: m.slug,
        heroImage: m.heroImage || '',
        heroCredit: m.heroCredit || '',
        description: m.description || '',
        listings: [],
      };
      fs.writeFileSync(dataPath, JSON.stringify(dataContent, null, 2), 'utf8');
      dataFilesCreated++;
    }

    // ── History file ────────────────────────────────────────────────────
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const historyPath = path.join(HISTORY_DIR, `${m.slug}.json`);
    if (!fs.existsSync(historyPath)) {
      fs.writeFileSync(historyPath, '[]', 'utf8');
      historyFilesCreated++;
    }
  }

  // ── Analysis page ───────────────────────────────────────────────────────
  const analysisDir = path.join(ROOT, 'public/analysis', m.slug);
  const analysisPath = path.join(analysisDir, 'index.html');

  if (fs.existsSync(analysisPath) && !force) {
    // skip silently
  } else {
    try {
      fs.mkdirSync(analysisDir, { recursive: true });
      const html = generateAnalysisPage(m);

      // Verify all F430 references were replaced
      if (html.includes('ferrari-f430') || html.includes('Ferrari F430')) {
        console.warn(`  WARN  ${m.slug} (analysis): template still contains F430 references — skipping`);
      } else {
        fs.writeFileSync(analysisPath, html, 'utf8');
        analysisPagesCreated++;
      }
    } catch (err) {
      errors.push({ slug: m.slug, type: 'analysis', error: err.message });
      console.error(`  FAIL  ${m.slug} (analysis): ${err.message}`);
    }
  }
}

// ── Auto-update analysis index ───────────────────────────────────────────────
updateAnalysisIndex(modelsData.models);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n=== Summary ===`);
if (!analysisOnly) {
  console.log(`  Listing pages created:  ${listingPagesCreated}`);
  console.log(`  Listing pages skipped:  ${listingPagesSkipped}`);
  console.log(`  Data files created:     ${dataFilesCreated}`);
  console.log(`  History files created:  ${historyFilesCreated}`);
}
console.log(`  Analysis pages created: ${analysisPagesCreated}`);
if (errors.length > 0) {
  console.log(`  Errors:                 ${errors.length}`);
  errors.forEach(e => console.log(`    - ${e.slug} (${e.type}): ${e.error}`));
}
console.log('\nDone!');
