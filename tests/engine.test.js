// Run with:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const SAMPLE = require('../js/data.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (±${tol})`);

test('all textbook / class-slide verification cases match the hand answers', () => {
  const cases = E.verifications();
  assert.equal(cases.length, 6);
  cases.forEach((c) => assert.ok(c.pass, `${c.id} ${c.title} failed: ${JSON.stringify(c.steps.filter((s) => !s.pass))}`));
});

test('ratio formulas (Module 2)', () => {
  near(E.inventoryTurnover(2400000, 300000), 8);
  near(E.inventoryDays(300000, 2400000), 45.625);
  near(E.currentRatio(110000, 60000), 1.8333, 0.0001);
  near(E.quickRatio(110000, 40000, 60000), 1.1667, 0.0001);
  near(E.debtorDays(300000, 3650000), 30);
  near(E.creditorDays(250000, 3000000), 30.4167, 0.0001);
  near(E.cashConversionCycle(50, 30, 30.4167), 49.5833, 0.0001);
  assert.equal(E.currentRatio(100, 0), null, 'division by zero returns null, not Infinity');
});

test('purchase budget formula (Module 5)', () => {
  assert.equal(E.requiredPurchases(50000, 12000, 8000), 54000);
});

test('landed cost: domestic goods carry no duty; GST not included', () => {
  const lc = E.landedCost({ currency: 'INR', purchasePrice: 240, freightPerUnit: 8, insurancePct: 0, bcdPct: 0, swsPct: 0, clearingPerUnit: 0, inlandFreightPerUnit: 0 }, { fxRate: 84 });
  assert.equal(lc.landed, 248);
  assert.equal(lc.duty, 0);
  assert.equal(lc.cashPart, 8);
});

test('landed cost: bulk discount lowers CIF and therefore duty too', () => {
  const sku = SAMPLE.skus[0];
  const std = E.landedCost(sku, SAMPLE.global, 0);
  const bulk = E.landedCost(sku, SAMPLE.global, 8);
  near(std.landed, 1940.78);
  assert.ok(bulk.landed < std.landed);
  assert.ok(bulk.duty < std.duty);
  near(bulk.priceINR, 1260 * 0.92);
});

test('cash budget keeps minimum balance with overdraft and repays it first', () => {
  const cb = E.cashBudget({ openingCash: 100, receipts: [{ label: 'r', values: [0, 500] }], payments: [{ label: 'p', values: [300, 0] }], minCash: 50, odRatePct: 12 });
  assert.equal(cb.months[0].odDrawn, 250);
  assert.equal(cb.months[0].closing, 50);
  near(cb.months[1].interest, 2.5);                 // 250 x 12% / 12
  near(cb.months[1].odRepaid, 250);
  near(cb.months[1].closing, 50 + 500 - 2.5 - 250);
});

for (const bulk of [false, true]) {
  test(`full twin integrity (${bulk ? 'bulk' : 'base'} plan)`, () => {
    const r = E.run(SAMPLE, { bulk });
    r.checks.forEach((c) => assert.ok(c.ok, `${c.label}: ${c.detail}`));
    // accounting equation every month
    r.bs.forEach((b) => near(b.totalAssets, b.totalLiab, 0.5));
    // trading account identity
    const t = r.finalAccounts.trading;
    near(t.openingStock + t.purchases - t.closingStock, r.totals.cogs, 0.5);
    // cash never below the minimum after financing
    r.monthly.cash.forEach((c) => assert.ok(c >= SAMPLE.global.minCash - 0.5));
    // purchases = demand + closing target - opening, never negative
    r.skuRuns.forEach((s) => s.rows.forEach((row) => {
      assert.ok(row.buyU >= 0);
      assert.equal(row.stockoutU, 0);
    }));
  });
}

test('festive bulk buy: cheaper per unit but a bigger cash crunch', () => {
  const c = E.compare(SAMPLE);
  assert.ok(c.purchaseSaving > 0, 'bulk discount saves money');
  assert.ok(c.bulk.totals.grossProfit > c.base.totals.grossProfit, 'gross profit improves');
  assert.ok(c.bulk.totals.peakOD > c.base.totals.peakOD, 'needs more overdraft');
  assert.ok(c.bulk.totals.monthsOverLimit.length > 0, 'breaches the sanctioned limit');
  assert.equal(c.base.totals.monthsOverLimit.length, 0, 'base plan stays inside the limit');
  assert.ok(c.bulk.ccc.monthlyAvg.ccc > c.base.ccc.monthlyAvg.ccc, 'cash is locked up longer');
});

test('validation rejects bad inputs', () => {
  const bad = clone(SAMPLE);
  bad.channels[0].sharePct = 50;               // shares no longer 100
  bad.supplierTerms.Import = [50, 40, 0];      // pattern no longer 100
  bad.skus[0].demand[3] = -5;                  // negative demand
  bad.festive.buyMonth = 9; bad.festive.coverToMonth = 8;
  const v = E.validate(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 4, v.errors.join('\n'));
  assert.equal(E.validate(SAMPLE).ok, true);
});

test('cost sheet: apportioned overheads add back to the pool totals', () => {
  const cs = E.costSheets(SAMPLE);
  Object.values(cs.pools).forEach((p) => near(E.sum(p.amounts), p.total, 0.01));
  cs.sheets.forEach((s) => {
    near(s.costOfSales + s.profit, s.sku.sellPrice, 1e-6);
    near(s.costOfSales, s.lc.landed + s.wh + s.ad + s.varSelling + s.mk, 1e-6);
  });
});

test('changing debtor terms changes debtor days and CCC in the right direction', () => {
  const faster = clone(SAMPLE);
  faster.channels[3].profilePct = [0, 100, 0];   // B2B now pays in 30 days instead of 60
  const a = E.run(SAMPLE).ccc.textbook;
  const b = E.run(faster).ccc.textbook;
  assert.ok(b.dso < a.dso);
  assert.ok(b.ccc < a.ccc);
});
