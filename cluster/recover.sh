#!/usr/bin/env bash
# ════════════════════════════════════════════
# recover.sh — Main comes back, reclaims its role
# Run this on Pi1 (MAIN) after it recovers
# ════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/notify.sh"

LOCAL_IP=$(hostname -I | awk '{print $1}')
LOG="$HOME/recovery.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

# Check if this is Pi1
if [ "$LOCAL_IP" != "$PI1_IP" ]; then
  log "This script runs on MAIN (Pi1) only — exiting"
  exit 1
fi

log "==================================="
log "RECOVERY — Pi1 coming back online"
log "==================================="

# 1. Pull latest database from Backup
log "Pulling latest database from BACKUP ($PI2_IP)..."
rsync -avz -e "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10" \
  "deploy@$PI2_IP:$DB_FILE" "$DB_FILE" 2>>"$LOG"

if [ $? -eq 0 ]; then
  log "Database restored from backup"
else
  log "Could not pull from backup — trying DR ($PI3_IP)..."
  rsync -avz -e "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15" \
    "deploy@$PI3_IP:$DB_FILE" "$DB_FILE" 2>>"$LOG"
  if [ $? -eq 0 ]; then
    log "Database restored from DR"
  else
    log "WARNING: Could not pull from any backup — using local DB"
  fi
fi

# 2. Start Node server
log "Starting Node server..."
cd "$PROJECT_DIR/backend"
NODE_ENV=production nohup node server.js > /tmp/node-server.log 2>&1 &
sleep 3

if pgrep -f "node server.js" >/dev/null; then
  log "Node server running"
else
  log "Node server FAILED to start"
  send_alert "❌ Recovery FAILED — Node won't start on Pi1"
  exit 1
fi

# 3. Restore nginx config
log "Restoring nginx as MAIN..."
NGINX_CONF="/etc/nginx/sites-available/aman-pharma"

cat > /tmp/aman-pharma-main <<NGINX
server {
    listen 80;
    server_name $DOMAIN $LOCAL_IP;
    root $PROJECT_DIR;
    index index.html;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location / {
        try_files \$uri \$uri/ \$uri.html =404;
    }

    location ~ /\. { deny all; access_log off; log_not_found off; }
    location ~ (store\.db|\.env|package\.json|package-lock\.json|node_modules|init-db\.js) {
        deny all;
        access_log off; log_not_found off;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_min_length 1000;
    gzip_vary on;
}
NGINX

sudo cp /tmp/aman-pharma-main "$NGINX_CONF"
sudo nginx -t && sudo systemctl reload nginx

if [ $? -eq 0 ]; then
  log "Nginx restored — Pi1 is MAIN again"
else
  log "Nginx reload FAILED"
  send_alert "❌ Recovery FAILED — nginx error on Pi1"
  exit 1
fi

# 4. Clear failover state on backup Pis
log "Clearing failover state on Backup..."
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "deploy@$PI2_IP" \
  "rm -f ~/.failover-state ~/.failover-active" 2>>"$LOG" || true

ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "deploy@$PI3_IP" \
  "rm -f ~/.failover-state ~/.failover-active" 2>>"$LOG" || true

# 5. Re-run immediate sync
log "Running initial sync..."
bash "$SCRIPT_DIR/sync.sh"

# 6. Test
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost" 2>/dev/null)
log "Local HTTP test: $HTTP_CODE"

send_alert "✅ *RECOVERY COMPLETE*%0APi1 ($PI1_IP) is back as MAIN%0AHTTP status: $HTTP_CODE"

log "==================================="
log "RECOVERY COMPLETE — Pi1 is MAIN"
log "==================================="
