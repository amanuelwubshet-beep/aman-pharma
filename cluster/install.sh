#!/usr/bin/env bash
# ════════════════════════════════════════════
# install.sh — Install cluster system on all 3 Pis
# Run this once on your PC to set up everything
# ════════════════════════════════════════════

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
step()  { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

CLUSTER_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$CLUSTER_DIR/config.sh"
SSH_DIR="$HOME/.ssh"

# ────────────────────────────────────────────
# Load config
# ────────────────────────────────────────────
step "Loading cluster configuration"
source "$CONFIG"

echo "  Pi1 (MAIN):   $PI1_IP"
echo "  Pi2 (BACKUP): $PI2_IP"
echo "  Pi3 (DR):     $PI3_IP"
echo "  Domain:       $DOMAIN"
echo "  Project:      $PROJECT_DIR"
echo ""

read -p "Are these IPs correct? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
  err "Edit config.sh first, then re-run"
fi

# ────────────────────────────────────────────
# SSH key setup
# ────────────────────────────────────────────
step "Setting up SSH keys for passwordless access"

if [ ! -f "$SSH_DIR/id_ed25519" ]; then
  info "Generating SSH key..."
  ssh-keygen -t ed25519 -o -f "$SSH_DIR/id_ed25519" -N "" -C "aman-cluster"
else
  info "SSH key already exists"
fi

install_key() {
  local ip="$1"
  local label="$2"
  echo ""
  warn "For $label ($ip): enter the password when prompted"
  ssh-copy-id -o StrictHostKeyChecking=no "deploy@$ip" 2>/dev/null || \
    ssh-copy-id "deploy@$ip"
  info "$label SSH key installed"
}

install_key "$PI1_IP" "Pi1 (MAIN)"
install_key "$PI2_IP" "Pi2 (BACKUP)"
install_key "$PI3_IP" "Pi3 (DR)"

# ────────────────────────────────────────────
# Copy cluster scripts + project to all Pis
# ────────────────────────────────────────────
step "Copying files to all Pis"

copy_to_pi() {
  local ip="$1"
  local label="$2"

  info "Copying cluster scripts to $label..."
  ssh "deploy@$ip" "mkdir -p $PROJECT_DIR/cluster $PROJECT_DIR/backend"
  scp -r "$CLUSTER_DIR"/* "deploy@$ip:$PROJECT_DIR/cluster/"
  ssh "deploy@$ip" "chmod +x $PROJECT_DIR/cluster/*.sh"
  info "$label: cluster scripts installed"
}

copy_to_pi "$PI1_IP" "Pi1 (MAIN)"
copy_to_pi "$PI2_IP" "Pi2 (BACKUP)"
copy_to_pi "$PI3_IP" "Pi3 (DR)"

# Also copy the main project
info "Copying main project to Pi1..."
scp -r "$CLUSTER_DIR/../backend" "$CLUSTER_DIR/../index.html" "$CLUSTER_DIR/../store.html" "$CLUSTER_DIR/../admin.html" "$CLUSTER_DIR/../assets" "deploy@$PI1_IP:$PROJECT_DIR/" 2>/dev/null || \
  warn "Main project not found — copy manually later"

# ────────────────────────────────────────────
# Set up crontabs
# ────────────────────────────────────────────
step "Setting up cron jobs"

# Pi1: Sync every hour
info "Pi1: hourly sync"
ssh "deploy@$PI1_IP" "(crontab -l 2>/dev/null; echo '0 * * * * $PROJECT_DIR/cluster/sync.sh >/dev/null 2>&1') | crontab -"

# Pi2: Sync every hour + health check every minute
info "Pi2: hourly sync + health check every minute"
ssh "deploy@$PI2_IP" "(crontab -l 2>/dev/null; echo '0 * * * * $PROJECT_DIR/cluster/sync.sh >/dev/null 2>&1') | crontab -"
ssh "deploy@$PI2_IP" "(crontab -l 2>/dev/null; echo '* * * * * $PROJECT_DIR/cluster/health-check.sh >/dev/null 2>&1') | crontab -"

# Pi3: Daily sync + health check every minute
info "Pi3: daily sync + health check every minute"
ssh "deploy@$PI3_IP" "(crontab -l 2>/dev/null; echo '0 3 * * * $PROJECT_DIR/cluster/sync.sh >/dev/null 2>&1') | crontab -"
ssh "deploy@$PI3_IP" "(crontab -l 2>/dev/null; echo '* * * * * $PROJECT_DIR/cluster/health-check.sh >/dev/null 2>&1') | crontab -"

info "Cron jobs set on all Pis"

# ────────────────────────────────────────────
# Test connectivity
# ────────────────────────────────────────────
step "Testing cluster connectivity"

test_pi() {
  local ip="$1"
  local label="$2"
  ssh -o ConnectTimeout=5 "deploy@$ip" "hostname && echo '  Uptime:' && uptime -p" 2>/dev/null && \
    info "$label connected" || \
    warn "$label unreachable — check network"
}

test_pi "$PI1_IP" "Pi1 (MAIN)"
test_pi "$PI2_IP" "Pi2 (BACKUP)"
test_pi "$PI3_IP" "Pi3 (DR)"

# ────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       CLUSTER SETUP COMPLETE                     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Pi1 (MAIN) : $PI1_IP"
echo "    → Syncs to Pi2 every hour"
echo ""
echo "  Pi2 (BACKUP) : $PI2_IP"
echo "    → Syncs from Pi1 every hour"
echo "    → Checks Pi1 every 60 seconds"
echo "    → Fails over if Pi1 is down"
echo ""
echo "  Pi3 (DR) : $PI3_IP"
echo "    → Syncs from Pi2 daily at 3am"
echo "    → Checks Pi1 every 60 seconds"
echo "    → Fails over if Pi1 + Pi2 are down"
echo ""
echo "  ─ COMMANDS ─"
echo "  Manual sync:     ssh deploy@PI_IP '$PROJECT_DIR/cluster/sync.sh'"
echo "  Force failover:  ssh deploy@PI_IP '$PROJECT_DIR/cluster/failover.sh'"
echo "  Recover Pi1:     ssh deploy@$PI1_IP '$PROJECT_DIR/cluster/recover.sh'"
echo "  View logs:       ssh deploy@PI_IP 'tail -f ~/sync.log'"
echo "  Check failover:  ssh deploy@PI_IP 'cat ~/.failover-active 2>/dev/null || echo no failover'"
echo ""
echo "  ─ ALERTS ─"
echo "  Edit config.sh to add your Telegram bot token"
echo "  for failover notifications."
echo ""
