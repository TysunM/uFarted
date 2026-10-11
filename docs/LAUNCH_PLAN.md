# TootTally: Launch Plan

## 1. Premise check (read this first)

| Your assumption | What the evidence says | What the app does |
|---|---|---|
| "You need to fart at least 15–20 times a day." | **There's no minimum.** The largest dataset (CSIRO, *JAMA Network Open*, May 2026: 6,416 people, 360,192 logged events) found a **mean of 5/day, a median of 3.8, and 80% of people between 2 and 7**. The "14 ± 6" figure comes from older, small studies. Wearable sensors (University of Maryland, 2026, n = 19 pilot) detect about **32/day (range 4–59)** because most farts go unnoticed. | Shows "most people log 2–7", explains the sensor gap, and after 5 days compares you to **your own baseline**. It never tells anyone to hit a target. |
| "Burping is healthy too." | Correct. Up to **~30/day** is physiological, mostly after meals (*Frontline Gastroenterology*). A burping problem is defined by how bothersome it is (Rome IV), not by the count. | Shows "Normal: up to ~30" and flags burp types worth watching (wet, sulfur). |
| "It's a health app." | Legally it has to be a **wellness** app. Diagnostic or treatment claims would pull it toward FDA and FTC scrutiny. | All copy says "not medical advice". Red flags follow NHS guidance. The doctor report is labelled "self-reported, for discussion with a clinician". |

## 2. The real risk: Apple

Apple's App Store Review Guideline **4.3(b)** names **fart and burp apps** as a saturated or low-value category. A "fart app" submitted to the App Store is likely to be rejected.

**Decision:** launch as a **PWA** (already built). You avoid the review and the $99/yr fee, keep 100% of revenue, and can ship today. When you go native later (Capacitor wrapper, same code):

- Submit under **Health & Fitness** as a *digestive-health tracker* with logging, insights and the doctor report. Don't submit it as a soundboard.
- Lead the screenshots with insights and the doctor report, and put the fun second.
- Native iOS generally requires Apple in-app purchase for digital unlocks (US builds may also link out to web checkout). Keep Stripe for web users.

## 3. Positioning

**"The fun, science-backed gas tracker."** Comedy gets people to install it. Health insights keep them coming back.

- **Hook (viral):** 39 types, recordings, "Fart of the Day", share cards.
- **Retention (health):** personal baseline, streaks, trigger insights.
- **Revenue:** the doctor report and trigger insights. These are worth the most to people with IBS or bloating, which is about 5–10% of adults.

## 4. Monetization

| Lever | Status | Notes |
|---|---|---|
| Premium **$4.99 one-time** | Built (Stripe) | Lowest friction for an impulse "fun" purchase. Start here. |
| Premium **$2.99/mo** | Built (`STRIPE_MODE=subscription`) | Switch once retention data shows people stay past month 2. |
| Affiliate (gas relief, probiotics, FODMAP guides) | Not built | Contextual links on the Insights trigger card. Needs FTC disclosure. Add after 1k users. |
| Merch ("Certified Thunderclap Survivor") | Not built | Print-on-demand (Printful), zero inventory. Link it from the community tab. |
| Ads | Rejected | Low CPMs, privacy cost, and they hurt the health positioning. |

**Unit economics:** the server you already pay for covers it. The marginal cost is a domain (~$12/yr) plus Stripe fees (2.9% + 30¢). Break-even is the first sale.

## 5. Go-to-market (first 30 days, $0 budget)

1. **Ride the news.** The CSIRO "Chart Your Fart" study went viral in June 2026 (19,000+ sign-ups), and UMD's Human Flatus Atlas has 10,000+ sign-ups. Post: *"Scientists say normal is 4 a day. I tracked mine for 30 days."*
2. **TikTok / Reels / Shorts,** 1 post a day: a type-of-the-day explainer, "Fart of the Day" reactions, and the 30-day challenge using the share card.
3. **Communities:** r/IBS, r/FODMAP and r/Microbiome (lead with the doctor report and trigger insights, not the jokes), plus r/funny and r/mildlyinteresting (lead with the type list).
4. **Share loops (already built):** every shared clip link shows a preview card and a "Start free" banner, and every daily share card carries the domain.

**Metrics to watch** (run `admin.js stats`): DAU, logs per user per day, the share of guests who claim a username, D7 retention, and free → Premium conversion. Targets: D7 above 25%, conversion above 2%.

## 6. Alternatives that may beat the original idea

1. **Gut-health tracker that happens to be funny.** Put bloating/IBS tracking front and centre and keep farts as the playful layer. People will pay more for that, and it passes App Store review. The code already supports it: triggers, discomfort, the doctor report.
2. **B2B for dietitians and FODMAP coaches.** Clients log, and the coach sees the 90-day report. $20–50/month per practice beats $4.99 per user, and you'd need about 40 practices to make $1k+/month. This needs a "share report with my coach" link, which is small to add.
3. **Citizen-science partnership.** Offer UMD / CSIRO an opt-in, anonymized data export. That earns press, credibility and a "contribute to science" badge, which is strong for both PR and the App Store.
4. **Content-first validation.** Build the TikTok audience *before* paying for anything native. If clips don't get traction in 30 days, the app won't either.

My recommendation: **launch the PWA now with option 1's positioning**, and run option 4 alongside it as your marketing.

## 7. Launch checklist

- [ ] Pick the final name. If you change it, set `APP_NAME` and re-run `node scripts/make-icons.js` for the preview image. Check the USPTO and App Store before committing.
- [ ] Domain + DNS, then `docker compose up -d --build`
- [ ] `SUPPORT_EMAIL` set. App stores and the privacy policy require one.
- [ ] `MOD_WEBHOOK_URL` set (ntfy), so you see reports within minutes.
- [ ] Claim your admin username and seed 5–10 community clips so the feed isn't empty.
- [ ] Stripe live keys + webhook (README → Premium).
- [ ] Off-site backup cron (README → Backups).
- [ ] Move `toottally/` into its own repository. It doesn't belong in a BTC trading repo: `git subtree split -P toottally -b toottally-main`.

## Sources

- CSIRO, *Regular Flatulence Patterns Among Community-Dwelling Individuals in Australia*, JAMA Netw Open 2026 (doi:10.1001/jamanetworkopen.2026.15637)
- University of Maryland, smart-underwear flatulence study, 2026 (today.umd.edu)
- NHS, Flatulence: when to see a GP (nhs.uk/symptoms/flatulence)
- *Frontline Gastroenterology*, belching review (fg.bmj.com/content/17/5/440)
- Apple App Store Review Guidelines §4.3(b)
