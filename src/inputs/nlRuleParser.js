/**
 * nlRuleParser.js
 *
 * Input path #3: a plain-English sentence → DiscountRule draft.
 *
 *   sentence ──► /api/parse-rule (LLM) ──► interpretLlmDraft() ──► validateRule() ──► confirm step
 *
 * The engine is never called from here. The app only adds the rule to the active
 * list AFTER the user presses Confirm.
 */

import { validateRule, nextRuleId } from '../engine/ruleSchema.js'

/**
 * Calls the server and returns one of:
 *   { kind: 'ok',      rule, warnings }   → show confirm step
 *   { kind: 'unclear', message }          → ask the user to be more specific
 *   { kind: 'invalid', errors }           → AI returned something we can't use
 *   { kind: 'error',   message }          → network / server problem
 */
export async function parseRuleFromText(text, { rules, cartItems }) {
  const sentence = String(text ?? '').trim()
  if (!sentence) return { kind: 'unclear', message: 'Please type a rule first, e.g. "20% off Natura Casa, stackable".' }

  const knownBrands = unique(cartItems.map((i) => i.brand).concat(rules.filter((r) => r.scope === 'brand').map((r) => r.appliesTo)))
  const knownPlatforms = unique(cartItems.map((i) => i.platform).concat(rules.filter((r) => r.scope === 'platform').map((r) => r.appliesTo)))

  let resp
  try {
    resp = await fetch('/api/parse-rule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: sentence, knownBrands, knownPlatforms }),
    })
  } catch {
    return { kind: 'error', message: 'Could not reach the server. Check your connection and try again.' }
  }

  let body = null
  try { body = await resp.json() } catch { /* handled below */ }

  if (!resp.ok || !body) {
    return { kind: 'error', message: body?.error || `Server error (${resp.status}). Please try again.` }
  }

  return interpretLlmDraft(body.draft, { rules, cartItems })
}

/**
 * Pure function (no network) so it can be unit-tested.
 * Takes whatever the LLM returned and decides if it is a usable rule.
 */
export function interpretLlmDraft(draft, { rules, cartItems }) {
  if (!draft || typeof draft !== 'object') {
    return { kind: 'invalid', errors: ['The AI returned an empty answer. Please rephrase.'] }
  }

  if (draft.status === 'unclear') {
    return {
      kind: 'unclear',
      message: draft.missing_info || 'This rule is not specific enough. Please say how much off, and what it applies to.',
    }
  }

  const { rule, errors } = validateRule({
    ruleId: nextRuleId(rules),
    scope: draft.scope,
    appliesTo: draft.applies_to,
    type: draft.type,
    value: draft.value,
    stackable: draft.stackable,
    minCartValue: draft.min_cart_value,
  })

  if (!rule) return { kind: 'invalid', errors }

  // Match the name to how it is spelled in the cart ("natura casa" → "Natura Casa").
  const warnings = []
  if (rule.scope === 'brand' || rule.scope === 'platform') {
    const names = unique(cartItems.map((i) => (rule.scope === 'brand' ? i.brand : i.platform)))
    const exact = names.find((n) => n.toLowerCase() === rule.appliesTo.toLowerCase())
    if (exact) {
      rule.appliesTo = exact
    } else {
      warnings.push(
        `No item in the current cart is from the ${rule.scope} "${rule.appliesTo}". The rule will be added, but it won't change any price right now. Check the spelling if that's not what you expected.`
      )
    }
  }

  const duplicate = rules.find(
    (r) =>
      r.scope === rule.scope &&
      r.appliesTo.toLowerCase() === rule.appliesTo.toLowerCase() &&
      r.type === rule.type &&
      r.value === rule.value &&
      r.stackable === rule.stackable &&
      (r.minCartValue ?? null) === (rule.minCartValue ?? null)
  )
  if (duplicate) warnings.push(`This looks the same as ${duplicate.ruleId}, which is already active.`)

  return { kind: 'ok', rule, warnings }
}

function unique(list) {
  return [...new Set(list.filter(Boolean))]
}
