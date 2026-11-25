/**
 * Vercel serverless function: POST /api/parse-rule
 * Body: { text, knownBrands, knownPlatforms }
 * Keeps the Gemini API key on the server (set GEMINI_API_KEY in Vercel project settings).
 */
import { parseRuleWithLLM } from './_lib/parseRuleWithLLM.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' })
    return
  }
  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {}
  const result = await parseRuleWithLLM(body, process.env.GEMINI_API_KEY)
  if (!result.ok) {
    res.status(result.httpStatus).json({ error: result.error })
    return
  }
  res.status(200).json({ draft: result.draft })
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return {} }
}
