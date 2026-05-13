#!/bin/bash
#
# cek-port.sh - cek status port SSH/HTTP/HTTPS ke sekumpulan server VPN.
#
# Daftar server dibaca dari file 'cek-port.servers' (satu hostname per baris,
# baris kosong + baris '#' diabaikan). File ini ada di .gitignore supaya
# config lokal di VPS tidak nyangkut di git saat update.
#
# Kalau file belum ada, script auto-create dari 'cek-port.servers.example'.
# Override via env var juga bisa:
#   SERVER_LIST_FILE=/path/ke/file bash cek-port.sh
#   SERVERS="a.example.com b.example.com" bash cek-port.sh
#   PORTS="22 80 443 2222" bash cek-port.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_LIST_FILE="${SERVER_LIST_FILE:-$SCRIPT_DIR/cek-port.servers}"
EXAMPLE_FILE="$SCRIPT_DIR/cek-port.servers.example"

if [ -n "$SERVERS" ]; then
  read -r -a servers <<< "$SERVERS"
else
  if [ ! -f "$SERVER_LIST_FILE" ] && [ -f "$EXAMPLE_FILE" ]; then
    cp "$EXAMPLE_FILE" "$SERVER_LIST_FILE"
    echo "File $SERVER_LIST_FILE belum ada, dibuat dari example."
    echo "Edit list server-nya lalu jalankan ulang: bash cek-port.sh"
    exit 0
  fi

  if [ ! -f "$SERVER_LIST_FILE" ]; then
    echo "File server list tidak ditemukan: $SERVER_LIST_FILE"
    echo "Bikin dulu file itu (satu hostname per baris) atau set env SERVERS."
    exit 1
  fi

  mapfile -t servers < <(grep -Ev '^\s*(#|$)' "$SERVER_LIST_FILE" | awk '{$1=$1;print}')
fi

if [ ${#servers[@]} -eq 0 ]; then
  echo "Tidak ada server yang terdaftar di $SERVER_LIST_FILE (atau env SERVERS kosong)."
  exit 1
fi

if [ -n "$PORTS" ]; then
  read -r -a ports <<< "$PORTS"
else
  ports=(22 80 443)
fi

green="\e[32m"
red="\e[31m"
nc="\e[0m"

echo "Cek status server pada port ${ports[*]}"
echo "-------------------------------------------"

for server in "${servers[@]}"; do
  echo -e "\nServer: $server"
  for port in "${ports[@]}"; do
    timeout 2 bash -c "</dev/tcp/$server/$port" &>/dev/null
    if [[ $? -eq 0 ]]; then
      echo -e "  Port $port: ${green}OPEN${nc}"
    else
      echo -e "  Port $port: ${red}CLOSED${nc}"
    fi
  done
done
