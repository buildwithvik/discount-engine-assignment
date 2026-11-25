/**
 * App.jsx
 *
 * Top-level component. Manages state for rules and cart items, and shows results.
 *
 *   inputs/ (CSV, PDF, plain-English)  ──►  rules[] + cartItems[]  ──►  engine/  ──►  display
 *
 * Every input path just produces rules or cart items. None of them call the engine.
 * Once the user has pressed Calculate, results are derived live from (rules, cartItems),
 * so adding a rule or uploading a new cart re-runs the engine automatically.
 */

import { useMemo, useState } from 'react'
import CsvUploader from './components/CsvUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import RuleTextInput from './components/RuleTextInput.jsx'
import { parseRulesCSV, parseCartCSV } from './inputs/csvParser.js'
import { parseCartPDF } from './inputs/pdfCartParser.js'
import { processCart, summariseCart } from './engine/discountEngine.js'

const rs = (n) => `Rs.${Math.round(n).toLocaleString('en-IN')}`

// ── Column definitions ───────────────────────────────────────────

const RULES_COLUMNS = [
  { key: 'ruleId',    label: 'Rule ID', render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
  { key: 'scope',     label: 'Scope',      render: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  { key: 'appliesTo', label: 'Applies To', render: (v, row) => (row.scope === 'cart' ? 'Entire cart' : v) },
  { key: 'type',      label: 'Type',       render: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  {
    key: 'value',
    label: 'Value',
    render: (v, row) => {
      const amount = row.type === 'percentage' ? `${v}% off` : `${rs(v)} off`
      return row.scope === 'cart' ? `${amount} if cart ≥ ${rs(row.minCartValue)}` : amount
    },
  },
  { key: 'stackable', label: 'Stackable',  render: (v, row) => (row.scope === 'cart' ? '—' : v ? 'Yes' : 'No') },
]

const CART_COLUMNS = [
  { key: 'itemId',    label: 'Item', render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
  { key: 'product',   label: 'Product' },
  { key: 'brand',     label: 'Brand' },
  { key: 'platform',  label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
]

const RESULTS_COLUMNS = [
  { key: 'itemId',    label: 'Item', render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
  { key: 'product',   label: 'Product' },
  { key: 'basePrice', label: 'Base Price',  render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
  { key: 'finalPrice',label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>
        Rs.{v.toLocaleString('en-IN')}
      </span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) =>
      v > 0 ? (
        <span style={{ color: '#1e5c2c', fontWeight: 600 }}>Rs.{v.toLocaleString('en-IN')}</span>
      ) : (
        <span style={{ color: '#888' }}>—</span>
      ),
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v, row) => (
      <span style={{ color: row.totalDiscount > 0 ? '#131A48' : '#888', fontStyle: row.totalDiscount > 0 ? 'normal' : 'italic' }}>
        {v}
      </span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    render: (v) => {
      const colors = {
        'Max discount': ['#7a3d00', '#ffe9d6'],
        Stacked: ['#1e5c2c', '#dff3e3'],
        'Discount applied': ['#131A48', '#e6e9fb'],
        'No offer': ['#777', '#eee'],
      }
      const [c, bg] = colors[v] || colors['No offer']
      return <span style={S.tag(c, bg)}>{v}</span>
    },
  },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page:    { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header:  { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan:{ color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main:    { maxWidth: 1120, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { overflowX: 'auto', background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem' },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  grid2:   { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1rem' },
  btn:     {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnDisabled: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'not-allowed',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  totalRow: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
    gap: '1rem', marginTop: '0.75rem', paddingTop: '0.75rem',
    borderTop: '2px solid #131A48',
  },
  totalLabel: { fontWeight: 700, fontSize: 14, color: '#131A48' },
  totalValue: { fontWeight: 700, fontSize: 16, color: '#131A48', minWidth: 90, textAlign: 'right' },
  subLabel: { fontSize: 13, color: '#131A48', fontWeight: 600 },
  subValue: { fontSize: 14, color: '#131A48', fontWeight: 600, minWidth: 90, textAlign: 'right' },
  notice: { fontSize: 12, color: '#1e5c2c', marginTop: 8 },
  linkBtn: { background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: 0 },
  tag: (color, bg) => ({
    display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 6px',
    borderRadius: 20, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
  }),
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules]           = useState([])
  const [rulesErrors, setRulesErr]  = useState([])
  const [rulesFileName, setRulesFileName] = useState('')

  const [cartItems, setCartItems]   = useState([])
  const [cartErrors, setCartErrors] = useState([])
  const [cartFileName, setCartFileName]   = useState('')

  const [calculated, setCalculated] = useState(false)
  const [addedRuleIds, setAddedRuleIds] = useState([]) // rules added via plain English (removable)
  const [cartNotice, setCartNotice] = useState('')
  const [rulesNotice, setRulesNotice] = useState('')

  // Live results: once calculated, any change to rules or cart re-runs the engine.
  const results = useMemo(
    () => (calculated && cartItems.length > 0 ? processCart(cartItems, rules) : null),
    [calculated, cartItems, rules]
  )
  const summary = useMemo(() => (results ? summariseCart(results, rules) : null), [results, rules])

  // ── Handlers (inputs → state; the engine is never called here) ──

  function handleRulesLoad(csvText, fileName) {
    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErr(errors)
    setRulesFileName(fileName)
    setRulesNotice('')
    setCalculated(false) // new rule file: wait for Calculate again
  }

  function handleCartLoad(csvText, fileName) {
    const { data, errors } = parseCartCSV(csvText)
    setCartItems(data)
    setCartErrors(errors)
    setCartFileName(fileName)
    setCartNotice('')
    setCalculated(false)
  }

  async function handleCartPdf(file, fileName) {
    setCartNotice('Reading PDF…')
    const { data, errors } = await parseCartPDF(file)
    setCartErrors(errors)
    if (data.length === 0) {
      // Decision: never wipe a working cart because a PDF was unreadable.
      setCartNotice(cartItems.length ? 'PDF had no usable items — your current cart was kept.' : '')
      return
    }
    setCartItems(data)
    setCartFileName(fileName)
    setCartNotice(
      `Cart replaced from ${fileName}: ${data.length} item${data.length > 1 ? 's' : ''} loaded` +
        (errors.length ? `, ${errors.length} row${errors.length > 1 ? 's' : ''} skipped (see below)` : '') +
        (rules.length ? '. Prices updated.' : '.')
    )
    if (rules.length > 0) setCalculated(true) // spec: re-run automatically with active rules
  }

  function handleRuleConfirmed(rule) {
    setRules((prev) => [...prev, rule])
    setAddedRuleIds((prev) => [...prev, rule.ruleId])
    setRulesNotice(`${rule.ruleId} added.${calculated ? ' Prices updated below.' : ''}`)
  }

  function handleRemoveRule(ruleId) {
    setRules((prev) => prev.filter((r) => r.ruleId !== ruleId))
    setAddedRuleIds((prev) => prev.filter((id) => id !== ruleId))
    setRulesNotice(`${ruleId} removed.`)
  }

  const canCalculate = rules.length > 0 && cartItems.length > 0

  const rulesColumnsWithRemove = [
    ...RULES_COLUMNS,
    {
      key: 'ruleId',
      label: '',
      render: (id) =>
        addedRuleIds.includes(id) ? (
          <button onClick={() => handleRemoveRule(id)} style={S.linkBtn} title="Remove this rule" aria-label={`Remove ${id}`}>
            ✕
          </button>
        ) : null,
    },
  ]

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>

        {/* Upload row */}
        <div style={S.grid2}>
          {/* Rules upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Discount Rules</div>
            <CsvUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              onLoad={handleRulesLoad}
              hasData={rules.length > 0}
              fileName={rulesFileName}
            />
            <ErrorBanner errors={rulesErrors} />
            {rules.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {rules.length} rule{rules.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={rulesColumnsWithRemove} rows={rules} />
              </div>
            )}
            {rulesNotice && <div style={S.notice}>{rulesNotice}</div>}
          </div>

          {/* Cart upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Items</div>
            <CsvUploader
              label="cart.csv"
              description="Upload your cart CSV"
              onLoad={handleCartLoad}
              hasData={cartItems.length > 0 && /\.csv$/i.test(cartFileName)}
              fileName={cartFileName}
            />
            <div style={{ fontSize: 11, color: '#888', textAlign: 'center', margin: '6px 0' }}>or</div>
            <CsvUploader
              label="cart.pdf"
              description="Upload a cart PDF (Product, Brand, Platform, Base Price)"
              onLoad={handleCartPdf}
              accept=".pdf,application/pdf"
              readAs="file"
              icon="🧾"
              hasData={cartItems.length > 0 && /\.pdf$/i.test(cartFileName)}
              fileName={cartFileName}
            />
            {cartNotice && <div style={S.notice}>{cartNotice}</div>}
            <ErrorBanner errors={cartErrors} />
            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </div>
        </div>

        {/* Plain-English rule input */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Add an offer in plain English</div>
          <RuleTextInput rules={rules} cartItems={cartItems} onConfirm={handleRuleConfirmed} />
        </div>

        {/* Calculate button */}
        <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          <button
            style={canCalculate ? S.btn : S.btnDisabled}
            onClick={() => setCalculated(true)}
            disabled={!canCalculate}
          >
            Calculate Discounts
          </button>
          {!canCalculate && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              Load rules and a cart to calculate
            </div>
          )}
        </div>

        {/* Results */}
        {results && summary && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <DataTable columns={RESULTS_COLUMNS} rows={results} />

            <div style={{ ...S.totalRow, borderTop: '1px solid #CECECE' }}>
              <span style={S.subLabel}>Items total</span>
              <span style={S.subValue}>{rs(summary.subtotal)}</span>
            </div>

            {summary.cartOffer && (
              <div style={{ ...S.totalRow, borderTop: 'none', marginTop: 4, paddingTop: 0 }}>
                <span style={{ ...S.subLabel, color: '#1e5c2c' }}>
                  {summary.cartOffer.label} <span style={{ color: '#888', fontWeight: 400 }}>({summary.cartOffer.ruleId})</span>
                </span>
                <span style={{ ...S.subValue, color: '#1e5c2c' }}>−{rs(summary.cartOffer.saving)}</span>
              </div>
            )}

            <div style={S.totalRow}>
              <span style={S.totalLabel}>Final Cart Total</span>
              <span style={S.totalValue}>{rs(summary.finalTotal)}</span>
            </div>

            {summary.nearMiss && (
              <div style={{ textAlign: 'right', fontSize: 12, color: '#7a3d00', marginTop: 6 }}>
                💡 {summary.nearMiss.label}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
