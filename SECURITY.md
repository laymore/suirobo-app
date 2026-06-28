# 🔐 Security Policy — Autobots

## Status summary

✅ **No keys are leaked publicly.** A full audit has been performed.

| Public channel | Status |
|----------------|--------|
| `https://autobots.wal.app` (Walrus mainnet) | ✅ Bundle has 0 keys |
| `autobots-agent.exe` / `Autobots.exe` (GitHub Releases) | ✅ Binary has 0 keys |
| Git history (`github.com/laymore/suirobo-app`, public) | ✅ Only `*.example` templates tracked; no private keys ever committed |

---

## Secret-management rules

### 1. Secret classification

| Type | Stored in | On disk? | In git? |
|------|-----------|----------|---------|
| **Dev private key** | `.env` → `SUIROBO_DEV_WALLET` | ✅ Local only | ❌ Ignored |
| **LLM API key** | `openclaw.json` → `apiKey` | ✅ Local only | ❌ Ignored |
| **User private key** (Auto Bot) | browser `sessionStorage` | ❌ RAM only | N/A |
| **User API key** | browser `localStorage` (btoa) | ❌ Browser only | N/A |
| **Test wallet address** | `.env` → `SUIROBO_DEV_ADDRESS` | ✅ Public OK | ✅ OK (address only) |

### 2. Files that MUST be in `.gitignore`

```
# Sensitive — NEVER commit
.env
.env.local
.env.production
openclaw.json
openclaw.local.json
*.pem
*.key
*.bak
server/bot_state.json
server/state.json

# Test files that hold runtime keys (local build only)
test-live-execute.ts
test-live-borrow.ts
test-live-repay.ts
```

### 3. Code rules

❌ **NEVER** hardcode a key/secret in any `.ts`, `.tsx`, `.js`, `.cjs`, or `.json` file tracked by git.

✅ **Always** use `process.env.<NAME>`:

```typescript
// ✅ Good
const apiKey  = process.env.DEEPSEEK_API_KEY || '';
const privKey = process.env.SUIROBO_DEV_WALLET || '';

// ❌ Bad
const apiKey = 'sk-REDACTED_EXAMPLE_DO_NOT_HARDCODE';
```

### 4. Local dev setup

```bash
# 1. Copy the template
cp openclaw.json.example openclaw.json

# 2. Edit openclaw.json — fill in the real key

# 3. Create .env
cat > .env <<'EOF'
SUIROBO_DEV_WALLET=suiprivkey1q...
SUIROBO_DEV_ADDRESS=0x...
DEEPSEEK_API_KEY=sk-...
EOF
```

### 5. Multi-user production (Walrus deploy)

When a new user opens `https://autobots.wal.app`:

| Item | How the user enters it | Stored in |
|------|------------------------|-----------|
| Sui wallet | Connect Wallet button | inside the dApp-Kit wallet (Slush, Sui Wallet, etc.) |
| Auto Bot private key (desktop only) | the desktop app, locally | the user's own machine — never the web |

→ **No user secret is ever sent to an Autobots server.** Everything runs on the user's machine. The web app is wallet-signed only and asks for no key.

---

## Security operations

### Before committing code

```bash
# Quick scan
grep -rn "sk-[a-zA-Z0-9]\{20,\}\|suiprivkey1[a-z0-9]\{50,\}" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.cjs" \
  --include="*.json" . | grep -v node_modules | grep -v dist
```

If the result is non-empty → DO NOT commit.

### Before deploying to Walrus

```bash
# Build first
npm run build

# Verify the bundle is clean
grep -c "sk-\|suiprivkey1" dist/assets/*.js
# Result 0 = safe to deploy

# Verify no .env / openclaw.json got bundled
ls dist/ | grep -E "\.env|openclaw"
# Empty result = safe
```

---

## Rotating keys (when in doubt)

### Rotate the LLM API key

1. Open your provider's API-key dashboard.
2. Create a new key.
3. Update `openclaw.json` → `apiKey`.
4. Update `.env` → `DEEPSEEK_API_KEY`.
5. Restart the agent (`npm run agent`).
6. Revoke the old key on the provider dashboard.

### Rotate the dev wallet (if you are sure it leaked)

⚠️ Transfer assets first!

```bash
# 1. Create a new wallet
sui client new-address ed25519

# 2. Transfer assets from the old wallet → the new one (via wallet or CLI)

# 3. Export the new private key
sui keytool export <new-address>

# 4. Update .env with the new key
```

---

## Reporting a vulnerability

If you find a vulnerability, **do not open a public issue**. Email directly: security@autobots.app
