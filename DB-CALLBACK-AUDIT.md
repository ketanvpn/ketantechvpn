# DB Callback Audit Summary
# Generated: 2026-06-02
# Total callsites: 150 (78 db.run, 53 db.get, 19 db.all)

## High-Priority Targets (Most Complex / Critical Flow)

### 1. QRIS Payment Flow (Lines 1534-1700+)
- **Complexity:** VERY HIGH (nested transactions, multiple rollback paths)
- **Pattern:** BEGIN TRANSACTION → multiple db.run/get → COMMIT/ROLLBACK
- **Impact:** HIGH (payment critical, user balance affected)
- **Estimated callsites:** ~15-20
- **Risk:** MEDIUM-HIGH (transaction atomicity must be preserved)

### 2. Reseller Bonus Processing (Lines 1156-1200+)
- **Complexity:** VERY HIGH (nested transactions, 4-level deep callback)
- **Pattern:** BEGIN → check existing → update saldo → insert log → COMMIT
- **Impact:** HIGH (bonus calculation, reseller incentive)
- **Estimated callsites:** ~10-15
- **Risk:** HIGH (complex transaction logic)

### 3. User Link/Unlink Web (Lines 1040-1100+)
- **Complexity:** MEDIUM-HIGH (multi-step: check → update → audit)
- **Impact:** MEDIUM (user account linking)
- **Estimated callsites:** ~8-10
- **Risk:** MEDIUM

### 4. Trial Usage Tracking (Lines 408-500)
- **Complexity:** MEDIUM (simple SELECT/UPDATE)
- **Impact:** MEDIUM (trial abuse prevention)
- **Estimated callsites:** ~5-8
- **Risk:** LOW-MEDIUM

### 5. Broadcast Jobs (Lines 5800-6400+)
- **Complexity:** MEDIUM (job persistence, progress tracking)
- **Impact:** MEDIUM (broadcast reliability)
- **Estimated callsites:** ~10-15
- **Risk:** MEDIUM

### 6. Admin Commands (Scattered)
- `/addsaldo`, `/minsaldo`, `/deluser`, `/listuser` — simple CRUD
- **Complexity:** LOW-MEDIUM
- **Impact:** MEDIUM (admin operations)
- **Estimated callsites:** ~15-20
- **Risk:** LOW

### 7. Server CRUD (Scattered)
- `/addserver`, `/editharga`, `/editnama`, etc. — simple CRUD
- **Complexity:** LOW
- **Impact:** LOW-MEDIUM (server config)
- **Estimated callsites:** ~10-15
- **Risk:** LOW

### 8. Misc/Helper Functions (Scattered)
- `getUserSaldo`, `getServerList`, `checkServerAccess`, etc.
- **Complexity:** LOW (simple SELECT)
- **Impact:** LOW-MEDIUM
- **Estimated callsites:** ~40-50
- **Risk:** LOW

---

## Refactor Strategy (Recommended Order)

### Batch 1: Low-Hanging Fruit (Simple SELECT, no transaction)
- **Target:** Misc helper functions (getUserSaldo, getServerList, etc.)
- **Estimated:** 30-40 callsites
- **Effort:** 15-20 minutes
- **Risk:** LOW
- **Benefit:** Quick wins, reduce callback nesting

### Batch 2: Simple CRUD (INSERT/UPDATE/DELETE, no transaction)
- **Target:** Admin commands (addsaldo, minsaldo, deluser, addserver, editharga)
- **Estimated:** 20-30 callsites
- **Effort:** 20-30 minutes
- **Risk:** LOW-MEDIUM
- **Benefit:** Clean up admin flow

### Batch 3: Medium Complexity (Multi-step, no transaction)
- **Target:** User link/unlink, trial usage, broadcast jobs
- **Estimated:** 20-25 callsites
- **Effort:** 30-40 minutes
- **Risk:** MEDIUM
- **Benefit:** Improve readability

### Batch 4: Transaction-Heavy (DEFER or CAREFUL)
- **Target:** QRIS payment, reseller bonus (BEGIN/COMMIT/ROLLBACK)
- **Estimated:** 25-30 callsites
- **Risk:** HIGH
- **Decision:** DEFER untuk sekarang (butuh sesi khusus dengan isolation testing)
- **Alternative:** Wrap transaction logic ke helper function, tapi tetap pakai callback internally

---

## Notes

- Helper `lib/db-async.js` (dbRun, dbGet, dbAll) sudah ada dan tested
- Transaction blocks (BEGIN/COMMIT/ROLLBACK) butuh special handling:
  - Option 1: Keep callback for transaction (safest)
  - Option 2: Wrap in Promise with careful error handling
  - Option 3: Use lib that supports async transaction (e.g., better-sqlite3, but breaking change)
- Prioritize non-transaction code first (80% of callsites, 20% of risk)

---

## Recommendation for Today

Focus on **Batch 1 + Batch 2** (50-70 callsites, ~40-50 minutes total):
- Low risk
- High readability improvement
- Build confidence before touching transaction code

Skip transaction-heavy code (Batch 4) for now — revisit in dedicated session with proper transaction wrapper pattern.
