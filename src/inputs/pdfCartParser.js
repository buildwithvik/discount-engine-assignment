/**
 * pdfCartParser.js
 *
 * Input path #4: a cart PDF → CartItem[].
 *
 *   PDF file ──► pdf.js reads every piece of text + its position on the page
 *            ──► cartFromTextItems() rebuilds the table by position
 *            ──► validateCartItem() (same checker the CSV upload uses)
 *
 * Why position and not "split on spaces"? Names like "Natura Casa" and
 * "Amazon India" contain spaces, so splitting a line on spaces mixes up columns.
 * Instead we find where each header word (Product, Brand, Platform, Base Price)
 * sits horizontally, and put each piece of text under the header it lines up with.
 *
 * Bad rows are skipped with a clear note; good rows still load.
 */

import { validateCartItem } from '../engine/cartSchema.js'

const COLUMNS = [
  { key: 'product', match: /^product/i },
  { key: 'brand', match: /^brand/i },
  { key: 'platform', match: /^platform/i },
  { key: 'basePrice', match: /^(base\s*)?price/i },
]

const LINE_TOLERANCE = 3 // points: text within 3pt vertically is the same line
const isSeparator = (s) => /^[\s─━—–\-_=|.]*$/.test(s)

/**
 * items: [{ str, x, y, page }]   (y grows upward, as in PDF coordinates)
 * returns { data: CartItem[], errors: string[] }
 */
export function cartFromTextItems(items) {
  const errors = []
  const lines = groupIntoLines(items.filter((it) => it.str && it.str.trim()))

  if (lines.length === 0) {
    return { data: [], errors: ['No text found in this PDF. Scanned/image PDFs are not supported — please upload a text PDF.'] }
  }

  let columns = null
  const data = []
  let rowNum = 0

  for (const line of lines) {
    const header = detectHeader(line)
    if (header) {
      columns = header // a repeated header on a new page just resets the columns
      continue
    }
    if (!columns) continue // text above the table (order number, date...) is ignored

    const text = line.map((i) => i.str).join(' ').trim()
    if (isSeparator(text)) continue
    if (/^(sub)?total\b/i.test(text)) continue

    rowNum += 1
    const cells = { product: [], brand: [], platform: [], basePrice: [] }
    for (const it of line) {
      cells[columnFor(it.x, columns)].push(it.str.trim())
    }
    const raw = {
      itemId: `ITEM-${String(data.length + 1).padStart(2, '0')}`,
      product: cells.product.join(' '),
      brand: cells.brand.join(' '),
      platform: cells.platform.join(' '),
      basePrice: cells.basePrice.join(''),
    }
    const { item, errors: rowErrors } = validateCartItem(raw)
    if (!item) {
      const name = raw.product ? ` ("${raw.product}")` : ''
      errors.push(`PDF row ${rowNum}${name} skipped: ${rowErrors.join('; ')}`)
      continue
    }
    data.push(item)
  }

  if (!columns) {
    errors.unshift('Could not find the table header in this PDF. Expected columns: Product, Brand, Platform, Base Price.')
  } else if (data.length === 0 && errors.length === 0) {
    errors.push('The table header was found but there are no item rows under it.')
  }
  return { data, errors }
}

function groupIntoLines(items) {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const lines = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= LINE_TOLERANCE) {
      last.items.push(it)
    } else {
      lines.push({ page: it.page, y: it.y, items: [it] })
    }
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x))
}

/** Returns [{key, x}] if this line is the table header, else null. */
function detectHeader(line) {
  const found = []
  for (const col of COLUMNS) {
    const hit = line.find((it) => col.match.test(it.str.trim()))
    if (!hit) return null
    found.push({ key: col.key, x: hit.x })
  }
  return found.sort((a, b) => a.x - b.x)
}

/** The column whose header starts closest to the left of this x. */
function columnFor(x, columns) {
  let chosen = columns[0].key
  for (const c of columns) {
    if (x >= c.x - 5) chosen = c.key
  }
  return chosen
}

/**
 * Browser helper: File → { data, errors }.
 * pdf.js is loaded only when someone actually uploads a PDF (keeps first page load small).
 */
export async function parseCartPDF(file) {
  if (!file || (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))) {
    return { data: [], errors: ['That file is not a PDF.'] }
  }
  try {
    const { extractTextItems } = await import('./pdfText.js')
    const items = await extractTextItems(await file.arrayBuffer())
    return cartFromTextItems(items)
  } catch (err) {
    console.error(err)
    return { data: [], errors: ['Could not read this PDF. It may be damaged or password-protected.'] }
  }
}
