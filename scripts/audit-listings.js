#!/usr/bin/env node
/**
 * Audit existing listing data for false positives.
 *
 * Scans all data/{slug}.json files and checks each listing title against
 * the updated titleMatchesModel logic + excludePatterns from models.json.
 *
 * Outputs a markdown report to scripts/audit-report.md
 *
 * Usage:
 *   node scripts/audit-listings.js
 */

const fs = require('fs');
const path = require('path');
const { titleMatchesModel } = require('./scrapers/base');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');
const REPORT_FILE = path.join(__dirname, 'audit-report.md');

const modelsData = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));

const lines = [];
lines.push('# Listing Data Audit Report');
lines.push(`\nGenerated: ${new Date().toISOString().split('T')[0]}\n`);
lines.push('This report identifies listings in existing data files that would be rejected');
lines.push('by the updated title matching logic (excludePatterns + tightened titleMatchesModel).\n');
lines.push('**Do NOT auto-delete these listings.** Review each one and confirm before removing.\n');

let totalFlagged = 0;
let totalListings = 0;
let modelsWithIssues = 0;

for (const modelConfig of modelsData.models) {
  const dataFile = path.join(DATA_DIR, `${modelConfig.slug}.json`);
  if (!fs.existsSync(dataFile)) continue;

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const listings = data.listings || [];
  if (listings.length === 0) continue;

  totalListings += listings.length;

  // Build generation patterns for this model
  const genPatterns = (modelConfig.generations || []).flatMap(g => g.patterns || []).map(p => p.toLowerCase());

  const flagged = [];

  for (const listing of listings) {
    const title = listing.title || '';
    if (!title) continue;

    // Check exclude patterns
    const excluded = (modelConfig.excludePatterns || []).some(p => new RegExp(p, 'i').test(title));
    if (excluded) {
      flagged.push({
        id: listing.id,
        title,
        status: listing.status,
        source: (listing.sources || []).map(s => s.name).join(', '),
        reason: 'Matches excludePattern',
      });
      continue;
    }

    // Check titleMatchesModel
    if (!titleMatchesModel(title, modelConfig)) {
      // Allow generation pattern matches
      const titleNorm = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const matchesGen = genPatterns.some(p => {
        const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        return re.test(titleNorm);
      });
      if (!matchesGen) {
        flagged.push({
          id: listing.id,
          title,
          status: listing.status,
          source: (listing.sources || []).map(s => s.name).join(', '),
          reason: 'Fails titleMatchesModel',
        });
      }
    }
  }

  if (flagged.length > 0) {
    modelsWithIssues++;
    totalFlagged += flagged.length;

    lines.push(`## ${modelConfig.make} ${modelConfig.model} (${modelConfig.slug})`);
    lines.push(`\n**${flagged.length}** of ${listings.length} listings flagged:\n`);
    lines.push('| ID | Title | Status | Source | Reason |');
    lines.push('|----|-------|--------|--------|--------|');
    for (const f of flagged) {
      lines.push(`| ${f.id} | ${f.title} | ${f.status} | ${f.source} | ${f.reason} |`);
    }
    lines.push('');
  }
}

lines.push('---\n');
lines.push(`## Summary\n`);
lines.push(`- **Total listings scanned:** ${totalListings}`);
lines.push(`- **Total flagged:** ${totalFlagged}`);
lines.push(`- **Models with issues:** ${modelsWithIssues}`);
lines.push(`- **False positive rate:** ${totalListings > 0 ? (totalFlagged / totalListings * 100).toFixed(1) : 0}%`);

fs.writeFileSync(REPORT_FILE, lines.join('\n') + '\n', 'utf8');
console.log(`Audit complete. ${totalFlagged} listings flagged across ${modelsWithIssues} models.`);
console.log(`Report written to: ${REPORT_FILE}`);
