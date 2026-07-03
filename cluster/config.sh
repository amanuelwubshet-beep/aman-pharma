#!/usr/bin/env bash
# ════════════════════════════════════════════
# Cluster Configuration
# Edit these values for your setup
# ════════════════════════════════════════════

# --- Pi roles ---
# MAIN   = Pi 1 (your room, Addis)
# BACKUP = Pi 2 (your room, Addis)
# DR     = Pi 3 (dad's company, Hawassa)

# Local IPs (use static IPs on your router)
PI1_IP="192.168.1.10"      # MAIN  — change to your Pi1 local IP
PI2_IP="192.168.1.11"      # BACKUP — change to your Pi2 local IP
PI3_IP="192.168.1.20"      # DR    — change to your Pi3 local IP

# Public IPs (for cross-city failover)
PI1_PUBLIC=""               # Optional — your home public IP
PI3_PUBLIC=""               # Optional — dad's public IP in Hawassa

# Paths
PROJECT_DIR="/var/www/aman-pharma"
DB_FILE="$PROJECT_DIR/backend/store.db"
BACKUP_DIR="$HOME/backups"
SYNC_LOG="$HOME/sync.log"

# Telegram alerts
TELEGRAM_BOT_TOKEN="8876513217:AAFiOYhKDlMDS5zeFJClMprUY9WJ-VFJ97g"
TELEGRAM_CHAT_ID="1232328451"

# Sync intervals (in minutes)
SYNC_INTERVAL_MAIN=60       # Pi1 → Pi2: every 60 min
SYNC_INTERVAL_DR=1440       # Pi2 → Pi3: every 1440 min (daily)

# Health check
CHECK_INTERVAL=60           # Check every 60 seconds
FAIL_THRESHOLD=3            # After 3 failed checks, trigger failover

# Domain
DOMAIN="amanpharma.com"
