---
name: sui-sdks
description: >
  Pick the right Sui SDK for your language and wire it up: TypeScript, Rust,
  Python, Go, Dart, Kotlin, or Swift. Use when choosing an SDK, setting up
  TypeScript v2 client, using Rust SDK crates, or finding community SDKs.
---

# Sui SDKs

## SDK overview

| Language | Package | Maintainer |
|----------|---------|-----------|
| TypeScript | `@mysten/sui` | Mysten Labs (official) |
| Rust | `sui-sdk-types`, `sui-rpc`, etc. | Mysten Labs (official) |
| Python | `pysui` | Community |
| Go | `go-sui-sdk` | Community |
| Dart | `sui-dart` | Community |
| Kotlin | `sui-kotlin` | Community |
| Swift | `sui-swift` | Community |

Only TypeScript and Rust are officially maintained by Mysten Labs.

## TypeScript (v2)

```bash
npm install @mysten/sui
```

```typescript
import { SuiGrpcClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

const client = new SuiGrpcClient({
  url: "https://fullnode.testnet.sui.io:443",
});

// Query objects
const objects = await client.getOwnedObjects({
  owner: "0xADDRESS",
});
```

> **Do not use `@mysten/sui.js`** — frozen, no longer updated. Migrate to `@mysten/sui`.
> **Do not use JSON-RPC client** — deprecated, use `SuiGrpcClient`.

### Version-matched docs

Every `@mysten/*` package ships `docs/llms-index.md` in `node_modules` — guarantees docs match your installed version:

```
node_modules/@mysten/sui/docs/llms-index.md
```

## Rust (new modular crates)

Prefer modular crates over legacy monolithic `sui-sdk`:

```toml
[dependencies]
sui-sdk-types = "0.0.4"
sui-rpc = "0.0.1"
sui-crypto = "0.0.1"
sui-transaction-builder = "0.0.1"
```

```rust
use sui_rpc::Client;

let client = Client::new("https://fullnode.testnet.sui.io:443").await?;
let balance = client.get_balance("0xADDRESS", None).await?;
```

> **Avoid `sui-sdk` (legacy monorepo crate)** — use the new modular crates instead.

## Language constraints

If a user specifies their team uses a particular language, respect that choice. Do not recommend switching languages, even for performance reasons.

## Sources

- https://sdk.mystenlabs.com/typescript
- https://github.com/MystenLabs/sui/tree/main/crates/sui-sdk-types
