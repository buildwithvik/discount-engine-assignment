# Opptra Discount Engine: FDE Intern Assignment

**Live demo:** https://discount-engine-assignment-rho.vercel.app
**Author:** Vikas Gowda

A customer-facing cart pricing engine. It picks the best offer for each item, stacks the offers that are allowed to stack, applies a cart-level offer, and explains every price in plain language.

## Run locally (3 steps)

```bash
npm install
cp .env.example .env.local      # then paste your Gemini API key into it
npm run dev                      # open http://localhost:5173
```

`npm test` runs the automated checks. Get a free key at https://aistudio.google.com/apikey. Without an API key, everything except the plain-English box still works, and that box shows a clear "AI service is not set up" message instead of crashing.

## What I built

| Task | What it does |
|---|---|
| Base | Runs and matches the expected table exactly: 1104 / 629 / 509 / 2499 / 382 / 809 |
| Cart-level offer | Sum of item final prices, then the best qualifying cart rule. Shown as its own row (`Cart offer: 10% off — Rs.593 saved`), then the final total (Rs.5,339). Below the threshold there is no offer row. |
| Plain-English rule | Text box → Gemini → validated rule → **confirm / discard** card → engine re-runs. Vague input ("Give a discount for big orders") gets a "need more detail" message. |
| PDF cart upload | Upload a cart PDF → items extracted → cart replaced → engine re-runs automatically with the active rules. Bad rows are skipped and each one is explained. |

Sample files are in `sample-data/`: `cart.pdf` (same cart as the CSV), `cart-small.pdf` (below Rs.4,000) and `cart-with-errors.pdf` (3 broken rows).

## How the code is organised

```
src/
  engine/                    ← pure logic, no UI, no I/O
    discountEngine.js        item discounts (processCart) + cart offer (summariseCart)
    ruleSchema.js            THE rule validator — every input path uses it
    cartSchema.js            THE cart-item validator — CSV and PDF both use it
  inputs/                    ← each input mode only produces rules[] or cartItems[]
    csvParser.js             CSV → validate
    pdfCartParser.js         PDF text + positions → table → validate
    pdfText.js               pdf.js wrapper (loaded only when a PDF is uploaded)
    nlRuleParser.js          sentence → /api/parse-rule → validate → confirm
  components/                UI
api/
  parse-rule.js              Vercel serverless function (keeps the API key off the browser)
  _lib/parseRuleWithLLM.js   the Gemini call (also used by `npm run dev`)
tests/                       engine + inputs tests (vitest)
```

**Adding a third input mode** (Excel, Shopify API, WhatsApp message…) means writing one file in `inputs/` that outputs raw objects and passes them through `validateRule` or `validateCartItem`. The discount calculator does not change. The engine itself only gained one new function (`summariseCart`), and its existing functions kept their signatures.

## Decisions and tradeoffs

**LLM output is never trusted**
- Gemini is forced to answer as JSON matching a fixed schema (`responseSchema` with allowed values for scope and type), at temperature 0, so I never scrape JSON out of free text.
- The answer then goes through the same `validateRule` as the CSV. Missing value, a percentage ≥ 100, an unknown scope, or a cart rule with no minimum: the rule is rejected with the reason, and nothing is added.
- The prompt tells the model **never to guess a missing number** and to return `unclear` with a follow-up question instead.
- Brand and platform names are matched to the spelling in the cart ("natura casa" → "Natura Casa"). If nothing in the cart matches, the confirm card warns that the rule won't change any price, which catches typos. Duplicates of an active rule are also flagged.
- The API key lives in a serverless function. A purely client-side call would expose the key to anyone who opens DevTools.

**PDF parsing**
- I read each text piece **with its x/y position** and assign it to the column whose header it lines up with. Splitting on spaces would break, because "Natura Casa" and "Amazon India" contain spaces.
- Text above the header (order number, date) and separator lines are ignored. A repeated header on page 2 is handled.
- A malformed row (empty price, `Rs.abc`, missing product) is **skipped with a row-specific reason**, and the good rows still load.
- If a PDF has **zero** usable rows, the current cart is **kept**. A bad file should never wipe a working cart.
- Item IDs (`ITEM-01`…) are generated, because the PDF has none.
- Scanned/image PDFs get a clear "not supported" message. OCR would be the next step if real carts arrive that way.

**Cart offer**
- Threshold is `≥`, so a Rs.4,000 cart qualifies and Rs.3,999 does not (tested).
- If several cart rules qualify, the biggest rupee saving wins, the same principle as item rules. Cart rules are never "stackable".
- Just below the threshold, the offer row is hidden as the brief asks. I added a small hint instead (for example "Add Rs.397 more to get 10% off your whole cart" with `cart-small.pdf`), because that is what a real checkout would show the customer.

**Engine fixes**
- A flat discount larger than the price used to produce a negative price. The saving is now capped at the price.
- Ties between non-stackable rules keep the rule listed first, so the result is predictable.
- Reasons now say *why*: `Amazon India offer: 15% off (you save Rs.195) — better than the Natura Casa brand offer (Rs.150)`. ITEM-04 says `No offers available — there is no current offer for LivSpace Pro on Noon`.
- Rounding follows the base code (round to the rupee at each step), which reproduces every number in the expected table.

**Issues I found in the starter repo**
1. `sample-data/rules.csv` had no RULE-04 and no `min_cart_value` column, although the brief shows both. I updated it to match the brief.
2. The CSV parser only accepted `brand` / `platform` and required `applies_to`, so a cart rule could never load. It now uses the shared validator.

## Where I'd push back on the brief

- **The confirmation step:** I kept it, because a wrong discount is real money lost. For a trusted ops user adding many rules, I'd propose a "draft rules" panel instead: rules are added as inactive drafts, you see a before/after price preview for the whole cart, and you activate several at once. Same safety, fewer clicks.
- **The PDF format assumption:** a fixed 4-column table is fine for a pilot. Real seller invoices vary a lot, so the next step would be sending the PDF text to the LLM to map columns, then running the same `validateCartItem`. The validator stays the safety net either way.
- **"One offer label":** the stakeholder asks for one label, but stacking means two offers can apply. I show both in one line joined by `+`, because hiding a stacked offer would surprise the customer more.

## Deploying (Vercel)

Import the repo into Vercel (it detects Vite) and add the environment variable `GEMINI_API_KEY`. Optional: `GEMINI_MODEL` to pin a model; otherwise it uses `gemini-3.8-flash` and falls back to other current Flash models if one is retired or overloaded. The `api/` folder becomes the serverless function.

## Testing

```bash
npm test
```

- **Engine:** the full expected table, a cart offer of exactly 593 → 5339, the boundary cases (3,999 / 4,000), two competing cart rules, a flat discount larger than the price, and invalid rules.
- **Inputs:** the sample PDF equals the CSV cart, the broken-rows PDF, the small cart (no cart offer), a PDF with no header, all four plain-English examples from the brief, LLM garbage, and a missing value.
