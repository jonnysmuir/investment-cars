#!/usr/bin/env node
/**
 * Send email notification with the refresh summary.
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

const RECIPIENT = 'jonny.s.muir@gmail.com';
const SUMMARY_FILE = path.join(__dirname, 'summary.md');

async function main() {
  // Check if there's a summary to send
  if (!fs.existsSync(SUMMARY_FILE)) {
    console.log('No summary file found, skipping email.');
    return;
  }

  const summaryMd = fs.readFileSync(SUMMARY_FILE, 'utf8');

  // Don't send if no changes
  if (summaryMd.includes('No changes detected')) {
    console.log('No changes detected, skipping email.');
    return;
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    console.warn('GMAIL_USER or GMAIL_APP_PASSWORD not set. Skipping email notification.');
    console.log('Summary:\n', summaryMd);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  });

  const today = new Date().toISOString().split('T')[0];

  // Convert markdown summary to simple HTML
  const htmlBody = summaryMd
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^\*\*(.+?)\*\*$/gm, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      return '<tr>' + cells.map(c => `<td style="padding:4px 12px;border:1px solid #ddd">${c.trim()}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, '<table style="border-collapse:collapse;margin:12px 0">$&</table>')
    .replace(/\n/g, '<br>');

  try {
    await transporter.sendMail({
      from: `"Collectorly Bot" <${gmailUser}>`,
      to: RECIPIENT,
      subject: `Collectorly Refresh — ${today}`,
      text: summaryMd,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#333">
          <div style="background:#0a0a0a;color:#c9a84c;padding:16px 24px;border-radius:8px 8px 0 0">
            <h1 style="margin:0;font-size:18px;letter-spacing:0.1em">COLLECTORLY</h1>
          </div>
          <div style="padding:20px 24px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">
            ${htmlBody}
          </div>
          <p style="font-size:12px;color:#888;text-align:center;margin-top:12px">
            Automated listing refresh — <a href="https://github.com/jonnysmuir/investment-cars">GitHub</a>
          </p>
        </div>
      `,
    });

    console.log(`Email sent to ${RECIPIENT}`);
  } catch (err) {
    console.error(`Failed to send email: ${err.message}`);
    // Don't fail the workflow over email issues
  }
}

main();
