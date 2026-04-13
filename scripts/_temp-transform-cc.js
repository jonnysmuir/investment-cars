#!/usr/bin/env node
/**
 * Transform raw CC sold data into normalised auction history format
 */
const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'collecting-cars-sold', 'ferrari-f430.json'), 'utf8'));

const results = raw.map(r => {
  // Parse date DD/MM/YY → YYYY-MM-DD
  const [dd, mm, yy] = r.date.split('/');
  const year = parseInt(yy) < 50 ? `20${yy}` : `19${yy}`;
  const date = `${year}-${mm}-${dd}`;

  // Parse price
  const priceNum = parseInt(r.price.replace(/[£,]/g, ''), 10);

  // Extract car year from title
  const yearMatch = r.title.match(/^(?:NO RESERVE:\s*)?(\d{4})\s/i);
  const carYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Extract model from title
  const model = r.title
    .replace(/^(?:NO RESERVE:\s*)?(\d{4})\s+FERRARI\s+/i, '')
    .replace(/\s*-\s*[\d,]+\s*(miles|km)\s*$/i, '')
    .replace(/\s*-\s*(LHD|RHD|MANUAL)\s*$/i, '')
    .replace(/\s*-\s*NOVITEC ROSSO\s*$/i, (m) => m) // keep Novitec
    .trim();

  return {
    year: carYear,
    make: 'Ferrari',
    model,
    title: r.title.replace(/^NO RESERVE:\s*/i, '').trim(),
    price: priceNum,
    currency: 'GBP',
    sold: true,
    date,
    source: 'Collecting Cars',
  };
});

// Save transformed
const outFile = path.join(__dirname, '..', 'data', 'collecting-cars-sold', 'ferrari-f430.json');
fs.writeFileSync(outFile, JSON.stringify(results, null, 2) + '\n');

console.log(`Transformed ${results.length} results`);
console.log(`Date range: ${results.map(r => r.date).sort()[0]} → ${results.map(r => r.date).sort().pop()}`);
console.log(`Price range: £${Math.min(...results.map(r => r.price)).toLocaleString()} → £${Math.max(...results.map(r => r.price)).toLocaleString()}`);
console.log(`\nSample:`);
results.slice(0, 5).forEach(r => console.log(`  ${r.date} | £${r.price.toLocaleString()} | ${r.title}`));
console.log(`  ...`);
results.slice(-3).forEach(r => console.log(`  ${r.date} | £${r.price.toLocaleString()} | ${r.title}`));
