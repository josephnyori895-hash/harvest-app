import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react')) return 'vendor'
            if (id.includes('leaflet')) return 'leaflet'
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // Dev preview talks to the live Cloudflare backend via same-origin proxy
    // (avoids CORS; the APK build bakes VITE_API_URL directly instead).
    proxy: {
      // E2E_API_TARGET lets QA point the same-origin proxy at a local worker
      // (e.g. http://127.0.0.1:8787 for wrangler dev) without touching prod.
      '/api': {
        target: process.env.E2E_API_TARGET || 'https://harvestfamily-api.harvestfamily.workers.dev',
        changeOrigin: true,
      },
      '/ws': {
        target: (process.env.E2E_API_TARGET || 'https://harvestfamily-api.harvestfamily.workers.dev').replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
})
