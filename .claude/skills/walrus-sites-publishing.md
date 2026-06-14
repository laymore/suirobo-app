---
name: walrus-sites-publishing
description: >
  Publish and update Walrus Sites using the site-builder CLI. Use when deploying
  a static site for the first time, updating an existing site, extending blob
  storage epochs, or debugging site-builder publish/update commands.
---

# Walrus Sites Publishing

## Install site-builder

```bash
suiup install site-builder
site-builder --version
```

## First-time publish

```bash
# Always build first
npm run build  # or your build command

# Publish — use --epochs 30+ for durability
site-builder publish ./dist --epochs 30
```

Output:
```
Site object ID: 0x95926fb4...
Site URL: http://3q7dwaf5a6eg....localhost:3000  (testnet)
      or: https://3q7dwaf5a6eg....wal.app        (mainnet)
```

Save the site object ID — you'll need it for updates.

## Update existing site

```bash
npm run build

site-builder update ./dist \
  --site-id <SITE_OBJECT_ID> \
  --epochs 30
```

> Always use `update` (not `publish`) to keep the same site URL.

## Extend blob storage

Blobs expire after `--epochs` epochs. Check expiration:

```bash
site-builder sitemap <SITE_OBJECT_ID>
```

Re-publish with more epochs to extend:

```bash
site-builder update ./dist --site-id <SITE_OBJECT_ID> --epochs 60
```

## SPA routing

Create `ws-resources.json` in your build output directory:

```json
{
  "routes": {
    "/*": "/index.html"
  }
}
```

Required for any app with client-side routing (React Router, Vue Router, etc.).

## Custom headers

```json
{
  "routes": {
    "/*": "/index.html"
  },
  "headers": {
    "/index.html": {
      "cache-control": "no-cache"
    },
    "/assets/*": {
      "cache-control": "public, max-age=31536000, immutable"
    }
  }
}
```

## Destroy a site

```bash
site-builder destroy --site-id <SITE_OBJECT_ID>
```

Deletes the onchain site object. Blobs on Walrus expire naturally.

## Common mistakes

- **Forgetting to build before publishing** — site-builder deploys whatever is in the dist folder
- **Using `publish` instead of `update`** — creates a new site with a new URL
- **Not using `--epochs 30+`** — blobs expire quickly, causing 404s
- **Missing `ws-resources.json` for SPAs** — all routes return 404 except `/`

## Epochs reference

| Epochs | Approximate duration (testnet) |
|--------|-------------------------------|
| 10 | ~10 days |
| 30 | ~30 days |
| 60 | ~60 days |
| 200 | ~200 days |

Testnet epochs may reset — use higher epoch counts for long-lived test sites.

## Sources

- https://docs.wal.app/walrus-sites/tutorial
- https://github.com/MystenLabs/walrus-sites
