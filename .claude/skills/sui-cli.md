---
name: sui-cli
description: >
  Understand Sui networks, gas costs, epochs, and how the network operates.
  Use when explaining network environments, gas calculation, epoch behavior,
  switching networks, or using faucets.
---

# Sui CLI — Networks and Gas

## Networks

| Network | Purpose | Tokens |
|---------|---------|--------|
| Mainnet | Production | Real SUI |
| Testnet | Staging, pre-production | Free (faucet) |
| Devnet | Early development | Free (faucet) |
| Localnet | Offline/local testing | Free (built-in faucet) |

```bash
# List configured environments
sui client envs

# Switch network
sui client switch --env testnet
sui client switch --env mainnet

# Check active environment
sui client active-env
```

## Gas calculation

```
gas cost = computation cost + storage cost - storage rebate
```

- **Computation cost** — reflects execution effort
- **Storage cost** — covers object bytes stored onchain
- **Storage rebate** — incentivizes cleanup of deleted objects

Always specify `--gas-budget` for CLI transactions:

```bash
sui client publish --gas-budget 100000000
sui client call --gas-budget 10000000 ...
```

## Epochs

Fixed periods (~24 hours on mainnet) where validators and gas prices remain constant. Network updates happen at epoch boundaries.

## Faucets

```bash
# Devnet and Localnet only
sui client faucet

# Testnet: use web UI at faucet.sui.io or Discord
# Never on Mainnet
```

## Localnet

```bash
sui start --with-faucet
sui client new-env --alias localnet --rpc http://127.0.0.1:9000
sui client switch --env localnet
sui client faucet
```

## Common mistakes

- Deploying to Mainnet accidentally — always check `sui client active-env` before publishing
- Forgetting `--gas-budget` — transaction will fail
- Using `sui client faucet` on Testnet — only works on Devnet/Localnet

## Sources

- https://docs.sui.io/references/cli/client
- https://docs.sui.io/concepts/tokenomics/gas-in-sui
