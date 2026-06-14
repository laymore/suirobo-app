---
name: sui-build-test
description: >
  Compile Move packages, resolve build errors, and run tests. Use when running
  sui move build, sui move test, fixing compilation errors, using code coverage,
  or debugging with sui replay.
---

# Build and Test Move

## Build

```bash
sui move build
```

Validates types, enforces resource safety, generates bytecode. Resolve all errors before proceeding.

### Multi-environment build

```bash
sui move build --build-env testnet
sui move build --build-env mainnet
```

Required when `Move.toml` defines multiple `[environments]` without a default.

## Test

```bash
sui move test
```

### Key testing modules

- **`sui::test_scenario`** — multi-transaction, multi-sender scenarios
- **`std::unit_test`** — `assert_eq!`, `assert_ne!` macros

### Code coverage

```bash
sui move test --coverage
```

## Debugging

- `std::debug::print` — print values during tests
- **Move Trace Debugger** — step-through execution in VS Code
- `sui replay <TRANSACTION_DIGEST>` — re-execute past onchain transactions

## Common Build Errors

- **"Dependency 'Sui' is a legacy system name"** — Remove `Sui = { git = "..." }` from `[dependencies]`; the current CLI resolves it automatically.
- **"Packages with old dependencies"** — CLI version mismatch; run `suiup update sui@testnet` then `suiup switch sui@testnet`.
- **Edition mismatch** — Add `edition = "2024"` to `Move.toml`.
- **Stale lock file** — Delete `Move.lock` and rebuild.

## Sources

- https://docs.sui.io/references/cli/move
- https://move-book.com
