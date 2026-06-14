# Suirobo — Agent Config

Suirobo (by Team Autobots) is a self-custody AI trading-bot ecosystem on Sui:
a React/Vite dApp hosted on Walrus Sites, Move contracts in `suirobo_contracts/`,
and a local agent (`.exe`) backend that holds the user's keys and runs bots.
Live at **autobots.wal.app**. UI is English-only.

## Sui Development Skills

Install community-maintained skills for Sui development:

```sh
npx skills https://github.com/MystenLabs/skills
```

## Sui SDK Reference

Every `@mysten/*` package ships LLM documentation in its `docs/` directory. When working with
these packages, find the relevant docs by looking for `docs/llms-index.md` files inside
`node_modules/@mysten/*/`. Read the index first to find the page you need, then read that page
for details.

> **Sui docs MCP:** when available, query `https://sui.mcp.kapa.ai` for up-to-date Sui answers
> and to verify anything not covered by the installed skills.

## Official Resources

When unsure about Move patterns or Sui APIs, consult these sources. Do not guess or
extrapolate from other blockchains.

- Move Book: https://move-book.com (use https://move-book.com/llms.txt)
- Sui Docs: https://docs.sui.io (use https://docs.sui.io/llms.txt)
- Sui Move examples: https://github.com/MystenLabs/sui/tree/main/examples/move

## Project Structure

- `src/` — React dApp (`@mysten/dapp-kit`, `@mysten/sui`). Views in `src/components/`.
- `src/agent/` — agent tools + the shared `backtestEngine.ts` (EA engine used by BOTH backtest and the live bot — keep them in sync).
- `server/` — local agent: `agent_bootstrap.ts` (entry, single-instance replace), `local_agent.ts` (Express/WS), `live_trade_agent.ts` (bot engine).
- `suirobo_contracts/` — Move package `suirobo_factory` (skill marketplace + per-open execution fee).
- `dist/` — built Walrus Site. `dist-agent/` — packaged agent `.exe`.

## On-chain (mainnet)

- Factory package **v2** (current): `0x02faed0dea5ebb13771a45169ffd11c54b1c77a53c5672b990ef1ca1453e9199`
  — v2 fee model: 0.01 SUI per OPEN, split deterministically 0.005 marketplace + 0.005 to `creators[0]` (skill author). Close is free.
- Factory package v1 (original, kept for type origin): `0x888f919f64154138f6e21a2341515f68d472be54c45eb9c70e628cfb5458958a`
- Marketplace object: `0x8a9b68ec257a515753f13f2b6582aa6e9bc8effe2d6c9731afdadd0411fa4d22`
- **Marketplace skills package (display/buy/publish_skill): `0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc`** — SEPARATE deployment from the fee package above. `SkillMarketplace.tsx` queries `SkillPublished` events and calls `buy_skill`/`update_skill_price` here. To list a skill in the marketplace, call `publish_skill` on THIS package (not the fee one, not the testnet `0x0a75f0b5…`). Template bots published via `server/publish_template_bots.ts` (SDK, dev-signed, price 0).
- Factory UpgradeCap: `0xbaac1822eea4801d91292c96a90169caec4aa5e0204af720aec5ee32fd073bc3`
- Walrus Site object (autobots.sui → this): `0xf070fa29afac7f54de6f849d6e4391b181ba511205e1e4474cf58bfa39537a81`
- Dev/test wallet (also skill author): `0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5`

The package id used by the app lives in `src/agent/tools/executionFee.ts` (`CONTRACTS.mainnet.FACTORY`).

## Build & Deploy

- Frontend: `npm run build` → `site-builder update ./dist 0xf070fa…537a81 --epochs 10`
- Agent: `node build_agent.cjs <version>` then `node publish_agent.cjs 50` (updates `public/agent-manifest.json` + `agent-history.json`).
- Move build: `cd suirobo_contracts && sui move build`
- Contract upgrade: use `suirobo_contracts/upgrade_factory.cjs` (SDK-based, reads key from `.env`).

## Project Rules

- **Secrets never committed or embedded in builds.** Dev key + API keys live only in `.env` and `openclaw.json` (both gitignored). `executionFee.ts` and tools must not hardcode keys.
- **Fee model:** 0.01 SUI per OPEN only (0.005 author + 0.005 marketplace, deterministic — no randomness); close is free. Skill marketplace buy split stays 80/20.
- **Local sui CLI is older than mainnet protocol** (panics with "Network protocol version … maximum supported version"). For on-chain publish/upgrade either update the CLI via `suiup` (see the `sui-install` skill) or build the tx with the TS SDK (pattern: `upgrade_factory.cjs`). `sui move build --dump-bytecode-as-base64` is local-only and works regardless.
- **Backtest == live:** entry signals evaluate on CLOSED candles only; the same `backtestEngine.ts` (manageExit / calcMargin / inSession) runs in both the backtester and the live bot. Don't fork the logic.
- Agent self-replaces a running instance on launch (`server/agent_bootstrap.ts`); ports 3001/3002 (HTTP/HTTPS) + 8080/8081 (WS/WSS). HTTPS web → agent needs the user to accept the self-signed cert at `https://localhost:3002/health`.
