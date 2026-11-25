/**
 * ruleSchema.js
 *
 * ONE place that decides whether a discount rule is valid.
 * Every input path (CSV upload, plain-English/LLM input, any future input)
 * builds a "raw" rule object and passes it through validateRule().
 * The engine only ever sees rules that passed this check.
 *
 * DiscountRule {
 *   ruleId:       string                         e.g. "RULE-01"
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string                         brand/platform name ("" for cart rules)
 *   type:         "percentage" | "flat"
 *   value:        number                         15 = 15%, or rupees for flat
 *   stackable:    boolean                        (cart rules: always false)
 *   minCartValue: number | null                  only for cart rules
 * }
 */

export const SCOPES = ['brand', 'platform', 'cart']
export const TYPES = ['percentage', 'flat']

function toBool(v) {
  if (typeof v === 'boolean') return v
  if (v === undefined || v === null || v === '') return false
  const s = String(v).trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y'
}

function toNumber(v) {
  if (typeof v === 'number') return v
  if (v === undefined || v === null) return NaN
  const cleaned = String(v).replace(/rs\.?|₹|inr|,|%/gi, '').trim()
  if (cleaned === '') return NaN
  return Number(cleaned)
}

/**
 * Checks a raw rule and returns { rule, errors }.
 * rule is null when there is at least one error.
 */
export function validateRule(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object') {
    return { rule: null, errors: ['Rule is empty or not an object'] }
  }

  const ruleId = String(raw.ruleId ?? '').trim()
  if (!ruleId) errors.push('Missing rule ID')

  const scope = String(raw.scope ?? '').trim().toLowerCase()
  if (!SCOPES.includes(scope)) {
    errors.push(`Scope must be brand, platform or cart (got "${raw.scope ?? ''}")`)
  }

  const type = String(raw.type ?? '').trim().toLowerCase()
  if (!TYPES.includes(type)) {
    errors.push(`Type must be percentage or flat (got "${raw.type ?? ''}")`)
  }

  const value = toNumber(raw.value)
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`Discount value must be a number above 0 (got "${raw.value ?? ''}")`)
  } else if (type === 'percentage' && value >= 100) {
    errors.push(`A percentage discount must be below 100% (got ${value}%)`)
  }

  const appliesTo = String(raw.appliesTo ?? '').trim()
  if ((scope === 'brand' || scope === 'platform') && !appliesTo) {
    errors.push(`A ${scope} rule needs the ${scope} name it applies to`)
  }

  let minCartValue = null
  if (scope === 'cart') {
    const min = toNumber(raw.minCartValue)
    if (!Number.isFinite(min) || min <= 0) {
      errors.push(`A cart rule needs a minimum cart value above 0 (got "${raw.minCartValue ?? ''}")`)
    } else {
      minCartValue = min
    }
  }

  if (errors.length > 0) return { rule: null, errors }

  return {
    rule: {
      ruleId,
      scope,
      appliesTo: scope === 'cart' ? '' : appliesTo,
      type,
      value,
      // Cart offers are evaluated once on the whole cart, so stacking has no meaning there.
      stackable: scope === 'cart' ? false : toBool(raw.stackable),
      minCartValue,
    },
    errors: [],
  }
}

/** Next free ID like RULE-05, based on the rules already loaded. */
export function nextRuleId(rules) {
  const nums = rules
    .map((r) => parseInt(String(r.ruleId).replace(/\D/g, ''), 10))
    .filter((n) => Number.isFinite(n))
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `RULE-${String(next).padStart(2, '0')}`
}

/** Short human label for a rule, used in tables and the confirm step. */
export function describeRule(rule) {
  const amount = rule.type === 'percentage' ? `${rule.value}% off` : `Rs.${rule.value.toLocaleString('en-IN')} off`
  if (rule.scope === 'cart') {
    return `${amount} the whole cart when cart total ≥ Rs.${rule.minCartValue.toLocaleString('en-IN')}`
  }
  return `${amount} on ${rule.appliesTo} (${rule.scope})${rule.stackable ? ', stackable' : ''}`
}
