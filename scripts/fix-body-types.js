#!/usr/bin/env node
/**
 * One-time script to fix body types in existing listing data.
 * Uses inferBodyType with model-specific rules (bodyTypeRules in models.json)
 * to fill in missing body types and correct misclassifications.
 */

const fs = require('fs');
const path = require('path');
const { normaliseBodyType, inferBodyType } = require('./scrapers/base');

const DATA_DIR = path.join(__dirname, '..', 'data');
const modelsRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'models.json'), 'utf8'));
const allModels = Object.values(modelsRaw).flat();

// Detect generation (mirrors frontend getGeneration and refresh.js detectGeneration)
function detectGeneration(title, year, model) {
  if (!model.generations) return null;
  const t = (title || '').toLowerCase();
  for (const g of model.generations) {
    if (g.patterns && g.patterns.length) {
      for (const p of g.patterns) {
        if (new RegExp(p, 'i').test(t)) return g.name;
      }
    }
  }
  if (year) {
    for (const g of model.generations) {
      if (g.years && year >= g.years[0] && year <= g.years[1]) return g.name;
    }
  }
  return null;
}

let totalListings = 0;
let totalChanged = 0;
let totalNewlySet = 0;
let totalCorrected = 0;
const changes = [];

for (const model of allModels) {
  const dataFile = path.join(DATA_DIR, `${model.slug}.json`);
  if (!fs.existsSync(dataFile)) continue;

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  if (!data.listings || data.listings.length === 0) continue;

  let modelChanges = 0;

  for (const listing of data.listings) {
    totalListings++;

    const gen = detectGeneration(listing.title, listing.year, model);
    const inferred = inferBodyType(listing.title, model, gen);
    const current = listing.bodyType || null;

    // Case 1: Currently null, inference gives a value → set it
    if (!current && inferred) {
      listing.bodyType = inferred;
      totalNewlySet++;
      modelChanges++;
      changes.push({
        slug: model.slug,
        title: listing.title,
        from: null,
        to: inferred,
        reason: 'was null',
      });
      continue;
    }

    // Case 2: Current value differs from what title analysis (not model default) says
    // Only correct if normaliseBodyType or title patterns give a definitive answer
    const fromTitle = normaliseBodyType(listing.title);
    if (current && fromTitle && current !== fromTitle) {
      listing.bodyType = fromTitle;
      totalCorrected++;
      modelChanges++;
      changes.push({
        slug: model.slug,
        title: listing.title,
        from: current,
        to: fromTitle,
        reason: 'title mismatch',
      });
    }
  }

  if (modelChanges > 0) {
    totalChanged += modelChanges;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    console.log(`  ${model.slug}: ${modelChanges} changes`);
  }
}

console.log(`\n=== Body Type Fix Summary ===`);
console.log(`Total listings scanned: ${totalListings}`);
console.log(`Total changes: ${totalChanged}`);
console.log(`  Newly set (was null): ${totalNewlySet}`);
console.log(`  Corrected (was wrong): ${totalCorrected}`);

if (totalCorrected > 0) {
  console.log(`\nCorrections:`);
  for (const c of changes.filter(c => c.reason === 'title mismatch')) {
    console.log(`  ${c.slug}: "${c.title}" — ${c.from} → ${c.to}`);
  }
}

const newlySet = changes.filter(c => c.reason === 'was null');
if (newlySet.length > 0) {
  console.log(`\nSample newly set (first 30):`);
  for (const c of newlySet.slice(0, 30)) {
    console.log(`  ${c.slug}: "${c.title}" → ${c.to}`);
  }
  if (newlySet.length > 30) {
    console.log(`  ... and ${newlySet.length - 30} more`);
  }
}
