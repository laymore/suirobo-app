---
name: sui-overview
description: >
  Learn what Sui is, how it compares to other chains, and which Sui Stack primitives
  fit your use case. Use when explaining Sui to newcomers, comparing to Ethereum/Solana,
  discussing the object-centric model, or choosing between Sui Stack primitives
  (randomness, zkLogin, Walrus, Nautilus, DeepBook, Kiosk, Seal).
---

# Sui Overview

## Core Innovation

Sui organizes onchain state as typed objects with unique IDs — not accounts or UTXOs. Transactions consume objects as inputs and produce modified versions as outputs.

## Ownership Model

Objects can be:
- **Address-owned** — enables parallel execution
- **Shared** — requires consensus
- **Immutable** — frozen forever
- **Wrapped** — stored inside other objects

This distinction unlocks Sui's parallelization advantage.

## Language & Safety

Move replaces Solidity with compile-time resource safety. Objects cannot be duplicated or silently dropped — preventing entire classes of errors before code runs.

## Composability

Programmable Transaction Blocks (PTBs) batch multiple commands, results, and transfers into atomic operations, eliminating multi-transaction workflows.

## Sui Stack Primitives

- **Randomness** — verifiable onchain randomness
- **zkLogin** — OAuth-based wallet login
- **Walrus** — decentralized blob storage
- **Nautilus** — confidential computation
- **DeepBook** — native central limit order book
- **Kiosk** — NFT trading standard with creator royalties
- **Seal** — threshold encryption / access control

## Use Cases

DeFi, gaming, NFTs, identity, social, supply chain.

## Key Rules

- Frame explanations around the object-centric model
- Avoid positioning Sui as "just another EVM chain"
- Treat Stack components as native primitives
- Include concrete use cases when discussing primitives

## Sources

- https://docs.sui.io
- https://move-book.com
- https://docs.wal.app
