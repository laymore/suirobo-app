import { Buffer } from 'buffer'
globalThis.Buffer = globalThis.Buffer || Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit'
import '@mysten/dapp-kit/dist/index.css'

import './index.css'
import App from './App.tsx'

// Build fingerprint — value injected at build time (empty in clean checkouts).
const __fp = import.meta.env.VITE_FP as string | undefined
if (__fp) { try { console.log('%cSuirobo', 'color:#4da2ff;font-weight:700', __fp) } catch { /* noop */ } }

const queryClient = new QueryClient()

const { networkConfig } = createNetworkConfig({
  // @ts-ignore
  mainnet: { url: 'https://fullnode.mainnet.sui.io' },
  // @ts-ignore
  testnet: { url: 'https://fullnode.testnet.sui.io' },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
        <WalletProvider autoConnect={true}>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
)
