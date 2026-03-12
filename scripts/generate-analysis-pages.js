#!/usr/bin/env node
/**
 * Generate enhanced analysis pages for all models.
 *
 * Uses public/analysis/ferrari-f430/index.html as the canonical template
 * and performs targeted string replacements per model.
 *
 * Usage:  node scripts/generate-analysis-pages.js
 *         node scripts/generate-analysis-pages.js --slug ferrari-458   (single model)
 *
 * Re-run this script whenever the F430 template page is updated.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_SLUG = 'ferrari-f430';
const TEMPLATE_PATH = path.join(ROOT, 'public', 'analysis', TEMPLATE_SLUG, 'index.html');
const MODELS_PATH = path.join(ROOT, 'data', 'models.json');

// Generic variant sort order — covers common variants across all makes.
// Variants not in this list still appear; they just sort after the listed ones.
const GENERIC_VARIANT_ORDER = [
  'Coupe', 'Berlinetta', 'Spider', 'Roadster', 'Convertible',
  'GT', 'GTS', 'GTO', 'GTR',
  'Speciale', 'Pista', 'Scuderia', 'Scuderia 16M', 'Challenge',
  'Competizione', 'Performante', 'SV', 'LT',
  'Other',
];

// ── Load template and models ──────────────────────────────────────────────────
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
const { models } = JSON.parse(fs.readFileSync(MODELS_PATH, 'utf8'));

// Parse CLI args
const args = process.argv.slice(2);
const slugIdx = args.indexOf('--slug');
const singleSlug = slugIdx !== -1 ? args[slugIdx + 1] : null;

// ── Generate ──────────────────────────────────────────────────────────────────
let generated = 0;
let skipped = 0;

for (const m of models) {
  // Skip the template model itself
  if (m.slug === TEMPLATE_SLUG) continue;

  // If --slug flag given, only generate that one
  if (singleSlug && m.slug !== singleSlug) continue;

  const displayName = `${m.make} ${m.model}`;

  let html = template;

  // 1. Page title
  html = html.replace(
    /<title>Ferrari F430 Market Analysis — Collectorly<\/title>/,
    `<title>${displayName} Market Analysis \u2014 Collectorly</title>`,
  );

  // 2. Hero banner model name
  html = html.replace(
    /<h1 class="hero-model-name">Ferrari F430<\/h1>/,
    `<h1 class="hero-model-name">${displayName}</h1>`,
  );

  // 2b. Hero image alt text
  html = html.replace(
    /alt="Ferrari F430"/,
    `alt="${displayName}"`,
  );

  // 3. CTA link to listings page
  html = html.replace(
    /href="\/cars\/ferrari-f430"/g,
    `href="/cars/${m.slug}"`,
  );

  // 4. API fetch URL
  html = html.replace(
    /fetch\('\/api\/history\/ferrari-f430'\)/,
    `fetch('/api/history/${m.slug}')`,
  );

  // 5. Variant sort order → generic
  html = html.replace(
    /const variantOrder = \[.*?\];/,
    `const variantOrder = ${JSON.stringify(GENERIC_VARIANT_ORDER)};`,
  );

  // Verify all replacements happened
  if (html.includes('ferrari-f430') || html.includes('Ferrari F430')) {
    console.warn(`⚠  ${m.slug}: template still contains F430 references — skipping`);
    skipped++;
    continue;
  }

  // Write output
  const outDir = path.join(ROOT, 'public', 'analysis', m.slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  generated++;
}

console.log(`\n✓ Generated ${generated} analysis page${generated !== 1 ? 's' : ''}`);
if (skipped) console.log(`⚠ Skipped ${skipped} (see warnings above)`);
if (singleSlug && generated === 0 && skipped === 0) {
  console.log(`  No model found with slug "${singleSlug}"`);
}
