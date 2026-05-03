# Bundly Production Deployment Guide

Industrial-grade deployment checklist for running Bundly securely in production.

---

## Architecture

```
Internet
   ↓
[ Cloudflare WAF + DDoS ]         (Layer 1 — bot score, DDoS shield)
   ↓
[ Nginx reverse proxy + TLS ]     (Layer 2 — SSL, rate-limit, static compression)
   ↓
[ Fail2ban / ipset ]              (Layer 3 — IP banning on abuse)
   ↓
[ Node.js Bundly (PM2) ]          (Layer 4 — app-level security)
   ↓
[ bundly-db.json + files ]        (Layer 5 — file permissions 0640)
```

---

## 1. Server Preparation (Ubuntu 22.04 LTS)

```bash
# Update
sudo apt update && sudo apt upgrade -y

# Essential packages
sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx \
                   fail2ban ufw curl git

# Create a non-root user
sudo useradd -m -s /bin/bash bundly
sudo usermod -aG sudo bundly

# Harden SSH
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Firewall — only SSH, HTTP, HTTPS
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

---

## 2. Deploy Application

```bash
# As 'bundly' user
sudo su - bundly
git clone https://github.com/your-org/bundly.git groupbuy-app
cd groupbuy-app
npm ci --production
npm run build

# Copy and edit environment file
cp .env.example .env
nano .env  # fill in real values

# Restrict file permissions (only user can read .env)
chmod 600 .env
chmod 700 invoices/ bundly-db.json 2>/dev/null || true
```

---

## 3. PM2 Process Manager

```bash
sudo npm install -g pm2
```

Create `ecosystem.config.cjs`:

```js
module.exports = {
  apps: [{
    name:        "bundly",
    script:      "server.js",
    instances:   1,               // increase on multi-core; needs sticky sessions
    exec_mode:   "fork",
    max_memory_restart: "500M",
    env: {
      NODE_ENV: "production",
      PORT:     "3001",
    },
    error_file:  "/var/log/bundly/error.log",
    out_file:    "/var/log/bundly/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    max_restarts: 10,
    min_uptime:   "10s",
  }],
};
```

Then:

```bash
sudo mkdir -p /var/log/bundly && sudo chown bundly:bundly /var/log/bundly
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd            # copy printed command and run as root
```

---

## 4. Nginx Reverse Proxy + TLS

`/etc/nginx/sites-available/bundly`:

```nginx
# Rate-limiting zones (tunable — start conservative)
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth:10m rate=1r/s;
limit_conn_zone $binary_remote_addr zone=perip:10m;

# HTTP → HTTPS redirect
server {
  listen 80;
  server_name bundly.co.il www.bundly.co.il;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name bundly.co.il www.bundly.co.il;

  # TLS (certbot-managed)
  ssl_certificate     /etc/letsencrypt/live/bundly.co.il/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/bundly.co.il/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         HIGH:!aNULL:!MD5:!3DES;
  ssl_prefer_server_ciphers on;
  ssl_session_cache   shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_stapling        on;
  ssl_stapling_verify on;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

  # Connection limits — 50 concurrent per IP
  limit_conn perip 50;

  # Buffer overflow protection
  client_body_buffer_size 1K;
  client_header_buffer_size 1K;
  client_max_body_size 2M;
  large_client_header_buffers 4 4k;

  # Hide nginx version
  server_tokens off;

  # Block suspicious agents at nginx level
  if ($http_user_agent ~* (scanner|sqlmap|nmap|nikto|metasploit|burp|zgrab)) {
    return 444;
  }

  # Block common exploits
  location ~* \.(env|git|svn|bak|sql|log)$ { deny all; return 444; }
  location ~* /(wp-admin|phpmyadmin|\.git|\.env) { deny all; return 444; }

  # API with rate limiting
  location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_http_version 1.1;
    proxy_connect_timeout 10s;
    proxy_read_timeout 60s;
  }

  # Auth endpoints — stricter rate
  location ~ ^/api/auth/(send-otp|verify-otp|check-existing) {
    limit_req zone=auth burst=3 nodelay;
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  # Static files + SPA
  location / {
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

Activate:

```bash
sudo ln -s /etc/nginx/sites-available/bundly /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get Let's Encrypt TLS
sudo certbot --nginx -d bundly.co.il -d www.bundly.co.il
sudo systemctl enable certbot.timer
```

---

## 5. Fail2ban — auto-ban abusive IPs

`/etc/fail2ban/jail.d/bundly.conf`:

```ini
[bundly-auth]
enabled  = true
filter   = bundly-auth
logpath  = /home/bundly/groupbuy-app/security.log
maxretry = 5
findtime = 600
bantime  = 3600
action   = iptables-multiport[name=bundly, port="http,https"]

[nginx-badbots]
enabled  = true
filter   = nginx-badbots
logpath  = /var/log/nginx/access.log
maxretry = 2
findtime = 60
bantime  = 86400
```

`/etc/fail2ban/filter.d/bundly-auth.conf`:

```ini
[Definition]
failregex = .*"ip":"<HOST>".*"type":"(ADMIN_FAIL|AUTH_INVALID|RATE_LIMIT|BOT_BLOCKED|TRAVERSAL_BLOCKED)".*
ignoreregex =
```

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status bundly-auth
```

---

## 6. Cloudflare (Layer 1 — CDN/WAF/DDoS)

1. Add domain to Cloudflare → Update DNS at registrar
2. Enable **Full (strict)** SSL mode
3. Enable **Bot Fight Mode** (Free) or **Super Bot Fight Mode** (Pro)
4. Enable **Under Attack Mode** temporarily if flooded
5. Add WAF rule: block countries you don't serve (e.g. only allow IL, US, EU)
6. Add Rate Limiting rule: `/api/auth/*` → 10/minute per IP
7. Enable **Email Obfuscation** + **Hotlink Protection**
8. Page Rules: Cache `/product-img/*` and `/product-db/*` aggressively
9. Enable **Argo Smart Routing** (paid) for faster responses worldwide

---

## 7. Database Hardening

```bash
# File permissions
chmod 600 ~/.env
chmod 600 ~/groupbuy-app/bundly-db.json
chmod 700 ~/groupbuy-app/invoices/
chmod 600 ~/groupbuy-app/product-descriptions-cache.json

# Automated daily backup
sudo mkdir -p /backups/bundly
cat > /etc/cron.daily/bundly-backup <<'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d)
tar -czf /backups/bundly/$DATE.tar.gz \
  /home/bundly/groupbuy-app/bundly-db.json \
  /home/bundly/groupbuy-app/invoices/ \
  /home/bundly/groupbuy-app/.env
# Keep only last 30 days
find /backups/bundly -type f -mtime +30 -delete
EOF
sudo chmod +x /etc/cron.daily/bundly-backup
```

Send backups off-server (rsync to separate host, S3, Backblaze B2, etc.).

---

## 8. Log Rotation

`/etc/logrotate.d/bundly`:

```
/home/bundly/groupbuy-app/security.log
/var/log/bundly/*.log
{
  daily
  rotate 30
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
```

---

## 9. Monitoring (recommended)

- **Sentry** — error tracking (`npm install @sentry/node` + 3 lines in server.js)
- **UptimeRobot** / **Better Uptime** — free 5-min pings to `/api/health`
- **Grafana + Prometheus** — metrics (nginx_exporter + node_exporter)
- **Papertrail** / **Loggly** — centralized log aggregation

---

## 10. Pre-Launch Security Checklist

- [ ] All production env vars set in `.env` (JWT_SECRET, ADMIN_PASSWORD, STRIPE_*, TWILIO_*, EMAIL_*, HCAPTCHA_SECRET, URL_SIGN_SECRET)
- [ ] `NODE_ENV=production` set
- [ ] TLS live + auto-renewal working (`certbot renew --dry-run`)
- [ ] Cloudflare proxying all traffic
- [ ] Fail2ban active and tested (run `fail2ban-client status`)
- [ ] PM2 starts on reboot (`pm2 startup` + `pm2 save` done)
- [ ] `npm audit` — 0 vulnerabilities
- [ ] `.env` not in git (check `.gitignore`)
- [ ] Backup cron job tested (run manually, verify tarball)
- [ ] Admin password is strong (24+ chars, mixed)
- [ ] Test OTP flow end-to-end (real SMS + real email delivered)
- [ ] Test payment flow end-to-end with Stripe test cards
- [ ] Invoice generation produces HTML that renders correctly
- [ ] Dispute / refund flow tested end-to-end
- [ ] Delete `bundly-db.json` and restart — verify no demo data leaks
- [ ] Run `curl -A "sqlmap" https://bundly.co.il/` — should get 403/444
- [ ] Run `curl -X POST https://bundly.co.il/api/auth/send-otp -d "phone=050&captchaToken=fake"` × 20 — rate limit kicks in by 6th
- [ ] Legal pages live: `/privacy.html`, `/terms.html`, `/return-policy.html`
- [ ] Register with Israeli privacy authority (חוק הגנת הפרטיות)

---

## Emergency Response

**If compromised:**
1. `pm2 stop bundly`
2. Rotate all secrets (`JWT_SECRET`, `ADMIN_PASSWORD`, all API keys)
3. Check `security.log` for forensics
4. Restore from latest clean backup
5. Review `bundly-db.json` for tampered records (orders/disputes/transactions)
6. Notify affected users (required by Israeli law for data breaches)

**If DDoSed:**
1. Enable Cloudflare "I'm Under Attack" mode
2. Tighten rate limits in nginx to 1r/s on all API routes
3. Temporarily block non-IL IPs in Cloudflare WAF
