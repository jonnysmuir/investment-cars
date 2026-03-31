#!/usr/bin/env node
/**
 * One-time script to fix body types in existing listing data.
 * Re-runs normaliseBodyType against each listing's title and updates
 * when the title analysis produces a better result than what's stored.
 */

const fs = require('fs');
const path = require('path');

// Import normaliseBodyType from the scrapers
const { normaliseBodyType } = require('./scrapers/base');

const DATA_DIR = path.join(__dirname, '..', 'data');
const modelsRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'models.json'), 'utf8'));
const allModels = Object.values(modelsRaw).flat();

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

    const titleBodyType = normaliseBodyType(listing.title);
    const current = listing.bodyType || null;

    // Case 1: Currently null, title analysis gives a value → set it
    if (!current && titleBodyType) {
      listing.bodyType = titleBodyType;
      totalNewlySet++;
      modelChanges++;
      changes.push({
        slug: model.slug,
        title: listing.title,
        from: null,
        to: titleBodyType,
        reason: 'was null',
      });
      continue;
    }

    // Case 2: Current value differs from title analysis → correct it
    // Only override if title analysis returns non-null and differs
    if (current && titleBodyType && current !== titleBodyType) {
      listing.bodyType = titleBodyType;
      totalCorrected++;
      modelChanges++;
      changes.push({
        slug: model.slug,
        title: listing.title,
        from: current,
        to: titleBodyType,
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

// Log corrections (more interesting than newly-set)
if (totalCorrected > 0) {
  console.log(`\nCorrections (body type changed):`);
  for (const c of changes.filter(c => c.reason === 'title mismatch')) {
    console.log(`  ${c.slug}: "${c.title}" — ${c.from} → ${c.to}`);
  }
}

// Sample of newly-set
const newlySet = changes.filter(c => c.reason === 'was null');
if (newlySet.length > 0) {
  console.log(`\nSample newly set (first 20):`);
  for (const c of newlySet.slice(0, 20)) {
    console.log(`  ${c.slug}: "${c.title}" → ${c.to}`);
  }
}
