# DEBUG TOPUP ISSUE - Saldo Masuk ke Bot, Bukan Web

## Root Cause Hypothesis

User Bos Eko (690744680) sudah link ke web, tapi topup QRIS masuk ke saldo bot (SQLite), bukan saldo web (Postgres).

**Kemungkinan:**
1. Link bot ↔ web tidak sempurna (database mismatch)
2. Env variable `WEB_API_BASE_URL` atau `WEB_API_BOT_KEY` salah/kosong
3. Web API error saat bot hit `/telegram/credit`

---

## Test Checklist (Jalankan di VPS Production)

### 1. Cek Status Link User Bos Eko di Bot (SQLite)

```bash
cd /root/BotVPN
sqlite3 botvpn.db "SELECT user_id, web_user_id, web_linked_at, saldo FROM users WHERE user_id = 690744680;"
```

**Expected Output:**
```
690744680|<web_user_id>|<timestamp>|<saldo_bot>
```

**Jika `web_user_id` NULL:**
- ❌ Link GAGAL → root cause! Topup pasti masuk bot SQLite.

---

### 2. Cek Status Link User Bos Eko di Web (Postgres)

```bash
# Ganti <DB_HOST>, <DB_NAME>, <DB_USER>, <DB_PASS> dari .env web
psql -h <DB_HOST> -U <DB_USER> -d <DB_NAME> -c "SELECT id, username, \"vpnTelegramId\", balance FROM users WHERE \"vpnTelegramId\" = 690744680;"
```

**Expected Output:**
```
 id | username | vpnTelegramId | balance
----+----------+---------------+---------
 XX | boseko   | 690744680     | XXXXX
```

**Jika `vpnTelegramId` NULL atau tidak ada row:**
- ❌ Web tidak tahu user telegram 690744680 → link GAGAL

---

### 3. Cek Env Variable Web API di Bot

```bash
cd /root/BotVPN
grep -E "WEB_API_BASE_URL|WEB_API_BOT_KEY|WEB_LINK_ENABLED" .env
```

**Expected Output:**
```
WEB_API_BASE_URL=https://ketantech.my.id/api
WEB_API_BOT_KEY=your-secret-key-here
WEB_LINK_ENABLED=true
```

**Jika kosong/salah:**
- ❌ Bot tidak bisa hit web API → fallback ke SQLite

---

### 4. Test Web API Manual (Credit Balance)

```bash
# Ganti YOUR_BOT_KEY dari .env bot
curl -X POST https://ketantech.my.id/api/telegram/credit \
  -H "X-Bot-API-Key: YOUR_BOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "telegramId": 690744680,
    "amount": 1000,
    "description": "Test topup manual",
    "refId": "test_debug_001"
  }'
```

**Expected Output (SUCCESS):**
```json
{"ok": true, "applied": true, "newBalance": XXXXX}
```

**Jika 404/401/500:**
- ❌ Web API down/auth error → bot fallback ke SQLite

---

### 5. Cek Log Error Bot (Topup Terakhir)

```bash
cd /root/BotVPN
tail -200 app.log | grep -A 5 -B 5 "690744680" | grep -i "finalize\|credit\|link\|web"
```

**Cari keyword:**
- `"gagal cek link status"` → link check error
- `"Web credit gagal"` → API call error
- `"fallback ke SQLite"` → masuk path bot
- `"linkedToWeb = false"` → link check return false

---

### 6. Cek Log Error Web API (Topup Terakhir)

```bash
# Ganti path log sesuai deployment web
cd /var/log/webvpn  # atau pm2 logs <id>
tail -200 webvpn.log | grep -i "telegram/credit\|690744680"
```

**Cari keyword:**
- `"User tidak ditemukan"` → vpnTelegramId tidak ada
- `"transaction"` → credit sukses
- Error 404/500 → endpoint/DB error

---

## Quick Fix (Jika Link Gagal)

### Scenario A: `web_user_id` NULL di Bot

**Re-link manual:**

1. **Di Web:** User Bos klik "Link Bot" lagi → dapat link baru `https://t.me/panelketan_bot?start=link_<token>`
2. **Di Bot:** Bos klik link tersebut → bot hit `/telegram/verify-link-token` → set `web_user_id` + `vpnTelegramId`
3. **Verify:**
   ```bash
   sqlite3 /root/BotVPN/botvpn.db "SELECT web_user_id FROM users WHERE user_id = 690744680;"
   ```

### Scenario B: `vpnTelegramId` NULL di Web (Tapi `web_user_id` Ada di Bot)

**Update manual di Web Postgres:**

```sql
-- Ganti <WEB_USER_ID> dari query test #1
UPDATE users 
SET "vpnTelegramId" = 690744680, updated_at = NOW() 
WHERE id = <WEB_USER_ID>;
```

---

## Expected Resolution

Setelah link fix:
1. ✅ Topup QRIS baru → masuk saldo web (Postgres)
2. ✅ Bot hit `POST /telegram/credit` sukses
3. ✅ `finalizeQrisPayment` log: `"linkedToWeb = true"`, `"source: web"`

---

**Next Steps:**
1. Bos jalankan Test #1-6
2. Share hasil output ke saya
3. Saya kasih fix konkret based on hasil test

---

*Created: 2026-06-02 14:38 UTC+9 (KetanClaw)*
