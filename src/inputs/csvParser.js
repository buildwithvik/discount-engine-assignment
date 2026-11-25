/**
 * csvParser.js
 *
 * Converts raw CSV text into the typed objects the discount engine expects.
 * Uses papaparse for reliable CSV parsing, then maps column names to the
 * internal data shapes.
 *
 * Expected rules.csv columns:
 *   rule_id, scope, applies_to, type, value, stackable, min_cart_value
 *   (scope can be brand | platform | cart; cart rules leave applies_to empty)
 *
 * Expected cart.csv columns:
 *   item_id, product, brand, platform, base_price
 */

import Papa from 'papaparse'
import { validateRule } from '../engine/ruleSchema.js'
import { validateCartItem } from '../engine/cartSchema.js'

/**
 * Parses the raw text of rules.csv into an array of DiscountRule objects.
 * Each row is turned into a raw rule and checked by validateRule() — the same
 * checker the plain-English input uses. Returns { data, errors }.
 */
export function parseRulesCSV(csvText) {
  const { data: rows, errors: parseErrors } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  if (parseErrors.length > 0) {
    return { data: [], errors: parseErrors.map((e) => e.message) }
  }

  const data = []
  const errors = []

  rows.forEach((row, i) => {
    const rowNum = i + 2 // account for header row
    const { rule, errors: rowErrors } = validateRule({
      ruleId: row.rule_id,
      scope: row.scope,
      appliesTo: row.applies_to,
      type: row.type,
      value: row.value,
      stackable: row.stackable,
      minCartValue: row.min_cart_value,
    })
    if (!rule) {
      errors.push(`Row ${rowNum} skipped: ${rowErrors.join('; ')}`)
      return
    }
    if (data.some((r) => r.ruleId === rule.ruleId)) {
      errors.push(`Row ${rowNum} skipped: rule ID ${rule.ruleId} is used twice`)
      return
    }
    data.push(rule)
  })

  return { data, errors }
}

/**
 * Parses the raw text of cart.csv into an array of CartItem objects.
 * Returns { data, errors } where errors is an array of row-level issues.
 */
export function parseCartCSV(csvText) {
  const { data: rows, errors: parseErrors } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  if (parseErrors.length > 0) {
    return { data: [], errors: parseErrors.map((e) => e.message) }
  }

  const data = []
  const errors = []

  rows.forEach((row, i) => {
    const rowNum = i + 2
    const { item, errors: rowErrors } = validateCartItem({
      itemId: row.item_id,
      product: row.product,
      brand: row.brand,
      platform: row.platform,
      basePrice: row.base_price,
    })
    if (!item) {
      errors.push(`Row ${rowNum} skipped: ${rowErrors.join('; ')}`)
      return
    }
    data.push(item)
  })

  return { data, errors }
}
