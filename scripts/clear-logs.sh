#!/bin/bash
# Script untuk clear PM2 logs agar bersih untuk debugging

echo "=== CLEAR PM2 LOGS ==="

cd /root/BotVPN

echo "1. Flush PM2 logs:"
pm2 flush

echo -e "\n2. Verify logs cleared:"
pm2 logs sellvpn --lines 5 --nostream

echo -e "\n=== LOGS CLEARED ==="
echo "Sekarang Bos bisa test button dan lihat log fresh:"
echo "  pm2 logs sellvpn --lines 0 --raw"
