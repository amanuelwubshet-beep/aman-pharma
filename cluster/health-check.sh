#!/usr/bin/env bash
# ════════════════════════════════════════════
# health-check.sh — Monitor Pi1, trigger failover
# Runs on Pi2 (BACKUP) and Pi3 (DR)
# ════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/notify.sh"

HOSTNAME=$(hostname)
LOCAL_IP=$(hostname -I | awk '{print $1}')
CHECK_LOG="$HOME/health-check.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$CHECK_LOG"
}

# ────────────────────────────────────────────
# Determine this Pi's role
# ────────────────────────────────────────────
determine_role() {
  if [ "$LOCAL_IP" = "$PI2_IP" ]; then
    echo "backup"
  elif [ "$LOCAL_IP" = "$PI3_IP" ]; then
    echo "dr"
  else
    echo "unknown"
  fi
}

ROLE=$(determine_role)

if [ "$ROLE" = "unknown" ]; then
  log "This Pi is not configured as BACKUP or DR — exiting"
  exit 1
fi

# ────────────────────────────────────────────
# Check if an IP is alive
# ────────────────────────────────────────────
check_host() {
  local ip="$1"
  local label="$2"

  # Try ping first (3 fast pings)
  ping -c 3 -W 2 "$ip" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    log "$label ($ip): alive via ping"
    return 0
  fi

  # Try port 80/443 (site might be up even if ping blocked)
  timeout 5 curl -s -o /dev/null -w "%{http_code}" "http://$ip" 2>/dev/null | grep -q "200\|301\|302"
  if [ $? -eq 0 ]; then
    log "$label ($ip): alive via HTTP"
    return 0
  fi

  # Try SSH port
  timeout 3 bash -c "echo > /dev/tcp/$ip/22" 2>/dev/null
  if [ $? -eq 0 ]; then
    log "$label ($ip): alive via SSH"
    return 0
  fi

  log "$label ($ip): DEAD"
  return 1
}

# ────────────────────────────────────────────
# State tracking
# ────────────────────────────────────────────
STATE_FILE="$HOME/.failover-state"
touch "$STATE_FILE"
source "$STATE_FILE" 2>/dev/null

if [ -z "$MAIN_FAIL_COUNT" ]; then
  MAIN_FAIL_COUNT=0
fi

# ────────────────────────────────────────────
# Main check
# ────────────────────────────────────────────
if check_host "$PI1_IP" "MAIN (Pi1)"; then
  # Main is alive — reset fail counter
  MAIN_FAIL_COUNT=0
  save_state() {
    echo "MAIN_FAIL_COUNT=$MAIN_FAIL_COUNT" > "$STATE_FILE"
  }
  save_state
  exit 0
fi

# Main is not responding
MAIN_FAIL_COUNT=$((MAIN_FAIL_COUNT + 1))
log "MAIN fail count: $MAIN_FAIL_COUNT / $FAIL_THRESHOLD"

if [ "$MAIN_FAIL_COUNT" -ge "$FAIL_THRESHOLD" ]; then
  log "FAILOVER THRESHOLD REACHED — Main is DOWN!"
  send_alert "🔥 *MAIN SERVER DOWN*%0APi1 ($PI1_IP) unreachable for $FAIL_THRESHOLD checks%0ARole: $ROLE%0AFailover triggered."

  # Don't reset counter — keep it so failover lasts
  # Reset only when main recovers

  # Run failover script
  bash "$SCRIPT_DIR/failover.sh" "$ROLE"
else
  log "Main down but threshold not reached ($MAIN_FAIL_COUNT/$FAIL_THRESHOLD)"
fi

# Save state
save_state() {
  echo "MAIN_FAIL_COUNT=$MAIN_FAIL_COUNT" > "$STATE_FILE"
}
save_state
