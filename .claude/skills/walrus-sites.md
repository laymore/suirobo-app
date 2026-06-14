---
name: walrus-sites
description: >
  Deploy and manage fully decentralized websites powered by Walrus storage and
  onchain site objects. Use when publishing static sites to Walrus, configuring
  ws-resources.json for SPA routing, updating deployments, checking blob expiration,
  or troubleshooting site-builder errors.
---

# Walrus Sites

Walrus Sites hosts static websites on Walrus blob storage with onchain site objects on Sui.

## Prerequisites

```bash
suiup install walrus
suiup install site-builder
sui client switch --env testnet  # or mainnet
```

## Publish

```bash
# Build your app first
npm run build

# Publish (use --epochs 30+ for durability)
site-builder publish ./dist --epochs 30
```

Output includes:
- Site object ID (hex)
- Base36 URL for the portal

## Update existing site

```bash
site-builder update ./dist --site-id <SITE_OBJECT_ID> --epochs 30
```

## Configure routing (SPA, custom headers)

Create `ws-resources.json` in your dist directory:

```json
{
  "routes": {
    "/*": "/index.html"
  },
  "headers": {
    "/index.html": {
      "content-type": "text/html; charset=utf-8"
    }
  }
}
```

The `"/*": "/index.html"` fallback is required for single-page apps with client-side routing.

## Check blob expiration

```bash
site-builder sitemap <SITE_OBJECT_ID>
```

Check the "Earliest Expiration Date" column. Blobs with past dates cause 404s.

## Convert object ID to portal URL

```bash
site-builder convert <HEX_SITE_OBJECT_ID>
```

## Destroy a site

```bash
site-builder destroy --site-id <SITE_OBJECT_ID>
```

## Portals

| Network | Portal URL |
|---------|-----------|
| Mainnet | `<b36-id>.wal.app` |
| Testnet | Self-hosted required (see walrus-sites-portal skill) |

> `wal.app` is mainnet only. For testnet, run a local portal.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| 404 on all pages | Blobs expired | Re-publish with `--epochs 30+` |
| SPA routes return 404 | Missing fallback route | Add `"/*": "/index.html"` to `ws-resources.json` |
| "Object not found" | Wrong site object ID | Check `site-builder publish` output |
| Site not updating | Published new site instead of updating | Use `site-builder update` with existing `--site-id` |

## Rules

- Always build before publishing
- Use `--epochs 30` or higher to avoid silent 404 failures
- Use `site-builder update` (not `publish`) to avoid changing the site URL

## Sources

- https://docs.wal.app/walrus-sites/
- https://github.com/MystenLabs/walrus-sites
