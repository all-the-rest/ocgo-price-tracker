#!/usr/bin/env bash
# uninstall-cron.sh — Remove ocgo-price-tracker cron setup
set -euo pipefail

CRON_FILE="/etc/cron.d/ocgo-price-tracker"
TOKEN_FILE="/etc/ocgo-tracker.env"

echo "Removing ${CRON_FILE}..."
rm -f "$CRON_FILE" && echo "✓ Cron removed" || echo "! Cron file not found"

echo "Removing ${TOKEN_FILE}..."
rm -f "$TOKEN_FILE" && echo "✓ Token removed" || echo "! Token file not found"

echo "Done. Verify: crontab -l"
