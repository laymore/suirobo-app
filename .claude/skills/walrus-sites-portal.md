---
name: walrus-sites-portal
description: >
  Run a local portal server to browse and test Walrus Sites on testnet.
  Use when wal.app doesn't serve testnet sites, setting up a local portal,
  configuring portal-config.yaml, or troubleshooting portal 404s and port conflicts.
---

# Walrus Sites Portal (Local)

`wal.app` only serves **mainnet** sites. To view testnet sites, self-host the portal.

## Prerequisites

- **Bun** runtime: `npm install -g bun`
- Git

## Setup

```bash
git clone --depth 1 https://github.com/MystenLabs/walrus-sites.git
cd walrus-sites/portal

bun install

# Copy testnet config
cp server/portal-config.testnet.example.yaml server/portal-config.yaml
```

> **Do not modify `original_package_id`** in the config. It must match the Walrus Sites framework package on testnet. The example ships with the correct value.

## Start the portal

```bash
# Must run from walrus-sites/portal directory
bun -F server start
```

Portal runs on **port 3000** by default.

## Access your site

```
http://<base36-site-id>.localhost:3000
```

Get the base36 URL from `site-builder publish` output, or convert manually:

```bash
site-builder convert <HEX_SITE_OBJECT_ID>
```

## Understanding `original_package_id`

The most common misconfiguration. This is the **Walrus Sites framework package ID**, NOT:
- Your app's Move package ID
- Your published site's object ID

Verify with:
```bash
sui client object <site-object-id>
# Look at objType: 0x<THIS_PREFIX>::site::Site
# The prefix IS the original_package_id
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "Page not found" (404) | Blobs expired | Run `site-builder sitemap <id>` and re-publish with `--epochs 30+` |
| "Page not found" after editing config | Wrong `original_package_id` | Restore from example file |
| Port 3000 in use | Another dev server | `lsof -i :3000 -t \| xargs kill`, then restart |
| Portal crashes on startup | Missing config file | Ensure `portal/server/portal-config.yaml` exists |
| Bun errors | Old Bun version | Update: `npm install -g bun` |

## Mainnet vs testnet summary

| | Testnet | Mainnet |
|--|---------|---------|
| Portal | Self-hosted (`localhost:3000`) | `wal.app` |
| WAL tokens | Free (faucet) | Real cost |
| URL format | `<b36>.localhost:3000` | `<b36>.wal.app` |

## Rules

1. Don't change `original_package_id` unless the framework package was upgraded
2. Run `bun -F server start` from the `portal/` directory, not repo root
3. Kill port 3000 before starting the portal
4. `wal.app` is mainnet only

## Sources

- https://docs.wal.app/walrus-sites/portal
- https://github.com/MystenLabs/walrus-sites/tree/main/portal
