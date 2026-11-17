import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { previewBridgePlugin } from './dev/preview-bridge.mjs'
import { distributionNotices } from './scripts/distribution-notices.mjs'

export default defineConfig({
  plugins: [vue(), previewBridgePlugin(), distributionNotices()],
  base: './',
  resolve: { dedupe: ['vue'] },
  server: {
    host: '127.0.0.1', port: 5174, strictPort: true, cors: false,
    watch: {ignored: ['**/android/app/build/**', '**/android/build/**', '**/android/.gradle/**', '**/android/app/src/main/assets/**', '**/release/**']},
  },
  build: { target: 'es2022' },
})
