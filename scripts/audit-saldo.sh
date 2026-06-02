#!/bin/bash
echo "=== AUDIT SALDO BOT & WEB ==="

# Check bot saldo
echo -e "\n1. Saldo bot user 690744680:"
cd /root/BotVPN
sqlite3 sellvpn.db "SELECT user_id, web_user_id, saldo FROM users WHERE user_id = 690744680;"

# Check web saldo
echo -e "\n2. Saldo web user id=7 (kr2k3n):"
PGPASSWORD="***" psql -h localhost -U ketantech -d ketantech_db -t -c "SELECT id, username, vpn_telegram_id, balance FROM users WHERE id = 7;"

# Check balance logs terakhir
echo -e "\n3. Balance logs terakhir user id=7:"
PGPASSWORD="***" psql -h localhost -U ketantech -d ketantech_db -t -c "SELECT type, amount, balance_after, description, created_at FROM balance_logs WHERE user_id = 7 ORDER BY created_at DESC LIMIT 5;"

echo -e "\n=== SELESAI ==="
