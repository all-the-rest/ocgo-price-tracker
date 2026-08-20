#!/usr/bin/env bash
# install-cron.sh — Install/update ocgo-price-tracker external cron on a remote server.
# Runs locally; reads the server state over one SSH connection, applies over one.
#
# Token handling (the PAT lives on the server, not locally):
#   • Server already has a token (/etc/ocgo-tracker.env) → update mode:
#     the stored token is read from the server and reused — no local token needed.
#   • GITHUB_PAT set in the environment → explicit token, stored on the server
#     (replaces an existing one, e.g. rotation after expiry).
#   • Otherwise → first install: interactive prompt; the token is stored on the
#     server (root-only, 0600) and reused from then on.
#
# Usage:
#   ./scripts/install-cron.sh                       # update, or first install (prompts only if no server token)
#   GITHUB_PAT=ghp_xxx ./scripts/install-cron.sh    # explicit token (replaces the one on the server)
#   SERVER=root@myserver ./scripts/install-cron.sh  # custom server
#
# Requires: curl (local, for token verify + test dispatch), ssh

set -euo pipefail

# --- Configuration ---
REPO="all-the-rest/ocgo-price-tracker"
WORKFLOW="price-tracker.yml"
API_URL="https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches"
CRON_MARKER="# ocgo-price-tracker"
CRON_FILE="/etc/cron.d/ocgo-price-tracker"
TOKEN_FILE="/etc/ocgo-tracker.env"
SERVER="${SERVER:-root@reisinger.pictures}"

# SSH connection reuse: token read (step 1) and apply (step 5) share ONE master
# connection, so the run needs only a single password prompt. The socket lives
# in a per-run temp dir and is closed explicitly at the end (ControlPersist is
# the 5-minute fallback if the script dies earlier).
SSH_CTL_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ocgo-tracker-ssh.XXXXXX")
SSH_CTL="$SSH_CTL_DIR/control"
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$SSH_CTL" -o ControlPersist=300)
trap 'rm -rf "$SSH_CTL_DIR"' EXIT

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

# --- 1. Token: server first, prompt only as fallback ---
MODE="install"
if [[ -n "${GITHUB_PAT:-}" ]]; then
  # Explicit token from the environment: stored on the server (replaces an old one).
  info "Using GITHUB_PAT from environment (will be stored on ${SERVER})"
else
  # Try the token already stored on the server (update mode) — the secret never
  # needs to exist locally. "__NO_TOKEN__" = reachable server without a token
  # file; a failing ssh (unreachable server) aborts the script here.
  echo -n "Checking ${SERVER} for existing token... "
  READ_OUT=$(ssh "${SSH_OPTS[@]}" "$SERVER" "if [ -f ${TOKEN_FILE} ] && grep -q '^GH_PAT=' ${TOKEN_FILE}; then grep '^GH_PAT=' ${TOKEN_FILE} | cut -d= -f2; else echo '__NO_TOKEN__'; fi" 2>&1) || {
    error "Cannot reach ${SERVER} via SSH:"
    echo "$READ_OUT" >&2
    exit 1
  }
  if [[ "$READ_OUT" == "__NO_TOKEN__" || -z "$READ_OUT" ]]; then
    MODE="install"
    warn "No token on ${SERVER} yet — first install"
  else
    MODE="update"
    GITHUB_PAT="$READ_OUT"
    info "Token found on ${SERVER} (${TOKEN_FILE}) — update mode, no local token needed"
  fi
fi

# First install: prompt for a PAT (stored on the server, never locally)
if [[ "$MODE" == "install" && -z "${GITHUB_PAT:-}" ]]; then
  echo ""
  echo "=== ocgo-price-tracker — Cron Setup (first install) ==="
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
  echo "  → Repository access → Only select repositories → all-the-rest/ocgo-price-tracker"
  echo "  → Permissions → Repository permissions:"
  echo "      Metadata: Read (default)"
  echo "      Actions:  Read and Write"
  echo "      Contents: Read and Write"
  echo "  → Generate token"
  echo ""
  echo "The token will be stored on ${SERVER} (${TOKEN_FILE}, root-only)."
  echo "Afterwards this script only refreshes the schedule — no token needed."
  echo ""
  read -rsp "Paste your GitHub PAT: " GITHUB_PAT
  echo ""
  if [[ -z "$GITHUB_PAT" ]]; then
    error "No token provided. Exiting."
    exit 1
  fi
fi

# --- 2. Verify token ---
echo -n "Verifying token... "
HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${GITHUB_PAT}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}")

if [[ "$HTTP_CODE" != "200" ]]; then
  error "Token verification failed (HTTP $HTTP_CODE)."
  if [[ "$MODE" == "update" ]]; then
    error "The token on ${SERVER} (${TOKEN_FILE}) seems invalid or expired."
    error "Replace it via: GITHUB_PAT=xxx ./scripts/install-cron.sh"
  else
    error "Check your token."
  fi
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
trap 'rm -f "$CRON_TMP"; rm -rf "$SSH_CTL_DIR"' EXIT

WRAPPER="/usr/local/bin/ocgo-dispatch.sh"

cat << CRON > "$CRON_TMP"
# ocgo-price-tracker — External schedule (no GitHub Actions cron limit)
# All times in server local time (set to Europe/Vienna)
# Dispatch wrapper has built-in ±10 min random delay.
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# ─── Weekdays (Mon-Fri): every 2h, 06:00–20:00 ───
0  6  * * 1-5  root  ${WRAPPER} ${CRON_MARKER}
0  8  * * 1-5  root  ${WRAPPER} ${CRON_MARKER}
0 10  * * 1-5  root  ${WRAPPER} ${CRON_MARKER}
0 12  * * 1-5  root  ${WRAPPER} ${CRON_MARKER}
0 14  * * 1-5  root  ${WRAPPER} ${CRON_MARKER}
0 16  * * 1-5  root  ${WRAPPER} ${CRON_MARKER}
0 18  * * 1-5  root  ${WRAPPER} ${CRON_MARKER}
0 20  * * 1-5  root  ${WRAPPER} ${CRON_MARKER}

# ─── Weekends (Sat-Sun): 06:00 and 14:00 ───
0  6  * * 6,0  root  ${WRAPPER} ${CRON_MARKER}
0 14  * * 6,0  root  ${WRAPPER} ${CRON_MARKER}

# ─── Daily 22:30 REMOVED — replaced by GitHub Actions schedule at 20:28 UTC ───
CRON

# --- 5. Upload dispatch wrapper + apply cron (single SSH connection, one password) ---
echo -n "Applying to ${SERVER}... "
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Upload wrapper script via scp (reuses SSH ControlMaster — no extra password).
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/dispatch-cron.sh" "${SERVER}:${WRAPPER}" 2>/dev/null
ssh "${SSH_OPTS[@]}" "$SERVER" "chmod 755 ${WRAPPER}" 2>/dev/null

if [[ "$MODE" == "update" ]]; then
  # Update: token stays untouched, only refresh schedule + restart crond.
  ssh "${SSH_OPTS[@]}" "$SERVER" "cat > ${CRON_FILE} && chmod 644 ${CRON_FILE} && timedatectl set-timezone Europe/Vienna 2>/dev/null || true && systemctl restart crond 2>/dev/null || service crond restart 2>/dev/null || true && echo '=== Schedule applied ===' && grep -n 'Daily' ${CRON_FILE}" < "$CRON_TMP"
else
  # Install: token (first stdin line) + schedule + restart crond.
  { printf 'GH_PAT=%s\n' "$GITHUB_PAT"; cat "$CRON_TMP"; } | \
    ssh "${SSH_OPTS[@]}" "$SERVER" "IFS= read -r TOKEN_LINE && printf '%s\n' \"\$TOKEN_LINE\" > ${TOKEN_FILE} && chmod 600 ${TOKEN_FILE} && echo 'Token stored' && cat > ${CRON_FILE} && chmod 644 ${CRON_FILE} && timedatectl set-timezone Europe/Vienna 2>/dev/null || true && systemctl restart crond 2>/dev/null || service crond restart 2>/dev/null || true && echo '=== Schedule applied ===' && grep -n 'Daily' ${CRON_FILE}"
fi

info "Installed on ${SERVER}"
echo ""
if [[ "$MODE" == "update" ]]; then
  echo "Schedule updated (token on ${SERVER} reused)."
else
  echo "Schedule installed, token stored on ${SERVER}."
fi
echo "Schedule (server local time = Europe/Vienna):"
echo "  Weekdays:  every 2h from 06:00–20:00"
echo "  Weekends:  06:00 and 14:00"
echo "  Daily 22:30: handled by GitHub Actions schedule (20:28 UTC)"
echo ""
echo "To uninstall:"
echo "  ./scripts/uninstall-cron.sh"

# Close the shared SSH master connection (idempotent; ControlPersist would time out anyway).
ssh -O exit "${SSH_OPTS[@]}" "$SERVER" 2>/dev/null || true