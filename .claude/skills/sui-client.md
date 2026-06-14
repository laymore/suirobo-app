---
name: sui-client
description: >
  Configure the Sui client, manage addresses, switch networks, request faucet
  tokens, and check balances. Use when setting up a new wallet, importing a
  recovery phrase, managing multiple addresses, or checking coin balances.
---

# Sui Client

## Initial setup

First-time `sui client` execution:
1. Creates `~/.sui/sui_config/client.yaml`
2. Generates a key pair
3. Displays a 12-word recovery phrase — **save it immediately**

## Config locations

- **macOS/Linux:** `~/.sui/sui_config/client.yaml` and `sui.keystore`
- **Windows:** `%USERPROFILE%\.sui\sui_config\client.yaml` and `sui.keystore`

## Addresses

```bash
# List addresses
sui client addresses

# Active address
sui client active-address

# Create new address
sui client new-address ed25519

# Switch active address
sui client switch --address <ADDRESS>
```

## Balances

```bash
sui client balance
sui client balance --address <ADDRESS>

# List objects
sui client objects
sui client objects --address <ADDRESS>
```

## Network management

```bash
# List environments
sui client envs

# Add new environment
sui client new-env --alias devnet --rpc https://fullnode.devnet.sui.io:443

# Switch environment
sui client switch --env testnet

# Check active environment
sui client active-env
```

## Faucet tokens

```bash
# Devnet and Localnet only
sui client faucet

# Testnet
# → Web: https://faucet.sui.io
# → Discord: Sui Discord server #testnet-faucet
# → SDK: requestSuiFromFaucetV1() in TypeScript
```

## Coin management

Merge small coins (avoid fragmentation):

```bash
sui client ptb \
  --merge-coins gas "[<COIN_ID_1>, <COIN_ID_2>]" \
  --gas-budget 5000000
```

## Recovery

```bash
# Import a lost address
sui keytool import '<12-WORD-PHRASE>' ed25519
```

> Quote the phrase and ensure it's in correct order.

## Block explorers

- **SuiVision:** https://suivision.xyz
- **Suiscan:** https://suiscan.xyz

## Sources

- https://docs.sui.io/references/cli/client
