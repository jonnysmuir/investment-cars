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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      user_id             VARCHAR(36) NOT NULL,
      model_slug          VARCHAR(100) NOT NULL,
      filters             JSON NULL,
      notify_new_listings BOOLEAN DEFAULT TRUE,
      notify_price_drops  BOOLEAN DEFAULT TRUE,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_user_slug (user_id, model_slug),
      INDEX idx_slug (model_slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('watchlist table ready.');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS favourites (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      user_id       VARCHAR(36) NOT NULL,
      model_slug    VARCHAR(100) NOT NULL,
      listing_id    VARCHAR(50) NOT NULL,
      source_url    VARCHAR(500),
      title         VARCHAR(500),
      price_at_save VARCHAR(50),
      image_url     VARCHAR(500),
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_user_listing (user_id, model_slug, listing_id),
      INDEX idx_user (user_id),
      INDEX idx_slug (model_slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('favourites table ready.');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      user_id         VARCHAR(36) NOT NULL,
      model_slug      VARCHAR(100) NOT NULL,
      year            INT NULL,
      variant         VARCHAR(200) NULL,
      generation      VARCHAR(50) NULL,
      transmission    VARCHAR(50) NULL,
      body_type       VARCHAR(50) NULL,
      purchase_price  INT NULL,
      purchase_date   DATE NULL,
      mileage_at_purchase INT NULL,
      current_mileage INT NULL,
      colour          VARCHAR(100) NULL,
      notes           TEXT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_slug (model_slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('portfolio table ready.');
  await pool.end();
}

setup().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
