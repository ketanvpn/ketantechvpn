// db/connection.js - singleton SQLite connection
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

function createConnection(filePath, logger) {
  const dbPath = filePath || path.join(process.cwd(), "sellvpn.db");
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      if (logger) logger.error("Kesalahan koneksi SQLite3:", err.message);
    } else {
      if (logger) logger.info(`Terhubung ke SQLite3 (${dbPath})`);
    }
  });
  return db;
}

module.exports = { createConnection };
