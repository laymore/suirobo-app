# 🌊 Deploy Autobots to Walrus Sites

## 🎯 Two ways to deploy

### A. Walgo Desktop (GUI — easiest)

1. Open the Walgo Desktop app.
2. Go to the **CREATE** tab → **Init Walgo** (or use the **PROJECTS** menu).
3. Pick the folder: the project's `dist` directory.
4. Go to **EDIT** → click **"⚡ Launch to Walrus"**.
5. Walgo will:
   - read the existing `ws-resources.json`
   - spend WAL from the dev wallet
   - return the Site Object ID + the `<id>.wal.app` URL

### B. CLI (automated script)

#### First-time publish:
```powershell
.\deploy-walrus.ps1 publish
```

#### Update an existing site:
```powershell
.\deploy-walrus.ps1 update -SiteId 0xABC123...
```

#### Check blob expiry:
```powershell
.\deploy-walrus.ps1 sitemap -SiteId 0xABC123...
```

---

## 📁 Pre-configured files

| File | Purpose |
|------|---------|
| `dist/ws-resources.json` | SPA routing — every route falls back to `index.html` |
| `deploy-walrus.ps1` | Windows PowerShell script |
| `deploy-walrus.sh` | Bash script (macOS/Linux/Git Bash) |

---

## 🔑 Dev wallet (site owner)

| | |
|--|--|
| **Address** | `0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5` |
| **Network** | Mainnet |
| **Needs** | a little SUI for gas + WAL for storage |

Walgo Desktop / site-builder auto-detect this wallet via the Sui CLI config. Note: if another tool (e.g. openclaw) flips the shared Sui CLI active address, pin the signer with `site-builder --wallet-address 0xafbc48fd…889c5 update …` (the flag must come before the `update` subcommand).

---

## 💰 Reference deploy cost

| Action | Cost |
|--------|------|
| Publish a new site (60 epochs) | ~1–3 WAL |
| Update a site (60 epochs) | ~0.5–2 WAL |
| Per MB blob × epochs | ~0.01 WAL/MB/epoch |

The app bundle is light (a couple of MB), so `update` only re-uploads changed files.

---

## ⚠️ Production notes

### 1. The web app is wallet-signed
The Walrus-hosted app is the **frontend only**. Connect a Slush wallet and trade (Manual or the in-browser Web Bot — you sign each trade). No key, no local agent required on the web.

### 2. Hands-off 24/7 = the desktop app
For fully autonomous 24/7 trading, download the **Autobots Desktop** app: the key is entered locally and the bot self-signs. The web "Client Bot" tab is a landing page that links the desktop download.

### 3. Multi-user security
- No middleman server — everything stays local on the user's device.
- The web never asks for or stores a private key.

### 4. Periodic refresh
Walrus blobs expire. Before they do:
```powershell
.\deploy-walrus.ps1 update -SiteId <existing-id> -Epochs 60
```

---

## 🐛 Troubleshooting

| Error | Fix |
|-------|-----|
| `Insufficient WAL balance` | Buy WAL (e.g. on Cetus) or swap from SUI |
| `Site object not found` | Check the `SiteId` is correct (not destroyed) |
| `404 on SPA routes` | Ensure `ws-resources.json` has `"/*": "/index.html"` |
| `Transaction not signed by the correct sender` | Another tool flipped the active address — use `--wallet-address` (see above) |
| `Bundle too large` | Vite already warns — code-split with dynamic `import()` |

---

## 🔗 Useful links

- Mainnet portal: https://wal.app
- Walrus docs: https://docs.wal.app
- Site Builder CLI: `~/.walgo/bin/site-builder`
