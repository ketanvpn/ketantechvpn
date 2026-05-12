const axios = require('axios');
const { httpGet, httpPost, httpPatch, httpDelete } = require('./http-client');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

function isValidUsername(username) {
  return !(/\s/.test(username) || /[^a-zA-Z0-9]/.test(username));
}

function isValidExp(exp) {
  return Number.isFinite(Number(exp)) && Number(exp) > 0;
}

function isValidNonNegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

async function createssh(username, password, exp, iplimit, serverId) {
  console.log(`Creating SSH account for ${username} with expiry ${exp} days, IP limit ${iplimit}, and password ${password}`);

  // Validasi username
  if (!isValidUsername(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  // Validasi password SSH
  if (!/^[A-Za-z0-9._!@#\-]{3,32}$/.test(password)) {
    return '❌ Password tidak valid. Gunakan 3-32 karakter: huruf, angka, dan . _ ! @ # -';
  }

  if (!isValidExp(exp)) {
    return '❌ Durasi tidak valid.';
  }

  if (!isValidNonNegative(iplimit)) {
    return '❌ IP limit tidak valid.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/sshvpn`;
      const web_URL = `http://${domain}${param}`; // misalnya: http://idnusastb.domain.web.id/vps/sshvpn
      const AUTH_TOKEN = server.auth;
      const days = exp;
      const KUOTA = "0"; // jika perlu di-hardcode, bisa diubah jadi parameter juga
      const LIMIT_IP = iplimit;

      try {
        const response = await httpPost(
          web_URL,
          { expired: days, kuota: KUOTA, limitip: LIMIT_IP, password, username },
          {
            headers: {
              Authorization: AUTH_TOKEN,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 15000,
          }
        );
        const d = response.data;
        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;

        const msg = `✅ *SSH Account Created Successfully!*

*🔐 SSH Premium Details*
────────────────────────
📡 *SSH WS*       : \`${s.hostname}:80@${s.username}:${s.password}\`
🔒 *SSH SSL*      : \`${s.hostname}:443@${s.username}:${s.password}\`
📶 *SSH UDP*      : \`${s.hostname}:1-65535@${s.username}:${s.password}\`
🌐 *DNS SELOW*    : \`${s.hostname}:5300@${s.username}:${s.password}\`
────────────────────────
🌍 *Hostname*     : \`${s.hostname}\`
👤 *Username*     : \`${s.username}\`
🔑 *Password*     : \`${s.password}\`
📅 *Expiry Date*  : \`${s.exp}\`
⏰ *Expiry Time*  : \`${s.time}\`
📌 *IP Limit*     : \`${LIMIT_IP}\`
────────────────────────
🛠 *Ports*:
• TLS         : \`${s.port.tls}\`
• Non-TLS     : \`${s.port.none}\`
• OVPN TCP    : \`${s.port.ovpntcp}\`
• OVPN UDP    : \`${s.port.ovpnudp}\`
• SSH OHP     : \`${s.port.sshohp}\`
• UDP Custom  : \`${s.port.udpcustom}\`
────────────────────────
🧩 *Payload WS*:
\`
GET / HTTP/1.1
Host: ${s.hostname}
Connection: Upgrade
User-Agent: [ua]
Upgrade: websocket
\`

🧩 *Payload Enhanced*:
\`
PATCH / HTTP/1.1
Host: ${s.hostname}
Host: bug.com
Connection: Upgrade
User-Agent: [ua]
Upgrade: websocket
\`

📥 *Download Config*:
🔗 http://${s.hostname}:81/myvpn-config.zip

*© Telegram Bots - 2025*
✨ Terimakasih telah menggunakan layanan kami!
`;
        return resolve(msg);
      } catch (err2) {
        console.error('❌ Gagal request API server:', err2.message || err2);
        if (err2.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(err2.response.data, null, 2)}`);
        }
        return resolve('❌ Gagal terhubung ke server VPN. Coba lagi nanti.');
      }
    });
  });
}

async function createvmess(username, exp, quota, limitip, serverId) {
  console.log(`Creating VMess account for ${username} with expiry ${exp} days, quota ${quota} GB, IP limit ${limitip}`);

  // Validasi username
  if (!isValidUsername(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  if (!isValidExp(exp)) {
    return '❌ Durasi tidak valid.';
  }

  if (!isValidNonNegative(quota)) {
    return '❌ Quota tidak valid.';
  }

  if (!isValidNonNegative(limitip)) {
    return '❌ IP limit tidak valid.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/vmessall`;
      const web_URL = `http://${domain}${param}`; // contoh: http://idnusastb.domain.web.id/vps/vmess
      const AUTH_TOKEN = server.auth;
      const days = exp;
      const KUOTA = quota;
      const LIMIT_IP = limitip;

      try {
        const response = await httpPost(
          web_URL,
          { expired: days, kuota: KUOTA, limitip: LIMIT_IP, username },
          {
            headers: {
              Authorization: AUTH_TOKEN,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 15000,
          }
        );
        const d = response.data;
        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;

        const msg = `✅ *VMess Account Created Successfully!*

🔐 *Akun VMess Premium*
──────────────
👤 *Username*     : \`${s.username}\`
🌍 *Host*         : \`${s.hostname}\`
🛡 *UUID*         : \`${s.uuid}\`
🧾 *Expired*      : \`${s.expired}\` (${s.time})
📦 *Quota*        : \`${KUOTA === "0" ? "Unlimited" : KUOTA} GB\`
🔢 *IP Limit*     : \`${LIMIT_IP === "0" ? "Unlimited" : LIMIT_IP} IP\`
──────────────
📡 *Ports*:
- TLS         : ${s.port.tls}
- Non TLS     : ${s.port.none}
- Any Port    : ${s.port.any}
──────────────
📶 *Path*:
- WS          : ${s.path.stn} | ${s.path.multi}
- gRPC        : ${s.path.grpc}
- Upgrade     : ${s.path.up}
──────────────
🔗 *VMess Links*:
- TLS         : \`${s.link.tls}\`
──────────────
- Non TLS     : \`${s.link.none}\`
──────────────
- gRPC        : \`${s.link.grpc}\`
──────────────
- Up TLS      : \`${s.link.uptls}\`
──────────────
- Up Non-TLS  : \`${s.link.upntls}\`
──────────────
⚙️ *Settings*:
- AlterId     : \`0\`
- Security    : \`auto\`
- Network     : \`ws, grpc, upgrade\`

*© Telegram Bots - 2025*
✨ Terimakasih telah menggunakan layanan kami!
`;

        return resolve(msg);
      } catch (err2) {
        console.error('❌ Gagal request API server:', err2.message || err2);
        if (err2.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(err2.response.data, null, 2)}`);
        }
        return resolve('❌ Gagal terhubung ke server VPN. Coba lagi nanti.');
      }
    });
  });
}

async function createvless(username, exp, quota, limitip, serverId) {
  console.log(`Creating VLESS account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip}`);

  // Validasi username
  if (!isValidUsername(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  if (!isValidExp(exp)) {
    return '❌ Durasi tidak valid.';
  }

  if (!isValidNonNegative(quota)) {
    return '❌ Quota tidak valid.';
  }

  if (!isValidNonNegative(limitip)) {
    return '❌ IP limit tidak valid.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/vlessall`;
      const web_URL = `http://${domain}${param}`; // Contoh: http://domainmu.com/vps/vless
      const AUTH_TOKEN = server.auth;
      const days = exp;
      const KUOTA = quota;
      const LIMIT_IP = limitip;

      try {
        const response = await httpPost(
          web_URL,
          { expired: days, kuota: KUOTA, limitip: LIMIT_IP, username },
          {
            headers: {
              Authorization: AUTH_TOKEN,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 15000,
          }
        );
        const d = response.data;
        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;

        const msg = `✅ *VLESS Account Created Successfully!*

🔐 *Akun VLESS Premium*
──────────────
👤 *Username*     : \`${s.username}\`
🌍 *Host*         : \`${s.hostname}\`
🛡 *UUID*         : \`${s.uuid}\`
📅 *Expired*      : \`${s.expired}\` (${s.time})
📦 *Quota*        : \`${KUOTA === "0" ? "Unlimited" : KUOTA} GB\`
🔢 *IP Limit*     : \`${LIMIT_IP === "0" ? "Unlimited" : LIMIT_IP} IP\`
──────────────
📡 *Ports*:
- TLS         : ${s.port.tls}
- Non TLS     : ${s.port.none}
- Any Port    : ${s.port.any}
──────────────
📶 *Path*:
- WS          : ${s.path.stn} | ${s.path.multi}
- gRPC        : ${s.path.grpc}
- Upgrade     : ${s.path.up}
──────────────
🔗 *VLESS Links*:
- TLS         : \`${s.link.tls}\`
──────────────
- Non TLS     : \`${s.link.none}\`
──────────────
- gRPC        : \`${s.link.grpc}\`
──────────────
- Up TLS      : \`${s.link.uptls}\`
──────────────
- Up Non-TLS  : \`${s.link.upntls}\`
──────────────
⚙️ *Settings*:
- Security    : \`auto\`
- Network     : \`ws, grpc, upgrade\`

*© Telegram Bots - 2025*
✨ Terimakasih telah menggunakan layanan kami!
`;

        return resolve(msg);
      } catch (err2) {
        console.error('❌ Gagal request API server:', err2.message || err2);
        if (err2.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(err2.response.data, null, 2)}`);
        }
        return resolve('❌ Gagal terhubung ke server VPN. Coba lagi nanti.');
      }
    });
  });
}

async function createtrojan(username, exp, quota, limitip, serverId) {
  console.log(`Creating Trojan account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip}`);

  // Validasi username
  if (!isValidUsername(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  if (!isValidExp(exp)) {
    return '❌ Durasi tidak valid.';
  }

  if (!isValidNonNegative(quota)) {
    return '❌ Quota tidak valid.';
  }

  if (!isValidNonNegative(limitip)) {
    return '❌ IP limit tidak valid.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ Error fetching server:', err?.message || 'server null');
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      const domain = server.domain;
      const param = `/vps/trojanall`;
      const web_URL = `http://${domain}${param}`; // contoh: http://domainmu.com/vps/trojan
      const AUTH_TOKEN = server.auth;
      const days = exp;
      const KUOTA = quota;
      const LIMIT_IP = limitip;

      try {
        const response = await httpPost(
          web_URL,
          { expired: days, kuota: KUOTA, limitip: LIMIT_IP, username },
          {
            headers: {
              Authorization: AUTH_TOKEN,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 15000,
          }
        );
        const d = response.data;
        if (d?.meta?.code !== 200 || !d.data) {
          console.error('❌ Respons error:', d);
          const errMsg = d?.message || d?.meta?.message || JSON.stringify(d, null, 2);
          return resolve(`❌ Respons error:\n${errMsg}`);
        }

        const s = d.data;

        const msg = `✅ *Trojan Account Created Successfully!*

🔐 *Akun TROJAN Premium*
──────────────
👤 *Username*     : \`${s.username}\`
🌍 *Host*         : \`${s.hostname}\`
🔑 *Key*          : \`${s.uuid}\`
📅 *Expired*      : \`${s.expired}\` (${s.time})
📦 *Quota*        : \`${KUOTA === "0" ? "Unlimited" : KUOTA} GB\`
🔢 *IP Limit*     : \`${LIMIT_IP === "0" ? "Unlimited" : LIMIT_IP} IP\`
──────────────
📡 *Ports*:
- TLS         : ${s.port.tls}
- Non TLS     : ${s.port.none}
- Any Port    : ${s.port.any}
──────────────
📶 *Path*:
- WS          : ${s.path.stn} | ${s.path.multi}
- gRPC        : ${s.path.grpc}
- Upgrade     : ${s.path.up}
──────────────
🔗 *Trojan Links*:
- TLS         : \`${s.link.tls}\`
──────────────
- gRPC        : \`${s.link.grpc}\`
──────────────
- Up TLS      : \`${s.link.uptls}\`
──────────────
⚙️ *Settings*:
- Security    : \`auto\`
- Network     : \`ws, grpc, upgrade\`

*© Telegram Bots - 2025*
✨ Terimakasih telah menggunakan layanan kami!
`;

        return resolve(msg);
      } catch (err2) {
        console.error('❌ Gagal request API server:', err2.message || err2);
        if (err2.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(err2.response.data, null, 2)}`);
        }
        return resolve('❌ Gagal terhubung ke server VPN. Coba lagi nanti.');
      }
    });
  });
}

//create shadowsocks ga ada di potato
async function createshadowsocks(username, exp, quota, limitip, serverId) {
  console.log(`Creating Shadowsocks account for ${username} with expiry ${exp} days, quota ${quota} GB, limit IP ${limitip} on server ${serverId}`);

  // Validasi username
  if (!isValidUsername(username)) {
    return '❌ Username tidak valid. Mohon gunakan hanya huruf dan angka tanpa spasi.';
  }

  if (!isValidExp(exp)) {
    return '❌ Durasi tidak valid.';
  }

  if (!isValidNonNegative(quota)) {
    return '❌ Quota tidak valid.';
  }

  if (!isValidNonNegative(limitip)) {
    return '❌ IP limit tidak valid.';
  }

  // Ambil domain dari database
  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err) {
        console.error('Error fetching server:', err.message);
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      if (!server) return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');

      const domain = server.domain;
      const auth = server.auth;
      // TODO: pindah ke header auth (cek apakah endpoint mendukung header Authorization)
      const param = `:5888/createshadowsocks?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${auth}`;
      const url = `http://${domain}${param}`;
      try {
        const response = await httpGet(url, {
          headers: {
            Authorization: auth,
            Accept: 'application/json',
          },
          timeout: 15000,
        });
        if (response.data.status === "success") {
          const shadowsocksData = response.data.data;
          const msg = `
🌟 *AKUN SHADOWSOCKS PREMIUM* 🌟

🔹 *Informasi Akun*
┌─────────────────────
│ *Username* : \`${shadowsocksData.username}\`
│ *Domain*   : \`${shadowsocksData.domain}\`
│ *NS*       : \`${shadowsocksData.ns_domain}\`
│ *Port TLS* : \`443\`
│ *Port HTTP*: \`80\`
│ *Alter ID* : \`0\`
│ *Security* : \`Auto\`
│ *Network*  : \`Websocket (WS)\`
│ *Path*     : \`/shadowsocks\`
│ *Path GRPC*: \`shadowsocks-grpc\`
└─────────────────────
🔐 *URL SHADOWSOCKS TLS*
\`\`\`
${shadowsocksData.ss_link_ws}
\`\`\`
🔒 *URL SHADOWSOCKS GRPC*
\`\`\`
${shadowsocksData.ss_link_grpc}
\`\`\`
🔒 *PUBKEY*
\`\`\`
${shadowsocksData.pubkey}
\`\`\`
┌─────────────────────
│ Expiry: \`${shadowsocksData.expired}\`
│ Quota: \`${shadowsocksData.quota === '0 GB' ? 'Unlimited' : shadowsocksData.quota}\`
│ IP Limit: \`${shadowsocksData.ip_limit === '0' ? 'Unlimited' : shadowsocksData.ip_limit} IP\`
└─────────────────────
Save Account Link: [Save Account](https://${shadowsocksData.domain}:81/shadowsocks-${shadowsocksData.username}.txt)
✨ Selamat menggunakan layanan kami! ✨
`;
          console.log('Shadowsocks account created successfully');
          return resolve(msg);
        } else {
          console.log('Error creating Shadowsocks account');
          return resolve(`❌ Terjadi kesalahan: ${response.data.message}`);
        }
      } catch (error) {
        console.error('Error saat membuat Shadowsocks:', error.message || error);
        if (error.response?.data) {
          return resolve(`❌ Respons error:\n${JSON.stringify(error.response.data, null, 2)}`);
        }
        return resolve('❌ Terjadi kesalahan saat membuat Shadowsocks. Silakan coba lagi nanti.');
      }
    });
  });
}

module.exports = { createssh, createvmess, createvless, createtrojan, createshadowsocks };
