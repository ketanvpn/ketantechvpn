// Integration test: broadcast_jobs persistence + resume cursor.
// Memastikan kolom + index ada, INSERT/UPDATE jalan, dan filter status='running'
// memungkinkan resume.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setupMemoryDb, closeDb, dbRun, dbGet, dbAll } = require('./helpers');

function insertJob(db, opts = {}) {
  const targetList = opts.targetList || [101, 102, 103];
  return dbRun(
    db,
    `INSERT INTO broadcast_jobs
       (admin_id, target_type, message, parse_mode, target_list_json,
        total_target, cursor, sent_count, gagal_count, status, started_at)
     VALUES (?, ?, ?, 'HTML', ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.adminId || 1,
      opts.targetType || 'all',
      opts.message || 'hi',
      JSON.stringify(targetList),
      targetList.length,
      opts.cursor || 0,
      opts.sent || 0,
      opts.gagal || 0,
      opts.status || 'running',
      opts.startedAt || Date.now(),
    ]
  );
}

test('broadcast_jobs: insert + select by id', async () => {
  const { db } = await setupMemoryDb();
  try {
    const { lastID } = await insertJob(db, { targetType: 'reseller' });
    const row = await dbGet(db, 'SELECT * FROM broadcast_jobs WHERE job_id = ?', [lastID]);
    assert.ok(row);
    assert.equal(row.target_type, 'reseller');
    assert.equal(row.status, 'running');
    assert.equal(row.total_target, 3);
    assert.equal(row.cursor, 0);
  } finally {
    await closeDb(db);
  }
});

test('broadcast_jobs: update cursor + counters', async () => {
  const { db } = await setupMemoryDb();
  try {
    const { lastID } = await insertJob(db);
    await dbRun(
      db,
      'UPDATE broadcast_jobs SET cursor = ?, sent_count = ?, gagal_count = ? WHERE job_id = ?',
      [2, 2, 0, lastID]
    );
    const row = await dbGet(db, 'SELECT cursor, sent_count, gagal_count FROM broadcast_jobs WHERE job_id = ?', [lastID]);
    assert.equal(row.cursor, 2);
    assert.equal(row.sent_count, 2);
    assert.equal(row.gagal_count, 0);
  } finally {
    await closeDb(db);
  }
});

test('broadcast_jobs: status filter resume scenario', async () => {
  const { db } = await setupMemoryDb();
  try {
    await insertJob(db, { targetType: 'all', status: 'running', cursor: 5 });
    await insertJob(db, { targetType: 'reseller', status: 'done', cursor: 100 });
    await insertJob(db, { targetType: 'member', status: 'running', cursor: 0 });

    const pending = await dbAll(db, "SELECT job_id, target_type, cursor FROM broadcast_jobs WHERE status = 'running' ORDER BY started_at ASC");
    assert.equal(pending.length, 2);
    assert.equal(pending[0].target_type, 'all');
    assert.equal(pending[0].cursor, 5);
    assert.equal(pending[1].target_type, 'member');
  } finally {
    await closeDb(db);
  }
});

test('broadcast_jobs: mark done updates status + finished_at', async () => {
  const { db } = await setupMemoryDb();
  try {
    const { lastID } = await insertJob(db);
    const ts = Date.now();
    await dbRun(db, 'UPDATE broadcast_jobs SET status = ?, finished_at = ? WHERE job_id = ?', ['done', ts, lastID]);
    const row = await dbGet(db, 'SELECT status, finished_at FROM broadcast_jobs WHERE job_id = ?', [lastID]);
    assert.equal(row.status, 'done');
    assert.equal(row.finished_at, ts);
  } finally {
    await closeDb(db);
  }
});

test('broadcast_jobs: target_list_json roundtrip', async () => {
  const { db } = await setupMemoryDb();
  try {
    const list = [111, 222, 333, 444];
    const { lastID } = await insertJob(db, { targetList: list });
    const row = await dbGet(db, 'SELECT target_list_json FROM broadcast_jobs WHERE job_id = ?', [lastID]);
    const parsed = JSON.parse(row.target_list_json);
    assert.deepEqual(parsed, list);
  } finally {
    await closeDb(db);
  }
});
