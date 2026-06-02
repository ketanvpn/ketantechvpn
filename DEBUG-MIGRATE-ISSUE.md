#!/bin/bash
echo "=== DEBUG MIGRATE SALDO ISSUE ==="

echo -e "\n1. Cek user 690744680 di bot:"
cd /root/BotVPN
sqlite3 sellvpn.db "SELECT user_id, web_user_id, saldo FROM users WHERE user_id = 690744680;"

echo -e "\n2. Cek user id=7 di web (linked status):"
echo "PGPASSWORD='***' psql -h localhost -U ketantech -d ketantech_db -c \"SELECT id, username, vpn_telegram_id, balance FROM users WHERE id = 7;\""

echo -e "\n3. Cek balance_logs untuk refId migrate_telegram_690744680:"
echo "PGPASSWORD='***' psql -h localhost -U ketantech -d ketantech_db -c \"SELECT id, user_id, type, amount, description, created_at FROM balance_logs WHERE description LIKE '%migrate_telegram_690744680%' ORDER BY created_at DESC;\""

echo -e "\n4. Cek log bot terakhir (migrate related):"
cd /root/BotVPN
tail -50 app.log 2>/dev/null | grep -i "migrate\|690744680" | tail -10

echo -e "\n=== DIAGNOSIS ==="
echo "Jika balance_logs ada row dengan refId migrate_telegram_690744680:"
echo "  → RefId DUPLICATE, web skip credit (applied=false)"
echo "  → Bot SEHARUSNYA tidak reset saldo (fix terbaru)"
echo ""
echo "Jika balance_logs TIDAK ada row:"
echo "  → Credit ke web GAGAL (network/auth error)"
echo "  → Cek app.log untuk error detail"
echo ""
echo "Jika vpn_telegram_id NULL di web:"
echo "  → Link GAGAL atau di-reset saat unlink"
echo "  → User harus link ulang dari web"
