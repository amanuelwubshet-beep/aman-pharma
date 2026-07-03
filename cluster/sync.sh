#!/usr/bin/env bash
# ════════════════════════════════════════════
# sync.sh — Database sync between Pis
# Run on Pi1:  pushes to Pi2
# Run on Pi2:  pulls from Pi1, pushes to Pi3
# Run on Pi3:  pulls from Pi2
# ════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/notify.sh"

HOSTNAME=$(hostname)
LOCAL_IP=$(hostname -I | awk '{print $1}')
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

log() {
  echo "[$TIMESTAMP] $1" | tee -a "$SYNC_LOG"
}

backup_db() {
  local backup_file="$BACKUP_DIR/store-$(date +%Y%m%d-%H%M).db"
  mkdir -p "$BACKUP_DIR"
  cp "$DB_FILE" "$backup_file" 2>/dev/null
  # Keep only last 30 backups
  ls -t "$BACKUP_DIR"/store-*.db 2>/dev/null | tail -n +31 | xargs -r rm
  echo "$backup_file"
}

# ────────────────────────────────────────────
# Determine role
# ────────────────────────────────────────────
determine_role() {
  if [ "$LOCAL_IP" = "$PI1_IP" ]; then
    echo "main"
  elif [ "$LOCAL_IP" = "$PI2_IP" ]; then
    echo "backup"
  elif [ "$LOCAL_IP" = "$PI3_IP" ]; then
    echo "dr"
  else
    # Fallback: use hostname
    case "$HOSTNAME" in
      *pi1*|*main*)     echo "main" ;;
      *pi2*|*backup*)   echo "backup" ;;
      *pi3*|*dr*)       echo "dr" ;;
      *)                echo "unknown" ;;
    esac
  fi
}

ROLE=$(determine_role)

# ────────────────────────────────────────────
# Sync functions
# ────────────────────────────────────────────
sync_main_to_backup() {
  log "MAIN → BACKUP: Syncing database..."
  backup_db
  rsync -avz --delete \
    -e "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10" \
    "$DB_FILE" \
    "deploy@$PI2_IP:$DB_FILE" 2>>"$SYNC_LOG"
  if [ $? -eq 0 ]; then
    log "MAIN → BACKUP: Sync successful"
  else
    log "MAIN → BACKUP: Sync FAILED"
    send_alert "⚠️ Backup sync FAILED%0A Main → Backup unreachable"
  fi
}

sync_backup_to_dr() {
  log "BACKUP → DR: Syncing database..."
  backup_db
  rsync -avz --delete \
    -e "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15" \
    "$DB_FILE" \
    "deploy@$PI3_IP:$DB_FILE" 2>>"$SYNC_LOG"
  if [ $? -eq 0 ]; then
    log "BACKUP → DR: Sync successful"
  else
    log "BACKUP → DR: Sync FAILED"
    send_alert "⚠️ DR sync FAILED%0A Backup → Hawassa unreachable"
  fi
}

pull_from_main() {
  log "BACKUP: Pulling from MAIN..."
  backup_db
  rsync -avz \
    -e "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10" \
    "deploy@$PI1_IP:$DB_FILE" "$DB_FILE" 2>>"$SYNC_LOG"
  if [ $? -eq 0 ]; then
    log "BACKUP: Pull successful"
  else
    log "BACKUP: Pull FAILED (main may be down)"
  fi
}

pull_from_backup() {
  log "DR: Pulling from BACKUP..."
  backup_db
  rsync -avz \
    -e "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15" \
    "deploy@$PI2_IP:$DB_FILE" "$DB_FILE" 2>>"$SYNC_LOG"
  if [ $? -eq 0 ]; then
    log "DR: Pull successful"
  else
    log "DR: Pull FAILED (backup may be down)"
  fi
}

# ────────────────────────────────────────────
# Execute based on role
# ────────────────────────────────────────────
case "$ROLE" in
  main)
    sync_main_to_backup
    ;;
  backup)
    pull_from_main
    sync_backup_to_dr
    ;;
  dr)
    pull_from_backup
    ;;
  *)
    log "Unknown role — cannot sync"
    exit 1
    ;;
esac
