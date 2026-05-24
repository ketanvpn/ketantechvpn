# Integrasi Payment Gateway KetantechPay ke Bot VPN

> **Tujuan**: Mengganti endpoint AutoGopay eksternal dengan payment gateway kita sendiri di `https://pay.ketantech.my.id`

---

## 📌 Kenapa Perlu Integrasi Ini?

**Sebelum**:
- Bot → `api-gopay.autoftbot.com` (pihak ketiga)
- Tidak ada kontrol fallback provider
- Tergantung 1 provider (AutoGopay)

**Sesudah**:
- Bot → `https://pay.ketantech.my.id` (gateway kita sendiri)
- Auto-fallback ke Midtrans/Xendit/DOKU/Tripay kalau AutoGopay down
- Monitoring terpusat di dashboard
- Webhook real-time untuk update status payment

---

## 🔧 Langkah 1: Update Environment Variables

Edit file `.env` di bot VPN:

```bash
# Ganti ini:
GOPAY_API_BASE_URL=https://v1-gateway.autogopay.site

# Jadi ini:
GOPAY_API_BASE_URL=https://pay.ketantech.my.id

# Tambahkan API key payment gateway:
PAYMENT_GATEWAY_API_KEY=1db4790735cce48296a9b742ae33a0d23c1574c3d26a279285c1c68c01679ce4
```

**Penjelasan**:
- `GOPAY_API_BASE_URL`: URL backend payment gateway kita
- `PAYMENT_GATEWAY_API_KEY`: API key untuk autentikasi ke gateway

---

## 🔧 Langkah 2: Update File `payment/gopay.js`

File ini handle generate QRIS & cek status. Kita perlu sesuaikan dengan API payment gateway kita.

### 2.1. Backup File Lama

```bash
cd /root/BotVPN
cp payment/gopay.js payment/gopay.js.backup
```

### 2.2. Edit `payment/gopay.js`

Ganti fungsi `generateQris` dan `fetchQrisStatus`:

```javascript
// payment/gopay.js - UPDATE untuk payment gateway KetantechPay

const axios = require('axios');

function createGopayClient({ getApiKey, baseUrl, timeoutMs = 15000 }) {
  if (typeof getApiKey !== 'function') {
    throw new Error('createGopayClient: getApiKey harus fungsi');
  }
  
  // Default ke payment gateway kita
  if (!baseUrl || typeof baseUrl !== 'string') {
    baseUrl = 'https://pay.ketantech.my.id';
  }

  // API key payment gateway (bukan AutoGopay API key)
  const gatewayApiKey = process.env.PAYMENT_GATEWAY_API_KEY || '';

  function buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': gatewayApiKey, // Header auth payment gateway
    };
  }

  /**
   * Generate QRIS via payment gateway
   * Gateway akan otomatis pilih provider terbaik (AutoGopay/Midtrans/dll)
   */
  async function generateQris(amount) {
    if (!gatewayApiKey) {
      throw new Error('PAYMENT_GATEWAY_API_KEY belum diisi di .env');
    }

    const nominal = Number(amount || 0);
    if (!Number.isFinite(nominal) || nominal <= 0) {
      throw new Error('Nominal QRIS tidak valid');
    }

    // Generate unique order ID
    const orderId = `vpn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Idempotency key untuk prevent double charge
    const idempotencyKey = `bot-vpn-${orderId}`;

    const payload = {
      orderId: orderId,
      amount: nominal,
      currency: 'IDR',
      method: 'qris',
      customer: {
        name: 'VPN Customer',
        email: 'customer@ketantech.my.id'
      },
      description: `Top up saldo VPN - ${nominal}`
    };

    const res = await axios.post(
      `${baseUrl}/api/v1/payments/charge`,
      payload,
      { 
        headers: {
          ...buildHeaders(),
          'Idempotency-Key': idempotencyKey
        },
        timeout: timeoutMs 
      }
    );

    // Response dari payment gateway
    const data = res.data?.data;
    if (!data) {
      throw new Error('Response payment gateway tidak valid');
    }

    // Normalize response supaya compatible dengan code bot yang ada
    return {
      success: true,
      data: {
        transaction_id: data.id, // ID transaksi di gateway
        order_id: data.orderId,
        qris_string: data.rawResponse?.qris_string || '', // QRIS string kalau ada
        qris_url: data.paymentUrl || '', // URL payment page
        amount: data.amount,
        status: data.status, // pending/success/failed
        provider: data.providerName, // provider yang dipakai (autogopay/midtrans/dll)
        created_at: data.createdAt
      }
    };
  }

  /**
   * Cek status transaksi QRIS
   * @param {string} transactionId - ID transaksi dari payment gateway
   */
  async function fetchQrisStatus(transactionId) {
    if (!gatewayApiKey) {
      throw new Error('PAYMENT_GATEWAY_API_KEY belum diisi di .env');
    }

    if (!transactionId) {
      throw new Error('Transaction ID tidak boleh kosong');
    }

    const res = await axios.get(
      `${baseUrl}/api/v1/payments/${transactionId}`,
      { 
        headers: buildHeaders(),
        timeout: timeoutMs 
      }
    );

    const data = res.data?.data;
    if (!data) {
      throw new Error('Response payment gateway tidak valid');
    }

    // Normalize response
    return {
      success: true,
      data: {
        transaction_id: data.id,
        order_id: data.orderId,
        transaction_status: data.status, // pending/success/failed/expired
        transaction_time: data.updatedAt,
        payment_type: 'qris',
        issuer: data.providerName,
        amount: data.amount
      }
    };
  }

  /**
   * Fetch semua transaksi (untuk polling mutasi)
   * NOTE: Payment gateway kita tidak punya endpoint list transactions untuk client API
   * Jadi kita skip fungsi ini, pakai webhook untuk update status
   */
  async function fetchTransactions() {
    // Tidak dipakai lagi karena payment gateway pakai webhook
    // Kalau perlu, bisa hit endpoint admin (tapi butuh ADMIN_API_KEY)
    return [];
  }

  return {
    generateQris,
    fetchQrisStatus,
    fetchTransactions,
  };
}

module.exports = { createGopayClient };
```

**Penjelasan Perubahan**:

1. **`generateQris(amount)`**:
   - Hit endpoint `/api/v1/payments/charge` payment gateway
   - Generate unique `orderId` & `Idempotency-Key`
   - Gateway otomatis pilih provider terbaik (AutoGopay → Midtrans → Xendit → dll)
   - Return format di-normalize supaya compatible dengan code bot yang ada

2. **`fetchQrisStatus(transactionId)`**:
   - Hit endpoint `/api/v1/payments/{id}` untuk cek status
   - Return status: `pending`, `success`, `failed`, `expired`

3. **`fetchTransactions()`**:
   - Tidak dipakai lagi karena payment gateway pakai **webhook** untuk update status real-time
   - Polling mutasi tidak perlu lagi

---

## 🔧 Langkah 3: Setup Webhook untuk Auto-Update Status

Payment gateway akan kirim webhook saat status payment berubah (pending → success).

### 3.1. Buat Endpoint Webhook di Bot

Tambahkan endpoint webhook di `app.js`:

```javascript
// app.js - tambahkan di bagian Express routes

// Webhook dari payment gateway
app.post('/webhook/payment-gateway', async (req, res) => {
  try {
    const payload = req.body;
    
    // Validasi webhook (opsional: tambahkan signature verification)
    if (!payload || !payload.orderId) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const orderId = payload.orderId;
    const status = payload.status; // pending/success/failed/expired
    const transactionId = payload.id;

    logger.info(`Webhook payment gateway: orderId=${orderId}, status=${status}`);

    // Update status di database
    if (status === 'success') {
      // Cari invoice berdasarkan order_id
      db.get(
        `SELECT * FROM qris_payments WHERE provider_tx_id = ? OR invoice_id LIKE ? LIMIT 1`,
        [transactionId, `%${orderId}%`],
        async (err, row) => {
          if (err) {
            logger.error('Error query invoice:', err);
            return res.status(500).json({ error: 'Database error' });
          }

          if (!row) {
            logger.warn(`Invoice tidak ditemukan untuk orderId=${orderId}`);
            return res.status(404).json({ error: 'Invoice not found' });
          }

          const userId = row.user_id;
          const amount = row.amount;

          // Update saldo user
          db.run(
            `UPDATE users SET saldo = saldo + ? WHERE user_id = ?`,
            [amount, userId],
            (updateErr) => {
              if (updateErr) {
                logger.error('Error update saldo:', updateErr);
                return res.status(500).json({ error: 'Failed to update balance' });
              }

              logger.info(`Saldo user ${userId} berhasil ditambah ${amount}`);

              // Kirim notifikasi ke user via Telegram
              bot.telegram.sendMessage(
                userId,
                `✅ <b>Pembayaran Berhasil!</b>\n\n` +
                `💰 Saldo Anda bertambah: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n` +
                `📊 Saldo sekarang: <b>Rp ${(row.current_balance + amount).toLocaleString('id-ID')}</b>\n\n` +
                `Terima kasih telah menggunakan layanan kami! 🙏`,
                { parse_mode: 'HTML' }
              ).catch(e => logger.error('Error kirim notif:', e));

              res.json({ status: 'ok' });
            }
          );
        }
      );
    } else {
      // Status lain (pending/failed/expired) - log saja
      res.json({ status: 'ok' });
    }
  } catch (error) {
    logger.error('Error webhook payment gateway:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 3.2. Expose Webhook ke Internet

Bot VPN jalan di port `6969` (dari `.env`). Perlu reverse proxy nginx:

```bash
# Di VPS bot VPN, edit nginx config
sudo nano /etc/nginx/sites-available/bot-vpn
```

Tambahkan:

```nginx
server {
    listen 80;
    server_name bot.ketantech.my.id; # ganti dengan domain bot VPN

    location /webhook/payment-gateway {
        proxy_pass http://127.0.0.1:6969/webhook/payment-gateway;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 3.3. Set Webhook URL di Payment Gateway

**BELUM BISA DILAKUKAN SEKARANG** karena payment gateway kita belum support custom webhook per-transaksi.

**Alternatif sementara**: Pakai **polling status** di bot (cek status tiap 10 detik sampai success/expired).

---

## 🔧 Langkah 4: Update Polling Logic (Temporary)

Karena webhook belum ready, kita pakai polling untuk cek status payment.

Edit `payment/polling.js` (kalau ada) atau tambahkan logic polling di `app.js`:

```javascript
// Polling status payment tiap 10 detik
async function pollPaymentStatus(transactionId, userId, amount, maxAttempts = 60) {
  let attempts = 0;
  
  const interval = setInterval(async () => {
    attempts++;
    
    try {
      const statusRes = await gopayClient.fetchQrisStatus(transactionId);
      const status = statusRes.data.transaction_status;

      logger.info(`Poll payment ${transactionId}: status=${status}, attempt=${attempts}`);

      if (status === 'success') {
        clearInterval(interval);
        
        // Update saldo user
        db.run(
          `UPDATE users SET saldo = saldo + ? WHERE user_id = ?`,
          [amount, userId],
          (err) => {
            if (err) {
              logger.error('Error update saldo:', err);
              return;
            }

            logger.info(`Saldo user ${userId} berhasil ditambah ${amount}`);

            // Kirim notifikasi
            bot.telegram.sendMessage(
              userId,
              `✅ <b>Pembayaran Berhasil!</b>\n\n` +
              `💰 Saldo Anda bertambah: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n\n` +
              `Terima kasih! 🙏`,
              { parse_mode: 'HTML' }
            ).catch(e => logger.error('Error kirim notif:', e));
          }
        );
      } else if (status === 'failed' || status === 'expired') {
        clearInterval(interval);
        logger.warn(`Payment ${transactionId} ${status}`);
        
        // Kirim notifikasi gagal
        bot.telegram.sendMessage(
          userId,
          `❌ <b>Pembayaran ${status === 'expired' ? 'Kadaluarsa' : 'Gagal'}</b>\n\n` +
          `Silakan coba lagi atau hubungi admin.`,
          { parse_mode: 'HTML' }
        ).catch(e => logger.error('Error kirim notif:', e));
      }

      // Max 60 attempts = 10 menit
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        logger.warn(`Payment ${transactionId} timeout after ${maxAttempts} attempts`);
      }
    } catch (error) {
      logger.error(`Error poll payment ${transactionId}:`, error.message);
    }
  }, 10000); // Poll tiap 10 detik
}
```

Panggil fungsi ini setelah generate QRIS:

```javascript
// Setelah generateQris berhasil
const qrisRes = await gopayClient.generateQris(amount);
const transactionId = qrisRes.data.transaction_id;

// Start polling
pollPaymentStatus(transactionId, userId, amount);
```

---

## 🔧 Langkah 5: Testing

### 5.1. Test Generate QRIS

1. Jalankan bot: `pm2 restart BotVPN`
2. Di Telegram, pilih menu **Top Up Saldo**
3. Masukkan nominal (misal: 10000)
4. Bot akan generate QRIS via payment gateway
5. Cek di dashboard `https://pay.ketantech.my.id/transactions` → transaksi muncul dengan status `pending`

### 5.2. Test Payment

1. Scan QRIS yang di-generate
2. Bayar via GoPay/QRIS
3. Tunggu 10-30 detik (polling)
4. Bot akan kirim notifikasi "Pembayaran Berhasil"
5. Saldo user bertambah

### 5.3. Test Fallback Provider

1. Di dashboard payment gateway, set AutoGopay `force_down=true` (simulasi down)
2. Generate QRIS lagi dari bot
3. Gateway otomatis fallback ke Midtrans/Xendit
4. Payment tetap jalan normal

---

## 📊 Monitoring

### Dashboard Payment Gateway

Buka `https://pay.ketantech.my.id`:

- **Home**: Lihat stats transaksi real-time
- **Transactions**: List semua transaksi dari bot VPN
- **Provider Health**: Cek status provider (AutoGopay/Midtrans/dll)

### Logs Bot VPN

```bash
pm2 logs BotVPN
```

Cari log:
- `Poll payment xxx: status=success` → payment berhasil
- `Saldo user xxx berhasil ditambah` → saldo updated

---

## 🎯 Keuntungan Setelah Integrasi

✅ **Multi-provider fallback**: AutoGopay down? Otomatis pakai Midtrans/Xendit
✅ **Monitoring terpusat**: Semua transaksi bot VPN tercatat di dashboard
✅ **Idempotency**: Prevent double charge
✅ **Retry & timeout**: Gateway handle retry otomatis
✅ **Audit log**: Semua transaksi ter-log dengan hash chain (tamper-proof)

---

## 🚨 Troubleshooting

### Error: "PAYMENT_GATEWAY_API_KEY belum diisi"

**Fix**: Tambahkan di `.env`:
```
PAYMENT_GATEWAY_API_KEY=1db4790735cce48296a9b742ae33a0d23c1574c3d26a279285c1c68c01679ce4
```

### Error: "Route POST /api/v1/payments/charge not found"

**Fix**: Cek `GOPAY_API_BASE_URL` di `.env`, pastikan:
```
GOPAY_API_BASE_URL=https://pay.ketantech.my.id
```

### Payment stuck di "pending"

**Cek**:
1. Dashboard payment gateway → cek status transaksi
2. Logs bot VPN → cek polling jalan atau tidak
3. Cek webhook AutoGopay sudah di-set atau belum

---

## 📝 Checklist Deployment

- [ ] Update `.env` dengan `PAYMENT_GATEWAY_API_KEY` & `GOPAY_API_BASE_URL`
- [ ] Backup `payment/gopay.js` lama
- [ ] Update `payment/gopay.js` dengan code baru
- [ ] Tambahkan endpoint webhook `/webhook/payment-gateway` di `app.js`
- [ ] Setup nginx reverse proxy untuk webhook (kalau perlu)
- [ ] Restart bot: `pm2 restart BotVPN`
- [ ] Test generate QRIS
- [ ] Test payment end-to-end
- [ ] Monitor dashboard payment gateway

---

**Selesai!** Bot VPN sekarang pakai payment gateway kita sendiri dengan auto-fallback multi-provider. 🎉

Kalau ada error atau pertanyaan, tanya saja! 😊

---

## 🔄 Refresh Notes (2026-05-24)

Dokumen ini sudah dicek ulang setelah KetantechPay production update:

- Payment gateway live di `https://pay.ketantech.my.id`
- Dashboard dan API sudah running di production
- AutoGoPay provider tersedia lewat gateway
- Flow integrasi tetap: Bot VPN → KetantechPay → provider payment
- File contoh client baru tersedia di `payment/gopay.new.js`

Catatan: jangan commit API key asli ke repository. Gunakan `.env` di VPS untuk nilai production.
