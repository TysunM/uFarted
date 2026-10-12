# uFarted 🩺💨

The free fart tracker for your gut health. Check in on bloating and belly pain, find the foods that set you off, log every fart and burp (39 researched types), and bring a printable report to your doctor. Record the legendary ones and share them with the community.

- **Daily gut check**: bloating and belly pain in 2 taps, right at the top of Today.
- **Triggers**: tag foods and habits (beans, dairy, fizzy drinks…). Insights compares your bloating on days with each trigger against days without it.
- **Log**: one-tap quick add, or a full entry with type, time, smell, discomfort, triggers and a private note.
- **Record**: clips up to 15 s. The server re-encodes them to AAC with loudness levelling, so they play on every phone, including iPhone.
- **Community**: public feed, reactions, "Fart of the Day", share links with previews, report / block / auto-hide.
- **Insights**: bloating and pain trends, gas per day, personal baseline, peak hour, top types, badges, streaks and a share card.
- **Health**: ranges from 2026 research, red-flag guidance, a printable 90-day doctor report and CSV export.
- **Free**: no payments, no ads (yet), no email collected.
- **Ops**: one Docker container with free HTTPS through Cloudflare Tunnel (or Caddy on a server), SQLite with daily rotated backups, a moderation CLI and phone alerts on reports.

It's an installable PWA (Add to Home Screen), so you don't need the App Store to launch.

---

## Run locally (WSL2)

Needs Node 22+ and ffmpeg (`sudo apt install ffmpeg`).

```bash
git clone https://github.com/TysunM/ufarted.git
cd ufarted
npm ci
npm run dev        # http://localhost:3000
npm test           # 32 API tests
npm run e2e        # real-browser test with a fake microphone (Chromium)
```

## Go live for $0 on your laptop (Cloudflare Tunnel)

Cloudflare Tunnel gives the app real HTTPS on your domain without opening router ports or paying for a server. It keeps working when you change Wi-Fi or move house. The only cost is a domain, about $10/yr.

**1. Domain.** Buy one at Cloudflare Registrar (sold at cost), or add a domain you already own to a free Cloudflare account.

**2. Create the tunnel.** In the Cloudflare dashboard, go to **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, name it `ufarted`, pick **Docker**, and copy the long token from the command it shows. Under **Public hostname**, choose your domain, set the type to `HTTP`, and the URL to `app:3000`. (Menu names shift a little between dashboard versions.)

**3. Laptop.** Install **Docker Desktop for Windows** (WSL2 backend) and turn on **Settings → General → Start Docker Desktop when you sign in**. Then, in your WSL terminal, edit the values and paste:

```bash
git clone https://github.com/TysunM/ufarted.git
cd ufarted
cat > .env <<'ENVEOF'
COMPOSE_PROFILES=tunnel
TUNNEL_TOKEN=paste-your-tunnel-token-here
DOMAIN=ufarted.com
PUBLIC_URL=https://ufarted.com
APP_NAME=uFarted
SUPPORT_EMAIL=you@yourdomain.com
REPORT_HIDE_THRESHOLD=3
MOD_WEBHOOK_URL=https://ntfy.sh/pick-a-long-random-topic-name
ENVEOF
docker compose up -d --build
```

For `MOD_WEBHOOK_URL`, install the free **ntfy** app on your phone and subscribe to the same topic. You'll get a push on every report.

**4. Check it.** On your phone, open your domain and tap **Share → Add to Home Screen**. Claim your username, then make yourself a moderator:

```bash
docker compose exec app node server/admin.js admin yourusername
```

**5. Keep it online.** In Windows, go to **Settings → System → Power** and set sleep to **Never** when plugged in. The containers restart on their own whenever Docker Desktop starts.

The site is down whenever the laptop is asleep, off or offline. That's fine for a beta and your first users. Move to a server (below) once uptime matters.

To update later: `git pull && docker compose up -d --build`

### Try it tonight, no domain needed

This gives you a temporary public link to share with friends. You need Node 22+ and ffmpeg in WSL (`sudo apt install ffmpeg`).

```bash
# Terminal 1: start a temporary tunnel and copy the https://….trycloudflare.com address it prints
curl -L -o ~/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/cloudflared
~/cloudflared tunnel --url http://localhost:3000

# Terminal 2: run the app with that address
cd ufarted && npm ci
PUBLIC_URL=https://PASTE-THE-ADDRESS.trycloudflare.com npm run dev
```

The address changes every time you restart the tunnel, and the data stays in `./data`. Use this for testing only.

## Later: move to a server

Any Linux server with Docker works. Keep `COMPOSE_PROFILES=tunnel` and the same token, and nothing else changes: no ports to open, no DNS edits. (Use `COMPOSE_PROFILES=caddy` instead only if you'd rather point DNS straight at the server's IP.)

Move your data across like this:

```bash
# On the laptop: stop the app and the tunnel (two copies on one tunnel would split users), then pack the data
docker compose stop
docker run --rm -v ufarted_ufarted-data:/data -v "$PWD":/out alpine tar czf /out/ufarted-data.tgz -C /data .

# On the server, after cloning the repo and creating the same .env, copy ufarted-data.tgz into the repo folder, then:
docker volume create ufarted_ufarted-data
docker run --rm -v ufarted_ufarted-data:/data -v "$PWD":/in alpine tar xzf /in/ufarted-data.tgz -C /data
docker compose up -d --build
```

## Backups

Every 24 h the app writes a consistent SQLite backup inside its data volume and keeps the last 7. That's the same disk as the live data, so also copy everything to another drive. For example, to your D: drive (an external or long-term storage drive):

```bash
mkdir -p /mnt/d/ufarted-backups
docker run --rm -v ufarted_ufarted-data:/data:ro -v /mnt/d/ufarted-backups:/out alpine sh -c 'tar czf /out/ufarted-$(date +%F).tgz -C /data .'
```

Run it weekly (or set it up in Windows Task Scheduler). To restore, stop the app, copy a `backups/ufarted-YYYY-MM-DD.db` over `ufarted.db` in the volume, and start the app again.

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
