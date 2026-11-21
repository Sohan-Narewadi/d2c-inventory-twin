# D2C Inventory Twin: Stock, Cash and Profit

**FCA IA2 · Project 20** · Finance and Cost Accounting (216U50C501) · TY B.Tech CSBS, KJSSE
Modules **M1 + M2 + M3 + M5** · Course outcomes **CO1–CO4**

**Live tool:** https://sohan-narewadi.github.io/d2c-inventory-twin/

A browser-based "digital twin" of a direct-to-consumer (D2C) sneaker and apparel brand. Purchase and sales orders flow
through to inventory, debtor and creditor days, the Cash Conversion Cycle, a landed cost sheet per SKU, a 12-month
cash budget, double-entry books, final accounts and liquidity ratios. Every figure shows its working.

## Required scope → where it is in the tool

| # | Required scope | Tab | Syllabus |
|---|---|---|---|
| 1 | Order flow to inventory, debtor and creditor days and the Cash Conversion Cycle | **1 Order flow & CCC** | M5 purchase budget, M2 activity ratios, M1 CCC |
| 2 | Landed cost sheet per SKU | **2 Landed cost sheet** | M3 cost elements, cost sheet, allocation / apportionment / absorption |
| 3 | Cash budget and liquidity ratios | **3 Cash budget & ratios** | M5 cash budget, M1 journal → ledger → trial balance, M2 final accounts & ratios |
| ★ | Demo: a bigger festive order looks cheaper per unit, but causes a cash crunch | **Festive twin** | all of the above |

### How the components link (output of one feeds the next)

```
Demand (sales budget) ──► Purchase budget = Sales + Desired closing − Opening      [M5]
                              │  units × landed cost per unit  ◄── Landed cost sheet [M3]
                              ▼
          Stock ledger (weighted-average cost) → COGS, closing stock
          Sales by channel → cash sales / credit sales → debtors schedule
          Supplier terms   → cash purchases / credit purchases → creditors schedule
                              ▼
     Inventory days + Debtor days − Creditor days = Cash Conversion Cycle        [M1, M2]
                              ▼
     Cash budget (receipts, payments, overdraft to keep minimum cash)            [M5]
                              ▼
     Journal → Ledger → Trial Balance (Dr = Cr) → Trading, P&L, Balance Sheet     [M1, M2]
                              ▼
     Current ratio, quick ratio, inventory turnover, margins                     [M2]
```

## Accounting verification

The **Textbook checks** tab recomputes these with the same engine functions the twin uses:

| Case | Source | Result |
|---|---|---|
| V1 Inventory turnover | Module 2, slide 47 | COGS 24,00,000 ÷ 3,00,000 = **8×**, 45.6 days ✓ |
| V2 Current ratio | Module 2, slide 45 | 1,10,000 ÷ 60,000 = **1.83** ✓ |
| V3 Production & material purchase budget | Module 5, slide 21 | 54,000 units; 1,03,000 kg = **₹1,54,50,000** ✓ |
| V4 Cash budget (Apex Traders format) | Module 5, slide 22 format | Apr 40,000 · May 53,000 · Jun **72,000** ✓ |
| V5 Cash Conversion Cycle | textbook-style, hand solved | 50 + 30 − 30.42 = **49.58 days** ✓ |
| V6 Landed cost of an imported sneaker | team problem, hand solved | **₹1,940.78** per unit ✓ |

Live integrity checks for both plans: every journal entry and the trial balance satisfy Dr = Cr; the Balance Sheet balances
every month; Trading-account COGS equals units × weighted-average cost; final-accounts profit equals the monthly P&L;
cash-budget closing cash equals the Bank ledger; no stock-outs.

## Key assumptions (stated so every figure can be explained)

- All amounts in ₹ and **excluding GST** (GST paid is recoverable as input tax credit, so it is not a cost).
- Inventory is valued at **landed cost** (purchase price + freight + insurance + customs duty + clearing + inland freight),
  following Ind AS 2. Warehouse, admin and selling costs are period costs in the P&L. The cost sheet absorbs them per unit for pricing.
- Customs: assessable value = CIF; BCD on CIF; Social Welfare Surcharge = 10% of BCD.
- Weighted-average cost for stock; periodic (Trading account) method for the journal, as taught in class.
- Supplier goods are paid on their credit terms; freight, insurance, duty and clearing are paid in cash on receipt.
- Debtor days use **credit sales** and creditor days use **credit purchases** (the share not settled in the same month).
- Ratios use the textbook average (opening + closing) ÷ 2. A seasonality check using 13 month-end balances is shown alongside.
- The overdraft keeps a minimum cash balance and is repaid first from surpluses. Interest is charged on the opening monthly balance.
- The sample company "StrideKart" and all of its figures are fictional.

## Run it

No install or build. Either open the live link above, or:

```bash
# any static server works; for example
python -m http.server 8000      # then open http://localhost:8000
```

Opening `index.html` directly from disk also works. Chart.js is bundled in `js/vendor/`, so the tool runs offline.

Run the unit tests (Node 18+):

```bash
node --test
```

## Project structure

```
index.html            page shell and tabs
css/style.css         styles (light and dark)
js/engine.js          pure accounting engine: landed cost, purchase budget, stock ledger,
                      debtors/creditors, CCC, cash budget, journal, ledger, trial balance,
                      final accounts, ratios, verification cases (runs in browser and Node)
js/data.js            sample scenario (StrideKart, FY 2026-27)
js/app.js             UI: inputs with validation, tables showing working, charts
js/vendor/            Chart.js 4.4.1 (MIT)
tests/engine.test.js  unit tests (node --test)
```

## Team

| Name | Roll no. |
|---|---|
| _to be filled_ | |
| _to be filled_ | |
| _to be filled_ | |
| _to be filled_ | |

## Declaration of AI assistance

As the IA2 ground rules require, we declare that an AI coding assistant (Claude, by Anthropic, used through Claude Code)
helped write the code and documentation. The team chose the project, reviewed the accounting logic, checked the
results against the class problems, and can explain every figure on screen.
