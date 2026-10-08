import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { createApiApp } from './server/api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Mounts the same API the production server uses (server/index.js) on the dev server:
// uploads, thumbnails, OCR and state, all stored under data/.
function apiPlugin(env) {
  const api = createApiApp({
    dataDir: path.resolve(__dirname, env.DATA_DIR || 'data'),
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    model: env.OPENAI_MODEL || undefined,
  })
  return {
    name: 'fin-api',
    configureServer(server) {
      server.middlewares.use(api)
    },
    configurePreviewServer(server) {
      server.middlewares.use(api)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiPlugin(env)],
    resolve: {
      alias: {
        '@ui': path.resolve(__dirname, 'src/ui'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@pages': path.resolve(__dirname, 'src/pages'),
        '@utils': path.resolve(__dirname, 'src/utils'),
        '@store': path.resolve(__dirname, 'src/store'),
      },
    },
  }
})
