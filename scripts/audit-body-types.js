#!/usr/bin/env node
/**
 * Body Type Audit Script
 * Scans all data/{slug}.json files and reports on body type distribution,
 * missing body types, and models with suspected misclassification.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const modelsRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'models.json'), 'utf8'));
const allModels = Object.values(modelsRaw).flat();

// Models known to come in multiple body styles
const MULTI_BODY_MODELS = {
  'bmw-m3': ['Coupe', 'Saloon', 'Convertible', 'Estate'],
  'bmw-m4': ['Coupe', 'Convertible'],
  'bmw-m5': ['Saloon', 'Estate'],
  'bmw-m6': ['Coupe', 'Convertible'],
  'bmw-z4': ['Coupe', 'Convertible'],
  'porsche-911': ['Coupe', 'Convertible', 'Targa'],
  'porsche-boxster': ['Convertible'],
  'porsche-cayman': ['Coupe'],
  'ferrari-458': ['Coupe', 'Convertible'],
  'ferrari-488': ['Coupe', 'Convertible'],
  'ferrari-f8': ['Coupe', 'Convertible'],
  'ferrari-296': ['Coupe', 'Convertible'],
  'ferrari-812': ['Coupe', 'Convertible'],
  'ferrari-california': ['Convertible'],
  'ferrari-portofino': ['Convertible'],
  'ferrari-roma': ['Coupe', 'Convertible'],
  'ferrari-360': ['Coupe', 'Convertible'],
  'ferrari-f355': ['Coupe', 'Convertible'],
  'ferrari-550': ['Coupe', 'Convertible'],
  'ferrari-308': ['Coupe', 'Convertible'],
  'ferrari-328': ['Coupe', 'Convertible'],
  'mclaren-720s': ['Coupe', 'Convertible'],
  'mclaren-650s': ['Coupe', 'Convertible'],
  'mclaren-570s': ['Coupe', 'Convertible'],
  'mclaren-12c': ['Coupe', 'Convertible'],
  'lamborghini-huracan': ['Coupe', 'Convertible'],
  'lamborghini-aventador': ['Coupe', 'Convertible'],
  'lamborghini-gallardo': ['Coupe', 'Convertible'],
  'aston-martin-vantage': ['Coupe', 'Convertible'],
  'aston-martin-db11': ['Coupe', 'Convertible'],
  'aston-martin-db9': ['Coupe', 'Convertible'],
  'audi-r8': ['Coupe', 'Convertible'],
  'audi-rs4': ['Saloon', 'Estate'],
  'audi-rs6': ['Estate'],
  'mercedes-amg-c63': ['Coupe', 'Saloon', 'Convertible', 'Estate'],
  'mercedes-amg-e63': ['Saloon', 'Estate'],
  'mercedes-amg-gt': ['Coupe', 'Convertible'],
};

let totalListings = 0;
let totalNull = 0;
const modelReports = [];
const suspectedIssues = [];

for (const model of allModels) {
  const dataFile = path.join(DATA_DIR, `${model.slug}.json`);
  if (!fs.existsSync(dataFile)) continue;

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  if (!data.listings || data.listings.length === 0) continue;

  const active = data.listings.filter(l => l.status === 'active');
  if (active.length === 0) continue;

  const dist = {};
  let nullCount = 0;

  for (const l of active) {
    const bt = l.bodyType || null;
    if (bt === null) {
      nullCount++;
    } else {
      dist[bt] = (dist[bt] || 0) + 1;
    }
  }

  totalListings += active.length;
  totalNull += nullCount;

  const sortedDist = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  const topType = sortedDist[0];
  const topPct = topType ? Math.round((topType[1] / active.length) * 100) : 0;

  modelReports.push({
    slug: model.slug,
    make: model.make,
    model: model.model,
    total: active.length,
    nullCount,
    distribution: dist,
    sortedDist,
  });

  // Flag models with suspected issues
  const expectedBodies = MULTI_BODY_MODELS[model.slug];
  if (expectedBodies && expectedBodies.length > 1 && topPct > 90) {
    const missingBodies = expectedBodies.filter(b => !dist[b] || dist[b] === 0);
    if (missingBodies.length > 0) {
      suspectedIssues.push({
        slug: model.slug,
        total: active.length,
        topType: topType[0],
        topPct,
        missingBodies,
        distribution: dist,
      });
    }
  }

  // Flag models with high null rate
  if (nullCount > 0 && (nullCount / active.length) > 0.3) {
    suspectedIssues.push({
      slug: model.slug,
      total: active.length,
      nullCount,
      nullPct: Math.round((nullCount / active.length) * 100),
      issue: 'high_null_rate',
    });
  }
}

// Generate markdown report
let md = `# Body Type Audit Report\n\n`;
md += `Generated: ${new Date().toISOString().split('T')[0]}\n\n`;
md += `## Summary\n\n`;
md += `- **Total active listings scanned**: ${totalListings.toLocaleString()}\n`;
md += `- **Listings with null bodyType**: ${totalNull.toLocaleString()} (${Math.round((totalNull / totalListings) * 100)}%)\n`;
md += `- **Models scanned**: ${modelReports.length}\n`;
md += `- **Suspected issues**: ${suspectedIssues.length}\n\n`;

// Body type distribution across all models
const globalDist = {};
for (const r of modelReports) {
  for (const [bt, count] of Object.entries(r.distribution)) {
    globalDist[bt] = (globalDist[bt] || 0) + count;
  }
}
md += `## Global Body Type Distribution\n\n`;
md += `| Body Type | Count | % |\n|---|---|---|\n`;
for (const [bt, count] of Object.entries(globalDist).sort((a, b) => b[1] - a[1])) {
  md += `| ${bt} | ${count.toLocaleString()} | ${Math.round((count / totalListings) * 100)}% |\n`;
}
md += `| null | ${totalNull.toLocaleString()} | ${Math.round((totalNull / totalListings) * 100)}% |\n`;
md += `\n`;

// Suspected issues
if (suspectedIssues.length > 0) {
  md += `## Suspected Issues\n\n`;
  for (const issue of suspectedIssues) {
    if (issue.issue === 'high_null_rate') {
      md += `### ${issue.slug} — High null rate\n`;
      md += `${issue.nullCount} of ${issue.total} listings (${issue.nullPct}%) have null bodyType.\n\n`;
    } else {
      md += `### ${issue.slug} — Missing body types\n`;
      md += `${issue.topPct}% are "${issue.topType}" but model should have: ${issue.missingBodies.join(', ')}\n`;
      md += `Distribution: ${JSON.stringify(issue.distribution)}\n\n`;
    }
  }
}

// Per-model details (only models with issues or interesting distributions)
md += `## Per-Model Distribution\n\n`;
md += `| Model | Total | Distribution | Null |\n|---|---|---|---|\n`;
for (const r of modelReports.sort((a, b) => b.nullCount - a.nullCount)) {
  const distStr = r.sortedDist.map(([bt, count]) => `${bt}: ${count}`).join(', ');
  md += `| ${r.slug} | ${r.total} | ${distStr || 'none'} | ${r.nullCount} |\n`;
}

const reportPath = path.join(__dirname, 'body-type-audit.md');
fs.writeFileSync(reportPath, md);
console.log(`Audit report written to ${reportPath}`);
console.log(`\nSummary: ${totalListings} listings, ${totalNull} null (${Math.round((totalNull / totalListings) * 100)}%), ${suspectedIssues.length} suspected issues`);
