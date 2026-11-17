/** Explicit, loopback-only development review. Never an app or account fallback. */
import path from 'node:path'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'

const root = path.resolve(import.meta.dirname, 'review')
const server = await createServer({
  root, configFile: false, plugins: [vue()], resolve: {dedupe: ['vue'], alias: {vue: path.resolve(root, '../../packages/ui/node_modules/vue/dist/vue.runtime.esm-bundler.js')}},
  server: {host: '127.0.0.1', port: 5186, strictPort: true, cors: false,
    fs: {allow: [path.resolve(root, '../..')]},
    watch: {ignored: ['**/android/android/**', '**/release/**', '**/artifacts/**']}},
})
try {
  await server.listen()
  console.log('NextGlance development review: http://127.0.0.1:5186/ — isolated example data, no Nextcloud access')
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {await server.close(); process.exit(0)})
} catch (error) {
  await server.close()
  if (error?.code === 'EADDRINUSE' || error?.message === 'Port 5186 is already in use') {
    console.error('Port 5186 is already in use. If the NextGlance review is already running, open http://127.0.0.1:5186/ — no second launch is needed.')
    process.exitCode = 1
  } else throw error
}
