#!/usr/bin/env bash
# dispatch-cron.sh — Cron wrapper: sleeps a random 0–600s (±10 min), then dispatches.
# Called by the cron entries in /etc/cron.d/ocgo-price-tracker.
#
# All configuration is read from /etc/ocgo-tracker.env (GH_PAT).

set -uo pipefail

TOKEN_FILE="/etc/ocgo-tracker.env"
API_URL="https://api.github.com/repos/reisi007/ocgo-price-tracker/actions/workflows/price-tracker.yml/dispatches"
LOG_FILE="/var/log/ocgo-price-tracker.log"

# Random delay: 0–600 seconds (0–10 minutes)
DELAY=$(( RANDOM % 601 ))
sleep "$DELAY"

# Read token
TOKEN=$(grep '^GH_PAT=' "$TOKEN_FILE" | cut -d= -f2)
if [[ -z "$TOKEN" ]]; then
  echo "$(date -Iseconds) ERROR: No token in $TOKEN_FILE" >> "$LOG_FILE"
  exit 1
fi

# Dispatch
HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$API_URL" \
  -d '{"ref":"main"}')

echo "$(date -Iseconds) dispatch delay=${DELAY}s HTTP=${HTTP_CODE}" >> "$LOG_FILE"

if [[ "$HTTP_CODE" != "204" ]]; then
  echo "$(date -Iseconds) ERROR: Dispatch failed (HTTP $HTTP_CODE)" >> "$LOG_FILE"
  exit 1
fi
