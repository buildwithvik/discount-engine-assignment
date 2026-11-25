import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csvParser.js'
import { processCart, summariseCart, applyDiscounts } from '../src/engine/discountEngine.js'
import { validateRule } from '../src/engine/ruleSchema.js'

const rules = parseRulesCSV(readFileSync('sample-data/rules.csv', 'utf8'))
const cart = parseCartCSV(readFileSync('sample-data/cart.csv', 'utf8'))

describe('sample data matches the assignment expected results', () => {
  it('loads all 4 rules including the cart rule, with no errors', () => {
    expect(rules.errors).toEqual([])
    expect(rules.data.map((r) => r.ruleId)).toEqual(['RULE-01', 'RULE-02', 'RULE-03', 'RULE-04'])
    expect(rules.data[3]).toMatchObject({ scope: 'cart', minCartValue: 4000, value: 10 })
  })

  it('item final prices', () => {
    const res = processCart(cart.data, rules.data)
    expect(res.map((r) => r.finalPrice)).toEqual([1104, 629, 509, 2499, 382, 809])
    expect(res.map((r) => r.status)).toEqual([
      'Max discount', 'Stacked', 'Discount applied', 'No offer', 'Discount applied', 'Discount applied',
    ])
    expect(res[0].appliedRules).toEqual(['RULE-01'])
    expect(res[0].skippedRules).toEqual(['RULE-02'])
    expect(res[1].appliedRules).toEqual(['RULE-02', 'RULE-03'])
    expect(res[3].reasoning).toMatch(/No offers available/)
  })

  it('cart offer: 5932 → -593 → 5339', () => {
    const s = summariseCart(processCart(cart.data, rules.data), rules.data)
    expect(s.subtotal).toBe(5932)
    expect(s.cartOffer.saving).toBe(593)
    expect(s.finalTotal).toBe(5339)
    expect(s.nearMiss).toBeNull()
  })
})

describe('edge cases', () => {
  const cartRule = { ruleId: 'C', scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 4000 }
  const fake = (total) => [{ finalPrice: total }]

  it('just below threshold: no cart offer row, shows how much more is needed', () => {
    const s = summariseCart(fake(3999), [cartRule])
    expect(s.cartOffer).toBeNull()
    expect(s.finalTotal).toBe(3999)
    expect(s.nearMiss.amountNeeded).toBe(1)
  })

  it('exactly at threshold counts (≥)', () => {
    expect(summariseCart(fake(4000), [cartRule]).cartOffer.saving).toBe(400)
  })

  it('two qualifying cart rules: bigger saving wins', () => {
    const flat = { ...cartRule, ruleId: 'D', type: 'flat', value: 500 }
    expect(summariseCart(fake(4000), [cartRule, flat]).cartOffer.ruleId).toBe('D')
  })

  it('flat discount bigger than price never goes below zero', () => {
    const r = applyDiscounts(
      { itemId: 'X', product: 'p', brand: 'B', platform: 'P', basePrice: 100 },
      [{ ruleId: 'F', scope: 'brand', appliesTo: 'B', type: 'flat', value: 150, stackable: false }]
    )
    expect(r.finalPrice).toBe(0)
  })

  it('rejects broken rules instead of crashing', () => {
    expect(validateRule({ ruleId: 'X', scope: 'cart', type: 'percentage', value: 10 }).rule).toBeNull()
    expect(validateRule({ ruleId: 'X', scope: 'brand', type: 'percentage', value: 150, appliesTo: 'A' }).rule).toBeNull()
    expect(validateRule({ ruleId: 'X', scope: 'galaxy', type: 'flat', value: 10, appliesTo: 'A' }).rule).toBeNull()
    expect(validateRule(null).rule).toBeNull()
  })
})
