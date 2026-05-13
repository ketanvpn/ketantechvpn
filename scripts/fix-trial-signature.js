// Fix parameter mismatch di handler trial.
// trialssh signature: (username, password, exp, iplimit, serverId)
// trialvmess/vless/trojan/shadowsocks signature: (username, exp, quota, limitip, serverId)
// Caller di app.js pass 5 args yang sama untuk semua -> vmess/vless/trojan/shadowsocks
// dapat 'none' di posisi exp -> gagal "Durasi tidak valid".
const fs = require('fs');

let s = fs.readFileSync('app.js', 'utf8');

const OLD_BLOCK = "      const password = 'none';\r\n      const exp = durationHours;   // DIKIRIM ke script trial sebagai JUMLAH JAM\r\n      const iplimit = 'none';\r\n\r\n      const delFunctions = {\r\n        vmess: trialvmess,\r\n        vless: trialvless,\r\n        trojan: trialtrojan,\r\n        shadowsocks: trialshadowsocks,\r\n        ssh: trialssh\r\n      };\r\n\r\n      if (delFunctions[type]) {\r\n        const msg = await delFunctions[type](username, password, exp, iplimit, serverId);";

const NEW_BLOCK = "      const password = 'none';\r\n      const exp = durationHours;   // DIKIRIM ke script trial sebagai JUMLAH JAM\r\n      const iplimit = 1;           // trial default 1 IP\r\n      const quota = 1;             // trial default 1 GB (hanya dipakai non-ssh)\r\n\r\n      // Signature berbeda per type:\r\n      //   trialssh(username, password, exp, iplimit, serverId)\r\n      //   trialvmess/vless/trojan/shadowsocks(username, exp, quota, limitip, serverId)\r\n      let msg;\r\n      if (type === 'ssh') {\r\n        msg = await trialssh(username, password, exp, iplimit, serverId);\r\n      } else if (type === 'vmess') {\r\n        msg = await trialvmess(username, exp, quota, iplimit, serverId);\r\n      } else if (type === 'vless') {\r\n        msg = await trialvless(username, exp, quota, iplimit, serverId);\r\n      } else if (type === 'trojan') {\r\n        msg = await trialtrojan(username, exp, quota, iplimit, serverId);\r\n      } else if (type === 'shadowsocks') {\r\n        msg = await trialshadowsocks(username, exp, quota, iplimit, serverId);\r\n      }\r\n\r\n      if (msg) {";

const count = s.split(OLD_BLOCK).length - 1;
console.log('Match:', count);
s = s.split(OLD_BLOCK).join(NEW_BLOCK);

fs.writeFileSync('app.js', s);
console.log('Replaced ' + count + ' block.');
