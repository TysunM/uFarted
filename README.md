# TootTally 🩺💨

Free gut-health tracking with a sense of humor. Check in on bloating and belly pain, find the foods that set you off, log every fart and burp (39 researched types), and bring a printable report to your doctor. Record the legendary ones and share them with the community.

- **Daily gut check**: bloating and belly pain in 2 taps, right at the top of Today.
- **Triggers**: tag foods and habits (beans, dairy, fizzy drinks…). Insights compares your bloating on days with each trigger against days without it.
- **Log**: one-tap quick add, or a full entry with type, time, smell, discomfort, triggers and a private note.
- **Record**: clips up to 15 s. The server re-encodes them to AAC with loudness levelling, so they play on every phone, including iPhone.
- **Community**: public feed, reactions, "Fart of the Day", share links with previews, report / block / auto-hide.
- **Insights**: bloating and pain trends, gas per day, personal baseline, peak hour, top types, badges, streaks and a share card.
- **Health**: ranges from 2026 research, red-flag guidance, a printable 90-day doctor report and CSV export.
- **Free**: no payments, no ads (yet), no email collected.
- **Ops**: one Docker container plus Caddy for automatic HTTPS, SQLite with daily rotated backups, a moderation CLI and phone alerts on reports.

It's an installable PWA (Add to Home Screen), so you don't need the App Store to launch.

---

## Run locally (WSL2)

Needs Node 22+ and ffmpeg (`sudo apt install ffmpeg`).

```bash
git clone https://github.com/TysunM/toottally.git
cd toottally
npm ci
npm run dev        # http://localhost:3000
npm test           # 32 API tests
npm run e2e        # real-browser test with a fake microphone (Chromium)
```

## Deploy to your Hetzner server

**1. DNS.** Create an `A` record for your domain (e.g. `toottally.yourdomain.com`) that points at the server's IP.

**2. Server prep.** Skip anything that's already installed:

```bash
curl -fsSL https://get.docker.com | sh
sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp
```

> If another proxy on this box already uses ports 80/443, leave out the `caddy` service and point your existing proxy at the app container on port 3000.

**3. Get the code**

```bash
git clone https://github.com/TysunM/toottally.git
cd toottally
```

**4. Configure.** Edit the values below, then paste the block:

```bash
cat > .env <<'ENVEOF'
DOMAIN=toottally.yourdomain.com
PUBLIC_URL=https://toottally.yourdomain.com
APP_NAME=TootTally
SUPPORT_EMAIL=you@yourdomain.com
REPORT_HIDE_THRESHOLD=3
MOD_WEBHOOK_URL=https://ntfy.sh/pick-a-long-random-topic-name
ENVEOF
```

For `MOD_WEBHOOK_URL`, install the free **ntfy** app on your phone and subscribe to the same topic. You'll get a push on every report. A Discord webhook URL also works.

**5. Launch**

```bash
docker compose up -d --build
curl -s https://toottally.yourdomain.com/healthz   # → {"ok":true}
```

On your phone, open the site and tap **Share → Add to Home Screen**. Claim your username, then make yourself a moderator:

```bash
docker compose exec app node server/admin.js admin yourusername
```

To update later: `git pull && docker compose up -d --build`

## Moderation & operations

```bash
docker compose exec app node server/admin.js reports            # reported / auto-hidden posts
docker compose exec app node server/admin.js hide 42            # hide post #42
docker compose exec app node server/admin.js restore 42         # un-hide + clear reports
docker compose exec app node server/admin.js ban someuser       # suspend community access
docker compose exec app node server/admin.js admin someuser     # grant moderator (unadmin to revoke)
docker compose exec app node server/admin.js stats              # users, DAU, logs, posts
docker compose exec app node server/admin.js backup             # backup now
docker compose logs -f app                                      # live logs
```

A post is hidden automatically after `REPORT_HIDE_THRESHOLD` different users report it. Only claimed accounts older than 24 hours count toward that, so a batch of new sockpuppet accounts can't take a post down. Every report still reaches your phone. Admins also get a **Remove** button in the app.

## Backups

Every 24 h the app writes a consistent SQLite backup to the data volume and keeps the last 7. Copy them **off the server** too, for example nightly to a Hetzner Storage Box:

```bash
cat > /usr/local/bin/toottally-offsite.sh <<'SHEOF'
#!/bin/sh
set -e
VOL=$(docker volume inspect -f '{{.Mountpoint}}' toottally_toottally-data)
rsync -a --delete -e "ssh -p 23" "$VOL/" uXXXXXX@uXXXXXX.your-storagebox.de:toottally/
SHEOF
chmod +x /usr/local/bin/toottally-offsite.sh
( crontab -l 2>/dev/null; echo "30 3 * * * /usr/local/bin/toottally-offsite.sh" ) | crontab -
```

To restore, stop the app, copy a `backups/toottally-YYYY-MM-DD.db` over `toottally.db` in the volume, and start the app again.

## Adding ads later

The app is ad-free today, and the privacy policy and terms say so. Before you turn ads on:

1. Update `templates/privacy.html` and `templates/terms.html` (they already promise to tell users first). Add a cookie/consent banner if you serve EU/UK users.
2. Allow the ad network's domains in the Content-Security-Policy in `server/app.js` (`scriptSrc`, `imgSrc`, `connectSrc`, `frameSrc`).
3. Keep ads off the doctor report and the gut-check card. Health-adjacent ad targeting is restricted on most networks.

## Security notes

- Passwords are hashed with scrypt.
- Session tokens are stored hashed and sent in HttpOnly, SameSite, Secure cookies.
- Login and recovery are rate limited per IP and per account.
- CSRF is blocked with Origin and Fetch-Metadata checks.
- A strict CSP blocks inline scripts.
- ffmpeg only accepts local audio containers, which blocks crafted-playlist file reads.
- Uploads are capped at 3 MB and 15 s.
- The container runs as non-root, on a read-only filesystem, with all Linux capabilities dropped.
- No email or other PII is collected; accounts use a username plus a recovery code.

## Project layout

```
server/      Fastify API (auth, logs, gut checks, stats, community, pages), audio pipeline, admin CLI
public/      PWA: js/ (views, recorder, player, offline queue), css/, icons/, service worker
templates/   index, privacy, terms, doctor report (APP_NAME / SUPPORT_EMAIL injected)
test/        API tests (node:test) + Playwright E2E
docs/        LAUNCH_PLAN.md: research, positioning, go-to-market
```
