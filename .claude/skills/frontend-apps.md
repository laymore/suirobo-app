---
name: frontend-apps
description: >
  Build browser dApps with dApp Kit, from wallet connection to onchain queries
  and transaction execution. Use when building Sui frontends, using React hooks,
  connecting wallets, signing transactions, querying onchain data, or working
  with non-React frameworks.
---

# Frontend Apps (Sui dApp Kit)

> **Use `@mysten/sui` (v2)** — the legacy `@mysten/dapp-kit` package is deprecated.

## Setup

```bash
npm install @mysten/sui
```

```typescript
import { createDAppKit } from "@mysten/sui/dapp-kit";

const { SuiClientProvider, WalletProvider, useSuiClient } = createDAppKit({
  networks: {
    mainnet: { url: "https://fullnode.mainnet.sui.io:443" },
    testnet: { url: "https://fullnode.testnet.sui.io:443" },
  },
  defaultNetwork: "testnet",
});
```

## React hooks

```typescript
import {
  useCurrentAccount,
  useCurrentClient,
  useSignAndExecuteTransaction,
  useConnectWallet,
  useDisconnectWallet,
} from "@mysten/sui/dapp-kit";

function MyComponent() {
  const account = useCurrentAccount();
  const client = useCurrentClient();  // SuiGrpcClient
  // ...
}
```

## Querying onchain data

```typescript
import { useQuery } from "@tanstack/react-query";

function useBalance(address: string) {
  const client = useCurrentClient();
  return useQuery({
    queryKey: ["balance", address],
    queryFn: () => client.getBalance({ owner: address }),
  });
}
```

## Signing and executing transactions

```typescript
const { mutate: signAndExecute } = useSignAndExecuteTransaction();

const handleClick = () => {
  const tx = new Transaction();
  // ... build tx

  signAndExecute(
    { transaction: tx },
    {
      onSuccess: async ({ digest }) => {
        // Wait before cache invalidation to avoid stale data
        await client.waitForTransaction({ digest });
        queryClient.invalidateQueries({ queryKey: ["balance"] });
      },
    }
  );
};
```

## Common mistakes to avoid

- **Wrong imports** — use `@mysten/sui`, not `@mysten/sui.js` or `@mysten/dapp-kit`
- **Client instantiation inside components** — create clients outside React render
- **Not awaiting `waitForTransaction`** — leads to stale cache after tx
- **Using JSON-RPC client** — use `SuiGrpcClient` instead
- **Removed hooks** — `useSuiClientQuery` is gone, use TanStack Query directly

## Non-React frameworks

```typescript
// Vue, Svelte, vanilla JS
import { SuiGrpcClient } from "@mysten/sui/client";

const client = new SuiGrpcClient({
  url: "https://fullnode.testnet.sui.io:443",
});
```

## Sources

- https://sdk.mystenlabs.com/dapp-kit
- https://docs.sui.io/guides/developer/app-examples/e2e-counter
