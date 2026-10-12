# uFarted: Launch Plan

**Decisions so far:** the name is **uFarted**, with "Fart Tracker" as the search keyword in the title. It's a gut-health tracker first and a joke second (option 1). Free, with no payments. Ads might come later. It lives in its own repository.

## 1. Premise check

| Assumption | What the evidence says | What the app does |
|---|---|---|
| "You need to fart at least 15–20 times a day." | **There's no minimum.** The largest dataset (CSIRO, *JAMA Network Open*, May 2026: 6,416 people, 360,192 logged events) found a **mean of 5/day, a median of 3.8, and 80% of people between 2 and 7**. The "14 ± 6" figure comes from older, small studies. Wearable sensors (University of Maryland, 2026, n = 19 pilot) detect about **32/day (range 4–59)** because most farts go unnoticed. | Shows "most people log 2–7", explains the sensor gap, and after 5 days compares you to **your own baseline**. It never tells anyone to hit a target. |
| "Burping is healthy too." | Correct. Up to **~30/day** is physiological, mostly after meals (*Frontline Gastroenterology*). A burping problem is defined by how bothersome it is (Rome IV), not by the count. | Shows "Normal: up to ~30" and flags burp types worth watching (wet, sulfur). |
| "It's a health app." | Legally it has to be a **wellness** app. Diagnostic or treatment claims would pull it toward FDA and FTC scrutiny. | All copy says "not medical advice". Red flags follow NHS guidance. The doctor report is labelled "self-reported, for discussion with a clinician". |

## 2. Positioning (option 1)

**"uFarted — the fart tracker for your gut health. Free."**

- **Core (why people stay):** a 2-tap daily gut check (bloating + belly pain), trigger tagging, and a "bloating on days with X vs without" comparison. This is what people with IBS or regular bloating want, and that's about 5–10% of adults.
- **Hook (why people share):** 39 fart and burp types, recordings, "Fart of the Day", share cards.
- **Trust:** a free doctor report, red-flag guidance, research-backed ranges, and no email collected.

The order in the app matches this: the gut check is at the top of Today, gut health and triggers lead Insights, and the jokes wrap around them.

## 3. App Store risk

Apple's Guideline **4.3(b)** names fart and burp apps as low-value. The PWA avoids review entirely. If you go native later (a Capacitor wrapper around the same code):

- Submit it under **Health & Fitness** as a digestive-health tracker. Never submit it as a soundboard.
- Screenshot order: gut check → trigger insights → doctor report → fun stuff.

## 4. Money: free now, ads maybe later

| Option | Verdict |
|---|---|
| **Free, no ads** (now) | Best for growth and trust. Total cost is about $10/yr for a domain: hosting runs on your laptop through a free Cloudflare Tunnel. Move to a ~$5/month server only once uptime matters. |
| **Display ads** (later) | Expect low CPMs, and ad networks restrict health-related targeting. Only worth it past roughly 10k monthly users. Keep ads away from the gut check and the doctor report. The README has the checklist (privacy policy, consent banner, CSP). |
| **Affiliate links** (better than ads) | Contextual links on a trigger, e.g. lactase pills next to dairy or simethicone next to gas, need an FTC disclosure. They pay per sale, so they beat display ads at small scale. |
| **Merch** | "Certified Thunderclap Survivor" via print-on-demand (Printful): no inventory, and it fits the humor. |

## 5. Go-to-market (first 30 days, $0)

1. **Ride the news.** The CSIRO "Chart Your Fart" study went viral in June 2026 (19,000+ sign-ups), and UMD's Human Flatus Atlas has 10,000+ sign-ups. Post: *"Scientists say normal is 4 a day. I tracked mine (and my bloating) for 30 days."*
2. **TikTok / Reels / Shorts,** 1 post a day: a type-of-the-day explainer, "Fart of the Day", and the 30-day bloating challenge using the share card.
3. **Communities:** r/IBS, r/FODMAP and r/Microbiome (lead with the gut check, the triggers and the free doctor report), plus r/funny (lead with the type list).
4. **Share loops (built):** clip links show a preview card and a "Start free" banner, and the daily share card carries your domain.

**Metrics** (`admin.js stats`): DAU, gut-check rate (the share of active users who check in), the share of guests who claim a username, and D7 retention. Target D7 above 25%.

## 6. Next features worth building (in order)

1. **Bristol stool scale** in the daily check. It's the clinical standard for IBS, and doctors ask for it.
2. **"Share report with my coach"** link: read-only and expiring. It opens the B2B path (dietitians, $20–50/month per practice) if you ever want revenue without ads.
3. **Reminders:** web push for the daily gut check (iOS 16.4+ supports push for installed PWAs).
4. **Citizen-science export:** an opt-in, anonymized data export for UMD / CSIRO, for press and credibility.

## 7. Launch checklist

- [x] Name cleared (no UFARTED results in the US trademark search) and domain bought: **ufarted.app**.
- [ ] Domain on Cloudflare DNS + tunnel token, then `docker compose up -d --build` (README → Go live for $0).
- [ ] Cloudflare Email Routing: `support@ufarted.app` forwarding to your inbox.
- [ ] `MOD_WEBHOOK_URL` set (ntfy), so you see reports within minutes.
- [ ] Claim your username, run `admin.js admin <you>`, and seed 5–10 community clips.
- [ ] Weekly backup to your D: drive (README → Backups).

## Sources

- CSIRO, *Regular Flatulence Patterns Among Community-Dwelling Individuals in Australia*, JAMA Netw Open 2026 (doi:10.1001/jamanetworkopen.2026.15637)
- University of Maryland, smart-underwear flatulence study, 2026 (today.umd.edu)
- NHS, Flatulence: when to see a GP (nhs.uk/symptoms/flatulence)
- *Frontline Gastroenterology*, belching review (fg.bmj.com/content/17/5/440)
- Apple App Store Review Guidelines §4.3(b)
