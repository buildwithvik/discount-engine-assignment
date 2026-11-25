import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { parseRuleWithLLM } from './api/_lib/parseRuleWithLLM.js'

/**
 * Lets `npm run dev` serve /api/parse-rule locally with the same code Vercel runs,
 * so the plain-English input works on localhost too (key read from .env.local).
 */
function localApi(env) {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/parse-rule', (req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          let body = {}
          try { body = JSON.parse(raw || '{}') } catch { /* ignore */ }
          const result = await parseRuleWithLLM(body, env.GEMINI_API_KEY)
          res.setHeader('content-type', 'application/json')
          res.statusCode = result.ok ? 200 : result.httpStatus
          res.end(JSON.stringify(result.ok ? { draft: result.draft } : { error: result.error }))
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.GEMINI_MODEL) process.env.GEMINI_MODEL = env.GEMINI_MODEL
  return {
    plugins: [react(), localApi(env)],
  }
})
