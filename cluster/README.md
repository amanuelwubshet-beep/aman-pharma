# Aman Pharma Cluster System

```
  Pi1 (MAIN) ─── sync (hourly) ──→ Pi2 (BACKUP) ─── sync (daily) ──→ Pi3 (DR)
   Addis room                       Addis room                        Hawassa (dad)
   │                                │                                │
   └── health check (every min) ←───┘                                │
                                    └── health check (every min) ←───┘
```

## Architecture

| Pi | Role | Location | Job |
|----|------|----------|-----|
| **Pi1** | Main | Your room, Addis | Serves all client sites |
| **Pi2** | Backup | Your room, Addis | Syncs DB hourly, takes over if Pi1 dies |
| **Pi3** | DR | Dad's company, Hawassa | Syncs DB daily, takes over if both fail |

## Setup (one-time)

### 1. Edit config

```bash
nano /var/www/aman-pharma/cluster/config.sh
```

Set your IPs, Telegram bot token, and chat ID.

### 2. Run installer from your PC

```bash
cd /var/www/aman-pharma/cluster
./install.sh
```

### 3. Test it

```bash
# Manual sync
ssh deploy@PI_IP '/var/www/aman-pharma/cluster/sync.sh'

# View logs
ssh deploy@PI_IP 'tail -f ~/sync.log'

# Check failover state
ssh deploy@PI_IP 'cat ~/.failover-active 2>/dev/null || echo "no failover"'

# Simulate failover (Pi2 or Pi3 only)
ssh deploy@PI2_IP '/var/www/aman-pharma/cluster/failover.sh'

# Recover main Pi
ssh deploy@PI1_IP '/var/www/aman-pharma/cluster/recover.sh'
```

## Failover Behavior

1. Pi2 and Pi3 check Pi1 every 60 seconds
2. After 3 failed checks → triggers failover
3. Backup takes over: starts Node, configures nginx, serves sites
4. DR checks if Backup already took over — avoids conflicts
5. When Pi1 recovers → run `recover.sh` to reclaim main role

## Telegram Alerts

| Alert | Meaning |
|-------|---------|
| ⚠️ Backup sync FAILED | Pi1 can't reach Pi2 |
| 🔥 MAIN SERVER DOWN | Pi1 is dead, failover triggered |
| ✅ FAILOVER COMPLETE | Backup/DR is now serving |
| ✅ Recovery complete | Pi1 is back as main |

## Manual Commands

```bash
# Check live status
curl -s -o /dev/null -w "%{http_code}" http://PI_IP

# Check database size
ssh deploy@PI_IP "ls -lh /var/www/aman-pharma/backend/store.db"

# Force sync
ssh deploy@PI_IP "/var/www/aman-pharma/cluster/sync.sh"

# View all logs in one command
ssh deploy@PI_IP "tail -f ~/sync.log ~/health-check.log ~/failover.log"

# Clean sync log
ssh deploy@PI_IP "> ~/sync.log"
```
