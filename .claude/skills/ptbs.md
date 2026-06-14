---
name: ptbs
description: >
  Compose multiple Move calls into a single atomic transaction with gas handling
  and sponsorship support. Use when building Programmable Transaction Blocks (PTBs),
  using the Transaction class in TypeScript, sui client ptb CLI, splitting/merging
  coins, or sponsored transactions.
---

# Programmable Transaction Blocks (PTBs)

A PTB bundles multiple commands into a single atomic transaction. Either all commands succeed or all fail.

## Commands

| Command | Purpose |
|---------|---------|
| `MoveCall` | Call a Move function |
| `SplitCoins` | Split a coin into multiple amounts |
| `MergeCoins` | Merge multiple coins into one |
| `TransferObjects` | Transfer objects to addresses |
| `MakeMoveVec` | Create a vector from values |
| `Publish` | Publish a new package |
| `Upgrade` | Upgrade an existing package |

## TypeScript SDK

```typescript
import { Transaction } from "@mysten/sui/transactions";

const tx = new Transaction();

// Split coin for payment
const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000)]);

// Call a Move function
const result = tx.moveCall({
  target: "0xPACKAGE::module::function",
  arguments: [tx.object("0xOBJECT_ID"), coin],
});

// Transfer result
tx.transferObjects([result], tx.pure.address(recipient));
```

## CLI

```bash
# Basic PTB with coin split and transfer
sui client ptb \
  --split-coins gas "[1000000]" \
  --assign coin \
  --transfer-objects "[coin]" @recipient

# Call a Move function
sui client ptb \
  --move-call "0xPACKAGE::module::function" @object_id \
  --gas-budget 10000000
```

## Gas handling

```typescript
// Set gas budget
tx.setGasBudget(10_000_000);

// Use gas coin as payment input
tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
```

## Sponsored transactions

```typescript
// Sponsor sets gas payment, user signs transaction data
tx.setSenderIfNotSet(userAddress);
const sponsored = await sponsorTransaction(tx);
// User signs sponsored.bytes
```

## Chaining results

PTB commands can use outputs of previous commands as inputs:

```typescript
const [nft] = tx.moveCall({ target: "pkg::nft::mint", ... });
tx.transferObjects([nft], tx.pure.address(recipient));
```

## End-of-transaction constraints

All non-`drop` values returned by commands must be consumed (transferred, stored, or destroyed) by the end of the PTB.

## Shared objects

Shared object transactions require consensus and cannot be parallelized with other transactions touching the same shared object.

## Sources

- https://docs.sui.io/concepts/transactions/prog-txn-blocks
- https://sdk.mystenlabs.com/typescript/transaction-building/basics
