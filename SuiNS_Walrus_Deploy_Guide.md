# Deploying the app to Walrus & linking SuiNS

To build, deploy a new version of the **Autobots app** to **Walrus Sites**, and link it to the **SuiNS** domain (`autobots.sui`), follow this process.

## Step 1: Build the source

Make sure everything is saved, then build the React app into `dist`:

```bash
npm run build
```

*(If `&&` errors out, run `npx tsc -b` then `npx vite build` separately.)*

## Step 2: Publish the build to Walrus

Use Sui's `site-builder` tool to push the `dist` folder to Walrus (decentralized storage). Give it a storage duration (e.g. 50 epochs).

```bash
site-builder publish dist --epochs 50
```

> [!NOTE]
> Wait ~1–2 minutes. This creates a new object on Sui and stores all files (JS, CSS, HTML, JSON) on Walrus.

**A successful result looks like:**
```
Created new site!
New site object ID: 0xf793b13bcb434d1b2cb2381956b54cec6b1a28dbca040ee83b63953f54c8e2f1
```
👉 Copy this **New site object ID**.

> To update the EXISTING site (keep the same object ID + the SuiNS link), use `site-builder update dist <site-object-id> --epochs N` instead of `publish` — the current site object is `0xf070fa29afac7f54de6f849d6e4391b181ba511205e1e4474cf58bfa39537a81`.

## Step 3: Put the Site ID into the link script

Open `link-suins-walrus.ts` in the project root. Find the `WALRUS_SITE_ID` constant near the top and replace it with the **Site Object ID** from Step 2.

```typescript
const WALRUS_SITE_ID = '0xf793b13...'; // <-- replace with the new ID
```

## Step 4: Link the SuiNS domain to the new Site ID

Run the script with tsx to call the smart contract and repoint `autobots.sui` to the website:

```bash
npx tsx link-suins-walrus.ts
```

> [!SUCCESS]
> When you see `LINK SUCCESSFUL!`, the transaction is confirmed on mainnet.
> You can visit **https://autobots.wal.app** right away (the portal DNS cache may take 1–2 minutes to update).
