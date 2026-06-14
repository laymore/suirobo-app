import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'stream', 'path', 'os', 'module', 'constants', 'util', 'child_process'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: [
      { find: 'node:fs/promises', replacement: path.resolve(__dirname, 'src/empty.ts') },
      { find: 'node:fs', replacement: path.resolve(__dirname, 'src/empty.ts') },
      { find: 'fs/promises', replacement: path.resolve(__dirname, 'src/empty.ts') },
      { find: 'fs', replacement: path.resolve(__dirname, 'src/empty.ts') },
      { find: 'node:process', replacement: path.resolve(__dirname, 'src/empty.ts') },
      { find: 'child_process', replacement: path.resolve(__dirname, 'src/empty.ts') },
      { find: 'node:stream/web', replacement: path.resolve(__dirname, 'src/empty.ts') },
      { find: 'stream/web', replacement: path.resolve(__dirname, 'src/empty.ts') },
    ]
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: {
      clientPort: 5173,
    },
  },
  define: {
    'process.env.ADK_MODEL_OVERRIDE': JSON.stringify(''),
    'process.env.DEEPSEEK_API_KEY': JSON.stringify(process.env.DEEPSEEK_API_KEY || ''),
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Hàm manualChunks linh hoạt — Vite có thể không resolve được package root khi dùng array
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@mysten/sui') || id.includes('@mysten/dapp-kit')
              || id.includes('@mysten/deepbook-v3') || id.includes('@mysten/bcs')
              || id.includes('@mysten-incubation')) return 'vendor-sui';
          if (id.includes('@google/adk') || id.includes('@google/genai')) return 'vendor-google';
          if (id.includes('@tanstack') || id.includes('zod') || id.includes('technicalindicators')) return 'vendor-utils';
          if (id.includes('reactflow')) return 'vendor-reactflow';
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
    esbuildOptions: {
      target: 'esnext',
      define: {
        global: 'globalThis'
      },
      plugins: [
        {
          name: 'stream-web-mock',
          setup(build) {
            build.onResolve({ filter: /^node:stream\/web$/ }, args => ({
              path: path.resolve(__dirname, 'src/empty.ts')
            }));
            build.onResolve({ filter: /^stream\/web$/ }, args => ({
              path: path.resolve(__dirname, 'src/empty.ts')
            }));
          }
        }
      ]
    }
  },
})
