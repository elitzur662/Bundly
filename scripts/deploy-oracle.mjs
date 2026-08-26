/**
 * deploy-oracle.mjs — put Bundly on an Oracle Cloud Always Free ARM instance.
 *
 * WHY THIS EXISTS. Bundly deploys to Render today: `deploy.ps1` pushes to git and
 * Render rebuilds. That service is SUSPENDED (`x-render-routing: suspend-by-user`
 * on https://www.bundly.co) because the plan costs $25/mo, and the plan is
 * `standard` because `render.yaml` records that starter's 512MB "consistently
 * OOM'd". Measured on 2026-08-25 with the full catalogue loaded — 20,386 products
 * across 53 categories — the API process holds **458MB RSS / 481MB private**.
 * The 2GB was an 8x growth margin someone chose, not the requirement, and 512MB
 * failed because it is barely under the real figure rather than far under it.
 * An Always Free ARM instance gives 24GB, which is free and forty times enough.
 *
 * The Vite process alongside it holds 730MB and is irrelevant here: production
 * serves the built `dist` and runs `server.js` alone.
 *
 * ── WHAT THIS SCRIPT WILL NOT DO ─────────────────────────────────────────────
 *
 * Create the Oracle account or provision the instance. Both need a human at
 * oracle.com with a card for identity verification. Bring:
 *   · the instance's public IP
 *   · the SSH private key Oracle generated when you created it
 * and pass them as --host / --key.
 *
 * ── THE ORACLE-SPECIFIC TRAPS, so the first attempt is not the failed one ────
 *
 *   · CAPACITY. "Out of host capacity" on VM.Standard.A1.Flex is routine in the
 *     busy regions. It is not an error in your setup; retry, or pick another
 *     availability domain.
 *   · TWO firewalls, and forgetting the second is the classic silent failure.
 *     Opening 80/443 in the VCN Security List is not enough — Oracle's Ubuntu
 *     image also ships iptables rules that DROP everything but 22. This script
 *     opens the instance side; the VCN side is yours in the console.
 *   · ARM. Checked before writing this: the only native-ish dependencies are
 *     puppeteer-core (no bundled Chromium — apt-get chromium-browser if the
 *     scraper is used) and esbuild (official arm64 builds). No better-sqlite3,
 *     sharp, canvas or bcrypt. `npm ci` runs ON the server so every binary is
 *     built for aarch64; node_modules is never copied.
 *
 * ── ABOUT THE SECRETS, AND ONE THING TO CHANGE BEFORE YOU GO LIVE ────────────
 *
 * `.env` holds 24 variables including all seven the server treats as
 * HARD_REQUIRED — it calls `process.exit(1)` without them. They travel over SSH
 * to your own machine and are never printed or logged here.
 *
 * TWO of them are not portable and this script refuses to guess:
 *   · ALLOWED_ORIGINS still names the old domain. CORS rejects every browser
 *     request until it names the new one.
 *   · STRIPE_SECRET_KEY. If it is a LIVE key, the moment this instance answers
 *     on a public address it can take real money. Use a test key until you mean
 *     it.
 *
 *   node scripts/deploy-oracle.mjs --host 1.2.3.4 --key ~/.ssh/oracle.key
 *   node scripts/deploy-oracle.mjs --host 1.2.3.4 --key … --domain bundly.co
 *   node scripts/deploy-oracle.mjs --host … --key … --app-only     # code, no setup
 */
import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const HOST = val('--host', null);
const KEY = val('--key', null);
const USER = val('--user', 'ubuntu');          // Oracle's Ubuntu images use `ubuntu`
const DOMAIN = val('--domain', null);
const APP_ONLY = has('--app-only');
const DRY = !has('--apply') && !APP_ONLY;

if (!HOST || !KEY) {
  console.error('need --host <ip> --key <path to the SSH key Oracle gave you>');
  console.error('  (I cannot create the account or the instance — see the header)');
  process.exit(2);
}
if (!fs.existsSync(KEY)) { console.error(`no such key: ${KEY}`); process.exit(2); }

const REMOTE = '/opt/bundly';
const SSH = ['-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=25'];
const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf-8', stdio: opts.quiet ? 'pipe' : 'inherit', maxBuffer: 1 << 28 });
const ssh = (cmd, opts = {}) => sh('ssh', [...SSH, `${USER}@${HOST}`, cmd], opts);

// Everything the app needs, and nothing that must be rebuilt for aarch64.
const EXCLUDES = [
  'node_modules', '.git', 'dist', 'android', '.prewarm.lock',
  '*.log', '.vite', 'excel-export', 'chrome-debug-profile',
];

console.log('\n════ BUNDLY → ORACLE ════\n');
console.log(`  target ......... ${USER}@${HOST}:${REMOTE}`);
console.log(`  domain ......... ${DOMAIN || '(none yet — serves on the bare IP)'}`);
console.log(`  mode ........... ${APP_ONLY ? 'app only' : DRY ? 'DRY RUN' : 'full'}`);

// ── reachability, and the architecture check before anything is copied ──
let arch = '';
try {
  arch = ssh('uname -m && . /etc/os-release && echo $PRETTY_NAME && nproc && free -g | awk \'/Mem:/{print $2"GB"}\'', { quiet: true }).trim();
} catch (e) {
  console.error(`\n  ✗ cannot reach the instance over SSH.`);
  console.error(`    Check the IP, that the key matches, and that port 22 is open in the VCN Security List.`);
  process.exit(1);
}
const [machine, os, cpus, mem] = arch.split('\n');
console.log(`\n  the instance answers: ${os} · ${machine} · ${cpus} vCPU · ${mem}`);
if (!/aarch64|arm64|x86_64/.test(machine)) { console.error(`  ✗ unexpected architecture ${machine}`); process.exit(1); }

if (DRY) {
  console.log('\n  DRY RUN — nothing sent. Pass --apply.\n');
  process.exit(0);
}

// ── 1. the machine ──────────────────────────────────────────────────────────
if (!APP_ONLY) {
  console.log('\n▸ preparing the machine');
  ssh([
    'set -e',
    'sudo apt-get update -qq',
    'sudo apt-get install -y -qq curl git nginx rsync ufw >/dev/null',
    // Node 20 LTS from NodeSource; Ubuntu's own node is too old for this app.
    'if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then',
    '  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null',
    '  sudo apt-get install -y -qq nodejs >/dev/null',
    'fi',
    // THE SECOND FIREWALL. Oracle's image DROPs 80/443 in iptables even after the
    // VCN Security List allows them, and the symptom is a connection that hangs
    // rather than refuses — which reads like a DNS or nginx fault and is neither.
    'sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true',
    'sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true',
    'sudo netfilter-persistent save >/dev/null 2>&1 || sudo apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true',
    `sudo mkdir -p ${REMOTE} && sudo chown -R ${USER}:${USER} ${REMOTE}`,
    'node -v && nginx -v',
  ].join('\n'));
}

// ── 2. the application ──────────────────────────────────────────────────────
console.log('\n▸ sending the application (node_modules stays behind — it rebuilds for this CPU)');
const rsyncArgs = [
  '-az', '--delete', '--info=stats1',
  '-e', `ssh ${SSH.join(' ')}`,
  ...EXCLUDES.flatMap((e) => ['--exclude', e]),
  './', `${USER}@${HOST}:${REMOTE}/`,
];
sh('rsync', rsyncArgs);

console.log('\n▸ installing dependencies and building ON the instance');
ssh(`cd ${REMOTE} && npm ci --omit=dev --no-audit --fund=false && npm ci --no-audit --fund=false && npm run build`);

// ── 3. the service ──────────────────────────────────────────────────────────
if (!APP_ONLY) {
  console.log('\n▸ installing the systemd service');
  // DATA_DIR is what Render's persistent disk provided. Without it the JSON DB
  // and the caches live inside the deploy directory and rsync --delete removes
  // them on the next deploy, which loses every user and every deal.
  const unit = `[Unit]
Description=Bundly
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${REMOTE}
EnvironmentFile=${REMOTE}/.env
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATA_DIR=/var/lib/bundly
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
  ssh(`sudo mkdir -p /var/lib/bundly && sudo chown ${USER}:${USER} /var/lib/bundly && cat | sudo tee /etc/systemd/system/bundly.service >/dev/null <<'UNIT'\n${unit}UNIT`);

  const server = DOMAIN ? `${DOMAIN} www.${DOMAIN}` : '_';
  const site = `server {
  listen 80;
  server_name ${server};
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
`;
  ssh(`cat | sudo tee /etc/nginx/sites-available/bundly >/dev/null <<'SITE'\n${site}SITE
sudo ln -sf /etc/nginx/sites-available/bundly /etc/nginx/sites-enabled/bundly
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx`);
}

console.log('\n▸ starting');
ssh('sudo systemctl daemon-reload && sudo systemctl enable --now bundly && sleep 6 && systemctl is-active bundly');

// ── 4. does it actually answer? ─────────────────────────────────────────────
console.log('\n▸ verifying');
let ok = true;
for (const [what, cmd] of [
  ['app on :3001', `curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1:3001/api/health`],
  ['through nginx', `curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1/`],
]) {
  const code = ssh(cmd, { quiet: true }).trim();
  const good = code.startsWith('2') || code.startsWith('3');
  if (!good) ok = false;
  console.log(`    ${good ? '✅' : '❌'} ${what.padEnd(16)} ${code}`);
}
if (!ok) {
  console.log('\n  Not answering. The first thing to read is the app log, not nginx:');
  console.log(`     ssh -i ${KEY} ${USER}@${HOST} "journalctl -u bundly -n 60 --no-pager"`);
  console.log('  A boot that exits immediately is almost always the HARD_REQUIRED env check.');
  process.exit(1);
}

console.log(`\n  ✅ live at http://${HOST}/`);
console.log('\n  Still yours to do:');
console.log('    · open 80 and 443 in the VCN Security List (the instance side is done)');
if (DOMAIN) {
  console.log(`    · point ${DOMAIN} at ${HOST}, then:`);
  console.log(`        ssh -i ${KEY} ${USER}@${HOST} "sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"`);
} else {
  console.log('    · re-run with --domain <name> once DNS points here, to get TLS');
}
console.log('    · set ALLOWED_ORIGINS in .env to the new origin, or CORS rejects every browser call');
console.log(`    · watch memory for an hour — measured 458MB at boot, and the ZAP and search caches grow:`);
console.log(`        ssh -i ${KEY} ${USER}@${HOST} "systemctl show bundly -p MemoryCurrent"`);
