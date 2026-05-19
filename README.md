# 🔬 BotPrints — Behavioral Forensics for Reddit Moderators

> **BotPrints** silently fingerprints every user's behavioral metadata — not their content — and surfaces suspicious accounts on a mod-only dashboard. Zero content analysis means zero language bias.

Built for the [Reddit Mod Tools Hackathon 2026](https://devpost.com/) on Devvit 0.12.

---

## 🏆 Why BotPrints Wins

| Existing Tool | Approach | BotPrints Advantage |
|--------------|----------|---------------------|
| StopBots | Reactive CAPTCHA challenges | BotPrints is **passive** — zero user friction |
| Bot Bouncer | Crowdsourced blocklist | BotPrints flags behavioral anomalies for human review |
| Stop AI | Crowdsourced voting on content | Content-based = biased. We use **metadata only** |
| *Any existing tool* | No raid detection | BotPrints has **real-time raid alerting** |
| *Any existing tool* | No cross-subreddit sharing | BotPrints has **shared threat intelligence** |
| *Any existing tool* | No AutoMod generation | BotPrints **auto-generates AutoMod rules** from patterns |
| *Any existing tool* | No ban evasion detection | BotPrints detects **returning banned users** via behavioral fingerprints |

---

## ⚡ Feature Overview

### 🧠 6-Signal Behavioral Scoring Engine
| # | Signal | What It Detects | Weight |
|---|--------|----------------|--------|
| 1 | **Temporal regularity** | Metronomic, cron-job posting intervals | 25 pts |
| 2 | **Circadian entropy** | 24/7 activity without a sleep cycle | 20 pts |
| 3 | **Engagement ratio** | Posts but never comments | 15 pts |
| 4 | **Edit absence** | AI-generated content is never edited | 10 pts |
| 5 | **Burst-silence** | Batch posting then going silent | 15 pts |
| 6 | **Vote correlation** | Suspiciously uniform upvote patterns (astroturfing) | 15 pts |

**Total: 0–100 suspicion score.** Visualized on a 6-axis radar chart per user.

### 🔗 Coordinated Ring Detection (CIB)
Detects bot rings by computing Jaccard similarity on 5-minute posting time windows across flagged users. Bot farms using the same scheduler are identified automatically.

### ⚡ Behavioral Shift Detection
Catches warmed-up accounts that post normally for weeks then suddenly switch to spam mode. Uses z-score analysis against the user's own 7-day rolling baseline.

### 🆕 New Account Amplifier
Accounts under a configurable age threshold (default 30 days) get their suspicion score multiplied (default 1.3x) before threshold comparison. Both raw and amplified scores are displayed. **Directly addresses communities targeted by new-account karma farming.**

### 🕵️ Ban Evasion Fingerprint Matching
When a user is banned, their 6-dimensional behavioral fingerprint is stored (privacy-preserving — no PII, only math). When new accounts post, cosine similarity matching detects returning banned users on their **first post**, not their fiftieth.

### ⚠️ Real-Time Raid Detection
Monitors a sliding window of suspicious account activity. When the threshold is breached, fires an instant modmail alert with participant usernames, scores, and one-click bulk filter.

### 🌐 Cross-Subreddit Shared Threat Intelligence
A bot ring hitting one subreddit is always hitting others. BotPrints shares anonymized behavioral fingerprints of confirmed rings across all participating installations. O(1) lookup on every new post — pre-flag known ring members instantly.

### 🤖 AutoMod Rule Generator
Translates detected patterns into ready-to-use AutoModerator YAML rules:
- Domain spam → `domain: [detected-domain]` remove rules
- New account swarms → account age requirements
- Posting frequency abuse → rate limits
- Karma farming → minimum comment karma requirements

One-click apply directly to your subreddit's AutoModerator config.

---

## 🛠️ 4-Tier Enforcement System

| Tier | Score Range | Action | Details |
|------|-----------|--------|---------|
| **0** | Any | 👁 Watch | Silent monitoring — modmail alert on new activity |
| **1** | 60-79 | 🔽 Filter | Future content auto-routed to modqueue |
| **2** | 80-89 | ⚠ Remove + Appeal | Content removed, user gets appeal via modmail |
| **3** | 90+ | 🚫 Ban + Report | Permanent ban, content reported to Reddit admins |

All actions default to **"Do Nothing"** — BotPrints is never aggressive out of the box.

### ⚖️ Appeal Workflow
- Customizable appeal messages with `{username}` and `{subreddit}` variables
- Configurable timeout (24h, 48h, 72h, or never)
- Optional auto-escalation when appeals expire unanswered
- Dedicated Appeals tab with approve/extend/escalate buttons

---

## 📊 Dashboard

### Navigation
- **📊 Dashboard** — User cards with 6-signal radar charts, badges, and enforcement buttons
- **⚖️ Appeals** — Pending appeal queue with countdown timers
- **📋 Audit Log** — Complete transparency record of all automated and manual actions
- **🌐 Shared Intel** — Pre-flagged accounts from the cross-subreddit threat network
- **⚙️ Settings** — Full configuration panel for thresholds, actions, and opt-ins

### Dashboard Filters
All | 🔴 High Risk | ⚡ Shifted | 🔗 Bot Ring | 🕵️ Ban Evaders | ⏳ Awaiting Appeal | ✓ Safe

### Badges
- ✓ **Consistent** — Normal behavior
- ⚡ **Shifted** — Sudden pattern change (possible account purchase)
- 🔗 **Bot Ring** — Coordinated posting detected
- 🆕 **New Account** — Amplified score due to young account age
- 🕵️ **Ban Evader** — Behavioral match to previously banned user
- 🌐 **Shared Intel** — Flagged by the cross-subreddit threat network

### Time Saved Metrics
Prominent "Estimated Hours Saved" counter with formula: `(accounts_actioned × 15 min) + (rings_detected × 45 min)`. Includes 14-day sparkline chart, accounts actioned, items filtered, bans issued, rings detected, and appeal conversion rate.

---

## 🚀 Installation & Configuration

### Step 1: Install the App
1. Navigate to your subreddit's **Mod Tools** on Reddit.
2. Under the **Apps** section, search for **BotPrints** and click **Install**.
3. Accept the required permissions (we only ask for what we need to analyze metadata).

### Step 2: Open the Dashboard
1. Open your subreddit.
2. Click the **Mod Menu (⋮)** at the top right.
3. Select **📊 Open BotPrints Dashboard**.

*The dashboard is strictly visible only to moderators. Regular users cannot see your forensics data.*

### Step 3: Configure (Quick Start)
1. **Set Thresholds** — Go to ⚙️ Settings and configure Low/Medium/High risk cutoffs (start with 60/80/90).
2. **Customize Appeal Message** — Set the message removed users see. Use `{username}` and `{subreddit}` variables.
3. **Choose Opt-ins** — Enable Raid Alerts, New Account Amplifier, and Shared Threat Layer based on your community's needs.

### Autopilot Mode
BotPrints runs a daily background analysis at midnight UTC. It quietly processes active users and updates the dashboard. For immediate insights during a suspected raid, use **🔬 Run BotPrints Analysis Now** from the Mod Menu.

---

## 🔒 Privacy & Visibility

- **Invisible to Users:** Regular users have no idea BotPrints is running. Bad actors cannot game the detection.
- **Zero Content Storage:** We never read, store, or analyze post text, images, or links. Only behavioral metadata (timestamps, frequencies, ratios). This eliminates language-based or ideological bias.
- **Privacy-Preserving Fingerprints:** Ban evasion detection and shared threat intelligence use only mathematical behavioral vectors — no PII is ever stored or transmitted.
- **Mod-Only Access:** All dashboards, alerts, and forensics data are locked behind Reddit's moderator authentication.

---

## 🔧 Architecture

```
Posts/Comments → Triggers (silent) → Redis Profile Update
                                         ↓
                              Daily Scheduler (midnight UTC)
                                         ↓
                              6-Signal Scoring Engine
                                         ↓
                    ┌─── Behavioral Shift Detection
                    ├─── Coordinated Ring Detection (CIB)
                    ├─── New Account Amplifier
                    ├─── Ban Evasion Fingerprint Matching
                    ├─── Vote Correlation Analysis
                    └─── Cross-Subreddit Threat Lookup
                                         ↓
                              Ranked Sorted Set (Redis)
                                         ↓
                              Mod Dashboard (Custom Post)
```

---

## ⚡ Performance

| Metric | Target |
|--------|--------|
| Trigger latency | < 100ms (max 2 Redis ops) |
| Daily analysis (1000 users) | < 30 seconds |
| Dashboard load | < 2 seconds |
| Memory per user | ~2.5KB |
| Shared threat lookup | O(1) |
| Ban evasion matching | < 50ms per check |

---

## 🛡️ Safe & Responsible Usage

1. **Not a Ban Hammer:** A high Suspicion Score indicates anomalous patterns, not definitive proof. Always review actual content before permanent action.
2. **Helpful Bots:** Benign bots (AutoModerator, summary bots) will naturally score high. Use **✓ Mark Safe** to clear them.
3. **Watch Before Acting:** Use the **👁 Watch** feature to silently monitor accounts before escalating.
4. **Appeals Exist:** The Tier 2 action includes a built-in appeal pathway — users can always explain themselves.

---

<details>
<summary><strong>📚 Academic References</strong></summary>

1. **Varol et al.**, "Online Human-Bot Interactions: Detection, Estimation, and Characterization" — *ICWSM 2017* — Botometer temporal behavioral signals
2. **Pozzana & Ferrara**, "Measuring Bot and Human Behavioral Dynamics" — *Frontiers in Physics 2020* — Inter-arrival time burstiness analysis
3. **Circadian Rhythms in Social Media** — *AAAI 2023* — Sleep/wake cycle detection in posting patterns
4. **"Behavior Change as a Signal for Identifying Social Media Manipulation"** — *arXiv 2025* — Behavioral shift detection in warmed-up accounts
5. **MIT CIB Research** — *2024* — Coordinated inauthentic behavior detection via temporal correlation

</details>

---

*BotPrints — Because behavior doesn't lie.*
