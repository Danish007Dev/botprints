# 🔬 BotPrints — Behavioral Forensics for Reddit Moderators

> **BotPrints** silently fingerprints every user's behavioral metadata — not their content — and surfaces suspicious accounts on a mod-only forensics dashboard. Zero content analysis means zero language bias.

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
| *Any existing tool* | No appeal workflow | BotPrints has a **full lifecycle appeal system** with timers |

---

## ⚡ Feature Overview

### 🧠 6-Signal Behavioral Scoring Engine
Every user gets a **0–100 Suspicion Score** composed of 6 independent behavioral signals:

| # | Signal | What It Detects | Max Points |
|---|--------|----------------|-----------|
| 1 | **Temporal regularity** | Metronomic cron-job posting intervals (low inter-arrival CV) | 25 |
| 2 | **Circadian entropy** | 24/7 activity without a sleep cycle (high Shannon entropy) | 20 |
| 3 | **Engagement ratio** | Posts but never comments (abnormal post-to-comment ratio) | 15 |
| 4 | **Edit absence** | AI-generated content is never edited (zero edit rate) | 10 |
| 5 | **Burst-silence** | Long silence then batch posting spam (high max/median gap ratio) | 15 |
| 6 | **Vote correlation** | Suspiciously uniform upvote patterns across posts (low vote CV) | 15 |

Each signal is visualized on a **6-axis radar chart** and individual **signal bars** with color-coded severity (🟢 green / 🟡 yellow / 🔴 red).

#### Co-Occurrence Gate
A single elevated signal doesn't make a bot. The scoring engine applies a **co-occurrence gate** that caps the total score based on how many signals are elevated:
- **1 signal elevated** → Score capped at 35 (won't trigger action)
- **2 signals elevated** → Score capped at 55 (low risk only)
- **3+ signals elevated** → Full score (multi-signal anomaly = real threat)

#### Community Calibration
BotPrints calibrates to your community. After 50+ tracked users and 30+ days, signal thresholds adapt using **z-score analysis** against your community's own baseline. A meme subreddit and a news subreddit have very different "normal" posting behavior.

### 🔗 Coordinated Ring Detection (CIB)
Detects bot rings by computing **Jaccard similarity** on 5-minute posting time windows across flagged users. Bot farms using the same scheduler are identified and grouped automatically with a **🔗 Coordinated Group** badge.

### ⚡ Behavioral Shift Detection
Catches warmed-up accounts that post normally then suddenly switch to spam. Uses **z-score analysis** on a 7-day rolling score history to detect sudden spikes marked with a **⚡ Behavior Changed** badge.

### 🆕 New Account Amplifier
Accounts under a configurable age threshold (default: 30 days) get their suspicion score multiplied (default: 1.3×) before threshold comparison. Both raw and amplified scores are displayed on the card. **Directly addresses communities targeted by new-account karma farming.**

### 🕵️ Ban Evasion Fingerprint Matching
When a user is banned, their 5-dimensional behavioral fingerprint vector is stored (privacy-preserving — no PII, only normalized signal ratios). New accounts are matched via **cosine similarity**. A match above the threshold triggers a **🕵️ Ban Evader** badge with a side-by-side radar chart comparison showing exactly *how* the behavior overlaps.

### ⚠️ Real-Time Raid Detection
Monitors a sliding window of suspicious account activity (configurable threshold/window). When breached, fires an **instant modmail alert** with participant usernames, scores, and a one-click bulk filter action. A prominent red raid banner appears on the dashboard.

### 🌐 Cross-Subreddit Shared Threat Intelligence
A bot ring hitting one subreddit is always hitting others. BotPrints shares anonymized behavioral fingerprints of confirmed rings across all participating installations (opt-in). Flagged by the network = **🌐 Shared Intel** badge on the dashboard.

### 🤖 AutoMod Rule Generator
Translates detected patterns into ready-to-use **AutoModerator YAML rules**:
- Domain spam → `domain: [detected-domain]` remove rules
- New account swarms → account age requirements
- Posting frequency abuse → rate limits
- Karma farming → minimum comment karma requirements

One-click **📋 Copy to Clipboard** or **⚡ Apply Automatically** to your subreddit's AutoMod config.

---

## 🛠️ 4-Tier Enforcement System

| Tier | Action | What Happens |
|------|--------|-------------|
| **0** | **👁 Watch** | Silent monitoring — you receive a modmail alert whenever this user posts |
| **1** | **🔽 Filter** | All future content is auto-routed to your modqueue for manual review |
| **2** | **⚠ Remove + Appeal** | Content removed + appeal instructions sent to user via modmail |
| **3** | **🚫 Ban + Report** | Permanent subreddit ban + content reported to Reddit admins as spam |

> **Score ranges are fully configurable.** In ⚙️ Settings, you set your own Low/Medium/High cutoff thresholds. The card colors (🟢/🟡/🔴) and auto-action tiers dynamically adapt. Sliders enforce `Low < Medium < High` — they cannot overlap.

All actions default to **"Do Nothing"** — BotPrints is never aggressive out of the box. You must explicitly opt-in to each tier's auto-action.

### ⚖️ Appeal Workflow Engine
When **Remove + Appeal** fires:
1. Recent content (posts & comments) is removed from the subreddit
2. Future content is auto-routed to modqueue
3. A customizable appeal message is sent via modmail (supports `{username}` and `{subreddit}` variables)
4. A countdown timer starts (24h / 48h / 72h / never)
5. When the user replies via modmail, BotPrints **auto-highlights the conversation** in your inbox and injects the user's risk score, top signals, and behavior shift data as an internal mod note

**When the timer expires:**
- **Auto-Escalate ON** → Automatically bans the user (Tier 3)
- **Auto-Escalate OFF** → Sends a reminder modmail; timer bumps 24h

**Moderator controls in the ⚖️ Appeals tab:**
- **✓ Approve** — Clears the user, restores normal monitoring
- **Escalate (Ban)** — Immediately triggers Tier 3
- **Extend 24h** — Adds 24 hours to the countdown

---

## 📊 Dashboard — Every Button & Tab Explained

### Top Bar
| Element | What It Does |
|---------|-------------|
| **🔬 Run Analysis** | Manually triggers the scoring engine right now (doesn't wait for daily cron) |
| **📡 Load Demo Data** / **📡 Unload Demo Data** | Toggles 7 realistic demo user profiles with seeded audit log, appeals, and banned entries for testing |
| **🔄 Refresh** | Re-fetches all data from the backend |
| **❓ Help** | Opens the "How to read BotPrints" reference guide |
| **☀/🌙 Theme Toggle** | Switches between dark mode and light mode |

### Metrics Dashboard
| Metric | Description |
|--------|-------------|
| **Estimated Hours Saved** | Formula: `(accounts_actioned × 15min) + (rings_detected × 45min)` |
| **Flagged Accounts (14d)** | Sparkline chart of daily flagging activity |
| **Accounts Actioned** | Total users that have been watched, filtered, removed, or banned |
| **Items Filtered** | Total posts/comments routed to modqueue |
| **Bans Issued** | Total Tier 3 permanent bans |
| **Rings Actioned** | Coordinated bot rings detected and actioned |
| **Appeals Sent** | Total Tier 2 removal-with-appeal actions |
| **Appeal Response Rate** | Percentage of appeals that received a user reply |

### Navigation Tabs

| Tab | What It Shows |
|-----|--------------|
| **📊 Dashboard** | User cards with scores, signals, radar charts, badges, and action buttons |
| **⚖️ Appeals** | Pending appeal queue with countdown timers and approve/extend/escalate controls |
| **🚫 Banned** | Users who were permanently actioned. "Restore Tracking" button un-bans them from the dashboard (for testing/reversals) |
| **📋 Audit Log** | Timestamped record of every automated and manual action — your transparency trail |
| **🌐 Shared Intel** | Pre-flagged accounts from the cross-subreddit threat network |
| **⚙️ Settings** | Full configuration panel (see below) |

### Dashboard Filter Tabs (inside 📊 Dashboard)

| Filter | Shows |
|--------|-------|
| **All** | Every tracked user |
| **🔴 High Risk** | Users scoring above your Medium cutoff (red cards) |
| **⚡ Shifted** | Users with sudden behavioral pattern changes |
| **🔗 Bot Ring** | Users identified as coordinated ring members |
| **🕵️ Ban Evaders** | Users matching a previously banned account's fingerprint |
| **⏳ Awaiting Appeal** | Users currently in the Tier 2 appeal window |
| **✓ Safe** | Users you've manually cleared with Mark Safe |

### User Card Anatomy

```
┌──────────────────────────────────────────────────┐
│  [B] u/username ↗                    53  SUSPICION│
│  67 posts, 0 comments, 0 edits      4/6 elevated │
│  [🆕 New Account] [⚡ Behavior Changed]  Conf: Med│
│                                                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐              │
│  │  0      │ │  13     │ │  15     │              │
│  │ Timing  │ │Circadian│ │Engagmnt │              │
│  ├─────────┤ ├─────────┤ ├─────────┤              │
│  │  10     │ │  15     │ │  0      │              │
│  │ Edits   │ │ Bursts  │ │ Votes   │              │
│  └─────────┘ └─────────┘ └─────────┘              │
│                                                    │
│  ▼ Click to expand: Radar chart + actions ▼        │
│                                                    │
│  [👁 Watch] [🔽 Filter] [⚠ Remove+Appeal]         │
│  [🚫 Ban+Report] [✓ Mark Safe]                    │
│  [🤖 Generate AutoMod Rule] (if ring member)       │
└──────────────────────────────────────────────────┘
```

**Confidence indicator** (top-right of each card):
- **Low** (grey) — Limited data or single-signal anomaly
- **Medium** (yellow) — 50+ posts/comments AND 3+ elevated signals
- **High** (red) — 150+ posts/comments AND 5+ elevated signals

### User Card Action Buttons

| Button | Tier | What Happens |
|--------|------|-------------|
| **👁 Watch** | 0 | Adds to watchlist. You get a modmail whenever they post. Button changes to "Watched". |
| **🔽 Filter** | 1 | Routes all future content to modqueue. Click again to unfilter. |
| **⚠ Remove + Appeal** | 2 | Removes recent content + sends appeal modmail. Requires confirmation. |
| **🚫 Ban + Report** | 3 | Permanent ban + reports to Reddit admins. Requires confirmation. |
| **✓ Mark Safe** | — | Clears the user from the active dashboard. Moves them to the ✓ Safe filter. |
| **↺ Re-Analyze** | — | Appears on Safe-cleared users. Removes the safe marking and re-evaluates. |
| **🤖 Generate AutoMod Rule** | — | Appears on coordinated ring members. Generates ready-to-use YAML. |

---

## ⚙️ Settings Panel — Complete Reference

### Score Thresholds
Three sliders that define your risk tiers. They are **mutually exclusive** — Low must always be less than Medium, which must always be less than High.

| Setting | Default | Range | Effect |
|---------|---------|-------|--------|
| Low Suspicion Cutoff | 60 | 30–80 | Users at or above this score get **yellow card borders** |
| Medium Suspicion Cutoff | 80 | 50–95 | Users at or above this score get **red card borders** |
| High Suspicion Cutoff | 90 | 70–100 | Threshold for the most aggressive auto-action tier |

### Auto-Actions Per Tier
Three dropdowns — one per threshold tier. Each can be set to:
- **Do Nothing** (default for all)
- **Send to Modqueue** (Tier 1 filter)
- **Remove + Appeal** (Tier 2)
- **Ban + Report** (Tier 3)

### Appeal Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Appeal Removal Message | *(default template)* | Sent to users when content is removed. Supports `{username}` and `{subreddit}`. |
| Appeal Timeout | Never | How long users have to respond (24h / 48h / 72h / Never) |
| Auto-Escalate on Timeout | OFF | When ON, expired appeals auto-escalate to the next tier |

### New Account Amplifier

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Amplifier | OFF | Toggle the score multiplier for young accounts |
| Account Age Threshold | 30 days | Accounts younger than this get amplified |
| Score Multiplier | 1.3× | Applied to the raw suspicion score before threshold comparison |

### Scheduling & Integrations

| Setting | Default | Description |
|---------|---------|-------------|
| Daily Analysis Hour | 0:00 UTC | When the background scoring job runs |
| Raid Alerts Enabled | ON | Real-time raid detection modmail alerts |
| Shared Threat Layer | OFF | Cross-subreddit behavioral fingerprint sharing (opt-in) |

### Buttons

| Button | What It Does |
|--------|-------------|
| **💾 Save Settings** | Persists all settings to Redis. Server-side validation auto-clamps invalid values. |
| **🔄 Reset to Defaults** | Deletes all saved settings and restores factory defaults. Requires confirmation. |

---

## 🚀 Installation & Onboarding

### Step 1: Install
1. Navigate to your subreddit's **Mod Tools** on Reddit.
2. Under **Apps**, search for **BotPrints** and install.
3. Accept the required permissions (Reddit API + Redis for data storage).

### Step 2: Open the Dashboard
1. Open your subreddit.
2. Click the **Mod Menu (⋮)** at the top right.
3. Select **📊 Open BotPrints Dashboard**.

*The dashboard creates a pinned Custom Post visible only to moderators.*

### Step 3: First-Time Setup (3 Minutes)

| Step | Action | Why |
|------|--------|-----|
| 1 | Click **📡 Load Demo Data** | See the dashboard with realistic sample users before real data arrives |
| 2 | Go to **⚙️ Settings** → Set thresholds | Start conservative: 60/80/90. You can always tighten later. |
| 3 | Set **Low Suspicion Action** → "Do Nothing" | Don't auto-act on anything until you understand your community's baseline |
| 4 | Customize the **Appeal Removal Message** | Add your community-specific context so removed users know exactly what happened |
| 5 | Enable **Raid Alerts** | Get instant modmail alerts during coordinated attacks |
| 6 | Click **💾 Save Settings** | Settings persist in Redis — they survive app updates |

### Step 4: Go Live
1. Click **📡 Unload Demo Data** to clear the samples.
2. BotPrints is already silently collecting behavioral metadata from every new post and comment.
3. After enough data accumulates (25+ posts/comments per user), scores appear on the dashboard.
4. The daily analysis runs at your configured hour (default: midnight UTC).
5. Use **🔬 Run BotPrints Analysis Now** from the Mod Menu for immediate scoring.

### Autopilot Mode
BotPrints runs a **daily background analysis** at your configured UTC hour. It processes all tracked users, updates scores, checks for raids, processes appeal expirations, and updates the dashboard. For immediate insights, use the manual trigger from the Mod Menu.

---

## 💡 Pro Tips for Moderators

### 🤖 Handling AutoModerator & Known Bots
AutoModerator, summary bots, and other legitimate bots will **score extremely high** on multiple signals (they post mechanically, never edit, have uniform patterns). This is by design — the scoring engine correctly identifies their behavior as non-human.

**What to do:** Click **✓ Mark Safe** on AutoModerator and any other known-good bots. This moves them to the Safe list and excludes them from active monitoring. Encourage your mod team to mark safe accounts early to keep the dashboard clean.

### 🔍 Start with Watch, Not Ban
When you first see a high-scoring user, resist the urge to immediately ban. Use **👁 Watch** first. This silently monitors the account and sends you a modmail whenever they post. Observe the pattern for a few days before escalating.

### 📊 Interpreting Confidence Levels
- **Low Confidence** — The user hasn't been around long enough. Their score might be noisy. Wait for more data.
- **Medium Confidence** — Moderate data and multiple elevated signals. Worth investigating.
- **High Confidence** — Extensive data and multi-signal anomaly. This is your strongest evidence.

### 🎯 Understanding the Co-Occurrence Gate
A user with only 1 elevated signal is capped at score 35, even if that one signal is maxed out. This prevents false positives from users who just happen to post at regular intervals (high Temporal) but are otherwise normal. **True bots light up 3+ signals simultaneously.**

### 🔗 Coordinated Rings: The Strongest Signal
If BotPrints flags a **🔗 Coordinated Group**, pay close attention. This means multiple accounts are posting within the same 5-minute windows repeatedly — the strongest indicator of a bot farm using a shared scheduler. Use the **🤖 Generate AutoMod Rule** button on ring members to create blocking rules.

### 📈 Community Calibration Period
For the first 30 days with fewer than 50 tracked users, BotPrints uses a global default baseline. Once calibration completes, the scoring engine adapts to your community's unique posting rhythms. A gaming subreddit with night-owl users will have different "normal" circadian patterns than a morning-news subreddit.

### ⚖️ Appeal Best Practices
- Set the appeal timeout to **48h** for most communities — enough time for users to respond, short enough to not let spam linger.
- Keep **Auto-Escalate OFF** until you're confident in your threshold settings.
- The appeal message template supports `{username}` and `{subreddit}` — personalize it to reduce user confusion.

### 🚫 Using the Banned Tab
The **🚫 Banned** tab shows all permanently actioned users. The "Restore Tracking" button is useful for:
- **Testing:** Unban a demo user to verify the ban/restore cycle
- **Reversals:** If you discover a false positive, restore the user to active monitoring
- **Auditing:** Review your team's historical ban decisions

---

## 🔒 Privacy & Visibility

- **Invisible to Users:** Regular users have no idea BotPrints is running. Bad actors cannot game the detection.
- **Zero Content Storage:** We never read, store, or analyze post text, images, or links. Only behavioral metadata (timestamps, frequencies, ratios). This eliminates language-based or ideological bias.
- **Privacy-Preserving Fingerprints:** Ban evasion detection and shared threat intelligence use only mathematical behavioral vectors — no PII is ever stored or transmitted.
- **Mod-Only Access:** All dashboards, alerts, and forensics data are locked behind Reddit's moderator authentication. Non-mods see a "🔒 Access Denied" screen.

---

## 🔧 Architecture

```
                    ┌─────────────────────────────────┐
                    │     Reddit Event Triggers        │
                    │  onPostCreate, onCommentCreate,  │
                    │  onPostUpdate, onPostDelete,     │
                    │  onCommentUpdate, onCommentDelete,│
                    │  onModAction, onModMail          │
                    └──────────────┬──────────────────┘
                                   ↓
                    ┌──────────────────────────────────┐
                    │   Silent Profile Accumulator     │
                    │  Updates Redis user profiles:    │
                    │  timestamps, hourBuckets, edits, │
                    │  voteScoreDeltas, post/comment   │
                    │  counts. Checks watchlist,       │
                    │  filter list, and appeal state.  │
                    └──────────────┬──────────────────┘
                                   ↓
               ┌───────────────────┼───────────────────┐
               ↓                   ↓                   ↓
    ┌──────────────────┐  ┌────────────────┐  ┌────────────────┐
    │ Daily Scheduler  │  │ Real-Time Raid │  │ Modmail Trigger │
    │ (Cron: 0 0 * * *)│  │   Detection    │  │  (onModMail)   │
    │                  │  │ Sliding window │  │ Auto-highlight  │
    │ For each user:   │  │ + modmail alert│  │ + score inject  │
    │ • 6-Signal Score │  └────────────────┘  └────────────────┘
    │ • Shift Detection│
    │ • Ring Detection │
    │ • Ban Evasion    │
    │ • New Acct Amp   │
    │ • Shared Threat  │
    │ • Appeal Expiry  │
    │ • Auto-Actions   │
    └────────┬─────────┘
             ↓
    ┌──────────────────┐
    │  Redis Sorted    │
    │  Sets (ZSETs)    │
    │                  │
    │ bp:scores:ranked │ ← Active dashboard users
    │ bp:scores:cleared│ ← Safe/dismissed users
    │ bp:scores:watchlist│← Watched users
    │ bp:scores:filtered│← Modqueue-filtered users
    │ bp:scores:actioned│← Banned/removed users
    │ bp:appeals:pending│← Active appeal timers
    └────────┬─────────┘
             ↓
    ┌──────────────────┐
    │  Mod Dashboard   │
    │  (Custom Post)   │
    │  Devvit Webview  │
    │                  │
    │  Hono API Server │
    │  ↕ REST JSON     │
    └──────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Server entry point — registers all Hono route modules |
| `src/routes/triggers.ts` | Silent background data collection + raid detection |
| `src/routes/scheduler.ts` | Daily analysis cron job + appeal expiration processing |
| `src/routes/api.ts` | REST API for the dashboard (scores, actions, settings) |
| `src/routes/menu.ts` | Mod Menu items (Open Dashboard, Run Analysis Now) |
| `src/scoring/riskScore.ts` | 6-signal scoring engine with community calibration |
| `src/scoring/shiftDetector.ts` | Behavioral shift detection (z-score on rolling history) |
| `src/scoring/coordinatedDetector.ts` | Bot ring detection (Jaccard similarity on time windows) |
| `src/signals/temporal.ts` | Inter-arrival CV, circadian entropy, burst-silence ratio |
| `src/signals/engagement.ts` | Post-to-comment ratio, edit rate |
| `src/storage/settings.ts` | Auto-action settings (Redis JSON blob) |
| `src/storage/scores.ts` | Sorted sets for rankings, watchlist, filter, actioned |
| `src/storage/fingerprints.ts` | Ban evasion fingerprint storage and cosine matching |
| `src/types/index.ts` | TypeScript type definitions and default constants |
| `src/client/app.js` | Dashboard UI logic (vanilla JS, no framework) |
| `src/client/styles.css` | Dashboard styling (dark/light mode, responsive) |
| `src/client/index.html` | Dashboard HTML structure |
| `src/data/demoData.ts` | 7 demo profiles for testing all dashboard features |

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
2. **Helpful Bots:** AutoModerator and legitimate bots will naturally score high on multiple signals. Use **✓ Mark Safe** to clear them from the active dashboard.
3. **Watch Before Acting:** Use **👁 Watch** to silently monitor accounts before escalating. Observation > reaction.
4. **Appeals Exist:** Tier 2 includes a built-in appeal pathway — users can always explain themselves via modmail.
5. **Start Conservative:** Begin with high thresholds (60/80/90) and all actions set to "Do Nothing." Observe for a week, then gradually enable auto-actions.
6. **Community Calibration:** Give BotPrints 30 days and 50+ users to calibrate to your community. Scores become significantly more accurate after calibration.

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

*BotPrints — Because behavior doesn't lie.* 🔬
