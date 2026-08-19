#!/usr/bin/env bash
# install-cron.sh — Install/update ocgo-price-tracker external cron on a remote server.
# Runs locally, applies changes via a single SSH connection (one password).
#
# Usage:
#   ./scripts/install-cron.sh                          # prompts for PAT
#   GITHUB_PAT=ghp_xxx ./scripts/install-cron.sh      # non-interactive
#   SERVER=root@myserver ./scripts/install-cron.sh     # custom server
#
# Requires: curl, ssh

set -euo pipefail

# --- Configuration ---
REPO="reisi007/ocgo-price-tracker"
WORKFLOW="price-tracker.yml"
API_URL="https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches"
CRON_MARKER="# ocgo-price-tracker"
CRON_FILE="/etc/cron.d/ocgo-price-tracker"
TOKEN_FILE="/etc/ocgo-tracker.env"
SERVER="${SERVER:-root@reisinger.pictures}"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

# --- 1. Get token ---
if [[ -z "${GITHUB_PAT:-}" ]]; then
  echo ""
  echo "=== ocgo-price-tracker — Cron Setup ==="
  echo ""
  echo "You need a GitHub Personal Access Token (fine-grained) with"
  echo "these repository permissions on ${REPO}:"
  echo ""
  echo "  • Metadata:        Read (default)"
  echo "  • Actions:         Read and Write"
  echo "  • Contents:        Read and Write"
  echo ""
  echo "Create one at:"
  echo "  https://github.com/settings/tokens?type=beta"
  echo ""
  echo "  → Repository access → Only select repositories → ocgo-price-tracker"
  echo "  → Permissions → Repository permissions:"
  echo "      Metadata: Read (default)"
  echo "      Actions:  Read and Write"
  echo "      Contents: Read and Write"
  echo "  → Generate token"
  echo ""
  read -rsp "Paste your GitHub PAT: " GITHUB_PAT
  echo ""
  if [[ -z "$GITHUB_PAT" ]]; then
    error "No token provided. Exiting."
    exit 1
  fi
else
  info "Using GITHUB_PAT from environment"
fi

# --- 2. Verify token ---
echo -n "Verifying token... "
HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${GITHUB_PAT}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}")

if [[ "$HTTP_CODE" != "200" ]]; then
  error "Token verification failed (HTTP $HTTP_CODE). Check your token."
  exit 1
fi
info "Token is valid"

# --- 3. Test trigger ---
echo -n "Testing workflow dispatch... "
HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Authorization: Bearer ${GITHUB_PAT}" \
  -H "Accept: application/vnd.github+json" \
  "$API_URL" \
  -d '{"ref":"main"}')

if [[ "$HTTP_CODE" != "204" ]]; then
  error "Dispatch failed (HTTP $HTTP_CODE). Check token has Actions:write scope."
  exit 1
fi
info "Workflow triggered successfully (HTTP 204)"

# --- 4. Generate cron file content locally ---
CRON_TMP=$(mktemp)
trap 'rm -f "$CRON_TMP"' EXIT

cat << CRON > "$CRON_TMP"
# ocgo-price-tracker — External schedule (no GitHub Actions cron limit)
# All times in server local time (set to Europe/Vienna)
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# ─── Weekdays (Mon-Fri): every 2h, 06:00–20:00 ───
0  6  * * 1-5  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
0  8  * * 1-5  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
0 10  * * 1-5  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
0 12  * * 1-5  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
0 14  * * 1-5  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
0 16  * * 1-5  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
0 18  * * 1-5  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
0 20  * * 1-5  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}

# ─── Weekends (Sat-Sun): 06:00 and 14:00 ───
0  6  * * 6,0  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
0 14  * * 6,0  root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}

# ─── Daily: 22:30 (end-of-day capture, before midnight) ───
30 22  * * *    root  curl -fsSL -X POST -H "Authorization: Bearer \$(cat ${TOKEN_FILE} | cut -d= -f2)" -H "Accept: application/vnd.github+json" ${API_URL} -d '{\"ref\":\"main\"}' ${CRON_MARKER}
CRON

# --- 5. Apply to server (single SSH, one password) ---
echo -n "Applying to ${SERVER}... "
ssh "$SERVER" "if [ -f ${TOKEN_FILE} ]; then echo 'Token already configured — reusing'; else echo 'GH_PAT=${GITHUB_PAT}' > ${TOKEN_FILE} && chmod 600 ${TOKEN_FILE} && echo 'Token stored'; fi && cat > ${CRON_FILE} && chmod 644 ${CRON_FILE} && timedatectl set-timezone Europe/Vienna 2>/dev/null || true && systemctl restart crond 2>/dev/null || service crond restart 2>/dev/null || true && echo '=== Schedule applied ===' && grep -n 'Daily' ${CRON_FILE}" < "$CRON_TMP"

info "Installed on ${SERVER}"
echo ""
echo "Schedule (server local time = Europe/Vienna):"
echo "  Weekdays:  every 2h from 06:00–20:00"
echo "  Weekends:  06:00 and 14:00"
echo "  Daily:     22:30 (end-of-day capture, before midnight)"
echo ""
echo "To uninstall:"
echo "  ./scripts/uninstall-cron.sh"
