import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4777',
      '/ws': { target: 'ws://localhost:4777', ws: true },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared'),
    },
  },
  build: {
    outDir: 'dist',
  },
})
