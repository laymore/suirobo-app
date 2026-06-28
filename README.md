# Autobots — Stay Ahead of the AI-Agent Era

### A smarter, cheaper, and more sustainable way to trade on-chain · [`autobots.wal.app`](https://autobots.wal.app)

> Self-custody · Built on Sui — DeepBook V3 & DeepBook Margin, Walrus, Pyth, SuiNS

The AI-agent wave is sweeping across decentralized finance and promises to reshape the entire face of the market. In the middle of that frenzy, almost everyone dreams of the same ideal: an intelligent AI agent that analyzes the market and trades for them, 24/7, across decentralized exchanges (DEXs).

**But there is a hard truth very few people see: the cost of running it is enormous.**

Today's "smart" agents run on a constant stream of API calls to large language models (LLMs). If you let an agent continuously ingest real-time data, reason over every market move, and "call the API" non-stop to trade around the clock, the **inference cost becomes astronomical** — large enough to quietly erode, or even completely swallow, every bit of profit the bot earns.

Having seen that wasteful dead end, **Autobots** was built on a fundamentally different philosophy — smarter, more durable, and more economical:

- **AI agents are the strategy brain.** We point intelligent API agents at exactly what they're best at — auditing, deep backtesting, and research — to discover and shape the single most optimized strategy.
- **Robotics are the 24/7 execution arm.** Once the AI agent has done the hard thinking and locked in a strategy, execution is handed off to pure, deterministic trading robots on the DEX. They run continuously, tirelessly, with **no expensive per-trade API cost** — yet they carry out the full intelligence the AI established up front.

---

## 1. Doing one thing well: driving real volume for DeepBook & the DEX ecosystem

DeepBook is built as a high-performance, decentralized liquidity and trading layer. For core infrastructure like that, pouring heavy, bloated AI systems directly into the trading layer is unnecessary and dilutes the real goal.

What DEXs and their users actually need most are **lean, effective tools that drive trading volume and attract new users.**

Autobots focuses precisely on that strength:

- **No AI bloat at the point of execution.** We keep the trading layer fast, smooth, and cost-optimized.
- **A volume-and-traffic engine.** By providing high-speed automation, we help users execute strategies cleanly on DeepBook. That directly adds liquidity, lifts exchange volume, and welcomes a wave of new users — people who want to trade professionally but don't want the headache of infrastructure or runaway API bills.

---

## 2. Strength rooted in data discipline

An automated trading system is only valuable when it speaks in real numbers, not momentary emotion. So Autobots is built on:

- **Curated, rules-based strategies.** Our robots don't spray capital randomly — they apply strict, EA-style skill sets tuned for the on-chain environment.
- **Battle-tested against history.** Before any strategy goes live, it is put through rigorous backtests against large historical datasets, month by month, on real market data.

This preparation lets the robot execute precisely — optimizing win rate and controlling risk — at a running cost that is effectively zero.

---

## 3. Absolute sovereignty: platform-hack resistant, your assets stay private

In a decentralized world, security isn't a bonus feature — it's the root of survival. We hold crypto's highest principle sacred: *Not your keys, not your coins.*

Autobots is designed fully non-custodial, guaranteeing total privacy and independence:

- **It never leaves your machine.** Your private key and **your assets never leave your device.** Every calculation and every signature happens locally, on your own machine.
- **Safer against platform hacks.** Your funds are far safer because **Autobots is only a tool provider, never a custodian.** We hold no keys and no coins. Even in the worst case — the platform's front end being attacked — **your assets remain completely intact and safe** on your device, simply because there is no central database of funds for an attacker to target.
- **Private and independent.** Your trade logs, your proprietary strategies, and your wallet are yours alone. You are immune to central-server outages, third-party failures, and sudden policy changes. You hold 100% control of your own system.

---

## 4. Surviving the bear market & a built-in creator economy

The harsh reality of crypto is the "red season" — bear markets, when prices fall, volume dries up, and users thin out, largely because they lack a consistent method, lack tools, and can't afford the API bills to keep a bot alive.

Autobots solves this pain with a reinforcing ecosystem:

- **Ready-made audit flow & strategy templates.** We provide a standardized audit + backtest workflow and a library of strategy templates that AI agents have researched and optimized. Even when the market is grim, you have sharp tools to defend and hunt for opportunity — without paying a cent in API fees.
- **A creator economy — share to prosper together.** The standout feature of Autobots is that it rewards community brainpower. If you research a profitable strategy on our system, you can **publish it directly on the platform.** When other users run your bot, **a creator fee is paid back to you, the author — automatically and on-chain (0.005 SUI for every position your bot opens).**

This model turns the project into a durable, aligned whole: experienced traders monetize their insight, everyday users get a safe foundation, and a steady stream of organic trading volume keeps flowing into the DEX.

---

## Conclusion: redefining smart, sustainable DEX trading

Autobots doesn't just hand you another automated bot — it brings a **smart, sustainable mindset for on-chain finance.** By combining the analytical power of AI agents with the cost-efficient performance of robotics — while keeping your assets 100% safe on your own machine — we help you master the DEX, 24/7.

The system runs efficiently, economically, with absolute security, and opens the door to uncapped passive income. Protect your assets and lead the future of smart trading — with **Autobots**.

---

## 🚀 Roadmap

**Shipped**

- **Autobots Desktop app** — the full pro toolkit in a one-click portable app (Windows), bundling the local trading agent. Your key is entered locally and the bot self-signs 24/7. The desktop app is the product; the web app is wallet-signed trading (connect, trade, or run the in-browser Web Bot — you sign each trade).
- **EA-style strategy engine** shared by backtest and live — closed-candle signals (no repaint), TP/SL/breakeven/trailing, risk-% sizing, session filters, multi-timeframe gates, cooldowns, and per-strategy AND-filters (ADX/RSI/Stoch/ATR%/MACD/SMA/EMA).
- **Rigour tools** — a parameter **Optimizer** (sweep), a **Robustness Lab** (period stability + Monte-Carlo), and **anchored walk-forward** validation (in-sample optimise → out-of-sample test) so a strategy is proven before a coin is at risk.
- **Hard safety interlocks** — kill-switch + max-daily-loss breaker, a DeepBook liquidation guard, and TP/SL on every position. Deterministic, never AI-gated.
- **Sui-native data spine** — candles built from the **DeepBook on-chain fill-tape** (`OrderFilled` → OHLC) instead of a CEX REST feed, wired into both the Backtest Simulator and the live bot (opt-in). Plus a live **order-book imbalance** signal/entry filter. A self-custody bot can run entirely off its own Sui RPC.
- **Verifiable track record** — on-chain, per-wallet bot results surfaced as marketplace trust badges.

**Next**

- **Move-enforced risk vault** — capability-typed authority (analyst / execute / lifecycle caps) so an automation can trade within hard, on-chain-enforced limits it can never exceed.
- **DeepBook liquidator + cascade radar** — turn on-chain liquidation pressure into both a defensive guard and an opportunity signal.
- **More indicators, more pairs, portfolio bots**, and a continuously expanding library of ready-made, battle-tested templates — all no-code.

Our north star: turn strategy research into a fast, rigorous, no-code workflow — while keeping every Auto Bot self-custodial, verifiable, and cheap to run 24/7.

---

## How it's built (Sui-native)

| Layer | Tech |
|---|---|
| Spot & leveraged trading | **DeepBook V3** + **DeepBook Margin** (SUI/USDC) via `pool_proxy` |
| Market data | **DeepBook on-chain fill-tape** (`OrderFilled` → OHLC) + L2 order-book imbalance — no CEX REST in the critical path |
| Prices | **Pyth** oracle feeds |
| Marketplace / creator fee | on-chain `suirobo_factory` contract (deterministic 0.005 SUI/open to the skill author) |
| Hosting & storage | **Walrus** — frontend Site, bot-skill source, and agent memory (verifiable) |
| Naming | **SuiNS** — `autobots.sui` |
| Clients | **Autobots Desktop** (one-click portable app, bundles the local agent, 24/7 self-sign) **+** Walrus-hosted web app (wallet-signed: Manual + in-browser Web Bot) |

**Live app:** [autobots.wal.app](https://autobots.wal.app)
