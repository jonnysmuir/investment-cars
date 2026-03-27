/**
 * routes/admin.js
 *
 * GET /admin/stats     — JSON click analytics
 * GET /admin/dashboard — HTML dashboard displaying the stats
 */

const express = require('express');
const pool = require('../db/connection');

const router = express.Router();

// ── GET /admin/stats — JSON response with click analytics ────────────────────
router.get('/stats', async (req, res) => {
  try {
    // Total clicks (all time)
    const [[{ total_all_time }]] = await pool.execute(
      'SELECT COUNT(*) AS total_all_time FROM click_events'
    );

    // Total clicks (last 30 days)
    const [[{ total_30d }]] = await pool.execute(
      'SELECT COUNT(*) AS total_30d FROM click_events WHERE clicked_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );

    // Clicks grouped by destination platform (last 30 days)
    const [byPlatform] = await pool.execute(
      `SELECT destination_platform AS platform, COUNT(*) AS clicks
       FROM click_events
       WHERE clicked_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY destination_platform
       ORDER BY clicks DESC`
    );

    // Top 10 most-clicked car models (last 30 days)
    const [topModels] = await pool.execute(
      `SELECT car_make AS make, car_model AS model, COUNT(*) AS clicks
       FROM click_events
       WHERE clicked_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         AND car_make IS NOT NULL
       GROUP BY car_make, car_model
       ORDER BY clicks DESC
       LIMIT 10`
    );

    // Clicks by day for the last 30 days
    const [byDay] = await pool.execute(
      `SELECT DATE(clicked_at) AS date, COUNT(*) AS clicks
       FROM click_events
       WHERE clicked_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(clicked_at)
       ORDER BY date ASC`
    );

    res.json({
      total_all_time,
      total_30d,
      byPlatform,
      topModels,
      byDay,
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

// ── GET /admin/dashboard — HTML page ─────────────────────────────────────────
router.get('/dashboard', (req, res) => {
  res.send(dashboardHTML);
});

const dashboardHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Click Tracking Dashboard — Collectorly</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e4e4e7;
      padding: 2rem;
      line-height: 1.6;
    }
    h1 { color: #c9a84c; margin-bottom: 0.25rem; font-size: 1.5rem; }
    .subtitle { color: #71717a; margin-bottom: 2rem; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .card {
      background: #1a1b23;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 1.5rem;
    }
    .card h2 { color: #c9a84c; font-size: 1rem; margin-bottom: 1rem; font-weight: 600; }
    .big-number { font-size: 2.5rem; font-weight: 700; color: #fff; }
    .big-label { color: #71717a; font-size: 0.85rem; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; color: #71717a; font-size: 0.8rem; font-weight: 500; padding: 0.5rem 0; border-bottom: 1px solid #27272a; }
    td { padding: 0.5rem 0; border-bottom: 1px solid #1e1e24; font-size: 0.9rem; }
    td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .bar-cell { display: flex; align-items: center; gap: 0.75rem; }
    .bar { height: 6px; background: #c9a84c; border-radius: 3px; min-width: 4px; }
    .loading { color: #71717a; padding: 2rem; text-align: center; }
    .error { color: #ef4444; }
    .chart-area {
      width: 100%;
      height: 180px;
      display: flex;
      align-items: flex-end;
      gap: 2px;
      padding-top: 1rem;
    }
    .chart-bar {
      flex: 1;
      background: #c9a84c;
      border-radius: 2px 2px 0 0;
      min-height: 2px;
      position: relative;
    }
    .chart-bar:hover { opacity: 0.8; }
    .chart-bar .tooltip {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: #27272a;
      color: #e4e4e7;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      white-space: nowrap;
      margin-bottom: 4px;
    }
    .chart-bar:hover .tooltip { display: block; }
  </style>
</head>
<body>
  <h1>Click Tracking Dashboard</h1>
  <p class="subtitle">Outbound click analytics for partnership data</p>

  <div id="content" class="loading">Loading stats...</div>

  <script>
    async function load() {
      const el = document.getElementById('content');
      try {
        const res = await fetch('/admin/stats');
        if (!res.ok) throw new Error('Failed to fetch stats');
        const data = await res.json();
        render(data, el);
      } catch (err) {
        el.innerHTML = '<p class="error">Failed to load stats: ' + err.message + '</p>';
      }
    }

    function render(data, el) {
      const maxPlatform = Math.max(...data.byPlatform.map(p => p.clicks), 1);
      const maxDay = Math.max(...data.byDay.map(d => d.clicks), 1);

      el.className = '';
      el.innerHTML = \`
        <div class="grid">
          <div class="card">
            <h2>Total Clicks</h2>
            <div class="big-number">\${data.total_30d.toLocaleString()}</div>
            <div class="big-label">Last 30 days</div>
            <div style="margin-top:0.75rem;color:#71717a;font-size:0.9rem;">
              \${data.total_all_time.toLocaleString()} all time
            </div>
          </div>

          <div class="card">
            <h2>By Platform (30d)</h2>
            <table>
              <thead><tr><th>Platform</th><th>Clicks</th></tr></thead>
              <tbody>
                \${data.byPlatform.map(p => \`
                  <tr>
                    <td>
                      <div class="bar-cell">
                        <div class="bar" style="width:\${Math.round(p.clicks/maxPlatform*100)}px"></div>
                        \${p.platform}
                      </div>
                    </td>
                    <td>\${p.clicks.toLocaleString()}</td>
                  </tr>
                \`).join('')}
                \${data.byPlatform.length === 0 ? '<tr><td colspan="2" style="color:#71717a">No data yet</td></tr>' : ''}
              </tbody>
            </table>
          </div>

          <div class="card">
            <h2>Top Models (30d)</h2>
            <table>
              <thead><tr><th>Car</th><th>Clicks</th></tr></thead>
              <tbody>
                \${data.topModels.map(m => \`
                  <tr><td>\${m.make} \${m.model}</td><td>\${m.clicks.toLocaleString()}</td></tr>
                \`).join('')}
                \${data.topModels.length === 0 ? '<tr><td colspan="2" style="color:#71717a">No data yet</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h2>Daily Clicks (Last 30 Days)</h2>
          <div class="chart-area">
            \${data.byDay.map(d => \`
              <div class="chart-bar" style="height:\${Math.max(Math.round(d.clicks/maxDay*160), 2)}px">
                <div class="tooltip">\${d.date}: \${d.clicks} clicks</div>
              </div>
            \`).join('')}
            \${data.byDay.length === 0 ? '<div style="color:#71717a;width:100%;text-align:center;padding:2rem">No data yet</div>' : ''}
          </div>
        </div>
      \`;
    }

    load();
  </script>
</body>
</html>`;

module.exports = router;
