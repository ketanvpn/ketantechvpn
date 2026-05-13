// db/migrations.js - jalankan semua schema setup di startup
// Menerima db, logger, dan helpers dari db/ddl-safe.

function runMigrations(db, logger, helpers) {
  const { ensureSqliteColumn, createUniqueIndexIfSafe, createUniqueIndexMultiIfSafe } = helpers;

  // ============================================================================
  // PAYMENT TABLES: pending_deposits, qris_payments
  // ============================================================================
  db.run(`CREATE TABLE IF NOT EXISTS pending_deposits (
    unique_code TEXT PRIMARY KEY,
    user_id INTEGER,
    amount INTEGER,
    original_amount INTEGER,
    timestamp INTEGER,
    status TEXT,
    qr_message_id INTEGER
  )`, (err) => {
    if (err) logger.error('Kesalahan membuat tabel pending_deposits:', err.message);
  });

  db.run(`CREATE TABLE IF NOT EXISTS qris_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    invoice_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    base_amount INTEGER NOT NULL,
    unique_suffix INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    paid_at INTEGER,
    matched_at INTEGER,
    provider_tx_id TEXT,
    provider_tx_time TEXT,
    provider_payment_type TEXT,
    provider_issuer TEXT,
    provider_status TEXT,
    provider_payload_json TEXT
  )`, (err) => {
    if (err) logger.error('Kesalahan membuat tabel qris_payments:', err.message);
  });

  ensureSqliteColumn('qris_payments', 'matched_at', 'INTEGER');
  ensureSqliteColumn('qris_payments', 'provider_tx_id', 'TEXT');
  ensureSqliteColumn('qris_payments', 'provider_tx_time', 'TEXT');
  ensureSqliteColumn('qris_payments', 'provider_payment_type', 'TEXT');
  ensureSqliteColumn('qris_payments', 'provider_issuer', 'TEXT');
  ensureSqliteColumn('qris_payments', 'provider_status', 'TEXT');
  ensureSqliteColumn('qris_payments', 'provider_payload_json', 'TEXT');
  createUniqueIndexIfSafe('idx_qris_payments_invoice_unique', 'qris_payments', 'invoice_id');

  // Index non-unique untuk polling/query
  db.run("CREATE INDEX IF NOT EXISTS idx_pending_deposits_status_time ON pending_deposits(status, timestamp)", (err) => {
    if (err) logger.warn('Gagal bikin idx_pending_deposits_status_time: ' + err.message);
  });
  db.run("CREATE INDEX IF NOT EXISTS idx_pending_deposits_user ON pending_deposits(user_id, status)", (err) => {
    if (err) logger.warn('Gagal bikin idx_pending_deposits_user: ' + err.message);
  });
  db.run("CREATE INDEX IF NOT EXISTS idx_qris_payments_status_created ON qris_payments(status, created_at)", (err) => {
    if (err) logger.warn('Gagal bikin idx_qris_payments_status_created: ' + err.message);
  });
  db.run("CREATE INDEX IF NOT EXISTS idx_qris_payments_user ON qris_payments(user_id, status)", (err) => {
    if (err) logger.warn('Gagal bikin idx_qris_payments_user: ' + err.message);
  });
  db.run("CREATE INDEX IF NOT EXISTS idx_pending_deposits_amount ON pending_deposits(amount, status)", (err) => {
    if (err) logger.warn('Gagal bikin idx_pending_deposits_amount: ' + err.message);
  });

  // ============================================================================
  // Core: Server, users, transactions, accounts, reseller_bonus_logs
  // ============================================================================
  db.run(`CREATE TABLE IF NOT EXISTS Server (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT,
    auth TEXT,
    harga INTEGER,
    nama_server TEXT,
    quota INTEGER,
    iplimit INTEGER,
    batas_create_akun INTEGER,
    total_create_akun INTEGER,
    is_reseller_only INTEGER DEFAULT 0
  )`, (err) => {
    if (err) logger.error('Kesalahan membuat tabel Server:', err.message);
    else logger.info('Server table created or already exists');
  });

  db.run("UPDATE Server SET total_create_akun = 0 WHERE total_create_akun IS NULL", function (err) {
    if (err) {
      logger.error('Error fixing NULL total_create_akun:', err.message);
    } else if (this.changes > 0) {
      logger.info(`Fixed ${this.changes} servers with NULL total_create_akun`);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    saldo INTEGER DEFAULT 0,
    CONSTRAINT unique_user_id UNIQUE (user_id)
  )`, (err) => {
    if (err) logger.error('Kesalahan membuat tabel users:', err.message);
    else logger.info('Users table created or already exists');
  });

  // Upgrade users: flag_status + flag_note
  db.get('SELECT flag_status FROM users LIMIT 1', (err) => {
    if (err && err.message && err.message.includes('no such column')) {
      logger.info('Menambahkan kolom flag_status dan flag_note ke tabel users...');
      db.run("ALTER TABLE users ADD COLUMN flag_status TEXT DEFAULT 'NORMAL'", (e2) => {
        if (e2) logger.error('Kesalahan menambahkan kolom flag_status:', e2.message);
        else logger.info('Kolom flag_status berhasil ditambahkan ke tabel users');
      });
      db.run('ALTER TABLE users ADD COLUMN flag_note TEXT', (e3) => {
        if (e3) logger.error('Kesalahan menambahkan kolom flag_note:', e3.message);
        else logger.info('Kolom flag_note berhasil ditambahkan ke tabel users');
      });
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    type TEXT,
    reference_id TEXT,
    timestamp INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  )`, (err) => {
    if (err) {
      logger.error('Kesalahan membuat tabel transactions:', err.message);
      return;
    }
    logger.info('Transactions table created or already exists');
    db.get("PRAGMA table_info(transactions)", (e2) => {
      if (e2) {
        logger.error('Kesalahan memeriksa struktur tabel:', e2.message);
        return;
      }
      db.get("SELECT * FROM transactions WHERE reference_id IS NULL LIMIT 1", (e3, row) => {
        if (e3 && e3.message.includes('no such column')) {
          db.run("ALTER TABLE transactions ADD COLUMN reference_id TEXT", (e4) => {
            if (e4) logger.error('Kesalahan menambahkan kolom reference_id:', e4.message);
            else logger.info('Kolom reference_id berhasil ditambahkan ke tabel transactions');
          });
        } else if (row) {
          db.all("SELECT id, user_id, type, timestamp FROM transactions WHERE reference_id IS NULL", [], (e5, rows) => {
            if (e5) {
              logger.error('Kesalahan mengambil transaksi tanpa reference_id:', e5.message);
              return;
            }
            rows.forEach((r) => {
              const referenceId = `account-${r.type}-${r.user_id}-${r.timestamp}`;
              db.run("UPDATE transactions SET reference_id = ? WHERE id = ?", [referenceId, r.id], (e6) => {
                if (e6) logger.error(`Kesalahan mengupdate reference_id untuk transaksi ${r.id}:`, e6.message);
                else logger.info(`Berhasil mengupdate reference_id untuk transaksi ${r.id}`);
              });
            });
          });
        }
      });
    });
    createUniqueIndexIfSafe('idx_transactions_reference_unique', 'transactions', 'reference_id', 'reference_id IS NOT NULL');
  });

  db.run(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    type TEXT,
    server_id INTEGER,
    created_at INTEGER,
    expires_at INTEGER
  )`, (err) => {
    if (err) logger.error('Kesalahan membuat tabel accounts:', err.message);
    else logger.info('Accounts table created or already exists');
  });

  db.run('CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)', (err) => {
    if (err) logger.error('Kesalahan membuat index idx_users_user_id:', err.message);
    else logger.info('Index idx_users_user_id siap dipakai');
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, timestamp)', (err) => {
    if (err) logger.error('Kesalahan membuat index idx_tx_user_time:', err.message);
    else logger.info('Index idx_tx_user_time siap dipakai');
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_tx_type_time ON transactions(type, timestamp)', (err) => {
    if (err) logger.error('Kesalahan membuat index idx_tx_type_time:', err.message);
    else logger.info('Index idx_tx_type_time siap dipakai');
  });
  db.run('CREATE INDEX IF NOT EXISTS idx_accounts_user_time ON accounts(user_id, expires_at)', (err) => {
    if (err) logger.error('Kesalahan membuat index idx_accounts_user_time:', err.message);
    else logger.info('Index idx_accounts_user_time siap dipakai');
  });

  db.run(`CREATE TABLE IF NOT EXISTS reseller_bonus_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    period_month TEXT NOT NULL,
    active_days INTEGER NOT NULL DEFAULT 0,
    bonus_amount INTEGER NOT NULL DEFAULT 0,
    tier_label TEXT,
    processed_at INTEGER NOT NULL,
    processed_by INTEGER,
    note TEXT
  )`, (err) => {
    if (err) logger.error('Kesalahan membuat tabel reseller_bonus_logs:', err.message);
    else logger.info('Reseller bonus logs table created or already exists');
  });
  createUniqueIndexMultiIfSafe('idx_reseller_bonus_unique_month', 'reseller_bonus_logs', 'user_id, period_month');
  ensureSqliteColumn('reseller_bonus_logs', 'processed_by', 'INTEGER');
  ensureSqliteColumn('reseller_bonus_logs', 'note', 'TEXT');

  // ============================================================================
  // Trial counter harian (menggantikan trial.db JSON, atomic upsert)
  // ============================================================================
  db.run(`CREATE TABLE IF NOT EXISTS trial_usage (
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
  )`, (err) => {
    if (err) logger.error('Kesalahan membuat tabel trial_usage:', err.message);
    else logger.info('trial_usage table created or already exists');
  });

  // ============================================================================
  // Broadcast jobs: persist progres broadcast supaya bisa di-resume kalau bot
  // restart di tengah pengiriman. Target list disimpan sebagai JSON array user_id.
  // ============================================================================
  db.run(`CREATE TABLE IF NOT EXISTS broadcast_jobs (
    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    message TEXT NOT NULL,
    parse_mode TEXT DEFAULT 'HTML',
    target_list_json TEXT NOT NULL,
    total_target INTEGER NOT NULL,
    cursor INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    gagal_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  )`, (err) => {
    if (err) logger.error('Kesalahan membuat tabel broadcast_jobs:', err.message);
    else logger.info('broadcast_jobs table created or already exists');
  });
  db.run(
    'CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_status ON broadcast_jobs(status, started_at)',
    (err) => {
      if (err) logger.warn('Gagal bikin idx_broadcast_jobs_status: ' + err.message);
    }
  );
}

module.exports = { runMigrations };
