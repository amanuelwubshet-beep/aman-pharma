#!/usr/bin/env bash
# ════════════════════════════════════════════
# failover.sh — Promote this Pi to MAIN
# Runs on Pi2 (BACKUP) or Pi3 (DR)
# ════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/config.sh"
source "$SCRIPT_DIR/notify.sh"

LOCAL_IP=$(hostname -I | awk '{print $1}')
HOSTNAME=$(hostname)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
FAILOVER_LOG="$HOME/failover.log"

log() {
  echo "[$TIMESTAMP] $1" | tee -a "$FAILOVER_LOG"
}

# ────────────────────────────────────────────
# Determine role
# ────────────────────────────────────────────
ROLE="${1:-$( \
  if [ "$LOCAL_IP" = "$PI2_IP" ]; then echo "backup"; \
  elif [ "$LOCAL_IP" = "$PI3_IP" ]; then echo "dr"; \
  else echo "unknown"; fi \
)}"

if [ "$ROLE" = "unknown" ]; then
  log "This Pi is not configured for failover — exiting"
  exit 1
fi

# ────────────────────────────────────────────
# Check if main has recovered during our count
# ────────────────────────────────────────────
ping -c 2 -W 2 "$PI1_IP" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  log "Main appears to be back up. Checking service..."

  timeout 5 curl -s -o /dev/null -w "%{http_code}" "http://$PI1_IP" 2>/dev/null | grep -q "200\|301\|302"
  if [ $? -eq 0 ]; then
    log "Main is serving requests. Cancelling failover."
    rm -f "$HOME/.failover-state"
    send_alert "✅ Main recovered — failover cancelled"
    exit 0
  fi
fi

# ────────────────────────────────────────────
# Check if another backup already took over
# ────────────────────────────────────────────
# If we're backup but DR already promoted, don't conflict
if [ "$ROLE" = "backup" ]; then
  # Check if DR is serving
  timeout 3 curl -s -o /dev/null -w "%{http_code}" "http://$PI3_IP" 2>/dev/null | grep -q "200\|301\|302"
  if [ $? -eq 0 ]; then
    log "DR (Pi3) already serving — backup standing down."
    send_alert "ℹ️ Backup standing down — DR (Hawassa) already serving"
    exit 0
  fi
fi

if [ "$ROLE" = "dr" ]; then
  # Check if backup is serving
  timeout 3 curl -s -o /dev/null -w "%{http_code}" "http://$PI2_IP" 2>/dev/null | grep -q "200\|301\|302"
  if [ $? -eq 0 ]; then
    log "BACKUP (Pi2) already serving — DR standing down."
    send_alert "ℹ️ DR standing down — Backup (Addis) already serving"
    exit 0
  fi
fi

# ────────────────────────────────────────────
# Promote THIS Pi to MAIN
# ────────────────────────────────────────────
log "==================================="
log "PROMOTING $ROLE to MAIN"
log "==================================="

# 1. Ensure project files exist
if [ ! -d "$PROJECT_DIR" ]; then
  log "Project directory missing at $PROJECT_DIR"
  send_alert "❌ Failover FAILED — project not found on $ROLE"
  exit 1
fi

# 2. Make sure the database is the most recent
log "Ensuring database symlink is correct..."
if [ -L "$DB_FILE" ]; then
  log "Database symlink OK"
fi

# 3. Start the Node server if not running
if pgrep -f "node server.js" >/dev/null; then
  log "Node server already running"
else
  log "Starting Node server..."
  cd "$PROJECT_DIR/backend"
  NODE_ENV=production nohup node server.js > /tmp/node-server.log 2>&1 &
  sleep 3
  if pgrep -f "node server.js" >/dev/null; then
    log "Node server started"
  else
    log "Failed to start Node server — check /tmp/node-server.log"
    send_alert "❌ Failover FAILED — Node server won't start on $ROLE"
    exit 1
  fi
fi

# 4. Configure nginx for this Pi as MAIN
log "Configuring nginx to serve as MAIN..."
NGINX_CONF="/etc/nginx/sites-available/aman-pharma"

cat > /tmp/aman-pharma-failover <<NGINX
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
        access_log off;
        log_not_found off;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
    gzip_min_length 1000;
    gzip_vary on;
}
NGINX

sudo cp /tmp/aman-pharma-failover "$NGINX_CONF"
sudo nginx -t && sudo systemctl reload nginx
if [ $? -eq 0 ]; then
  log "Nginx reloaded — $ROLE now serving as MAIN"
else
  log "Nginx config test FAILED"
  send_alert "❌ Failover FAILED — nginx error on $ROLE"
  exit 1
fi

# 5. Mark failover state
echo "FAILOVER_ACTIVE=true" > "$HOME/.failover-active"
echo "FAILOVER_ROLE=$ROLE" >> "$HOME/.failover-active"
echo "FAILOVER_TIME=$TIMESTAMP" >> "$HOME/.failover-active"
echo "MAIN_FAIL_COUNT=$FAIL_THRESHOLD" > "$HOME/.failover-state"

# 6. Clean old files from main's failed state
log "Cleanup: removing old PID files..."
rm -f /var/run/aman-pharma.pid

# 7. Test local site
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost" 2>/dev/null)
log "Local HTTP test: $HTTP_CODE"

# 8. Send success alert
send_alert "✅ *FAILOVER COMPLETE*%0A$ROLE ($LOCAL_IP) is now serving as MAIN%0AHTTP status: $HTTP_CODE%0A___%0AUpdate your DNS to point to this IP or wait for automatic update."

log "Failover complete for ROLE=$ROLE"
exit 0
