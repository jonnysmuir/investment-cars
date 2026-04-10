/**
 * scripts/lib/alert-email.js
 *
 * HTML email template builder for user digest alerts. Mirrors the dark-header
 * styling used by scripts/send-email.js (the scraper-summary email) so the
 * brand stays consistent across emails.
 *
 * The caller passes a `digest` object built by scripts/send-user-alerts.js:
 *
 *   {
 *     frequency: 'daily' | 'weekly' | 'monthly',
 *     dateLabel: '8 April 2026' | '1 April to 8 April 2026' | 'April 2026',
 *     portfolio: {
 *       changes: [ { displayName, year, previousValue, newValue, change, changePercent } ],
 *       totals:  { previous, current, change, changePercent } | null
 *     } | null,
 *     newListings: [
 *       { displayName, filterSummary, count, listings: [ { title, price, source, url } ], listingPageUrl }
 *     ],
 *     priceDrops: [
 *       { displayName, drops: [ { title, oldPrice, newPrice, dropAmount, source, url } ] }
 *     ],
 *     unsubscribeUrl: 'https://collectorly.io/api/alerts/unsubscribe?token=...',
 *     dashboardUrl:   'https://collectorly.io/account/dashboard'
 *   }
 */

const BRAND_GOLD = '#c9a84c';
const BRAND_DARK = '#0a0a0a';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatGBP(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return '£' + Math.round(Number(n)).toLocaleString('en-GB');
}

function formatChange(change, pct) {
  const positive = change >= 0;
  const color = positive ? '#16a34a' : '#dc2626';
  const arrow = positive ? '▲' : '▼';
  const sign = positive ? '+' : '−';
  const absChange = Math.abs(change);
  const absPct = Math.abs(pct);
  return `<span style="color:${color};font-weight:600">${arrow} ${sign}${formatGBP(absChange).replace('£', '£')} (${absPct.toFixed(1)}%)</span>`;
}

function headerTitle(frequency, dateLabel) {
  switch (frequency) {
    case 'daily':   return `Your Daily Market Update — ${esc(dateLabel)}`;
    case 'weekly':  return `Your Weekly Market Update — ${esc(dateLabel)}`;
    case 'monthly': return `Your Monthly Market Update — ${esc(dateLabel)}`;
    default:        return `Your Market Update — ${esc(dateLabel)}`;
  }
}

function subjectLine(frequency, dateLabel) {
  switch (frequency) {
    case 'daily':   return `Your Daily Collectorly Update — ${dateLabel}`;
    case 'weekly':  return `Your Weekly Collectorly Update — ${dateLabel}`;
    case 'monthly': return `Your Monthly Collectorly Update — ${dateLabel}`;
    default:        return `Your Collectorly Update — ${dateLabel}`;
  }
}

// ── Sections ─────────────────────────────────────────────────────────────────

function buildPortfolioSection(p) {
  if (!p || !p.changes || p.changes.length === 0) return '';

  let rows = '';
  for (const c of p.changes) {
    const yearPart = c.year ? `${c.year} ` : '';
    rows += `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:500;color:#111">
        ${esc(yearPart + c.displayName)}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;color:#666">
        ${formatGBP(c.previousValue)} → <span style="color:#111;font-weight:600">${formatGBP(c.newValue)}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">
        ${formatChange(c.change, c.changePercent)}
      </td>
    </tr>`;
  }

  let totalsRow = '';
  if (p.totals && p.totals.current !== null) {
    const direction = p.totals.change >= 0 ? '↑' : '↓';
    const color = p.totals.change >= 0 ? '#16a34a' : '#dc2626';
    const changeAbs = Math.abs(p.totals.change);
    totalsRow = `
    <p style="margin:12px 0 0;font-size:14px;color:#333">
      <strong>Total portfolio:</strong> ${formatGBP(p.totals.current)}
      <span style="color:${color};font-weight:600">(${direction} ${formatGBP(changeAbs)} over this period)</span>
    </p>`;
  }

  return `
  <h2 style="margin:24px 0 8px;font-size:16px;color:${BRAND_DARK};border-bottom:2px solid ${BRAND_GOLD};padding-bottom:6px">
    Portfolio Update
  </h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:4px">
    ${rows}
  </table>
  ${totalsRow}
  `;
}

function buildNewListingsSection(entries) {
  if (!entries || entries.length === 0) return '';

  let html = `
  <h2 style="margin:28px 0 8px;font-size:16px;color:${BRAND_DARK};border-bottom:2px solid ${BRAND_GOLD};padding-bottom:6px">
    New Listings on Your Watchlist
  </h2>`;

  for (const entry of entries) {
    const countLabel = entry.count === 1 ? '1 new listing' : `${entry.count} new listings`;
    html += `
  <div style="margin:16px 0 0">
    <div style="font-size:14px;color:#111;font-weight:600">
      ${esc(entry.displayName)}
      <span style="color:#888;font-weight:400"> · ${esc(entry.filterSummary || 'All variants')}</span>
    </div>
    <div style="font-size:12px;color:#666;margin-bottom:6px">${esc(countLabel)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">`;

    for (const l of entry.listings) {
      html += `
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid #f1f1f1">
          <a href="${esc(l.url)}" style="color:#111;text-decoration:none">${esc(l.title)}</a>
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f1f1;text-align:right;color:#111;font-weight:500;white-space:nowrap">
          ${esc(l.price)}
        </td>
        <td style="padding:6px 0;border-bottom:1px solid #f1f1f1;text-align:right;color:#888;font-size:12px;white-space:nowrap">
          ${esc(l.source)}
        </td>
      </tr>`;
    }
    html += `
    </table>`;

    if (entry.count > entry.listings.length) {
      const more = entry.count - entry.listings.length;
      html += `
    <div style="margin-top:6px;font-size:12px">
      <a href="${esc(entry.listingPageUrl)}" style="color:${BRAND_GOLD};text-decoration:none">
        and ${more} more — view all →
      </a>
    </div>`;
    }
    html += `
  </div>`;
  }

  return html;
}

function buildPriceDropsSection(entries) {
  if (!entries || entries.length === 0) return '';

  let html = `
  <h2 style="margin:28px 0 8px;font-size:16px;color:${BRAND_DARK};border-bottom:2px solid ${BRAND_GOLD};padding-bottom:6px">
    Price Drops
  </h2>`;

  for (const entry of entries) {
    html += `
  <div style="margin:16px 0 0">
    <div style="font-size:14px;color:#111;font-weight:600;margin-bottom:6px">
      ${esc(entry.displayName)}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">`;
    for (const d of entry.drops) {
      html += `
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid #f1f1f1">
          <a href="${esc(d.url)}" style="color:#111;text-decoration:none">${esc(d.title)}</a>
        </td>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f1f1;text-align:right;color:#666;white-space:nowrap">
          <span style="text-decoration:line-through">${formatGBP(d.oldPrice)}</span> →
          <span style="color:#111;font-weight:600">${formatGBP(d.newPrice)}</span>
        </td>
        <td style="padding:6px 0;border-bottom:1px solid #f1f1f1;text-align:right;color:#16a34a;font-weight:600;white-space:nowrap">
          − ${formatGBP(d.dropAmount)}
        </td>
      </tr>`;
    }
    html += `
    </table>
  </div>`;
  }

  return html;
}

// ── Main template ────────────────────────────────────────────────────────────

function buildDigestEmail(digest) {
  const portfolioSection = buildPortfolioSection(digest.portfolio);
  const listingsSection  = buildNewListingsSection(digest.newListings);
  const dropsSection     = buildPriceDropsSection(digest.priceDrops);

  const unsubscribeLink = digest.unsubscribeUrl
    ? `<a href="${esc(digest.unsubscribeUrl)}" style="color:#888">Unsubscribe</a>`
    : '';
  const manageLink = digest.dashboardUrl
    ? `<a href="${esc(digest.dashboardUrl)}" style="color:#888">Manage your alerts</a>`
    : '';
  const separator = unsubscribeLink && manageLink ? ' · ' : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f4f4">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:24px auto;color:#333">

  <div style="background:${BRAND_DARK};color:${BRAND_GOLD};padding:18px 24px;border-radius:8px 8px 0 0">
    <div style="font-size:18px;letter-spacing:0.15em;font-weight:700">COLLECTORLY</div>
    <div style="font-size:13px;color:#c9a84c;opacity:0.9;margin-top:4px">${headerTitle(digest.frequency, digest.dateLabel)}</div>
  </div>

  <div style="padding:24px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">
    ${portfolioSection}
    ${listingsSection}
    ${dropsSection}
  </div>

  <p style="font-size:12px;color:#888;text-align:center;margin:16px 12px;line-height:1.6">
    ${manageLink}${separator}${unsubscribeLink}<br>
    © ${new Date().getFullYear()} Collectorly
  </p>
</div>
</body></html>`;
}

function buildPlainText(digest) {
  const lines = [];
  lines.push(headerTitle(digest.frequency, digest.dateLabel).replace(/<[^>]+>/g, ''));
  lines.push('');

  if (digest.portfolio && digest.portfolio.changes.length > 0) {
    lines.push('PORTFOLIO UPDATE');
    for (const c of digest.portfolio.changes) {
      const yearPart = c.year ? `${c.year} ` : '';
      const sign = c.change >= 0 ? '+' : '-';
      lines.push(`  ${yearPart}${c.displayName}: ${formatGBP(c.previousValue)} -> ${formatGBP(c.newValue)} (${sign}${formatGBP(Math.abs(c.change))}, ${c.changePercent.toFixed(1)}%)`);
    }
    if (digest.portfolio.totals) {
      const t = digest.portfolio.totals;
      const dir = t.change >= 0 ? 'up' : 'down';
      lines.push(`  Total portfolio: ${formatGBP(t.current)} (${dir} ${formatGBP(Math.abs(t.change))})`);
    }
    lines.push('');
  }

  if (digest.newListings.length > 0) {
    lines.push('NEW LISTINGS ON YOUR WATCHLIST');
    for (const entry of digest.newListings) {
      lines.push(`  ${entry.displayName} · ${entry.filterSummary}  (${entry.count} new)`);
      for (const l of entry.listings) {
        lines.push(`    - ${l.title} — ${l.price} (${l.source})`);
      }
      if (entry.count > entry.listings.length) {
        lines.push(`    ... and ${entry.count - entry.listings.length} more — ${entry.listingPageUrl}`);
      }
    }
    lines.push('');
  }

  if (digest.priceDrops.length > 0) {
    lines.push('PRICE DROPS');
    for (const entry of digest.priceDrops) {
      lines.push(`  ${entry.displayName}`);
      for (const d of entry.drops) {
        lines.push(`    - ${d.title}: ${formatGBP(d.oldPrice)} -> ${formatGBP(d.newPrice)} (-${formatGBP(d.dropAmount)}) [${d.source}]`);
      }
    }
    lines.push('');
  }

  if (digest.unsubscribeUrl) {
    lines.push('');
    lines.push(`Unsubscribe: ${digest.unsubscribeUrl}`);
    lines.push(`Manage alerts: ${digest.dashboardUrl}`);
  }

  return lines.join('\n');
}

module.exports = {
  buildDigestEmail,
  buildPlainText,
  subjectLine,
};
