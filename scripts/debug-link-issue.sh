#!/bin/bash
# Script untuk debug link/unlink issue di production VPS

echo "=== DEBUG BOT VPN LINK/UNLINK ISSUE ==="
echo ""

cd /root/BotVPN || { echo "Error: /root/BotVPN tidak ditemukan"; exit 1; }

echo "1. Git status & commit terakhir:"
git log --oneline -1
echo ""

echo "2. Cek fungsi unlink ada di code:"
grep -n "web_link_unlink" app.js | head -3
echo ""

echo "3. Cek fungsi handleWebLinkToken ada di code:"
grep -n "handleWebLinkToken" app.js | head -3
echo ""

echo "4. Cek status link user 690744680:"
sqlite3 botvpn.db "SELECT user_id, web_user_id, web_linked_at, saldo FROM users WHERE user_id = 690744680;"
echo ""

echo "5. Cek env WEB_API:"
grep -E "WEB_API_BASE_URL|WEB_API_BOT_KEY|WEB_LINK_ENABLED" .env | sed 's/=.*/=***/'
echo ""

echo "6. Cek pm2 status bot:"
pm2 list | grep -i vpn
echo ""

echo "=== SELESAI ==="
