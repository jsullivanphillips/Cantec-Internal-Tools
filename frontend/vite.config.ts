import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.png',
        'cantec-logo-horizontal.png',
        'pwa-192.png',
        'pwa-512.png',
      ],
      manifest: {
        name: 'Cantec Technician Portal',
        short_name: 'Tech Portal',
        description: 'Field testing worksheet for monthly routes',
        start_url: '/tech/start',
        scope: '/tech',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0d6efd',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
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
      '/deficiency_tracker/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/processing_attack/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/scheduling_attack/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/webhooks/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/pink_folder/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/limbo_job_tracker/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/technician_meeting/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/performance_summary/': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/assets': { target: 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
})
