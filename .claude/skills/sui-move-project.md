---
name: sui-move-project
description: >
  Set up Move projects, configure Move.toml and MVR dependencies, and troubleshoot
  build errors. Use when creating a Move project, configuring Move.toml, resolving
  dependency errors, using MVR, or migrating from old Move.toml formats.
---

# Move Project Setup

> **Source constraint:** Information from docs.sui.io, move-book.com, and MystenLabs/sui-stack-hello-world.

## Canonical full-stack project

```bash
git clone https://github.com/MystenLabs/sui-stack-hello-world.git
cd sui-stack-hello-world
```

Layout:
```
sui-stack-hello-world/
├── move/
│   └── hello-world/   # publish this Move package
└── ui/                # run this existing frontend
```

Do **not** run `sui move new` or `npm create @mysten/dapp` for this workflow.

## New standalone project

```bash
sui move new my_project
cd my_project
```

## Multi-package workspace

```
my_project/
├── packages/
│   ├── core/
│   │   ├── sources/
│   │   └── Move.toml
│   └── examples/
│       ├── sources/
│       └── Move.toml
└── ui/
```

**Do not nest packages inside each other** — triggers test runner bugs.

Local dependency:
```toml
[dependencies]
core = { local = "../core" }
```

## Move.toml (Sui CLI v1.63+)

```toml
[package]
name = "my_project"
edition = "2024"

[environments]
testnet = "4c78adac"
mainnet = "35834a8a"
```

- Do **not** add `Sui = { git = "..." }` — resolved automatically
- Do **not** add `[addresses]` — removed in new format
- Only add `[dependencies]` for third-party/local packages

## MVR dependencies

```bash
suiup install mvr
mvr add @org/package --network testnet
```

Or directly in `Move.toml`:
```toml
[dependencies]
suins = { r.mvr = "@suins/core" }
```

## Published.toml and Move.lock

- **`Published.toml`** — tracks package addresses per environment (created after first publish)
- **`Move.lock`** — auto-generated, pins all dependencies; commit to version control, never edit manually

## Common errors

| Error | Fix |
|-------|-----|
| "Dependency 'Sui' is a legacy system name" | Remove `Sui = { git = "..." }` from `[dependencies]` |
| "Packages with old dependencies" | `suiup update sui@testnet` then `suiup switch sui@testnet` |
| "Cannot upgrade package without having a published id" | Check `Published.toml` exists with correct address |
| "Could not determine the correct dependencies" | Add `--build-env` flag or `[environments]` section |
| Edition mismatch / `public struct` syntax error | Set `edition = "2024"` in `Move.toml` |
| Stale lock file issues | Delete `Move.lock` and run `sui move build` |

## Rules

- Use `public(package)` for non-library functions (`public` signatures can't be deleted in upgrades)
- Struct definitions cannot be deleted, modified, or have abilities added through upgrades
- Objects cannot exceed 256 KB

## Sources

- https://docs.sui.io/guides/developer/first-app
- https://move-book.com
