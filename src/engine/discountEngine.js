/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects.
 * All functions take plain objects and return plain objects.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:    string       — e.g. "RULE-01"
 *   scope:     "brand" | "platform" | "cart"   (see ruleSchema.js)
 *   appliesTo: string       — e.g. "Natura Casa", "Amazon India"
 *   type:      "percentage" | "flat"
 *   value:     number       — percentage as integer (15 = 15%), flat in rupees
 *   stackable: boolean
 *   minCartValue: number | null — cart rules only
 * }
 *
 * CartItem {
 *   itemId:    string       — e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number       — in rupees
 * }
 *
 * DiscountResult {
 *   itemId:        string
 *   product:       string
 *   brand:         string
 *   platform:      string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   reasoning:     string   — customer-readable explanation
 *   status:        "Max discount" | "Stacked" | "Discount applied" | "No offer"
 * }
 *
 * CartSummary {
 *   subtotal:    number            — sum of item final prices
 *   cartOffer:   null | { ruleId, label, saving, rule }
 *   finalTotal:  number
 *   nearMiss:    null | { ruleId, amountNeeded, label }  — closest cart offer not yet reached
 * }
 *
 * Item-level and cart-level logic are separate steps:
 *   processCart()      → per-item results (cart rules are ignored here)
 *   summariseCart()    → applies the best qualifying cart rule to the item total
 * Input paths (CSV, PDF, plain-English) never touch this file.
 */

/**
 * Returns true if the rule applies to this cart item.
 * Cart-scope rules never match a single item — they are handled by summariseCart().
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => String(s ?? '').trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 * Never returns more than the price itself (a Rs.150 flat offer on a Rs.100 item saves Rs.100, not Rs.150).
 */
export function calculateDiscountAmount(price, rule) {
  let amount = 0
  if (rule.type === 'percentage') amount = Math.round((price * rule.value) / 100)
  else if (rule.type === 'flat') amount = rule.value
  return Math.max(0, Math.min(amount, price))
}

const rs = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`

/** Who is giving the offer, in words a customer understands. */
function offerName(rule) {
  if (rule.scope === 'brand') return `${rule.appliesTo} brand offer`
  if (rule.scope === 'platform') return `${rule.appliesTo} offer`
  return 'Cart offer'
}

function offerAmount(rule) {
  return rule.type === 'percentage' ? `${rule.value}% off` : `${rs(rule.value)} off`
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 *
 * Logic:
 *   1. Find all rules that match this item.
 *   2. Among non-stackable rules, pick the one giving the largest rupee saving.
 *      Ties keep the rule that appears first in the rules list (predictable).
 *   3. Apply any stackable rules on top of that price, one after another.
 *   4. Build the customer-facing reasoning from what was applied and what lost.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  if (matchingRules.length === 0) {
    return {
      itemId: item.itemId,
      product: item.product,
      brand: item.brand,
      platform: item.platform,
      basePrice: item.basePrice,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      reasoning: `No offers available — there is no current offer for ${item.brand} on ${item.platform}`,
      status: 'No offer',
    }
  }

  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  let winner = null
  let skipped = []
  if (nonStackable.length > 0) {
    // Stable sort: equal savings keep their original order.
    const sorted = [...nonStackable].sort(
      (a, b) =>
        calculateDiscountAmount(item.basePrice, b) - calculateDiscountAmount(item.basePrice, a)
    )
    winner = sorted[0]
    skipped = sorted.slice(1)
  }

  let price = item.basePrice
  const appliedRules = []
  const parts = []

  if (winner) {
    const saving = calculateDiscountAmount(price, winner)
    price -= saving
    appliedRules.push(winner.ruleId)
    let text = `${offerName(winner)}: ${offerAmount(winner)} (you save ${rs(saving)})`
    if (skipped.length > 0) {
      const best = skipped[0]
      const bestSaving = calculateDiscountAmount(item.basePrice, best)
      text += bestSaving === saving
        ? ` — same saving as the ${offerName(best)}, only one can apply`
        : ` — better than the ${offerName(best)} (${rs(bestSaving)})`
    }
    parts.push(text)
  }

  for (const rule of stackable) {
    const saving = calculateDiscountAmount(price, rule)
    price -= saving
    appliedRules.push(rule.ruleId)
    parts.push(
      winner
        ? `extra ${offerName(rule)}: ${offerAmount(rule)} on top (you save ${rs(saving)} more)`
        : `${offerName(rule)}: ${offerAmount(rule)} (you save ${rs(saving)})`
    )
  }

  const finalPrice = Math.round(price)

  let status = 'Discount applied'
  if (winner && stackable.length > 0) status = 'Stacked'
  else if (skipped.length > 0) status = 'Max discount'

  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules,
    skippedRules: skipped.map((r) => r.ruleId),
    reasoning: parts.join(' + '),
    status,
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Cart-level step. Runs AFTER item-level discounts.
 *
 *   1. subtotal = sum of item final prices
 *   2. a cart rule qualifies when subtotal ≥ its minCartValue (equal counts)
 *   3. if several qualify, the one giving the biggest saving wins (same principle as items)
 *   4. if none qualify, cartOffer is null (no row shown) and nearMiss says how close the
 *      customer is to the nearest one
 */
export function summariseCart(results, rules) {
  const subtotal = cartTotal(results)
  const cartRules = rules.filter((r) => r.scope === 'cart')

  const qualifying = cartRules
    .filter((r) => subtotal >= r.minCartValue)
    .map((r) => ({ rule: r, saving: calculateDiscountAmount(subtotal, r) }))
    .sort((a, b) => b.saving - a.saving)

  let cartOffer = null
  if (qualifying.length > 0 && qualifying[0].saving > 0) {
    const { rule, saving } = qualifying[0]
    cartOffer = {
      ruleId: rule.ruleId,
      rule,
      saving,
      label: `Cart offer: ${offerAmount(rule)} — ${rs(saving)} saved (cart total ${rs(subtotal)} is at least ${rs(rule.minCartValue)})`,
    }
  }

  let nearMiss = null
  if (!cartOffer) {
    const closest = cartRules
      .filter((r) => subtotal < r.minCartValue)
      .sort((a, b) => a.minCartValue - b.minCartValue)[0]
    if (closest && results.length > 0) {
      const amountNeeded = closest.minCartValue - subtotal
      nearMiss = {
        ruleId: closest.ruleId,
        amountNeeded,
        label: `Add ${rs(amountNeeded)} more to get ${offerAmount(closest)} your whole cart`,
      }
    }
  }

  return {
    subtotal,
    cartOffer,
    finalTotal: subtotal - (cartOffer ? cartOffer.saving : 0),
    nearMiss,
  }
}
