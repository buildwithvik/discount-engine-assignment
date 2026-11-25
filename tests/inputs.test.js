import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { cartFromTextItems } from '../src/inputs/pdfCartParser.js'
import { interpretLlmDraft } from '../src/inputs/nlRuleParser.js'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csvParser.js'
import { processCart, summariseCart } from '../src/engine/discountEngine.js'

async function itemsFrom(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  const out = []
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent()
    c.items.forEach((it) => out.push({ str: it.str, x: it.transform[4], y: it.transform[5], page: p }))
  }
  return out
}

const rules = parseRulesCSV(readFileSync('sample-data/rules.csv', 'utf8')).data
const csvCart = parseCartCSV(readFileSync('sample-data/cart.csv', 'utf8')).data

describe('PDF cart upload', () => {
  it('sample PDF gives exactly the same cart as cart.csv', async () => {
    const { data, errors } = cartFromTextItems(await itemsFrom('sample-data/cart.pdf'))
    expect(errors).toEqual([])
    expect(data).toEqual(csvCart)
  })

  it('broken rows are skipped with a reason; good rows still load', async () => {
    const { data, errors } = cartFromTextItems(await itemsFrom('sample-data/cart-with-errors.pdf'))
    expect(data.map((d) => d.product)).toEqual(['Cushion Cover', 'Cutting Board'])
    expect(errors).toHaveLength(3)
    expect(errors[0]).toMatch(/Bed Sheet Set.*price/)
    expect(errors[1]).toMatch(/Wall Shelf.*Rs.abc/)
    expect(errors[2]).toMatch(/missing product/)
  })

  it('smaller cart: below Rs.4,000, so no cart offer', async () => {
    const { data } = cartFromTextItems(await itemsFrom('sample-data/cart-small.pdf'))
    const s = summariseCart(processCart(data, rules), rules)
    expect(s.subtotal).toBe(1104 + 2499)
    expect(s.cartOffer).toBeNull()
    expect(s.nearMiss.amountNeeded).toBe(397)
  })

  it('no header → clear error, not a crash', () => {
    const r = cartFromTextItems([{ str: 'hello world', x: 10, y: 10, page: 1 }])
    expect(r.data).toEqual([])
    expect(r.errors[0]).toMatch(/table header/)
  })
})

describe('plain-English rule (LLM output checking)', () => {
  const ctx = { rules, cartItems: csvCart }

  it('example 1: 20% off Natura Casa, stackable', () => {
    const r = interpretLlmDraft({ status: 'ok', scope: 'brand', applies_to: 'natura casa', type: 'percentage', value: 20, stackable: true }, ctx)
    expect(r.kind).toBe('ok')
    expect(r.rule).toMatchObject({ ruleId: 'RULE-05', scope: 'brand', appliesTo: 'Natura Casa', value: 20, stackable: true })
    // engine re-runs with the new rule: ITEM-01 now 1104 → 15% wins, then 20% stacked
    const res = processCart(csvCart, [...rules, r.rule])
    expect(res[0].finalPrice).toBe(1104 - Math.round(1104 * 0.2))
  })

  it('example 3: cart rule needs min value', () => {
    const r = interpretLlmDraft({ status: 'ok', scope: 'cart', type: 'percentage', value: 10, min_cart_value: 5000 }, ctx)
    expect(r.kind).toBe('ok')
    expect(r.rule).toMatchObject({ scope: 'cart', minCartValue: 5000, stackable: false })
  })

  it('ambiguous input is surfaced as unclear', () => {
    const r = interpretLlmDraft({ status: 'unclear', missing_info: 'How much off, and from what cart value?' }, ctx)
    expect(r).toEqual({ kind: 'unclear', message: 'How much off, and from what cart value?' })
  })

  it('AI says ok but leaves out the number → rejected, never guessed', () => {
    const r = interpretLlmDraft({ status: 'ok', scope: 'cart', type: 'percentage' }, ctx)
    expect(r.kind).toBe('invalid')
  })

  it('AI returns garbage → rejected', () => {
    expect(interpretLlmDraft(null, ctx).kind).toBe('invalid')
    expect(interpretLlmDraft({ status: 'ok', scope: 'brand', applies_to: 'X', type: 'percentage', value: 250 }, ctx).kind).toBe('invalid')
  })

  it('unknown brand gives a warning, duplicate gives a warning', () => {
    const a = interpretLlmDraft({ status: 'ok', scope: 'brand', applies_to: 'Natura Casaa', type: 'flat', value: 50 }, ctx)
    expect(a.warnings[0]).toMatch(/No item in the current cart/)
    const b = interpretLlmDraft({ status: 'ok', scope: 'platform', applies_to: 'Amazon India', type: 'percentage', value: 15, stackable: false }, ctx)
    expect(b.warnings.join()).toMatch(/RULE-01/)
  })
})

import { vi, afterEach } from 'vitest'
import { parseRuleWithLLM } from '../api/_lib/parseRuleWithLLM.js'

describe('server: Gemini call', () => {
  afterEach(() => vi.unstubAllGlobals())
  const gemini = (obj, status = 200) =>
    vi.fn(async () => ({
      ok: status === 200,
      status,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
      text: async () => 'err',
    }))

  it('sends the key in a header (not the URL) and returns the parsed draft', async () => {
    const f = gemini({ status: 'ok', scope: 'platform', applies_to: 'Flipkart', type: 'flat', value: 100, stackable: false })
    vi.stubGlobal('fetch', f)
    const r = await parseRuleWithLLM({ text: 'Rs.100 flat discount on all Flipkart items' }, 'KEY')
    expect(r).toMatchObject({ ok: true, draft: { scope: 'platform', value: 100 } })
    const [url, opts] = f.mock.calls[0]
    expect(url).not.toMatch(/KEY/)
    expect(opts.headers['x-goog-api-key']).toBe('KEY')
    expect(JSON.parse(opts.body).generationConfig.responseMimeType).toBe('application/json')
  })

  it('missing key, empty text, API error and junk output all give friendly errors', async () => {
    expect((await parseRuleWithLLM({ text: 'x' }, '')).ok).toBe(false)
    expect((await parseRuleWithLLM({ text: '  ' }, 'KEY')).httpStatus).toBe(400)
    vi.stubGlobal('fetch', gemini({}, 500))
    expect((await parseRuleWithLLM({ text: 'x' }, 'KEY')).httpStatus).toBe(502)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }) })))
    expect((await parseRuleWithLLM({ text: 'x' }, 'KEY')).ok).toBe(false)
  })
  it('if a model is retired (404) it tries the next one', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      n += 1
      if (n === 1) return { ok: false, status: 404, text: async () => 'gone' }
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"status":"unclear","missing_info":"How much?"}' }] } }] }) }
    }))
    const r = await parseRuleWithLLM({ text: 'Give a discount for big orders' }, 'KEY')
    expect(r).toMatchObject({ ok: true, draft: { status: 'unclear' } })
    expect(n).toBe(2)
  })
})
