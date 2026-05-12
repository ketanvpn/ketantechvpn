// db/ddl-safe.js - helper DDL aman (whitelist identifier)

const SQL_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isSafeSqlIdent(name) {
  return typeof name === "string" && SQL_IDENT_RE.test(name);
}

function isSafeSqlIdentList(csv) {
  if (typeof csv !== "string") return false;
  return csv.split(",").every((part) => isSafeSqlIdent(part.trim()));
}

function createDdlHelpers(db, logger) {
  const log = logger || console;

  function ensureSqliteColumn(tableName, columnName, columnType) {
    if (!tableName || !columnName || !columnType) return;
    if (!isSafeSqlIdent(tableName) || !isSafeSqlIdent(columnName)) {
      log.warn(`ensureSqliteColumn: identifier tidak valid (${tableName}.${columnName})`);
      return;
    }

    db.all(`PRAGMA table_info(${tableName})`, [], (err, rows) => {
      if (err) {
        log.warn(`Gagal cek kolom ${tableName}.${columnName}: ${err.message}`);
        return;
      }

      const exists = Array.isArray(rows) && rows.some((row) => row && row.name === columnName);
      if (exists) return;

      db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`, (alterErr) => {
        if (alterErr) {
          const msg = String(alterErr.message || "");
          if (!msg.includes("duplicate column name")) {
            log.warn(`Gagal menambah kolom ${tableName}.${columnName}: ${msg}`);
          }
          return;
        }
        log.info(`Kolom SQLite ditambahkan: ${tableName}.${columnName} (${columnType})`);
      });
    });
  }

  function createUniqueIndexIfSafe(indexName, tableName, columnName, whereClause = "") {
    if (!indexName || !tableName || !columnName) return;
    if (!isSafeSqlIdent(indexName) || !isSafeSqlIdent(tableName) || !isSafeSqlIdent(columnName)) {
      log.warn(`createUniqueIndexIfSafe: identifier tidak valid (${indexName}/${tableName}/${columnName})`);
      return;
    }

    const whereSql = whereClause ? ` WHERE ${whereClause}` : "";
    const duplicateQuery = `
      SELECT ${columnName} AS value, COUNT(*) AS cnt
      FROM ${tableName}
      ${whereSql}
      GROUP BY ${columnName}
      HAVING COUNT(*) > 1
      LIMIT 1
    `;

    db.get(duplicateQuery, [], (dupErr, row) => {
      if (dupErr) {
        log.warn(`Gagal cek duplikat untuk index ${indexName}: ${dupErr.message}`);
        return;
      }
      if (row) {
        log.warn(`Index unik ${indexName} dilewati karena masih ada data duplikat di ${tableName}.${columnName}`);
        return;
      }
      db.run(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnName})${whereSql}`, (indexErr) => {
        if (indexErr) {
          log.warn(`Gagal membuat unique index ${indexName}: ${indexErr.message}`);
          return;
        }
        log.info(`Unique index siap: ${indexName}`);
      });
    });
  }

  function createUniqueIndexMultiIfSafe(indexName, tableName, columns) {
    if (!indexName || !tableName || !columns) return;
    if (!isSafeSqlIdent(indexName) || !isSafeSqlIdent(tableName) || !isSafeSqlIdentList(columns)) {
      log.warn(`createUniqueIndexMultiIfSafe: identifier tidak valid (${indexName}/${tableName}/${columns})`);
      return;
    }

    const duplicateQuery = `
      SELECT ${columns}, COUNT(*) AS cnt
      FROM ${tableName}
      GROUP BY ${columns}
      HAVING COUNT(*) > 1
      LIMIT 1
    `;

    db.get(duplicateQuery, [], (dupErr, row) => {
      if (dupErr) {
        log.warn(`Gagal cek duplikat untuk index ${indexName}: ${dupErr.message}`);
        return;
      }
      if (row) {
        log.warn(`Index unik ${indexName} dilewati karena masih ada data duplikat di ${tableName}(${columns})`);
        return;
      }
      db.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columns})`,
        (indexErr) => {
          if (indexErr) {
            log.warn(`Gagal membuat unique index ${indexName}: ${indexErr.message}`);
            return;
          }
          log.info(`Unique index siap: ${indexName}`);
        }
      );
    });
  }

  return {
    ensureSqliteColumn,
    createUniqueIndexIfSafe,
    createUniqueIndexMultiIfSafe,
  };
}

module.exports = { isSafeSqlIdent, isSafeSqlIdentList, createDdlHelpers };
