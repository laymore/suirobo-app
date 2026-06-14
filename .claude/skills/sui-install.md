---
name: sui-install
description: >
  Install and manage Sui CLI versions, toolchain components, and network-specific
  builds with suiup. Use when installing Sui, updating versions, switching between
  testnet/mainnet builds, or troubleshooting "command not found" errors.
---

# Install Sui

## Recommended: suiup

```bash
# Install suiup
curl -sSf https://raw.githubusercontent.com/MystenLabs/suiup/main/install.sh | sh

# Install latest testnet build
suiup install sui@testnet

# Switch active version
suiup switch sui@testnet

# Update to latest
suiup update sui@testnet
suiup switch sui@testnet   # update does NOT auto-switch
```

> **Important:** After `suiup update`, you must explicitly run `suiup switch` to activate the new version.

## Alternative: Homebrew (macOS)

```bash
brew install sui
```

## Alternative: Chocolatey (Windows)

```powershell
choco install sui
```

## Optional Tools

```bash
suiup install walrus       # Walrus CLI for blob storage
suiup install mvr          # Move Registry package manager
suiup install site-builder # Walrus Sites deployment
```

Install the **Move Analyzer** VS Code extension for code completion and diagnostics.

## Version Matching

CLI versions must match target networks. Use `sui@testnet` for testnet, `sui@mainnet` for mainnet.

## Troubleshooting

- **"command not found"** — Run `suiup switch sui@testnet` or add `~/.local/bin` to your PATH.
- **"client/server api version mismatch"** — Run `suiup update sui@testnet` then `suiup switch sui@testnet`.
- **Verify install:** `sui --version`

## Sources

- https://docs.sui.io/guides/developer/getting-started/sui-install
