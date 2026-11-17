import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import {fileURLToPath} from 'node:url'
export default defineConfig({
  plugins: [vue()], base: './',
  root:fileURLToPath(new URL('.',import.meta.url)),
  resolve:{dedupe:['vue']},
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/.runtime/**', '**/artifacts/**', '**/release/**'] },
  },
})
