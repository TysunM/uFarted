# TootTally 💨

The fun, science-backed gas tracker. Log farts & burps (39 researched types), record clips, share the legendary ones, and see what's normal **for you**.

- **Log**: one-tap quick add, or a full entry with type, time, smell, discomfort, food triggers and a private note.
- **Record**: clips up to 15 s. The server re-encodes them to AAC with loudness levelling, so they play on every phone, including iPhone.
- **Community**: public feed, reactions, "Fart of the Day", share links with previews, report / block / auto-hide.
- **Insights**: daily chart, personal baseline, peak hour, top types, trigger analysis, badges, streaks and a share card.
- **Health**: ranges from 2026 research, red-flag guidance, a printable 90-day doctor report and CSV export.
- **Money**: optional Stripe Premium (one-time or subscription). Leave Stripe unset and everything is free.
- **Ops**: one Docker container plus Caddy for automatic HTTPS, SQLite with daily rotated backups, a moderation CLI and phone alerts on reports.

It's an installable PWA (Add to Home Screen), so you don't need the App Store to launch.

---

## Run locally (WSL2)

Needs Node 22+ and ffmpeg (`sudo apt install ffmpeg`).

```bash
cd toottally
npm ci
npm run dev        # http://localhost:3000
npm test           # 26 API tests
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
git clone -b claude/fart-tracking-app-6ya6w8 https://github.com/TysunM/btcai.git
cd btcai/toottally
```

**4. Configure.** Edit the values below, then paste the block:

```bash
cat > .env <<'ENVEOF'
DOMAIN=toottally.yourdomain.com
PUBLIC_URL=https://toottally.yourdomain.com
APP_NAME=TootTally
SUPPORT_EMAIL=you@yourdomain.com
ADMIN_USERNAMES=yourusername
REPORT_HIDE_THRESHOLD=3
MOD_WEBHOOK_URL=https://ntfy.sh/pick-a-long-random-topic-name
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
STRIPE_MODE=payment
PREMIUM_PRICE_LABEL=$4.99 one-time
ENVEOF
```

For `MOD_WEBHOOK_URL`, install the free **ntfy** app on your phone and subscribe to the same topic. You'll get a push on every report. A Discord webhook URL also works.

**5. Launch**

```bash
docker compose up -d --build
curl -s https://toottally.yourdomain.com/healthz   # → {"ok":true}
```

On your phone, open the site and tap **Share → Add to Home Screen**. Then claim the username you put in `ADMIN_USERNAMES`.

To update later: `git pull && docker compose up -d --build`

## Turn on Premium (Stripe)

1. In the Stripe Dashboard, go to **Product catalog → Add product** ("TootTally Premium") and add a one-time price (e.g. $4.99) or a recurring one. Copy the **price ID** (`price_…`).
2. Under **Developers → Webhooks → Add endpoint**, use `https://YOUR_DOMAIN/api/billing/webhook` with these events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the **signing secret** (`whsec_…`).
3. Put `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` in `.env` (plus `STRIPE_MODE=subscription` for a recurring price), then run `docker compose up -d`.
4. For subscriptions, turn on the **Customer portal** in Stripe settings so users can cancel on their own.

Premium unlocks 90-day and 1-year history, trigger insights, the doctor report and a ⭐ supporter badge.

## Moderation & operations

```bash
docker compose exec app node server/admin.js reports            # reported / auto-hidden posts
docker compose exec app node server/admin.js hide 42            # hide post #42
docker compose exec app node server/admin.js restore 42         # un-hide + clear reports
docker compose exec app node server/admin.js ban someuser       # suspend community access
docker compose exec app node server/admin.js premium someuser   # comp Premium
docker compose exec app node server/admin.js stats              # users, DAU, logs, posts
docker compose exec app node server/admin.js backup             # backup now
docker compose logs -f app                                      # live logs
```

A post is hidden automatically after `REPORT_HIDE_THRESHOLD` different users report it. Admin usernames also get a **Remove** button in the app.

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

## Security notes

- Passwords are hashed with scrypt.
- Session tokens are stored hashed and sent in HttpOnly, SameSite, Secure cookies.
- CSRF is blocked with Origin and Fetch-Metadata checks.
- A strict CSP blocks inline scripts.
- Rate limits apply per user and per IP.
- ffmpeg only accepts local audio containers, which blocks crafted-playlist file reads.
- Uploads are capped at 3 MB and 15 s.
- The container runs as non-root, on a read-only filesystem, with all Linux capabilities dropped.
- Stripe webhooks are signature-verified and only processed once.
- No email or other PII is collected; accounts use a username plus a recovery code.

## Project layout

```
server/      Fastify API (auth, logs, stats, community, billing, pages), audio pipeline, admin CLI
public/      PWA: js/ (views, recorder, player, offline queue), css/, icons/, service worker
templates/   index, privacy, terms, doctor report (APP_NAME / SUPPORT_EMAIL injected)
test/        API tests (node:test) + Playwright E2E
docs/        LAUNCH_PLAN.md: research, positioning, pricing, go-to-market
```
