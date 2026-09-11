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
            if (id.includes('socket.io-client')) return 'socket'
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
})
