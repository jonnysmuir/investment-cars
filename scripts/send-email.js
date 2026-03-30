#!/usr/bin/env node
/**
 * Send email notification with the refresh summary.
 *
 * Reads structured data from scripts/email-data.json (written by refresh.js)
 * and generates a sectioned HTML email with health status, anomaly alerts,
 * and listing changes.
 *
 * Uses nodemailer with Gmail SMTP.
 * Requires GMAIL_USER and GMAIL_APP_PASSWORD secrets in GitHub Actions.
 *
 * Usage:
 *   node scripts/send-email.js
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { formatSourceName, formatDuration } = require('./health');

const RECIPIENT = 'jonny.s.muir@gmail.com';
const EMAIL_DATA_FILE = path.join(__dirname, 'email-data.json');
const SUMMARY_FILE = path.join(__dirname, 'summary.md');

async function main() {
  // Read structured email data
  let data;
  try {
    data = JSON.parse(fs.readFileSync(EMAIL_DATA_FILE, 'utf8'));
  } catch {
    console.log('No email-data.json found, skipping email.');
    return;
  }

  // Don't send if no changes and no anomalies
  const anomalies = data.health?.anomalies || [];
  const hasCritical = anomalies.some(a => a.level === 'CRITICAL');
  const hasWarning = anomalies.some(a => a.level === 'WARNING');

  if (!data.hasChanges && anomalies.length === 0) {
    console.log('No changes or anomalies, skipping email.');
    return;
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    console.warn('GMAIL_USER or GMAIL_APP_PASSWORD not set. Skipping email notification.');
    // Print summary to console
    try { console.log(fs.readFileSync(SUMMARY_FILE, 'utf8')); } catch {}
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  // Build subject line
  let subjectPrefix = '';
  if (hasCritical) subjectPrefix = '[CRITICAL] ';
  else if (hasWarning) subjectPrefix = '[WARNING] ';
  const subject = `${subjectPrefix}Collectorly Refresh — ${data.date}`;

  // Build HTML email
  const html = buildEmailHtml(data);

  // Plain text fallback
  let plainText = '';
  try { plainText = fs.readFileSync(SUMMARY_FILE, 'utf8'); } catch {}

  try {
    await transporter.sendMail({
      from: `"Collectorly Bot" <${gmailUser}>`,
      to: RECIPIENT,
      subject,
      text: plainText,
      html,
    });
    console.log(`Email sent to ${RECIPIENT}`);
  } catch (err) {
    console.error(`Failed to send email: ${err.message}`);
  }
}

// ── HTML Email Builder ───────────────────────────────────────────────────

function buildEmailHtml(data) {
  const h = data.health || {};
  const anomalies = h.anomalies || [];
  const runStats = h.runStats || {};
  const comparisons = h.comparisons || {};
  const duration = h.durationMs ? formatDuration(h.durationMs) : '';

  const hasCritical = anomalies.some(a => a.level === 'CRITICAL');
  const hasWarning = anomalies.some(a => a.level === 'WARNING');
  const hasBaseline = Object.keys(comparisons).length > 0 && Object.values(comparisons).some(c => c.avg > 0);

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;color:#333">
  <!-- Header -->
  <div style="background:#0a0a0a;color:#c9a84c;padding:16px 24px;border-radius:8px 8px 0 0">
    <h1 style="margin:0;font-size:18px;letter-spacing:0.1em">COLLECTORLY</h1>
  </div>

  <!-- Section 1: Status Banner -->
  ${buildStatusBanner(anomalies, duration)}

  <div style="padding:20px 24px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">

    <!-- Section 2: Source Health Table -->
    ${buildSourceHealthTable(runStats)}

    <!-- Section 3: Anomalies -->
    ${buildAnomaliesSection(anomalies)}

    <!-- Section 4: Summary Stats -->
    ${buildSummaryStats(data, comparisons, hasBaseline)}

    <!-- Section 5: Detailed Changes -->
    ${buildDetailedChanges(data)}

  </div>

  <p style="font-size:12px;color:#888;text-align:center;margin-top:12px">
    Automated listing refresh — <a href="https://github.com/jonnysmuir/investment-cars" style="color:#888">GitHub</a>
  </p>
</div>`;
}

// ── Section 1: Status Banner ─────────────────────────────────────────────

function buildStatusBanner(anomalies, duration) {
  const criticals = anomalies.filter(a => a.level === 'CRITICAL');
  const warnings = anomalies.filter(a => a.level === 'WARNING');

  let bgColor, text;
  if (criticals.length > 0) {
    bgColor = '#ef4444';
    const totalAffected = criticals.reduce((sum, a) => sum + a.affectedModels.length, 0);
    text = `CRITICAL: ${criticals.length} source issue${criticals.length > 1 ? 's' : ''} — ${totalAffected} models affected`;
  } else if (warnings.length > 0) {
    bgColor = '#f59e0b';
    text = `WARNING: ${warnings.length} issue${warnings.length > 1 ? 's' : ''} detected`;
  } else if (anomalies.length === 0 && !duration) {
    // No health data yet (first run)
    bgColor = '#6b7280';
    text = 'Baseline collecting — anomaly detection activates after 3 days';
  } else {
    bgColor = '#22c55e';
    text = 'ALL SYSTEMS HEALTHY';
  }

  const durationHtml = duration
    ? `<span style="float:right;font-size:13px;opacity:0.9">${duration}</span>`
    : '';

  return `
  <div style="background:${bgColor};color:#fff;padding:12px 24px;font-size:15px;font-weight:600">
    ${esc(text)}${durationHtml}
  </div>`;
}

// ── Section 2: Source Health Table ────────────────────────────────────────

function buildSourceHealthTable(runStats) {
  const sources = runStats?.sources;
  if (!sources || Object.keys(sources).length === 0) return '';

  let rows = '';
  for (const [name, stats] of Object.entries(sources)) {
    const ok = stats.modelsWithResults;
    const total = stats.modelsConfigured;
    const degraded = stats.modelsWithZero > total * 0.3;
    const statusDot = degraded
      ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;margin-right:4px"></span>'
      : '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:4px"></span>';
    const statusText = degraded ? 'Degraded' : 'Healthy';

    rows += `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-weight:500">${esc(formatSourceName(name))}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${ok}/${total}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${stats.modelsWithZero}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${stats.modelsWithErrors}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0">${statusDot}${statusText}</td>
    </tr>`;
  }

  return `
  <h3 style="margin:16px 0 8px;font-size:14px;color:#666;text-transform:uppercase;letter-spacing:0.05em">Source Health</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
    <tr style="background:#f8f8f8">
      <th style="padding:6px 12px;text-align:left;font-weight:600;font-size:12px;color:#666">Source</th>
      <th style="padding:6px 12px;text-align:center;font-weight:600;font-size:12px;color:#666">Models OK</th>
      <th style="padding:6px 12px;text-align:center;font-weight:600;font-size:12px;color:#666">Zero</th>
      <th style="padding:6px 12px;text-align:center;font-weight:600;font-size:12px;color:#666">Errors</th>
      <th style="padding:6px 12px;text-align:left;font-weight:600;font-size:12px;color:#666">Status</th>
    </tr>
    ${rows}
  </table>`;
}

// ── Section 3: Anomalies ─────────────────────────────────────────────────

function buildAnomaliesSection(anomalies) {
  if (anomalies.length === 0) return '';

  const criticals = anomalies.filter(a => a.level === 'CRITICAL');
  const warnings = anomalies.filter(a => a.level === 'WARNING');
  const infos = anomalies.filter(a => a.level === 'INFO');

  let html = '<h3 style="margin:16px 0 8px;font-size:14px;color:#666;text-transform:uppercase;letter-spacing:0.05em">Alerts</h3>';

  for (const a of criticals) {
    html += buildAnomalyCard('#ef4444', a);
  }
  for (const a of warnings) {
    html += buildAnomalyCard('#f59e0b', a);
  }
  // Only show first 5 INFO alerts to avoid noise
  for (const a of infos.slice(0, 5)) {
    html += buildAnomalyCard('#3b82f6', a);
  }
  if (infos.length > 5) {
    html += `<p style="font-size:12px;color:#888;margin:4px 0 16px">+ ${infos.length - 5} more info alerts</p>`;
  }

  return html;
}

function buildAnomalyCard(borderColor, anomaly) {
  let models = '';
  if (anomaly.affectedModels && anomaly.affectedModels.length > 0) {
    const shown = anomaly.affectedModels.slice(0, 3).join(', ');
    const more = anomaly.affectedModels.length > 3 ? ` + ${anomaly.affectedModels.length - 3} more` : '';
    models = `<div style="font-size:11px;color:#888;margin-top:4px">${esc(shown)}${more}</div>`;
  }

  return `
  <div style="border-left:4px solid ${borderColor};padding:8px 12px;margin:8px 0;background:#fafafa;border-radius:0 4px 4px 0">
    <div style="font-size:13px;color:#333">${esc(anomaly.message)}</div>
    ${models}
  </div>`;
}

// ── Section 4: Summary Stats ─────────────────────────────────────────────

function buildSummaryStats(data, comparisons, hasBaseline) {
  // Compute aggregate comparison
  let avgNew = '';
  if (hasBaseline) {
    const totalAvg = Object.values(comparisons).reduce((sum, c) => sum + c.avg, 0);
    if (totalAvg > 0) {
      avgNew = ` <span style="font-size:12px;color:#888">(vs ${Math.round(totalAvg)} avg)</span>`;
    }
  }

  const stats = [
    { label: 'New Listings', value: data.totalNew, extra: avgNew, color: '#22c55e' },
    { label: 'Price Changes', value: data.totalUpdated, extra: '', color: '#3b82f6' },
    { label: 'No Longer Listed', value: data.totalUnlisted, extra: '', color: '#f59e0b' },
    { label: 'Errors', value: data.totalErrors, extra: '', color: data.totalErrors > 0 ? '#ef4444' : '#888' },
  ];

  let cells = '';
  for (const s of stats) {
    cells += `
    <td style="padding:12px;text-align:center;width:25%">
      <div style="font-size:24px;font-weight:700;color:${s.color}">${s.value}${s.extra}</div>
      <div style="font-size:11px;color:#888;margin-top:2px">${s.label}</div>
    </td>`;
  }

  return `
  <h3 style="margin:16px 0 8px;font-size:14px;color:#666;text-transform:uppercase;letter-spacing:0.05em">Summary</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tr>${cells}</tr>
  </table>`;
}

// ── Section 5: Detailed Changes ──────────────────────────────────────────

function buildDetailedChanges(data) {
  const activeModels = (data.models || []).filter(m =>
    m.newCount > 0 || m.updatedCount > 0 || m.unlistedCount > 0 || m.errors.length > 0
  );

  if (activeModels.length === 0) return '';

  let html = '<h3 style="margin:16px 0 8px;font-size:14px;color:#666;text-transform:uppercase;letter-spacing:0.05em">Changes by Model</h3>';

  for (const m of activeModels) {
    html += `<div style="margin:12px 0;padding:8px 0;border-bottom:1px solid #f0f0f0">`;
    html += `<div style="font-weight:600;font-size:14px;margin-bottom:6px">${esc(m.make)} ${esc(m.model)}`;
    html += `<span style="font-size:12px;font-weight:400;color:#888;margin-left:8px">`;
    const parts = [];
    if (m.newCount > 0) parts.push(`${m.newCount} new`);
    if (m.updatedCount > 0) parts.push(`${m.updatedCount} updated`);
    if (m.unlistedCount > 0) parts.push(`${m.unlistedCount} unlisted`);
    html += parts.join(' · ');
    html += `</span></div>`;

    // New listings
    if (m.newListings && m.newListings.length > 0) {
      for (const l of m.newListings.slice(0, 5)) {
        html += `<div style="font-size:12px;color:#555;padding:1px 0">+ ${esc(l.title)} <span style="color:#888">(${esc(l.source)})</span></div>`;
      }
      if (m.newListings.length > 5) {
        html += `<div style="font-size:11px;color:#888">+ ${m.newListings.length - 5} more new listings</div>`;
      }
    }

    // Price changes
    if (m.priceChanges && m.priceChanges.length > 0) {
      for (const p of m.priceChanges.slice(0, 5)) {
        const arrow = p.direction === 'reduced' ? '↓' : '↑';
        const color = p.direction === 'reduced' ? '#22c55e' : '#ef4444';
        html += `<div style="font-size:12px;color:#555;padding:1px 0"><span style="color:${color}">${arrow}</span> ${esc(p.title)}: ${esc(p.oldPrice)} → ${esc(p.newPrice)}</div>`;
      }
      if (m.priceChanges.length > 5) {
        html += `<div style="font-size:11px;color:#888">+ ${m.priceChanges.length - 5} more price changes</div>`;
      }
    }

    // Unlisted
    if (m.unlistedListings && m.unlistedListings.length > 0) {
      for (const l of m.unlistedListings.slice(0, 3)) {
        html += `<div style="font-size:12px;color:#888;padding:1px 0">- ${esc(l.title)}</div>`;
      }
      if (m.unlistedListings.length > 3) {
        html += `<div style="font-size:11px;color:#888">+ ${m.unlistedListings.length - 3} more unlisted</div>`;
      }
    }

    // Errors
    if (m.errors && m.errors.length > 0) {
      for (const e of m.errors) {
        html += `<div style="font-size:12px;color:#ef4444;padding:1px 0">Error: ${esc(e.source)} — ${esc(e.error)}</div>`;
      }
    }

    html += `</div>`;
  }

  // Note about inactive models
  const inactiveCount = (data.models || []).length - activeModels.length;
  if (inactiveCount > 0) {
    html += `<p style="font-size:12px;color:#888;margin-top:8px">${inactiveCount} models with no changes omitted.</p>`;
  }

  return html;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main();
