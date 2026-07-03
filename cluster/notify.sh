#!/usr/bin/env bash
# ════════════════════════════════════════════
# notify.sh — Send Telegram alert
# ════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

send_alert() {
  local message="$1"
  local bot_token="${2:-$TELEGRAM_BOT_TOKEN}"
  local chat_id="${3:-$TELEGRAM_CHAT_ID}"

  if [ -z "$bot_token" ] || [ -z "$chat_id" ]; then
    echo "[notify] Telegram not configured — skipping alert"
    return
  fi

  local hostname=$(hostname)
  local ip=$(hostname -I | awk '{print $1}')
  local full_msg="🤖 *Aman Pharma Cluster* — $hostname ($ip)%0A%0A$message"

  curl -s -o /dev/null \
    "https://api.telegram.org/bot$bot_token/sendMessage" \
    -d "chat_id=$chat_id&text=$full_msg&parse_mode=Markdown" 2>/dev/null
}

# If run directly, send the argument
if [ "$#" -ge 1 ]; then
  send_alert "$1"
fi
