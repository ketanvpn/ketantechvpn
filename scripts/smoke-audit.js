const fs = require('fs');
const path = require('path');

const APP_PATH = path.resolve(__dirname, '..', 'app.js');
const src = fs.readFileSync(APP_PATH, 'utf8');

const failures = [];

function assertRegex(regex, message) {
  if (!regex.test(src)) failures.push(message);
}

function assertNoRegex(regex, message) {
  if (regex.test(src)) failures.push(message);
}

// 1) Tidak boleh ada eval di app.js
assertNoRegex(/\beval\s*\(/, 'Ditemukan penggunaan eval() di app.js');

// 2) admin_menu wajib cek admin
assertRegex(
  /bot\.action\('admin_menu'[\s\S]*?if\s*\(!ctx\.from\s*\|\|\s*!ADMIN_IDS\.includes\(ctx\.from\.id\)\)/,
  'admin_menu belum punya guard admin yang memadai'
);

// 3) Action admin_res_bonus_* kritikal wajib cek admin
[
  'admin_res_bonus_mindur_inc',
  'admin_res_bonus_mindur_dec',
  'admin_res_bonus_omzet_inc',
  'admin_res_bonus_omzet_dec',
].forEach((actionName) => {
  const re = new RegExp(
    `bot\\.action\\('${actionName}'[\\s\\S]*?if\\s*\\(!ctx\\.from\\s*\\|\\|\\s*!ADMIN_IDS\\.includes\\(ctx\\.from\\.id\\)\\)`,
    'm'
  );
  assertRegex(re, `${actionName} belum punya guard admin`);
});

// 4) Handler tier bonus wajib guard admin dan tidak pakai eval
assertRegex(
  /bot\.action\(`admin_res_bonus_\$\{tier\}_days_inc`[\s\S]*?if\s*\(!ctx\.from\s*\|\|\s*!ADMIN_IDS\.includes\(ctx\.from\.id\)\)[\s\S]*?adjustResellerBonusVar\(dayVar,\s*1\)/,
  'tier days inc belum aman (guard/admin atau adjust helper)'
);
assertRegex(
  /bot\.action\(`admin_res_bonus_\$\{tier\}_amt_dec`[\s\S]*?if\s*\(!ctx\.from\s*\|\|\s*!ADMIN_IDS\.includes\(ctx\.from\.id\)\)[\s\S]*?adjustResellerBonusVar\(amountVar,\s*-5000\)/,
  'tier amount dec belum aman (guard/admin atau adjust helper)'
);

// 5) cekQRISGopayHistory harus pakai spawn shell:false (bukan exec cmd string)
assertRegex(
  /function\s+cekQRISGopayHistory[\s\S]*?spawn\('curl',\s*args,\s*\{\s*shell:\s*false,\s*windowsHide:\s*true\s*\}\)/,
  'cekQRISGopayHistory belum memakai spawn shell:false'
);

// 6) BEGIN IMMEDIATE TRANSACTION di app.js harus menangani error begin
// (nama variable boleh `err` / `beginErr` selama langsung reject).
assertRegex(
  /BEGIN IMMEDIATE TRANSACTION',\s*\((err|beginErr)\)\s*=>\s*\{\s*if\s*\(\1\)\s*return\s+reject\(\1\)/,
  'BEGIN IMMEDIATE TRANSACTION belum menangani error begin'
);

if (failures.length) {
  console.error('SMOKE AUDIT FAILED');
  failures.forEach((f, i) => {
    console.error(`${i + 1}. ${f}`);
  });
  process.exit(1);
}

console.log('SMOKE AUDIT PASSED');
