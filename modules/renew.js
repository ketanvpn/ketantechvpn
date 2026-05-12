const axios = require('axios');
const { httpGet, httpPost, httpPatch, httpDelete } = require('./http-client');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

async function renewssh(username, exp, limitip, serverId) {
  console.log(`Renewing SSH account for ${username} with expiry ${exp} days, limit IP ${limitip} on server ${serverId}`);

  // Validasi username
  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/renewsshvpn`;
      const web_URL = `http://${domain}${param}`; // Contoh: http://domainmu.com/vps/sshvpn
      const AUTH_TOKEN = server.auth;
      const days = exp;
      if (!Number.isFinite(Number(days)) || Number(days) <= 0) {
        return resolve('❌ Durasi perpanjangan tidak valid.');
      }

      try {
        const response = await httpPatch(`${web_URL}/${encodeURIComponent(username)}/${encodeURIComponent(String(days))}`, {"kuota": 0}, {
        headers: {
          Authorization: AUTH_TOKEN,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
        const d = response.data;

        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;
        const msg = `✅ *Renew SSH Account Success!*

🔄 *Akun berhasil diperpanjang*
────────────────────────────
👤 *Username*     : \`${s.username}\`
📆 *Masa Aktif*   :
🕒 Dari: \`${s.from}\`
🕒 Sampai: \`${s.to}\`
────────────────────────────

✨ Terimakasih telah menggunakan layanan kami!
*© Telegram Bots - 2025*`;

        return resolve(msg);
      } catch (err) {
        console.error('❌ Gagal request API server:', err.message || err);
        if (err.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(err.response.data, null, 2)}`);
        }
        return resolve('❌ Gagal terhubung ke server VPN. Coba lagi nanti.');
      }
    });
  });
}
async function renewvmess(username, exp, quota, limitip, serverId) {
  console.log(`Renewing VMess account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip}`);

  // Validasi username
  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/renewvmess`;
      const web_URL = `http://${domain}${param}`; // contoh: http://domain.com/vps/vmess
      const AUTH_TOKEN = server.auth;
      const days = exp;
      if (!Number.isFinite(Number(days)) || Number(days) <= 0) {
        return resolve('❌ Durasi perpanjangan tidak valid.');
      }
      const KUOTA = quota;

      try {
        const response = await httpPatch(`${web_URL}/${encodeURIComponent(username)}/${encodeURIComponent(String(days))}`, {"kuota": KUOTA}, {
        headers: {
          Authorization: AUTH_TOKEN,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
        const d = response.data;

        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;
        const msg = `✅ *Renew VMess Account Success!*

🔄 *Akun berhasil diperpanjang*
────────────────────────────
👤 *Username*    : \`${s.username}\`
📦 *Quota*       : \`${s.quota === "0" ? "Unlimited" : s.quota} GB\`
📅 *Masa Aktif*  :
🕒 Dari   : \`${s.from}\`
🕒 Sampai : \`${s.to}\`
────────────────────────────

✨ Terimakasih telah menggunakan layanan kami!
*© Telegram Bots - 2025*`;

        return resolve(msg);
      } catch (err) {
        console.error('❌ Gagal request API server:', err.message || err);
        if (err.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(err.response.data, null, 2)}`);
        }
        return resolve('❌ Gagal terhubung ke server VPN. Coba lagi nanti.');
      }
    });
  });
}
async function renewvless(username, exp, quota, limitip, serverId) {
  console.log(`Renewing VLESS account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip}`);

  // Validasi username
  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/renewvless`;
      const web_URL = `http://${domain}${param}`;        // Contoh: http://domain.com/vps/vless
      const AUTH_TOKEN = server.auth;
      const days = exp;
      if (!Number.isFinite(Number(days)) || Number(days) <= 0) {
        return resolve('❌ Durasi perpanjangan tidak valid.');
      }
      const KUOTA = quota;

      try {
        const response = await httpPatch(`${web_URL}/${encodeURIComponent(username)}/${encodeURIComponent(String(days))}`, {"kuota": KUOTA}, {
        headers: {
          Authorization: AUTH_TOKEN,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
        const d = response.data;

        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;
        const msg = `✅ *Renew VLESS Account Success!*

🔄 *Akun berhasil diperpanjang*
────────────────────────────
👤 *Username*    : \`${s.username}\`
📦 *Quota*       : \`${s.quota === "0" ? "Unlimited" : s.quota} GB\`
📅 *Masa Aktif*  :
🕒 Dari   : \`${s.from}\`
🕒 Sampai : \`${s.to}\`
────────────────────────────

✨ Terimakasih telah menggunakan layanan kami!
*© Telegram Bots - 2025*`;

        return resolve(msg);
      } catch (err) {
        console.error('❌ Gagal request API server:', err.message || err);
        if (err.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(err.response.data, null, 2)}`);
        }
        return resolve('❌ Gagal terhubung ke server VPN. Coba lagi nanti.');
      }
    });
  });
}
async function renewtrojan(username, exp, quota, limitip, serverId) {
  console.log(`Renewing TROJAN account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip}`);

  // Validasi username
  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/renewtrojan`;
      const web_URL = `http://${domain}${param}`;         // Contoh: http://domain.com/vps/trojan
      const AUTH_TOKEN = server.auth;
      const days = exp;
      if (!Number.isFinite(Number(days)) || Number(days) <= 0) {
        return resolve('❌ Durasi perpanjangan tidak valid.');
      }
      const KUOTA = quota;

      try {
        const response = await httpPatch(`${web_URL}/${encodeURIComponent(username)}/${encodeURIComponent(String(days))}`, {"kuota": KUOTA}, {
        headers: {
          Authorization: AUTH_TOKEN,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
        const d = response.data;

        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;
        const msg = `✅ *Renew TROJAN Account Success!*

🔄 *Akun berhasil diperpanjang*
────────────────────────────
👤 *Username*    : \`${s.username}\`
📦 *Quota*       : \`${s.quota === "0" ? "Unlimited" : s.quota} GB\`
📅 *Masa Aktif*  :
🕒 Dari   : \`${s.from}\`
🕒 Sampai : \`${s.to}\`
────────────────────────────

✨ Terimakasih telah menggunakan layanan kami!
*© Telegram Bots - 2025*`;

        return resolve(msg);
      } catch (err) {
        console.error('❌ Gagal request API server:', err.message || err);
        if (err.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(err.response.data, null, 2)}`);
        }
        return resolve('❌ Gagal terhubung ke server VPN. Coba lagi nanti.');
      }
    });
  });
}
//create shadowsocks ga ada di potato
  async function renewshadowsocks(username, exp, quota, limitip, serverId) {
    console.log(`Renewing Shadowsocks account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip} on server ${serverId}`);
    
    // Validasi username
    if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
      return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
    }
  
    // Ambil domain dari database
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
        if (err) {
          console.error('Error fetching server:', err.message);
          return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
        }
  
        if (!server) return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
  
        const domain = server.domain;
        const auth = server.auth;
        const param = `:5888/renewshadowsocks?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${auth}`;
        const url = `http://${domain}${param}`;
        httpGet(url).then(response => {
            if (response.data.status === "success") {
              const shadowsocksData = response.data.data;
              const msg = `
  🌟 *RENEW SHADOWSOCKS PREMIUM* 🌟
  
  🔹 *Informasi Akun*
  ┌─────────────────────────────
  │ Username: \`${username}\`
  │ Kadaluarsa: \`${shadowsocksData.expired}\`
  │ Kuota: \`${shadowsocksData.quota}\`
  │ Batas IP: \`${shadowsocksData.limitip} IP\`
  └─────────────────────────────
  ✅ Akun ${username} berhasil diperbarui
  ✨ Selamat menggunakan layanan kami! ✨
  `;
           
                console.log('Shadowsocks account renewed successfully');
                return resolve(msg);
              } else {
                console.log('Error renewing Shadowsocks account');
                return resolve(`❌ Terjadi kesalahan: ${response.data.message}`);
              }
            })
          .catch(error => {
            console.error('Error saat memperbarui Shadowsocks:', error);
            return resolve('❌ Terjadi kesalahan saat memperbarui Shadowsocks. Silakan coba lagi nanti.');
          });
      });
    });
  }
  
  module.exports = { renewshadowsocks, renewtrojan, renewvless, renewvmess, renewssh };
