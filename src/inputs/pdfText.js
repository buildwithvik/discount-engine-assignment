/**
 * pdfText.js — browser-only wrapper around pdf.js.
 * Reads every text piece in the PDF with its x/y position.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function extractTextItems(arrayBuffer) {
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const items = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    for (const it of content.items) {
      if (!('str' in it)) continue
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], page: p })
    }
  }
  return items
}
