#!/bin/bash
echo "=== DEBUG TOGGLE BUTTON ERROR ==="

cd /root/BotVPN

echo -e "\n1. Cek file handler ada:"
ls -la admin/toggle-weblink-handler.js

echo -e "\n2. Log error terakhir (30 baris):"
pm2 logs sellvpn --lines 30 --nostream | grep -i "error\|toggle" | tail -10

echo -e "\n3. Cek require statement di app.js:"
grep -n "toggle-weblink-handler" app.js

echo -e "\n4. Test syntax handler:"
node --check admin/toggle-weblink-handler.js 2>&1 || echo "Syntax OK"

echo -e "\n=== SELESAI ==="
