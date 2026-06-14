---
name: sui-publish
description: >
  Publish and upgrade Move packages on any network, from localnet testing to
  multisig mainnet deploys. Use when publishing packages, upgrading with UpgradeCap,
  dry runs, multi-network deployment, or mainnet launch preparation.
---

# Publish and Upgrade Move Packages

## Pre-publish checklist

- `sui move build` passes with no warnings
- All tests pass: `sui move test`
- Active address has enough SUI for gas
- Correct network is active: `sui client active-env`

## Publish

```bash
sui client publish --gas-budget 100000000
```

After publishing, `Published.toml` is created with your package address and upgrade capability ID.

## Local network

```bash
sui start --with-faucet
sui client switch --env localnet
sui client faucet
```

## Dry run

```bash
sui client publish --gas-budget 100000000 --dry-run
```

## Upgrade

```bash
sui client upgrade --upgrade-cap-id <CAP_ID> --gas-budget 100000000
```

Requires a `published-at` value in `Published.toml`. The `UpgradeCap` must be owned by the signer.

### Upgrade constraints

- Struct definitions cannot be deleted, modified, or have abilities added
- `public` function signatures cannot be deleted or modified
- Only `public(package)` and `private` functions can be freely changed

## Upgrade policies

- **Compatible** (default) — enforces struct/function constraints
- **Additive** — only new modules/functions allowed
- **Immutable** — no upgrades ever

## Multisig mainnet deploy

Use `--serialize-unsigned-transaction` to create an unsigned transaction for multisig signing:

```bash
sui client publish --gas-budget 100000000 --serialize-unsigned-transaction
```

## Production monitoring

Track your package address in SuiVision or Suiscan for transaction activity.

## Sources

- https://docs.sui.io/guides/developer/first-app/publish
- https://docs.sui.io/concepts/sui-move-concepts/packages/upgrade
