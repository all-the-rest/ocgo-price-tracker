#!/usr/bin/env bash
# uninstall-cron.sh — Remove ocgo-price-tracker cron from a remote server.
# Runs locally, applies via a single SSH connection (one password).
#
# Usage:
#   ./scripts/uninstall-cron.sh                      # default server
#   SERVER=root@myserver ./scripts/uninstall-cron.sh # custom server
#
# Requires: ssh

set -euo pipefail

SERVER="${SERVER:-root@reisinger.pictures}"
CRON_FILE="/etc/cron.d/ocgo-price-tracker"
TOKEN_FILE="/etc/ocgo-tracker.env"

echo ""
echo "=== ocgo-price-tracker — Cron Removal ==="
echo ""
echo "This will remove from ${SERVER}:"
echo "  • ${CRON_FILE}"
echo "  • ${TOKEN_FILE}"
echo ""
read -rsp "Press Enter to confirm, Ctrl+C to abort... " _
echo ""

echo -n "Removing on ${SERVER}... "
ssh "$SERVER" bash -s << REMOTE
set -euo pipefail
echo -n "Removing ${CRON_FILE}... "
rm -f "${CRON_FILE}" && echo "✓ Cron removed" || echo "✗ Cron file not found"
echo -n "Removing ${TOKEN_FILE}... "
rm -f "${TOKEN_FILE}" && echo "✓ Token removed" || echo "✗ Token file not found"
echo ""
echo "Done. Verify: crontab -l"
REMOTE

echo ""
echo "✓ Removed cron setup from ${SERVER}"
