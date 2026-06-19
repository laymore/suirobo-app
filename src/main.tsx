/*
 * Suirobo — © 2026 Autobots Team. All rights reserved.
 * autobots.wal.app · github.com/laymore/suirobo-app
 * Authorship watermark in ./signature.ts — do not remove.
 */
import { Buffer } from 'buffer'
globalThis.Buffer = globalThis.Buffer || Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit'
import '@mysten/dapp-kit/dist/index.css'

import './index.css'
import App from './App.tsx'
import { printSignature } from './signature'

printSignature()

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
