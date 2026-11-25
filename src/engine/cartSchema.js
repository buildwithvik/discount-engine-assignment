/**
 * cartSchema.js
 *
 * ONE place that decides whether a cart item is valid.
 * CSV upload and PDF upload both build raw items and pass them through here,
 * so the engine always gets the same clean CartItem shape.
 *
 * CartItem { itemId, product, brand, platform, basePrice (whole rupees) }
 */

export function parsePrice(v) {
  if (typeof v === 'number') return v
  if (v === undefined || v === null) return NaN
  const cleaned = String(v).replace(/rs\.?|₹|inr|,/gi, '').trim()
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return NaN
  return Number(cleaned)
}

export function validateCartItem(raw) {
  const errors = []
  const field = (k) => String(raw?.[k] ?? '').trim()

  const itemId = field('itemId')
  const product = field('product')
  const brand = field('brand')
  const platform = field('platform')

  if (!itemId) errors.push('missing item ID')
  if (!product) errors.push('missing product')
  if (!brand) errors.push('missing brand')
  if (!platform) errors.push('missing platform')

  const price = parsePrice(raw?.basePrice)
  if (!Number.isFinite(price) || price <= 0) {
    errors.push(`price must be a number above 0 (got "${raw?.basePrice ?? ''}")`)
  }

  if (errors.length > 0) return { item: null, errors }
  return { item: { itemId, product, brand, platform, basePrice: Math.round(price) }, errors: [] }
}
