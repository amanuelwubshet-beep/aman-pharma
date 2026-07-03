#!/usr/bin/env bash
# ════════════════════════════════════════════
# manage.sh — One command to manage the cluster
# Usage: ./manage.sh [command]
# ════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"

case "${1:-help}" in
  status)
    echo "━━━ Cluster Status ━━━"
    for label in "MAIN|$PI1_IP" "BACKUP|$PI2_IP" "DR|$PI3_IP"; do
      name="${label%%|*}"
      ip="${label##*|}"
      ping -c 1 -W 2 "$ip" >/dev/null 2>&1 && echo "  $name ($ip): ONLINE" || echo "  $name ($ip): OFFLINE"
    done
    echo ""
    echo "  Failover active:"
    ssh "deploy@$PI2_IP" "cat ~/.failover-active 2>/dev/null || echo '    No active failover'" 2>/dev/null || echo "    Backup unreachable"
    ;;
  sync)
    echo "━━━ Running manual sync on all Pis ━━━"
    for label in "MAIN|$PI1_IP" "BACKUP|$PI2_IP" "DR|$PI3_IP"; do
      name="${label%%|*}"
      ip="${label##*|}"
      echo "  Syncing $name..."
      ssh "deploy@$ip" "$PROJECT_DIR/cluster/sync.sh" 2>/dev/null || echo "    FAILED"
    done
    ;;
  logs)
    echo "━━━ Live logs (Ctrl+C to exit) ━━━"
    ssh "deploy@$PI2_IP" "tail -f ~/sync.log ~/health-check.log ~/failover.log" 2>/dev/null || \
      echo "Backup unreachable"
    ;;
  failover)
    echo "━━━ Manual failover ━━━"
    echo "Which Pi should take over?"
    echo "  1) Pi2 (Backup — Addis)"
    echo "  2) Pi3 (DR — Hawassa)"
    read -p "Choice (1/2): " choice
    case "$choice" in
      1) ssh "deploy@$PI2_IP" "$PROJECT_DIR/cluster/failover.sh" ;;
      2) ssh "deploy@$PI3_IP" "$PROJECT_DIR/cluster/failover.sh" ;;
      *) echo "Invalid" ;;
    esac
    ;;
  recover)
    echo "━━━ Recovering Pi1 as MAIN ━━━"
    ssh "deploy@$PI1_IP" "$PROJECT_DIR/cluster/recover.sh"
    ;;
  help|*)
    echo "Usage: ./manage.sh [command]"
    echo ""
    echo "Commands:"
    echo "  status      Show online/offline status of all Pis"
    echo "  sync        Force sync on all Pis"
    echo "  logs        Live tail logs from Backup"
    echo "  failover    Manually failover to Backup or DR"
    echo "  recover     Recover Pi1 as MAIN"
    ;;
esac
