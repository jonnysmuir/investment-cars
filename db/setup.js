#!/usr/bin/env node
/**
 * db/setup.js
 *
 * Creates the click_events table if it doesn't exist.
 * Run once to initialise the database:
 *
 *   node db/setup.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const pool = require('./connection');

async function setup() {
  console.log('Connecting to database...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS click_events (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      clicked_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      session_id      VARCHAR(36),
      car_make        VARCHAR(100),
      car_model       VARCHAR(100),
      car_year        SMALLINT NULL,
      car_price       INT NULL,
      destination_platform VARCHAR(50),
      destination_url TEXT,
      source_page     VARCHAR(255),
      referrer        VARCHAR(500) NULL,

      INDEX idx_platform (destination_platform),
      INDEX idx_make (car_make),
      INDEX idx_clicked (clicked_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('click_events table ready.');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              VARCHAR(36) PRIMARY KEY,
      email           VARCHAR(255) NOT NULL,
      display_name    VARCHAR(100) NULL,
      avatar_url      VARCHAR(500) NULL,
      auth_provider   VARCHAR(20) DEFAULT 'email',
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      alert_frequency ENUM('instant', 'daily', 'weekly') DEFAULT 'daily',
      alerts_enabled  BOOLEAN DEFAULT TRUE,
      INDEX idx_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('users table ready.');
  await pool.end();
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
