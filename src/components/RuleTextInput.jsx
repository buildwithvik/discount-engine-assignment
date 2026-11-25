/**
 * RuleTextInput.jsx
 *
 * Plain-English rule box with a confirm step.
 * It only *proposes* a rule. The rule is added (and prices re-run) only when the
 * user presses Confirm → onConfirm(rule).
 */

import { useState } from 'react'
import { parseRuleFromText } from '../inputs/nlRuleParser.js'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
]

const box = (border, bg) => ({
  border: `1px solid ${border}`, borderLeft: `3px solid ${border}`, background: bg,
  borderRadius: 4, padding: '0.7rem 0.9rem', marginTop: '0.7rem', fontSize: 12,
})

export default function RuleTextInput({ rules, cartItems, onConfirm }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [outcome, setOutcome] = useState(null) // result of parseRuleFromText

  async function handleParse() {
    setLoading(true)
    setOutcome(null)
    const res = await parseRuleFromText(text, { rules, cartItems })
    setOutcome(res)
    setLoading(false)
  }

  function confirm() {
    onConfirm(outcome.rule)
    setOutcome(null)
    setText('')
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>
        Describe a new offer in plain English. You'll see what was understood before it is added.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && !loading && handleParse()}
          placeholder='e.g. "15% off Nordic Basics, stackable"'
          style={{ flex: 1, padding: '0.55rem 0.7rem', border: '1px solid #CECECE', borderRadius: 4, fontSize: 13 }}
        />
        <button
          onClick={handleParse}
          disabled={!text.trim() || loading}
          style={{
            background: !text.trim() || loading ? '#CECECE' : '#131A48', color: '#fff', border: 'none',
            borderRadius: 4, padding: '0 1.1rem', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {loading ? 'Reading…' : 'Read rule'}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => { setText(ex); setOutcome(null) }}
            style={{ fontSize: 11, border: '1px solid #ddd', background: '#fafafa', borderRadius: 20, padding: '2px 10px', cursor: 'pointer', color: '#444' }}
          >
            {ex}
          </button>
        ))}
      </div>

      {outcome?.kind === 'unclear' && (
        <div style={box('#d99a00', '#fff8e1')}>
          <b>Need a bit more detail.</b> {outcome.message}
        </div>
      )}

      {outcome?.kind === 'invalid' && (
        <div style={box('#c0392b', '#fce8e8')}>
          <b>The AI's answer didn't pass our checks, so nothing was added.</b> Please rephrase.
          {outcome.errors.map((e, i) => <div key={i} style={{ marginTop: 2 }}>• {e}</div>)}
        </div>
      )}

      {outcome?.kind === 'error' && (
        <div style={box('#c0392b', '#fce8e8')}><b>Something went wrong.</b> {outcome.message}</div>
      )}

      {outcome?.kind === 'ok' && (
        <div style={box('#131A48', '#f3f5ff')}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#131A48' }}>Is this the rule you meant?</div>
          <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              {fieldRows(outcome.rule).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ color: '#777', padding: '2px 14px 2px 0' }}>{k}</td>
                  <td style={{ fontWeight: 600 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {outcome.warnings.map((w, i) => (
            <div key={i} style={{ marginTop: 6, color: '#8a5a00' }}>⚠ {w}</div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={confirm} style={{ background: '#1e5c2c', color: '#fff', border: 'none', borderRadius: 4, padding: '0.4rem 1rem', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
              Confirm & add
            </button>
            <button onClick={() => setOutcome(null)} style={{ background: '#fff', color: '#c0392b', border: '1px solid #c0392b', borderRadius: 4, padding: '0.4rem 1rem', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function fieldRows(rule) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
  const rows = [
    ['Rule ID', rule.ruleId],
    ['Scope', cap(rule.scope)],
  ]
  if (rule.scope !== 'cart') rows.push(['Applies to', rule.appliesTo])
  rows.push(['Type', cap(rule.type)])
  rows.push(['Value', rule.type === 'percentage' ? `${rule.value}%` : `Rs.${rule.value.toLocaleString('en-IN')}`])
  if (rule.scope === 'cart') rows.push(['Min cart value', `Rs.${rule.minCartValue.toLocaleString('en-IN')}`])
  else rows.push(['Stackable', rule.stackable ? 'Yes' : 'No'])
  return rows
}
