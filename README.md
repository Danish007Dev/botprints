# 🔬 BotPrints — Behavioral Forensics for Reddit Moderators

**BotPrints** silently fingerprints every user's behavioral metadata — not their content — and surfaces suspicious accounts on a mod-only dashboard using academically validated signals. Zero content analysis means zero language bias.

Built for the [Reddit Mod Tools Hackathon 2026](https://devpost.com/) on Devvit 0.12.

---

## ✨ What Makes BotPrints Unique

After auditing every published Devvit mod app, **no existing tool does proactive, account-level behavioral fingerprinting**:

| Existing Tool | Approach | BotPrints Advantage |
|--------------|----------|-------------------|
| StopBots | Reactive CAPTCHA challenges | BotPrints is **passive** — zero user friction |
| Bot Bouncer | Crowdsourced blocklist | Can't catch **new** bots. We detect anomalies |
| Stop AI | Crowdsourced voting on content | Content-based = biased. We use **metadata only** |

### 🔗 Coordinated Ring Detection
BotPrints is the **first Devvit app** to detect coordinated bot rings by cross-correlating posting timestamps across users. Bot farms using the same scheduler are identified automatically.

---

## 🧠 The 5 Behavioral Signals

| # | Signal | What It Measures | Bot Behavior | Weight |
|---|--------|-----------------|-------------|--------|
| 1 | **Temporal Regularity** | Coefficient of variation of posting intervals | Metronomic, low CV | 25 pts |
| 2 | **Circadian Entropy** | Shannon entropy of posting hour distribution | Uniform across 24h | 20 pts |
| 3 | **Engagement Ratio** | Post-to-comment ratio | Posts but never comments | 20 pts |
| 4 | **Edit Absence** | Edit rate relative to community average | AI content is never edited | 15 pts |
| 5 | **Burst-Silence** | Max gap / median gap ratio | Batch posting then silence | 20 pts |

**Total: 0–100 risk score.** Higher = more suspicious.

### 🔬 Advanced Detection

- **Behavioral Shift Detection** — Catches warmed-up accounts that post normally for weeks then suddenly switch to spam mode (z-score against own 7-day baseline)
- **Coordinated Inauthentic Behavior (CIB)** — Detects bot rings by computing Jaccard similarity on 5-minute posting time windows across flagged users

---

## 📊 Dashboard Features

- **Subreddit Health Summary** — At-a-glance metrics: users tracked, high risk count, shifted accounts, bot rings detected, community health score
- **5-Signal Radar Chart** — Visual breakdown of which signals are anomalous per user
- **Coordinated Ring Alerts** — Purple-highlighted alert boxes showing detected bot groups
- **Filter Tabs** — All | High Risk | Shifted | Bot Ring
- **Expandable Cards** — Click to reveal radar chart, shift status, and mod actions
- **Demo Data** — One-click demo mode for testing

---

## 🛠️ Moderator Actions (Dashboard Buttons)

BotPrints provides one-click, deeply integrated moderation actions directly on the dashboard. These actions integrate securely with Reddit's backend APIs:

- **👁 Watch (Watchlist Monitoring)**: 
  - Adds the user to a permanent, invisible Watchlist backed by Redis.
  - Whenever a watched user posts or comments anywhere in the subreddit, BotPrints instantly triggers a **Modmail Inbox Alert** containing a direct link to the user's new activity. 
  - *Best for:* Monitoring "Shifted" accounts or suspicious users before escalating to a ban.
- **⚠ Restrict (Mute / Cool Off)**: 
  - Instantly mutes the user from the subreddit (using Reddit's official `reddit.muteUser` API). 
  - Leaves a secure internal note ("BotPrints: High risk behavioral anomaly detected - Under Review").
  - *Best for:* Immediate containment of 90+ score accounts and coordinated bot rings.
- **✓ Mark Safe (Clear)**: 
  - Clears a false positive or benign bot (e.g. AutoModerator, helpful summary bots) from the High Risk radar.
  - The user is permanently ignored by future Daily Analysis runs so they don't continually clutter the dashboard.
- **↺ Re-Analyze (Undo Mark Safe)**: 
  - Found under the "Safe" filter tab. This reverses a "Mark Safe" decision.
  - The user is removed from the cleared list, their risk score is instantly re-calculated, and they are placed back into active dashboard monitoring.

---

## 🚀 Installation & Configuration

BotPrints is designed to be plug-and-play for your moderation team. Here’s how to get started:

### Step 1: Install the App
1. Navigate to your subreddit’s **Mod Tools** on Reddit.
2. Under the **Apps** section, search for **BotPrints** and click **Install**.
3. Accept the required permissions (we only ask for what we absolutely need to analyze metadata).

### Step 2: Open the Mod Dashboard
Once installed, BotPrints lives entirely within Reddit.
1. Open your subreddit.
2. Click the **Mod Menu (⋮)** at the top right of the community header.
3. Select **📊 Open BotPrints Dashboard**.
*Note: This creates a secure, interactive webview dashboard. **This dashboard is strictly visible only to moderators.** Regular users cannot see your forensics data.*

### Step 3: Run the Analysis
BotPrints works silently in the background, but you are always in control.
- **Autopilot (Autonomous Mode):** By default, BotPrints runs a daily background analysis at midnight UTC. It quietly crunches the metadata of active users and updates the dashboard.
- **Manual Override:** Need immediate insights during a suspected raid? Open the **Mod Menu (⋮)** and click **🔬 Run BotPrints Analysis Now** to force an instant behavioral scan.

---

## 🔒 Privacy & Visibility

We built BotPrints with a strict **Privacy-First Architecture**:
- **Invisible to Users:** Regular users have no idea BotPrints is running. It operates silently in the background, ensuring bad actors cannot easily game or reverse-engineer the detection algorithms.
- **Zero Content Storage:** We do not read, store, or analyze post text, images, or links. BotPrints relies *exclusively* on behavioral metadata (timestamps, frequencies, and posting ratios). This ensures absolute privacy and completely eliminates language-based or ideological bias.
- **Mod-Only Access:** All dashboards, alerts, and forensics data are locked behind Reddit's secure moderator authentication.

---

## 🛡️ Safe & Responsible Usage

BotPrints is a powerful tool, but it should complement—not replace—human judgment:
1. **Not a Ban Hammer:** A high "Risk Score" indicates anomalous, machine-like patterns, but it is **not definitive proof** of malicious intent. Always review the user's actual content before taking permanent action.
2. **Helpful Bots:** Be aware that benign, community-approved tools (like AutoModerator or helpful summary bots) will naturally trigger high scores. Use the **✓ Mark Safe** button to clear them from your dashboard.
3. **Use "Watch" First:** We highly recommend using the **👁 Watch** feature to silently monitor accounts exhibiting "Shifted" behavior before applying hard restrictions.
4. **Need Help?** We've built an interactive **Help Center** directly into the dashboard. Just click the `?` icon in the top right corner of the BotPrints app for a quick refresher on interpreting signals.

---

## 🚀 The Future of BotPrints (We Need You!)

This is just the beginning. Our mission is to build the most sophisticated behavioral forensics engine on Reddit. 

In future updates, we plan to make our detection algorithms even more robust, optimized, and tailored to specific community types. **To do that, we need your precious feedback!** 

If you catch a bot we missed, or if a human gets flagged, please let us know. Your real-world moderation experience is critical to training the next generation of BotPrints.

## 🔧 How It Works

```
Posts/Comments → Triggers (silent) → Redis Profile Update
                                         ↓
                              Daily Scheduler (midnight UTC)
                                         ↓
                              5-Signal Scoring Engine
                                         ↓
                              Behavioral Shift Detection
                                         ↓
                              Coordinated Ring Detection
                                         ↓
                              Ranked Sorted Set (Redis)
                                         ↓
                              Mod Dashboard (Custom Post)
```

### 🎯 Interpreting the Radar Chart (Circle Diagram)
The BotPrints dashboard features a 5-axis circle diagram (radar chart) for each user. This visualizes their behavioral risk profile at a single glance. 

**How to read it:**
- **The Center (0 points)** represents perfect, human-like baseline behavior.
- **The Outer Edge (Max points)** represents highly anomalous, bot-like behavior.
- The shaded orange/red polygon shows the user's specific behavioral "fingerprint". A large, spiked shape reaching the outer edges indicates a high probability of automated behavior.

**The 5 Axes Explained:**
1. **Time (Temporal Regularity, 0-25 pts):** A spike here means the user posts with metronomic, machine-like precision (e.g., exactly every 60 minutes). Humans have natural variance; bots use `cron` jobs.
2. **Day (Circadian Entropy, 0-20 pts):** A spike here means the user is active 24/7 without a daily sleep cycle. Humans sleep; bots post uniformly around the clock.
3. **Act (Activity Ratio, 0-20 pts):** A spike here indicates heavily skewed engagement—such as an account that submits hundreds of link posts but never leaves a single comment.
4. **Edit (Edit Rate, 0-15 pts):** A spike here means the user *never* edits their posts or comments, while the rest of the community occasionally corrects typos. AI text generators don't make typos.
5. **Spk (Spikes/Silence, 0-20 pts):** A spike here reveals batch-processing behavior: the account goes completely silent for days, then dumps 50 posts in a single minute, followed by silence again.

---

## 📚 Academic References

1. **Varol et al.**, "Online Human-Bot Interactions: Detection, Estimation, and Characterization" — *ICWSM 2017* — Botometer temporal behavioral signals
2. **Pozzana & Ferrara**, "Measuring Bot and Human Behavioral Dynamics" — *Frontiers in Physics 2020* — Inter-arrival time burstiness analysis
3. **Circadian Rhythms in Social Media** — *AAAI 2023* — Sleep/wake cycle detection in posting patterns
4. **"Behavior Change as a Signal for Identifying Social Media Manipulation"** — *arXiv 2025* — Behavioral shift detection in warmed-up accounts
5. **MIT CIB Research** — *2024* — Coordinated inauthentic behavior detection via temporal correlation

---

## ⚡ Performance

| Metric | Target |
|--------|--------|
| Trigger latency | < 100ms (max 2 Redis ops) |
| Daily analysis (1000 users) | < 30 seconds |
| Dashboard load | < 2 seconds |
| Memory per user | ~2KB |

---


*BotPrints — Because behavior doesn't lie.*
