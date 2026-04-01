#!/usr/bin/env node
/**
 * Hero Image Audit Script
 * Checks all model and generation hero images for missing or broken URLs.
 * Uses Wikimedia API for commons images to avoid CDN rate limiting,
 * falls back to HEAD requests for non-Wikimedia URLs.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DATA_DIR = path.join(__dirname, '..', 'data');
const modelsRaw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'models.json'), 'utf8'));
const allModels = Object.values(modelsRaw).flat();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CollectorlyBot/1.0 (https://collectorly.io)' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse error')); } });
    }).on('error', reject);
  });
}

function headRequest(url, timeout = 15000) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'HEAD', timeout, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        headRequest(res.headers.location, timeout).then(resolve);
      } else {
        resolve(res.statusCode);
      }
    });
    req.on('error', () => resolve('error'));
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.end();
  });
}

/**
 * Check if a Wikimedia Commons thumbnail URL is valid.
 * Extracts the filename and checks via the API (avoids CDN rate limits).
 */
async function checkWikimediaUrl(url) {
  // Extract filename from thumbnail URL
  // Format: .../thumb/X/XX/Filename.jpg/1920px-Filename.jpg
  const match = url.match(/\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/(.+?)\//);
  if (!match) return headRequest(url); // not a recognisable Commons URL

  const filename = decodeURIComponent(match[1]);
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&format=json`;

  try {
    const data = await fetchJson(apiUrl);
    const pages = Object.values(data.query?.pages || {});
    if (pages.length === 0) return 404;
    // Page ID -1 means the file doesn't exist
    if (pages[0].missing !== undefined) return 404;
    return 200;
  } catch {
    return 'api_error';
  }
}

async function checkUrl(url) {
  if (url.includes('upload.wikimedia.org')) {
    return checkWikimediaUrl(url);
  }
  return headRequest(url);
}

async function main() {
  const missing = [];
  const broken = [];
  let workingModels = 0;
  let workingGens = 0;
  const genMissing = [];
  const genBroken = [];

  console.log(`Checking ${allModels.length} models...`);

  // Batch Wikimedia API checks (up to 50 titles per request)
  const wikimediaModels = [];
  const nonWikimediaModels = [];

  for (const m of allModels) {
    if (!m.heroImage) {
      missing.push({ slug: m.slug, make: m.make, model: m.model });
      continue;
    }
    if (m.heroImage.includes('upload.wikimedia.org')) {
      wikimediaModels.push(m);
    } else {
      nonWikimediaModels.push(m);
    }
  }

  // Batch check Wikimedia images (50 at a time via API)
  for (let i = 0; i < wikimediaModels.length; i += 50) {
    const batch = wikimediaModels.slice(i, i + 50);
    const filenames = batch.map(m => {
      const match = m.heroImage.match(/\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/(.+?)\//);
      return match ? 'File:' + decodeURIComponent(match[1]) : null;
    });

    const validFiles = filenames.filter(f => f);
    if (validFiles.length === 0) continue;

    const titles = validFiles.join('|');
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&format=json`;

    try {
      await sleep(500);
      const data = await fetchJson(apiUrl);
      const pages = data.query?.pages || {};
      const missingTitles = new Set();
      for (const page of Object.values(pages)) {
        if (page.missing !== undefined) missingTitles.add(page.title);
      }

      for (let j = 0; j < batch.length; j++) {
        const m = batch[j];
        const fn = filenames[j];
        if (!fn) {
          broken.push({ slug: m.slug, make: m.make, model: m.model, url: m.heroImage, status: 'bad_url' });
        } else if (missingTitles.has(fn)) {
          broken.push({ slug: m.slug, make: m.make, model: m.model, url: m.heroImage, status: 404 });
        } else {
          workingModels++;
        }
      }
    } catch (err) {
      console.error(`  API batch error: ${err.message}`);
      for (const m of batch) {
        broken.push({ slug: m.slug, make: m.make, model: m.model, url: m.heroImage, status: 'api_error' });
      }
    }
  }

  // Check non-Wikimedia images with HEAD requests
  for (const m of nonWikimediaModels) {
    await sleep(500);
    const status = await headRequest(m.heroImage);
    if (status === 200) {
      workingModels++;
    } else {
      broken.push({ slug: m.slug, make: m.make, model: m.model, url: m.heroImage, status });
    }
  }

  // Check generation hero images (batch by Wikimedia vs non)
  let totalGens = 0;
  const genEntries = [];
  for (const m of allModels) {
    if (!m.generations) continue;
    for (const g of m.generations) {
      totalGens++;
      if (!g.image) {
        genMissing.push({ slug: m.slug, generation: g.name });
        continue;
      }
      genEntries.push({ slug: m.slug, gen: g.name, url: g.image });
    }
  }

  // Batch check gen Wikimedia images
  const wikiGens = genEntries.filter(e => e.url.includes('upload.wikimedia.org'));
  const otherGens = genEntries.filter(e => !e.url.includes('upload.wikimedia.org'));

  for (let i = 0; i < wikiGens.length; i += 50) {
    const batch = wikiGens.slice(i, i + 50);
    const filenames = batch.map(e => {
      const match = e.url.match(/\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/(.+?)\//);
      return match ? 'File:' + decodeURIComponent(match[1]) : null;
    });

    const validFiles = filenames.filter(f => f);
    if (validFiles.length === 0) continue;

    const titles = validFiles.join('|');
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&format=json`;

    try {
      await sleep(500);
      const data = await fetchJson(apiUrl);
      const pages = data.query?.pages || {};
      const missingTitles = new Set();
      for (const page of Object.values(pages)) {
        if (page.missing !== undefined) missingTitles.add(page.title);
      }

      for (let j = 0; j < batch.length; j++) {
        const e = batch[j];
        const fn = filenames[j];
        if (!fn) {
          genBroken.push({ slug: e.slug, generation: e.gen, url: e.url, status: 'bad_url' });
        } else if (missingTitles.has(fn)) {
          genBroken.push({ slug: e.slug, generation: e.gen, url: e.url, status: 404 });
        } else {
          workingGens++;
        }
      }
    } catch (err) {
      console.error(`  Gen API batch error: ${err.message}`);
    }
  }

  for (const e of otherGens) {
    await sleep(500);
    const status = await headRequest(e.url);
    if (status === 200) {
      workingGens++;
    } else {
      genBroken.push({ slug: e.slug, generation: e.gen, url: e.url, status });
    }
  }

  // Generate report
  let md = `# Hero Image Audit Report\n\n`;
  md += `Generated: ${new Date().toISOString().split('T')[0]}\n\n`;
  md += `## Summary\n\n`;
  md += `| | Working | Missing | Broken | Total |\n|---|---|---|---|---|\n`;
  md += `| Models | ${workingModels} | ${missing.length} | ${broken.length} | ${allModels.length} |\n`;
  md += `| Generations | ${workingGens} | ${genMissing.length} | ${genBroken.length} | ${totalGens} |\n\n`;

  if (missing.length > 0) {
    md += `## Missing Model Hero Images\n\n`;
    md += `| Model | Slug |\n|---|---|\n`;
    for (const m of missing) md += `| ${m.make} ${m.model} | ${m.slug} |\n`;
    md += `\n`;
  }

  if (broken.length > 0) {
    md += `## Broken Model Hero Images\n\n`;
    md += `| Model | Status | URL |\n|---|---|---|\n`;
    for (const b of broken) md += `| ${b.make} ${b.model} | ${b.status} | \`${b.url.substring(0, 120)}\` |\n`;
    md += `\n`;
  }

  if (genMissing.length > 0) {
    md += `## Missing Generation Hero Images\n\n`;
    md += `| Model | Generation |\n|---|---|\n`;
    for (const g of genMissing) md += `| ${g.slug} | ${g.generation} |\n`;
    md += `\n`;
  }

  if (genBroken.length > 0) {
    md += `## Broken Generation Hero Images\n\n`;
    md += `| Model | Generation | Status | URL |\n|---|---|---|---|\n`;
    for (const g of genBroken) md += `| ${g.slug} | ${g.generation} | ${g.status} | \`${g.url.substring(0, 120)}\` |\n`;
    md += `\n`;
  }

  if (missing.length === 0 && broken.length === 0 && genMissing.length === 0 && genBroken.length === 0) {
    md += `All hero images are present and valid.\n`;
  }

  const reportPath = path.join(__dirname, 'hero-image-audit.md');
  fs.writeFileSync(reportPath, md);

  console.log(`\n${workingModels} models OK, ${missing.length} missing, ${broken.length} broken`);
  console.log(`${workingGens} generations OK, ${genMissing.length} missing, ${genBroken.length} broken`);
  console.log(`Report: ${reportPath}`);
}

main().catch(e => console.error(e));
