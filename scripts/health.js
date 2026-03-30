/**
 * Health monitoring for Collectorly scraper runs.
 *
 * Tracks per-source per-model result counts, maintains a 7-day rolling
 * baseline, and detects anomalies (source-level failures, broken URLs,
 * gradual degradation).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HEALTH_DIR = path.join(DATA_DIR, '.health');
const BASELINE_FILE = path.join(HEALTH_DIR, 'baseline.json');
const MAX_HISTORY_DAYS = 7;
const MAX_RUN_LOG_AGE_DAYS = 30;
const MIN_BASELINE_DAYS = 3; // Anomaly detection requires this many days of data

// ── Run Stats ─────────────────────────────────────────────────────────────

/**
 * Collect and write per-run health stats.
 * @param {object} summary - The refresh summary object
 * @param {object} sourceTracker - { sourceName: { modelResults: { slug: count } } }
 * @param {number} durationMs - Total run time in milliseconds
 * @returns {object} The run stats object
 */
function collectRunStats(summary, sourceTracker, durationMs) {
  fs.mkdirSync(HEALTH_DIR, { recursive: true });

  const sources = {};
  for (const [sourceName, data] of Object.entries(sourceTracker)) {
    const results = data.modelResults || {};
    const slugs = Object.keys(results);
    const counts = Object.values(results);
    const withResults = counts.filter(c => c > 0).length;
    const withZero = counts.filter(c => c === 0).length;
    const totalResults = counts.reduce((a, b) => a + b, 0);
    const withResultsCounts = counts.filter(c => c > 0);

    // Count errors from the summary models for this source
    let modelsWithErrors = 0;
    for (const m of summary.models) {
      if (m.errors.some(e => e.source.toLowerCase() === sourceName.toLowerCase())) {
        modelsWithErrors++;
      }
    }

    sources[sourceName] = {
      totalResults,
      modelsConfigured: slugs.length,
      modelsWithResults: withResults,
      modelsWithZero: withZero,
      modelsWithErrors,
      avgResultsPerModel: withResultsCounts.length > 0
        ? Math.round((totalResults / withResultsCounts.length) * 10) / 10
        : 0,
    };
  }

  const runStats = {
    date: summary.date,
    durationMs,
    durationFormatted: formatDuration(durationMs),
    modelsProcessed: summary.models.length,
    totalNew: summary.totalNew,
    totalUpdated: summary.totalUpdated,
    totalUnlisted: summary.totalUnlisted,
    totalErrors: summary.totalErrors,
    sources,
  };

  // Write daily run log
  const logFile = path.join(HEALTH_DIR, `${summary.date}.json`);
  fs.writeFileSync(logFile, JSON.stringify(runStats, null, 2), 'utf8');

  // Clean up old run logs
  cleanOldRunLogs();

  return runStats;
}

// ── Baseline ──────────────────────────────────────────────────────────────

/**
 * Update the rolling 7-day baseline with today's results.
 * @param {object} runStats - Today's run stats
 * @param {object} sourceTracker - { sourceName: { modelResults: { slug: count } } }
 * @returns {object} The updated baseline
 */
function updateBaseline(runStats, sourceTracker) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch {
    baseline = { lastUpdated: null, sources: {} };
  }

  const today = runStats.date;

  for (const [sourceName, data] of Object.entries(sourceTracker)) {
    if (!baseline.sources[sourceName]) {
      baseline.sources[sourceName] = { models: {} };
    }
    const sourceBaseline = baseline.sources[sourceName].models;

    for (const [slug, count] of Object.entries(data.modelResults || {})) {
      if (!sourceBaseline[slug]) {
        sourceBaseline[slug] = { avg: 0, lastSeen: null, consecutiveZeros: 0, history: [] };
      }

      const entry = sourceBaseline[slug];

      // Push today's count, maintain max window
      entry.history.push(count);
      if (entry.history.length > MAX_HISTORY_DAYS) {
        entry.history.shift();
      }

      // Recompute rolling average
      const sum = entry.history.reduce((a, b) => a + b, 0);
      entry.avg = Math.round((sum / entry.history.length) * 10) / 10;

      // Track consecutive zeros
      if (count === 0) {
        entry.consecutiveZeros++;
      } else {
        entry.consecutiveZeros = 0;
        entry.lastSeen = today;
      }
    }
  }

  baseline.lastUpdated = today;
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2), 'utf8');

  return baseline;
}

// ── Anomaly Detection ─────────────────────────────────────────────────────

/**
 * Detect anomalies by comparing today's results against the baseline.
 * @param {object} runStats - Today's run stats
 * @param {object} sourceTracker - { sourceName: { modelResults: { slug: count } } }
 * @param {object} baseline - The rolling baseline
 * @returns {Array} Array of { level, source, message, affectedModels }
 */
function detectAnomalies(runStats, sourceTracker, baseline) {
  const anomalies = [];

  if (!baseline?.sources || Object.keys(baseline.sources).length === 0) {
    return anomalies; // No baseline yet
  }

  const criticalSources = new Set();

  for (const [sourceName, data] of Object.entries(sourceTracker)) {
    const sourceBaseline = baseline.sources[sourceName]?.models;
    if (!sourceBaseline) continue;

    const modelResults = data.modelResults || {};
    const configuredCount = Object.keys(modelResults).length;
    if (configuredCount === 0) continue;

    // Count models at zero that had baseline results
    const zeroWithBaseline = [];
    const warningModels = [];
    const infoModels = [];

    for (const [slug, count] of Object.entries(modelResults)) {
      const entry = sourceBaseline[slug];
      if (!entry || entry.history.length < MIN_BASELINE_DAYS) continue;

      if (count === 0 && entry.avg > 0) {
        zeroWithBaseline.push(slug);
      }

      // WARNING: 3+ consecutive zeros, not part of a source-level failure
      if (entry.consecutiveZeros >= 3 && entry.avg > 0) {
        warningModels.push({ slug, consecutiveZeros: entry.consecutiveZeros, lastSeen: entry.lastSeen });
      }

      // INFO: >50% drop from average (only for models with meaningful baseline)
      if (count > 0 && entry.avg >= 2 && count < entry.avg * 0.5) {
        infoModels.push({ slug, today: count, avg: entry.avg });
      }
    }

    // CRITICAL: >30% of configured models at zero with baseline
    const zeroRate = zeroWithBaseline.length / configuredCount;
    if (zeroRate > 0.3 && zeroWithBaseline.length >= 3) {
      criticalSources.add(sourceName);
      const pct = Math.round(zeroRate * 100);
      anomalies.push({
        level: 'CRITICAL',
        source: sourceName,
        message: `${formatSourceName(sourceName)}: ${pct}% of models returned 0 results (${zeroWithBaseline.length}/${configuredCount}) — likely blocked or down`,
        affectedModels: zeroWithBaseline,
      });
    }

    // WARNING: individual model failures (skip if source itself is critical)
    if (!criticalSources.has(sourceName)) {
      for (const w of warningModels) {
        anomalies.push({
          level: 'WARNING',
          source: sourceName,
          message: `${formatSourceName(sourceName)} returning 0 for ${slugToName(w.slug)} for ${w.consecutiveZeros} consecutive days — check search URL. Last seen: ${w.lastSeen || 'never'}`,
          affectedModels: [w.slug],
        });
      }
    }

    // INFO: significant drops
    for (const i of infoModels) {
      const dropPct = Math.round((1 - i.today / i.avg) * 100);
      anomalies.push({
        level: 'INFO',
        source: sourceName,
        message: `${slugToName(i.slug)} down ${dropPct}% on ${formatSourceName(sourceName)} (${i.today} vs ${i.avg} avg)`,
        affectedModels: [i.slug],
      });
    }
  }

  // Sort: CRITICAL first, then WARNING, then INFO
  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  anomalies.sort((a, b) => order[a.level] - order[b.level]);

  return anomalies;
}

// ── Historical Comparisons ────────────────────────────────────────────────

/**
 * Get per-model comparison data (today vs baseline average).
 * @param {object} sourceTracker - { sourceName: { modelResults: { slug: count } } }
 * @param {object} baseline - The rolling baseline
 * @returns {object} { slug: { today, avg } } summed across all sources
 */
function getComparisons(sourceTracker, baseline) {
  const comparisons = {};

  for (const [sourceName, data] of Object.entries(sourceTracker)) {
    const sourceBaseline = baseline?.sources?.[sourceName]?.models || {};

    for (const [slug, count] of Object.entries(data.modelResults || {})) {
      if (!comparisons[slug]) comparisons[slug] = { today: 0, avg: 0 };
      comparisons[slug].today += count;

      const entry = sourceBaseline[slug];
      if (entry) {
        comparisons[slug].avg += entry.avg;
      }
    }
  }

  // Round averages
  for (const c of Object.values(comparisons)) {
    c.avg = Math.round(c.avg * 10) / 10;
  }

  return comparisons;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remainMin = min % 60;
  return `${hr}h ${remainMin}m`;
}

function formatSourceName(name) {
  const names = {
    pistonheads: 'PistonHeads',
    autotrader: 'AutoTrader',
    carsandclassic: 'Cars & Classic',
    collectingcars: 'Collecting Cars',
  };
  return names[name] || name;
}

function slugToName(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function cleanOldRunLogs() {
  try {
    const files = fs.readdirSync(HEALTH_DIR);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_RUN_LOG_AGE_DAYS);

    for (const file of files) {
      if (file === 'baseline.json') continue;
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (match && new Date(match[1]) < cutoff) {
        fs.unlinkSync(path.join(HEALTH_DIR, file));
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

module.exports = {
  collectRunStats,
  updateBaseline,
  detectAnomalies,
  getComparisons,
  formatDuration,
  formatSourceName,
};
