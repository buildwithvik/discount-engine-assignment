/**
 * parseRuleWithLLM.js  (server-side only — never shipped to the browser)
 *
 * Turns one plain-English sentence into a structured rule draft using Google Gemini.
 * We force Gemini to answer as JSON that follows a fixed schema (responseSchema),
 * so we never have to scrape JSON out of free text.
 *
 * IMPORTANT: the output here is still UNTRUSTED. The browser runs it through
 * validateRule() before anything reaches the engine.
 */

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const MAX_INPUT_CHARS = 300

// Gemini structured-output schema (OpenAPI subset).
const RULE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    status: {
      type: 'STRING',
      enum: ['ok', 'unclear'],
      description: '"unclear" if the discount amount is missing, or what it applies to is missing, or a cart rule has no minimum cart value.',
    },
    missing_info: {
      type: 'STRING',
      description: 'When unclear: a short, friendly question asking the user for exactly what is missing. Empty when ok.',
    },
    scope: { type: 'STRING', enum: ['brand', 'platform', 'cart'], nullable: true },
    applies_to: { type: 'STRING', description: 'Brand or platform name. Empty string for cart rules.', nullable: true },
    type: { type: 'STRING', enum: ['percentage', 'flat'], nullable: true },
    value: { type: 'NUMBER', description: 'Percent as a number (20 for 20%) or rupees for flat.', nullable: true },
    stackable: { type: 'BOOLEAN', nullable: true },
    min_cart_value: { type: 'NUMBER', description: 'Cart rules only: minimum cart total in rupees.', nullable: true },
  },
  required: ['status'],
}

function systemPrompt(knownBrands, knownPlatforms) {
  return `You convert one sentence describing an eCommerce discount into a structured rule.

Rules:
- scope "brand" = discount on a brand's products. scope "platform" = discount on a marketplace (Amazon India, Flipkart, Noon...). scope "cart" = discount on the whole cart when the cart total reaches a minimum.
- type "percentage" for "% off", type "flat" for a rupee amount ("Rs.100 off", "₹100 off", "100 rupees off").
- stackable is true ONLY if the sentence clearly says it stacks/combines with other offers. Otherwise false.
- "more than Rs.5,000" or "above Rs.5,000" or "over 5k" -> min_cart_value 5000.
- If the sentence names a brand or platform that closely matches one of these known names, use the known spelling exactly.
  Known brands: ${knownBrands.join(', ') || '(none)'}
  Known platforms: ${knownPlatforms.join(', ') || '(none)'}
- NEVER guess a missing number. If the discount amount is missing, or it is not clear what it applies to, or a cart rule has no minimum value, return status "unclear" with a short question in missing_info.
- If the sentence is not about a discount at all, return status "unclear".`
}

/**
 * Returns { ok: true, draft } or { ok: false, error, httpStatus }.
 */
export async function parseRuleWithLLM({ text, knownBrands = [], knownPlatforms = [] }, apiKey) {
  if (!apiKey) {
    return { ok: false, httpStatus: 500, error: 'The AI service is not set up (missing GEMINI_API_KEY on the server).' }
  }
  const sentence = String(text ?? '').trim()
  if (!sentence) return { ok: false, httpStatus: 400, error: 'Please type a rule first.' }
  if (sentence.length > MAX_INPUT_CHARS) {
    return { ok: false, httpStatus: 400, error: `Please keep the rule under ${MAX_INPUT_CHARS} characters.` }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`
    const resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt(knownBrands.slice(0, 50), knownPlatforms.slice(0, 50)) }],
        },
        contents: [{ role: 'user', parts: [{ text: sentence }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 400,
          responseMimeType: 'application/json',
          responseSchema: RULE_SCHEMA,
          // Flash models can skip 'thinking' for a simple extraction task (faster, cheaper).
          ...(MODEL().includes('flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    })

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      console.error('Gemini API error', resp.status, detail.slice(0, 300))
      return { ok: false, httpStatus: 502, error: 'The AI service did not respond properly. Please try again.' }
    }

    const data = await resp.json()
    const textOut = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
    let draft = null
    try {
      draft = JSON.parse(textOut)
    } catch {
      draft = null
    }
    if (!draft || typeof draft !== 'object') {
      return { ok: false, httpStatus: 502, error: 'The AI did not return a rule. Please rephrase and try again.' }
    }
    return { ok: true, draft }
  } catch (err) {
    const timedOut = err?.name === 'AbortError'
    return {
      ok: false,
      httpStatus: timedOut ? 504 : 502,
      error: timedOut ? 'The AI took too long to answer. Please try again.' : 'Could not reach the AI service.',
    }
  } finally {
    clearTimeout(timer)
  }
}
