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

## 🚀 Installation & Configuration

### Step 1: Install the app
```bash
# From the Reddit Developer Portal
# Navigate to your subreddit → Mod Tools → Install BotPrints
```

### Step 2: Open the Dashboard
Use the subreddit mod menu (⋮) → **📊 Open BotPrints Dashboard**

This creates a custom post with the full forensics dashboard. Only moderators can see the menu action.

### Step 3: Run Analysis
The app runs daily background analysis automatically at midnight UTC. You can also trigger an immediate scan via Mod Tools → **🔬 Run BotPrints Analysis Now**.

---

## 🛡️ Safe & Responsible Usage (For Moderators)

BotPrints is a powerful metadata analysis tool, but it should be used responsibly as part of a holistic moderation strategy:

1. **Not a Ban Hammer:** A high "Risk Score" indicates anomalous, bot-like behavioral patterns, but it is **not definitive proof** of malicious intent. Always review the user's actual content and context before taking permanent action (like banning).
2. **Privacy First:** BotPrints **never reads or stores user content** (text, images, or links). It purely analyzes metadata (timestamps, frequencies, and ratios).
3. **Avoid Bias:** Because we do not analyze text, BotPrints has zero language or topic bias. However, be aware that certain benign tools (like helpful summary bots) will naturally trigger high scores. Consider adding known good bots to an approve-list in your community guidelines.
4. **Use "Watch" Before "Restrict":** We recommend utilizing the "Watch" feature to monitor accounts exhibiting "Shifted" behavior before applying restrictions.

---

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

### Radar Chart Axes
- **Time** (was TMP) — Timing regularity (posting interval consistency)
- **Day** (was CRC) — Daily pattern (24-hour activity distribution)
- **Act** (was ENG) — Activity ratio (post vs. comment balance)
- **Edit** (was EDT) — Edit rate (content editing frequency)
- **Spk** (was BST) — Spikes/silence pattern (batch scheduling detection)

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

## 📝 Changelog

### v0.0.8 (Current)
- Added "Help" modal to explain metrics and badges in plain language.
- Refined badge terminology ("Stable" changed to "Consistent").
- Automated dashboard post opening upon creation.
- Implemented demo UI for "Watch" and "Restrict" moderator actions.

### v0.0.1
- Initial Hackathon Release.
- 5-axis behavioral fingerprinting implemented.
- Custom Devvit UI dashboard launched.
- Coordinated Ring detection active.

---


*BotPrints — Because behavior doesn't lie.*
