import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          charts: ['chart.js', 'react-chartjs-2', 'chartjs-plugin-datalabels'],
          bootstrap: ['react-bootstrap', 'bootstrap'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/home/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/deficiency_tracker/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/processing_attack/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/scheduling_attack/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/webhooks/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/pink_folder/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/limbo_job_tracker/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/data-analytics/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/assets': { target: 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
})
