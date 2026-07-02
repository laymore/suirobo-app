# Autobots — Own your bot. Own your keys.

### Deterministic trading robots for DeepBook, Sui's on-chain order book · [`autobots.wal.app`](https://autobots.wal.app)

> Self-custody · Built on Sui: DeepBook V3 + Margin, Walrus, Pyth, SuiNS

Autobots is a self-custody ecosystem for building, testing, publishing, and running rule-based trading bots on Sui. Strategies are designed and stress-tested with AI-grade tooling, then executed by lean, deterministic robots that run 24/7 at near-zero marginal cost, signing from the user's own machine.

This document is structured around one question: **why would a skeptic pass on this — and why would they be wrong?** Each section answers one objection.

---

## Objection 1: "Crypto trading bots are a scam-saturated category."

Correct. That is exactly why the design refuses every mechanic scams depend on:

- **There is no deposit address.** Funds stay in the user's wallet or their own on-chain margin account. We are a tool vendor, never a custodian, so there is nothing to rug and no honeypot for attackers.
- **No yield promises.** The home page's primary call to action is not "deposit" but *"Test a strategy free"*: run a real backtest on real market data with no wallet connected, and see the drawdowns next to the returns.
- **Everything is verifiable, not claimed.** Strategy source is pinned on Walrus (Sui's public storage network), live results are backed by transaction digests anyone can check on-chain, and every fee is stated in plain sight.

The pitch is not "trust us". The pitch is **"verify us"** — and that stance is only possible because the whole stack is on a public chain.

## Objection 2: "AI-agent trading has broken unit economics."

Also correct — for everyone doing it the obvious way. An always-on LLM agent that "watches the market" pays inference costs on every decision, around the clock. That cost quietly eats the very profit the bot earns; at retail position sizes it usually eats more than all of it.

Autobots inverts the architecture:

- **AI works at design time** — research, parameter optimization, robustness analysis, walk-forward validation — where one good decision is reused thousands of times.
- **Execution is deterministic** — an EA-style rules engine (signals on closed candles, TP/SL/breakeven/trailing, session filters, risk sizing) that runs 24/7 with **no per-trade API bill at all**.

Same intelligence, applied where it compounds instead of where it burns. This is the founding thesis of the product, and it is a structural cost advantage over every "AI agent trades for you" competitor.

## Objection 3: "Bots have no moat. Anyone can fork the code."

The code is open. The moat is not the code — it is the **trust layer that only an on-chain venue makes possible**, and that no CEX-based bot (MetaTrader EAs, 3Commas-style services) can structurally copy:

| Trust primitive | Autobots | CEX bot |
|---|---|---|
| Track record proven by transaction digests, not screenshots | ✅ on-chain | ❌ impossible |
| Strategy source pinned publicly (Walrus) and reproducible in the backtester | ✅ | ❌ |
| Market data from the venue's own fill-tape (DeepBook `OrderFilled` events), no data vendor in the critical path | ✅ shipped | ❌ |
| Creator royalties enforced by a smart contract on every bot-opened trade | ✅ live | ❌ trust-based |
| Hard risk limits enforceable by a Move contract the bot cannot exceed (roadmap) | ✅ possible | ❌ impossible |

Forking the code copies none of these: the marketplace history, the on-chain fee flow to authors, and the verifiable records accrue to the network, not the repository.

## Objection 4: "Where does revenue come from?"

One simple, on-chain-enforced fee: **0.01 SUI every time a bot opens a trade** — half to the platform treasury, half to the author of the strategy in use, paid automatically by the `suirobo_factory` contract. Closing is free.

This creates a supply-side flywheel rather than a custody business:

1. Strategy authors publish to the marketplace (source on Walrus, results reproducible).
2. Users run those strategies; every open pays the author on-chain.
3. Earning authors publish more and better strategies; verified badges compound their reputation.
4. More strategies attract more users — and every user is also new taker volume for DeepBook, which aligns the project with the exchange layer and the Sui ecosystem instead of competing with them.

Revenue scales with **bot activity**, not with assets under custody, spreads, or subscription churn.

## Objection 5: "Is anything actually built, or is this a deck?"

Shipped and verifiable today:

- **Mainnet-validated live trading**: swap-based DeepBook margin positions (long = borrow USDC → buy SUI; short = borrow SUI → sell), validated with real funds on Sui mainnet.
- **Autobots Desktop v1.2.0** (portable Windows app): the full product — key entered locally and encrypted at rest (OS-level DPAPI), bot self-signs 24/7.
- **A safety layer most retail bots never get**:
  - *Chain-is-truth reconcile* — the bot verifies its own position against the MarginManager's real on-chain debt and drops stale phantoms.
  - *Data-integrity watchdog* — entries pause automatically on stale market data; the agent rotates across three public Sui fullnodes on read failures.
  - *Dead-man switch* — a crashed or hung agent auto-restarts and a running bot auto-resumes, reconciling with the chain first.
  - Kill-switch, max-daily-loss circuit breaker, and a DeepBook liquidation guard on every position.
- **A professional research bench**: MT5-class backtester on real historical data, a parameter Optimizer, a Robustness Lab (period stability + 1,000-run Monte-Carlo), and anchored walk-forward validation — so strategies are proven before a coin is at risk. Example results (backtests on real data, reproducible in-app): +12.0% over Jan–May 2026 on SUI M5; +45.9% over full-year 2025 on BTC M15.
- **A Sui-native data spine**: OHLC candles built from DeepBook's own on-chain fill-tape and a live order-book-imbalance signal — the bot can run entirely off its own Sui RPC, with no CEX API in the decision loop.
- **Live surfaces**: the web app at [autobots.wal.app](https://autobots.wal.app) (hosted on Walrus, resolved by SuiNS) for wallet-signed trading and onboarding; the desktop app as the flagship for 24/7 automation.

Every claim above is checkable: the code is public, the contracts are on mainnet, and the releases are downloadable.

## Objection 6: "Why Sui and DeepBook?"

Because a trading bot needs three things a general-purpose chain rarely offers together: a **native central-limit order book** (DeepBook V3 with margin), **cheap fast transactions** (a 24/7 bot places thousands), and **verifiable public state** for the trust layer above. Sui has all three, plus Walrus for storage and Pyth for oracles.

Strategically, bots are the kind of user a young order book wants most: they trade around the clock and generate consistent volume. Autobots grows **with** the DeepBook and Sui ecosystem, not against it.

## Objection 7: "Retail users will never trust it enough to start."

Onboarding is a trust ladder in which commitment is earned one step at a time:

1. **Test a strategy** — a real backtest, no wallet, nothing at risk.
2. **Trade from your own wallet** — manually or with the in-tab Web Bot; the user reviews and signs every single trade.
3. **Go fully automatic** — download the desktop app; the key is entered once, locally, and never leaves the machine.

At no step is the user asked to trust before they can verify, and at no step do we hold anything of theirs.

---

## Roadmap

**Next**

- **Maker-first execution** — enter with DeepBook limit orders instead of crossing the spread as a taker: the largest per-trade cost improvement available without touching strategy logic.
- **Move-enforced risk vault** — position, leverage, and daily-loss limits enforced by an on-chain contract the bot cannot exceed: "trust-minimised" instead of "trust the software".
- **DeepBook liquidation radar** — turn on-chain liquidation pressure into both a defensive guard and an opportunity signal.
- **More instruments, portfolio bots, and a continuously expanding library** of battle-tested, no-code strategy templates.

**Shipped** — see [ROADMAP.md](./ROADMAP.md) for the full phase-by-phase record (12 completed phases, from the skill factory and on-chain fee contract through the v1.2.0 safety release).

---

## How it's built (Sui-native)

| Layer | Tech |
|---|---|
| Spot & leveraged trading | **DeepBook V3** + **DeepBook Margin** (SUI/USDC) via `pool_proxy` |
| Market data | **DeepBook on-chain fill-tape** (`OrderFilled` → OHLC) + L2 order-book imbalance — no CEX REST in the critical path |
| Prices | **Pyth** oracle feeds |
| Marketplace / creator fee | on-chain `suirobo_factory` contract (deterministic 0.005 SUI per open to the strategy author) |
| Hosting & storage | **Walrus** — frontend site and strategy source (verifiable) |
| Naming | **SuiNS** — `autobots.sui` |
| Clients | **Autobots Desktop** (portable app, 24/7 self-signing) + Walrus-hosted web app (wallet-signed) |

## Try it

- **Web (nothing at risk):** open [autobots.wal.app](https://autobots.wal.app) and run a backtest — no wallet needed.
- **Desktop (the product):** download the latest `Autobots-desktop` release, extract, run `Autobots.exe`, and verify the SHA-256 against `public/agent-manifest.json`.

One fee, stated once: 0.01 SUI per bot-opened trade (half to the strategy author). Closing is free. Your keys never leave your machine.
