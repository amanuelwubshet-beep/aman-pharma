#!/usr/bin/env bash
set -e

# ════════════════════════════════════════════════════
#  Aman Pharma — One-Command Pi Deployment
#  Run this on your Raspberry Pi (fresh Raspberry Pi OS)
#  Usage: chmod +x deploy-pi.sh && ./deploy-pi.sh
# ════════════════════════════════════════════════════

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
step()  { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
err()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ──────────────────────────────────────────────────
# Check we're on a Pi
# ──────────────────────────────────────────────────
if ! grep -q "Raspberry" /proc/cpuinfo 2>/dev/null; then
  warn "This doesn't look like a Raspberry Pi. Proceeding anyway..."
fi

# ──────────────────────────────────────────────────
# 1. SYSTEM UPDATE
# ──────────────────────────────────────────────────
step "Updating system packages"
sudo apt update && sudo apt upgrade -y
info "System updated"

# ──────────────────────────────────────────────────
# 2. INSTALL ESSENTIAL PACKAGES
# ──────────────────────────────────────────────────
step "Installing required packages"
sudo apt install -y \
  curl wget git ufw fail2ban \
  nginx \
  certbot python3-certbot-nginx \
  nodejs npm \
  sqlite3 \
  rsync unzip
info "Packages installed"

# ──────────────────────────────────────────────────
# 3. FIREWALL
# ──────────────────────────────────────────────────
step "Configuring firewall"
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
info "Firewall active — ports 22, 80, 443 only"

# ──────────────────────────────────────────────────
# 4. FAIL2BAN
# ──────────────────────────────────────────────────
step "Configuring Fail2Ban"
sudo systemctl enable --now fail2ban
info "Fail2Ban running"

# ──────────────────────────────────────────────────
# 5. SSH HARDENING
# ──────────────────────────────────────────────────
step "Hardening SSH"
sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config 2>/dev/null
sudo sed -i 's/^#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config 2>/dev/null
sudo sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config 2>/dev/null
sudo systemctl restart sshd
info "SSH passwords disabled — use SSH keys only"

# ──────────────────────────────────────────────────
# 6. CREATE DEPLOY USER
# ──────────────────────────────────────────────────
step "Setting up deploy user"
if id "deploy" &>/dev/null; then
  warn "User 'deploy' already exists"
else
  sudo adduser --disabled-password --gecos "" deploy
  sudo usermod -aG sudo deploy
  echo 'deploy:amanpharma' | sudo chpasswd
  warn "Default password: amanpharma — CHANGE IT after first login"
fi

# ──────────────────────────────────────────────────
# 7. SET UP PROJECT DIRECTORY
# ──────────────────────────────────────────────────
step "Setting up project directory on desktop (for easy access)"
sudo mkdir -p /var/www/aman-pharma
sudo chown -R $USER:$USER /var/www/aman-pharma
info "Project directory ready at /var/www/aman-pharma"

# ──────────────────────────────────────────────────
# 8. ASK FOR DOMAIN
# ──────────────────────────────────────────────────
step "Domain configuration"
echo ""
echo "Enter your domain (e.g., amanpharma.com or amanpharma.duckdns.org)"
echo "If using DuckDNS, set it up at https://duckdns.org first, then enter the domain below."
echo ""
read -p "Domain: " DOMAIN
if [ -z "$DOMAIN" ]; then
  DOMAIN="amanpharma.duckdns.org"
  warn "No domain entered — using $DOMAIN"
fi

# ──────────────────────────────────────────────────
# 9. DUCKDNS SETUP (if using duckdns)
# ──────────────────────────────────────────────────
if echo "$DOMAIN" | grep -q "duckdns.org"; then
  step "Setting up DuckDNS"
  DUCKDOMAIN=$(echo "$DOMAIN" | cut -d. -f1)
  mkdir -p $HOME/duckdns
  read -p "Enter your DuckDNS token: " DUCKTOKEN
  if [ -z "$DUCKTOKEN" ]; then
    warn "No token entered — skipping DuckDNS (update manually later)"
  else
    cat > $HOME/duckdns/duck.sh <<EOF
echo url="https://www.duckdns.org/update?domains=$DUCKDOMAIN&token=$DUCKTOKEN&ip=" | curl -k -o \$HOME/duckdns/duck.log -s -
EOF
    chmod +x $HOME/duckdns/duck.sh
    bash $HOME/duckdns/duck.sh
    (crontab -l 2>/dev/null; echo "*/5 * * * * $HOME/duckdns/duck.sh >/dev/null 2>&1") | crontab -
    info "DuckDNS auto-update set (every 5 minutes)"
  fi
fi

# ──────────────────────────────────────────────────
# 10. INSTALL YOUR PROJECT
# ──────────────────────────────────────────────────
step "Installing Aman Pharma project"

# Copy your project files
if [ -d "$PWD/backend" ]; then
  info "Project files found in current directory"
  cp -r "$PWD"/* /var/www/aman-pharma/
else
  warn "Project files not found. You'll need to copy them manually."
  warn "From your PC: rsync -avz /path/to/aman-pharma pi@PI_IP:/var/www/aman-pharma/"
fi

# Install backend dependencies
if [ -d "/var/www/aman-pharma/backend" ]; then
  cd /var/www/aman-pharma/backend
  npm install
  info "Backend dependencies installed"
  cd $HOME
fi

# ──────────────────────────────────────────────────
# 11. NGINX CONFIG
# ──────────────────────────────────────────────────
step "Configuring Nginx"

cat > /tmp/aman-pharma <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    root /var/www/aman-pharma;
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

sudo mv /tmp/aman-pharma /etc/nginx/sites-available/aman-pharma
sudo ln -sf /etc/nginx/sites-available/aman-pharma /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
info "Nginx configured for $DOMAIN"

# ──────────────────────────────────────────────────
# 12. SYSTEMD SERVICE
# ──────────────────────────────────────────────────
step "Creating systemd service"

cat > /tmp/aman-pharma.service <<SERVICE
[Unit]
Description=Aman Pharma Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/aman-pharma/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

sudo mv /tmp/aman-pharma.service /etc/systemd/system/
sudo systemctl daemon-reload

# Set permissions
sudo chown -R www-data:www-data /var/www/aman-pharma
sudo chmod -R 755 /var/www/aman-pharma

sudo systemctl enable aman-pharma
sudo systemctl start aman-pharma || warn "Service didn't start — check 'sudo systemctl status aman-pharma'"
info "Systemd service created and enabled"

# ──────────────────────────────────────────────────
# 13. SSL (Let's Encrypt)
# ──────────────────────────────────────────────────
if ! echo "$DOMAIN" | grep -q "duckdns.org"; then
  step "SSL Certificate (Let's Encrypt)"
  echo ""
  warn "Make sure $DOMAIN points to this Pi's IP in your DNS settings."
  read -p "Set up SSL now? (y/n): " SSL_YN
  if [ "$SSL_YN" = "y" ]; then
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "wubshetbezu@gmail.com" || \
    sudo certbot --nginx -d "$DOMAIN"
    info "SSL configured"
  fi
else
  info "Skipping SSL for DuckDNS (use Cloudflare for HTTPS)"
fi

# ──────────────────────────────────────────────────
# 14. SET UP BACKUP CRON
# ──────────────────────────────────────────────────
step "Setting up automatic backups"

mkdir -p $HOME/backups
cat > $HOME/backup.sh <<'BACKUP'
#!/usr/bin/env bash
BACKUP_DIR="$HOME/backups"
DB="/var/www/aman-pharma/backend/store.db"
DATE=$(date +%Y%m%d-%H%M)
cp "$DB" "$BACKUP_DIR/store-$DATE.db"
find "$BACKUP_DIR" -name "store-*.db" -mtime +7 -delete
BACKUP
chmod +x $HOME/backup.sh
(crontab -l 2>/dev/null; echo "0 */6 * * * $HOME/backup.sh >/dev/null 2>&1") | crontab -
info "Database backed up every 6 hours (keeps 7 days)"

# ──────────────────────────────────────────────────
# 15. SUMMARY
# ──────────────────────────────────────────────────
IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║       AMAN PHARMA — DEPLOYMENT COMPLETE       ║"
echo "╚════════════════════════════════════════════════╝"
echo ""
echo "  Domain:          http://$DOMAIN"
echo "  Public IP:       $IP"
echo "  Local IP:        $(hostname -I | awk '{print $1}')"
echo "  Nginx:           Active"
echo "  Node.js:         $(node -v)"
echo "  Firewall:        Active"
echo "  Fail2Ban:        Active"
echo "  SSH passwords:   Disabled"
echo "  Backups:         Every 6 hours"
echo ""
echo "  ─ USEFUL COMMANDS ─"
echo "  View logs:       sudo journalctl -u aman-pharma -f"
echo "  Restart:         sudo systemctl restart aman-pharma"
echo "  Check status:    sudo systemctl status aman-pharma"
echo "  Reload nginx:    sudo systemctl reload nginx"
echo "  Open project:    cd /var/www/aman-pharma"
echo ""
echo "  ─ NEXT ─"
echo "  Access your site at: http://$DOMAIN"
echo "  Admin panel:         http://$DOMAIN/admin.html"
echo "  Store:               http://$DOMAIN/store.html"
echo ""
echo "  Default admin login (change immediately!):"
echo "    Username: admin"
echo "    Password: admin@aman2026"
echo ""
