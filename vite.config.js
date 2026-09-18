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
      '/api': {
        target: 'https://harvestfamily-api.harvestfamily.workers.dev',
        changeOrigin: true,
      },
      '/ws': {
        target: 'wss://harvestfamily-api.harvestfamily.workers.dev',
        ws: true,
      },
    },
  },
})
