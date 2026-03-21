/**
 * db/connection.js
 *
 * MySQL connection pool using mysql2/promise.
 * Pool handles reconnection automatically — if a connection drops,
 * the pool creates a new one on the next query.
 */

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  // Reconnect idle connections after 10 minutes
  idleTimeout: 600000,
  // Don't let queries hang forever
  connectTimeout: 10000,
});

module.exports = pool;
