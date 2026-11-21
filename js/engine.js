/* =====================================================================
   D2C Inventory Twin — accounting engine
   ---------------------------------------------------------------------
   Pure functions only (no DOM). The same file runs in the browser
   (window.Engine) and in Node (require), so the unit tests and the
   textbook checks exercise exactly the code the app uses.

   Component 1  Order flow -> inventory, debtor, creditor days -> CCC
   Component 2  Landed cost sheet per SKU (with overhead apportionment)
   Component 3  Cash budget -> journal -> final accounts -> liquidity ratios
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 12;           // months in the budget year
  const DAYS = 365;       // days used for turnover-to-days conversion
  const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const zeros = (n = N) => new Array(n).fill(0);
  const pct = (x) => x / 100;
  const EPS = 1e-6;

  /* -------------------------------------------------------------
     Ratio formulas (Module 2: Financial Statement Analysis)
     Each takes plain numbers so the textbook checks can call them
     directly with the figures from the class slides.
     ------------------------------------------------------------- */
  const safeDiv = (a, b) => (Math.abs(b) < EPS ? null : a / b);
  const average = (opening, closing) => (opening + closing) / 2;

  /** Inventory Turnover = COGS / Average Inventory */
  const inventoryTurnover = (cogs, avgInventory) => safeDiv(cogs, avgInventory);
  /** Days in inventory = 365 / Inventory Turnover  (= Avg Inventory / COGS x 365) */
  const inventoryDays = (avgInventory, cogs) => {
    const t = inventoryTurnover(cogs, avgInventory);
    return t === null ? null : DAYS / t;
  };
  /** Debtor (receivable) days = Average Debtors / Net Credit Sales x 365 */
  const debtorDays = (avgDebtors, creditSales) => {
    const r = safeDiv(avgDebtors, creditSales);
    return r === null ? null : r * DAYS;
  };
  /** Creditor (payable) days = Average Creditors / Net Credit Purchases x 365 */
  const creditorDays = (avgCreditors, creditPurchases) => {
    const r = safeDiv(avgCreditors, creditPurchases);
    return r === null ? null : r * DAYS;
  };
  /** Cash Conversion Cycle = Inventory days + Debtor days - Creditor days */
  const cashConversionCycle = (dio, dso, dpo) =>
    dio === null || dso === null || dpo === null ? null : dio + dso - dpo;
  /** Current Ratio = Current Assets / Current Liabilities */
  const currentRatio = (ca, cl) => safeDiv(ca, cl);
  /** Quick (Liquid) Ratio = (Current Assets - Inventory) / Current Liabilities */
  const quickRatio = (ca, inventory, cl) => safeDiv(ca - inventory, cl);

  /** Interpretation bands used in class (Module 2, Current Ratio slide) */
  function currentRatioBand(cr) {
    if (cr === null) return { tone: 'ok', text: 'No current liabilities' };
    if (cr > 3) return { tone: 'warn', text: 'Above 3: excess current assets (under-utilised)' };
    if (cr >= 1.2) return { tone: 'ok', text: '1.2 to 3: balanced liquidity' };
    if (cr >= 1) return { tone: 'warn', text: '1 to 1.2: thin cushion' };
    return { tone: 'bad', text: 'Below 1: working-capital deficit' };
  }

  /* -------------------------------------------------------------
     Functional budget formula (Module 5: Production / Purchase budget)
     Required purchases = Requirement + Desired closing stock - Opening stock
     ------------------------------------------------------------- */
  const requiredPurchases = (requirement, desiredClosing, opening) =>
    requirement + desiredClosing - opening;

  /* -------------------------------------------------------------
     COMPONENT 2 — Landed cost of one unit (Module 3 cost elements)
     Inventory is valued at landed cost (Ind AS 2: purchase price +
     non-refundable import duties + freight, insurance and handling
     directly attributable to bringing goods to the warehouse).
     GST is recoverable as input tax credit, so it is excluded.
     ------------------------------------------------------------- */
  function landedCost(sku, global, discountPct = 0) {
    const fx = sku.currency === 'USD' ? global.fxRate : 1;
    const basePriceINR = sku.purchasePrice * fx;
    const discount = basePriceINR * pct(discountPct);
    const priceINR = basePriceINR - discount;                 // supplier invoice value (INR)
    const freight = sku.freightPerUnit;                         // ocean / inward freight
    const insurance = (priceINR + freight) * pct(sku.insurancePct || 0);
    const assessable = priceINR + freight + insurance;          // CIF = assessable value for customs
    const bcd = assessable * pct(sku.bcdPct || 0);              // Basic Customs Duty
    const sws = bcd * pct(sku.swsPct || 0);                     // Social Welfare Surcharge (on BCD)
    const clearing = sku.clearingPerUnit || 0;                  // CHA, port & handling
    const inland = sku.inlandFreightPerUnit || 0;               // port / factory -> warehouse
    const landed = assessable + bcd + sws + clearing + inland;
    return {
      fx, basePriceINR, discount, priceINR, freight, insurance, assessable,
      bcd, sws, duty: bcd + sws, clearing, inland, landed,
      supplierPart: priceINR,            // owed to the supplier (on credit terms)
      cashPart: landed - priceINR,       // freight, insurance, duty, clearing: paid on receipt
    };
  }

  /* -------------------------------------------------------------
     Generic cash budget (Module 5) — Apex Traders format.
     receipts / payments: [{ label, values: [n months] }]
     Keeps a minimum cash balance by drawing a bank overdraft and
     repays the overdraft first whenever there is a surplus.
     Interest on overdraft is charged on the opening OD balance.
     ------------------------------------------------------------- */
  function cashBudget({ openingCash, receipts, payments, minCash = 0, odRatePct = 0, openingOD = 0 }) {
    const n = (receipts[0] || payments[0]).values.length;
    const months = [];
    let cash = openingCash;
    let od = openingOD;
    for (let m = 0; m < n; m++) {
      const totalReceipts = sum(receipts.map((r) => r.values[m]));
      const interest = od * pct(odRatePct) / 12;
      const totalPayments = sum(payments.map((p) => p.values[m])) + interest;
      const net = totalReceipts - totalPayments;
      const beforeFinancing = cash + net;
      let odDrawn = 0;
      let odRepaid = 0;
      let closing = beforeFinancing;
      if (beforeFinancing < minCash) {
        odDrawn = minCash - beforeFinancing;
        closing = minCash;
      } else if (od > 0) {
        odRepaid = Math.min(od, beforeFinancing - minCash);
        closing = beforeFinancing - odRepaid;
      }
      od = od + odDrawn - odRepaid;
      months.push({ opening: cash, totalReceipts, interest, totalPayments, net, beforeFinancing, odDrawn, odRepaid, closing, odClosing: od });
      cash = closing;
    }
    return { months, receipts, payments };
  }

  /* -------------------------------------------------------------
     Input validation (engineering marks: no garbage in)
     ------------------------------------------------------------- */
  function validate(input) {
    const errors = [];
    const warnings = [];
    const g = input.global;
    const near100 = (x) => Math.abs(x - 100) < 0.01;
    if (!(g.fxRate > 0)) errors.push('Exchange rate must be greater than zero.');
    if (!(g.coverMonths >= 0)) errors.push('Stock cover (months) cannot be negative.');
    if (!(g.minCash >= 0)) errors.push('Minimum cash balance cannot be negative.');
    if (!(g.odRatePct >= 0)) errors.push('Overdraft interest rate cannot be negative.');
    if (!(g.odLimit >= 0)) errors.push('Sanctioned overdraft limit cannot be negative.');

    const shareTotal = sum(input.channels.map((c) => c.sharePct));
    if (!near100(shareTotal)) errors.push(`Sales channel shares add up to ${shareTotal}% — they must total 100%.`);
    input.channels.forEach((c) => {
      const t = sum(c.profilePct);
      if (!near100(t)) errors.push(`Collection pattern for "${c.name}" adds up to ${t}% — it must total 100%.`);
      if (c.profilePct.some((x) => x < 0) || c.sharePct < 0 || c.feePct < 0) errors.push(`Channel "${c.name}" has a negative value.`);
    });
    Object.entries(input.supplierTerms).forEach(([src, p]) => {
      const t = sum(p);
      if (!near100(t)) errors.push(`Payment pattern for ${src} suppliers adds up to ${t}% — it must total 100%.`);
    });
    input.skus.forEach((s) => {
      const label = s.code || 'SKU';
      ['purchasePrice', 'sellPrice', 'freightPerUnit', 'openingUnits', 'packagingPerUnit', 'deliveryPerUnit', 'cbmPerUnit']
        .forEach((k) => { if (!(s[k] >= 0)) errors.push(`${label}: ${k} must be zero or more.`); });
      if (s.demand.length !== N || s.demand.some((d) => !(d >= 0) || !Number.isInteger(d)))
        errors.push(`${label}: monthly demand must be 12 whole numbers, zero or more.`);
      if (!input.supplierTerms[s.source]) errors.push(`${label}: unknown supplier type "${s.source}".`);
      const lc = landedCost(s, g, 0);
      if (s.sellPrice > 0 && lc.landed >= s.sellPrice) warnings.push(`${label}: landed cost (₹${lc.landed.toFixed(2)}) is not below the selling price — every sale loses money before overheads.`);
    });
    input.expenses.forEach((e) => {
      if (e.monthly.length !== N || e.monthly.some((v) => !(v >= 0))) errors.push(`Expense "${e.label}" needs 12 values, zero or more.`);
    });
    const f = input.festive;
    if (!(f.buyMonth >= 0 && f.buyMonth < N && f.coverToMonth >= f.buyMonth && f.coverToMonth < N))
      errors.push('Festive bulk buy: the order month must come on or before the last month it covers.');
    if (!(f.discountPct >= 0 && f.discountPct < 100)) errors.push('Festive bulk discount must be between 0% and 100%.');
    const fa = input.opening.fixedAssets;
    if (fa.accDep > fa.gross) errors.push('Accumulated depreciation cannot exceed the gross block.');
    return { errors, warnings, ok: errors.length === 0 };
  }

  /* -------------------------------------------------------------
     COMPONENT 1 — order flow for one SKU
     Purchase budget + weighted-average inventory valuation.
     ------------------------------------------------------------- */
  function simulateSku(sku, input, bulk) {
    const g = input.global;
    const F = input.festive;
    const lcStd = landedCost(sku, g, 0);
    const lcBulk = landedCost(sku, g, F.discountPct);
    const d = sku.demand;
    const nextDemand = (k) => d[k % N];  // after March, assume next year repeats the same month
    const targetClosing = (m) => {
      if (bulk && m >= F.buyMonth && m < F.coverToMonth) {
        // Bulk policy: hold enough stock to sell through the festive window, then normal cover.
        let t = 0;
        for (let k = m + 1; k <= F.coverToMonth; k++) t += d[k];
        return t + Math.ceil(g.coverMonths * nextDemand(F.coverToMonth + 1));
      }
      return Math.ceil(g.coverMonths * nextDemand(m + 1));
    };

    const rows = [];
    let openU = sku.openingUnits;
    let openV = sku.openingUnits * lcStd.landed;
    for (let m = 0; m < N; m++) {
      const closingTarget = targetClosing(m);
      const buyU = Math.max(0, requiredPurchases(d[m], closingTarget, openU));
      const isBulkBuy = bulk && m === F.buyMonth && buyU > 0;
      const lc = isBulkBuy ? lcBulk : lcStd;
      const buyV = buyU * lc.landed;
      const supplierV = buyU * lc.supplierPart;
      const chargesV = buyU * lc.cashPart;
      const availU = openU + buyU;
      const availV = openV + buyV;
      const avgCost = availU > 0 ? availV / availU : lc.landed;
      const soldU = Math.min(d[m], availU);
      const closeU = availU - soldU;
      const cogs = closeU === 0 ? availV : soldU * avgCost;
      const closeV = closeU === 0 ? 0 : availV - cogs;
      const sales = soldU * sku.sellPrice;
      rows.push({
        month: m, openU, openV, demand: d[m], closingTarget, buyU, isBulkBuy, unitLanded: lc.landed,
        buyV, supplierV, chargesV, availU, availV, avgCost, soldU, cogs, closeU, closeV, sales,
        packDeliver: soldU * (sku.packagingPerUnit + sku.deliveryPerUnit),
        stockoutU: d[m] - soldU,
      });
      openU = closeU;
      openV = closeV;
    }
    return { sku, lcStd, lcBulk, rows, openingValue: sku.openingUnits * lcStd.landed };
  }

  /** Blend each channel's collection pattern by its share of sales */
  function blendedCollection(channels) {
    const P = [0, 1, 2].map((k) => sum(channels.map((c) => pct(c.sharePct) * pct(c.profilePct[k]))));
    const feeRate = sum(channels.map((c) => pct(c.sharePct) * pct(c.feePct)));
    return { P, feeRate };
  }

  /* -------------------------------------------------------------
     Full twin: order flow -> cash budget -> journal -> final accounts
     ------------------------------------------------------------- */
  function run(input, opts = {}) {
    const bulk = !!opts.bulk;
    const g = input.global;
    const op = input.opening;
    const { P, feeRate } = blendedCollection(input.channels);

    // ---- Component 1: order flow per SKU ----
    const skuRuns = input.skus.map((s) => simulateSku(s, input, bulk));
    const agg = (field) => {
      const out = zeros();
      skuRuns.forEach((r) => r.rows.forEach((row, m) => { out[m] += row[field]; }));
      return out;
    };
    const sales = agg('sales');
    const cogs = agg('cogs');
    const purchases = agg('buyV');          // landed value of goods bought
    const supplierV = agg('supplierV');
    const charges = agg('chargesV');        // freight, insurance, duty, clearing (cash)
    const closingInv = agg('closeV');
    const packDeliver = agg('packDeliver');
    const fees = sales.map((s) => s * feeRate);
    const openingInv = sum(skuRuns.map((r) => r.openingValue));

    // Supplier side: cash purchases (paid in month of receipt) vs credit purchases
    const cashPurchases = zeros();
    const creditPurchases = zeros();
    const creditorSettlements = zeros();
    let creditorsCarried = 0;   // dues falling after March stay in closing creditors
    skuRuns.forEach((r) => {
      const p = input.supplierTerms[r.sku.source].map(pct);
      r.rows.forEach((row, m) => {
        cashPurchases[m] += row.supplierV * p[0];
        creditPurchases[m] += row.supplierV * (1 - p[0]);
        for (let k = 1; k < p.length; k++) {
          if (m + k < N) creditorSettlements[m + k] += row.supplierV * p[k];
          else creditorsCarried += row.supplierV * p[k];
        }
      });
    });
    op.creditorsDue.forEach((v, m) => { creditorSettlements[m] += v; });

    // Customer side: cash sales vs credit sales and collections
    const cashSales = sales.map((s) => s * P[0]);
    const creditSales = sales.map((s, m) => s - cashSales[m]);
    const collections = zeros();
    for (let m = 0; m < N; m++) {
      collections[m] += op.debtorsDue[m] || 0;
      for (let k = 1; k < P.length; k++) if (m - k >= 0) collections[m] += sales[m - k] * P[k];
    }

    // Debtors & creditors balances
    const openingDebtors = sum(op.debtorsDue);
    const openingCreditors = sum(op.creditorsDue);
    const debtors = [];
    const creditors = [];
    let dBal = openingDebtors;
    let cBal = openingCreditors;
    for (let m = 0; m < N; m++) {
      dBal += creditSales[m] - collections[m];
      cBal += creditPurchases[m] - creditorSettlements[m];
      debtors.push(dBal);
      creditors.push(cBal);
    }

    // Expenses
    const fixedRows = input.expenses.map((e) => ({ key: e.key, label: e.label, group: e.group, values: e.monthly.slice() }));
    const fixedTotal = zeros().map((_, m) => sum(fixedRows.map((r) => r.values[m])));
    const fa = op.fixedAssets;
    const depMonthly = Math.min(fa.gross * pct(fa.depRatePct) / 12, Math.max(0, fa.gross - fa.accDep) / N);
    const depreciation = zeros().map(() => depMonthly);

    // ---- Component 3a: cash budget ----
    const receipts = [
      { key: 'cashSales', label: 'Cash sales (prepaid + COD remitted in month)', values: cashSales },
      { key: 'collections', label: 'Collections from debtors', values: collections },
    ];
    const payments = [
      { key: 'cashPurchases', label: 'Suppliers paid on receipt (cash purchases)', values: cashPurchases },
      { key: 'creditorSettlements', label: 'Payments to creditors', values: creditorSettlements },
      { key: 'charges', label: 'Freight, insurance, customs duty & clearing', values: charges },
      { key: 'packDeliver', label: 'Packaging & last-mile delivery', values: packDeliver },
      { key: 'fees', label: 'Payment gateway & marketplace fees', values: fees },
      ...fixedRows.map((r) => ({ key: r.key, label: r.label, values: r.values })),
    ];
    const cb = cashBudget({ openingCash: op.cash, receipts, payments, minCash: g.minCash, odRatePct: g.odRatePct, openingOD: 0 });
    const interest = cb.months.map((x) => x.interest);
    const cash = cb.months.map((x) => x.closing);
    const od = cb.months.map((x) => x.odClosing);

    // ---- Monthly P&L ----
    const grossProfit = sales.map((s, m) => s - cogs[m]);
    const netProfit = grossProfit.map((gp, m) => gp - fixedTotal[m] - packDeliver[m] - fees[m] - depreciation[m] - interest[m]);

    // ---- Monthly balance sheets ----
    const faOpeningNet = fa.gross - fa.accDep;
    const capital = faOpeningNet + openingInv + openingDebtors + op.cash - openingCreditors;  // balancing figure
    const bs = [];
    let cumProfit = 0;
    let cumDep = 0;
    for (let m = 0; m < N; m++) {
      cumProfit += netProfit[m];
      cumDep += depreciation[m];
      const faNet = faOpeningNet - cumDep;
      const ca = closingInv[m] + debtors[m] + cash[m];
      const cl = creditors[m] + od[m];
      const totalAssets = faNet + ca;
      const totalLiab = capital + cumProfit + cl;
      bs.push({ faNet, inventory: closingInv[m], debtors: debtors[m], cash: cash[m], ca, creditors: creditors[m], od: od[m], cl,
        capital, profit: cumProfit, totalAssets, totalLiab, diff: totalAssets - totalLiab,
        currentRatio: currentRatio(ca, cl), quickRatio: quickRatio(ca, closingInv[m], cl) });
    }

    // ---- Component 1 results: working-capital days and CCC ----
    const Y = (a) => sum(a);
    const closeInvY = closingInv[N - 1];
    const closeDebY = debtors[N - 1];
    const closeCredY = creditors[N - 1];
    const mean13 = (open, arr) => (open + sum(arr)) / (N + 1);
    const days = (avgInv, avgDeb, avgCred) => {
      const dio = inventoryDays(avgInv, Y(cogs));
      const dso = debtorDays(avgDeb, Y(creditSales));
      const dpo = creditorDays(avgCred, Y(creditPurchases));
      return { avgInv, avgDeb, avgCred, itr: inventoryTurnover(Y(cogs), avgInv), dio, dso, dpo, ccc: cashConversionCycle(dio, dso, dpo) };
    };
    const ccc = {
      cogs: Y(cogs), creditSales: Y(creditSales), creditPurchases: Y(creditPurchases),
      openingInv, closeInv: closeInvY, openingDebtors, closeDebtors: closeDebY, openingCreditors, closeCreditors: closeCredY,
      textbook: days(average(openingInv, closeInvY), average(openingDebtors, closeDebY), average(openingCreditors, closeCredY)),
      monthlyAvg: days(mean13(openingInv, closingInv), mean13(openingDebtors, debtors), mean13(openingCreditors, creditors)),
    };

    // ---- Component 3b: journal -> ledger -> trial balance ----
    const journal = buildJournal({ input, sales, cashSales, creditSales, collections, purchases, cashPurchases, charges, creditPurchases,
      creditorSettlements, fixedRows, packDeliver, fees, depreciation, interest, cb, faOpeningNet, openingInv, openingDebtors, openingCreditors, capital });
    const ledger = buildLedger(journal);
    const trialBalance = buildTrialBalance(ledger);

    // ---- Final accounts for the year ----
    const expenseLines = [
      ...fixedRows.map((r) => ({ label: r.label, amount: Y(r.values) })),
      { label: 'Packaging & last-mile delivery', amount: Y(packDeliver) },
      { label: 'Payment gateway & marketplace fees', amount: Y(fees) },
      { label: 'Depreciation on fixed assets', amount: Y(depreciation) },
      { label: 'Interest on bank overdraft', amount: Y(interest) },
    ];
    const finalAccounts = {
      trading: { openingStock: openingInv, purchases: Y(purchases), sales: Y(sales), closingStock: closeInvY,
        cogs: openingInv + Y(purchases) - closeInvY, grossProfit: Y(sales) - (openingInv + Y(purchases) - closeInvY) },
      pl: { expenses: expenseLines, totalExpenses: sum(expenseLines.map((e) => e.amount)) },
      bs: bs[N - 1],
    };
    finalAccounts.pl.netProfit = finalAccounts.trading.grossProfit - finalAccounts.pl.totalExpenses;

    const yearEnd = bs[N - 1];
    const liquidity = {
      ca: yearEnd.ca, cl: yearEnd.cl, inventory: yearEnd.inventory,
      currentRatio: yearEnd.currentRatio, quickRatio: yearEnd.quickRatio, band: currentRatioBand(yearEnd.currentRatio),
      itr: ccc.textbook.itr, grossMarginPct: safeDiv(Y(grossProfit), Y(sales)) * 100, netMarginPct: safeDiv(Y(netProfit), Y(sales)) * 100,
    };

    // ---- Integrity checks shown on screen ----
    const checks = [
      { label: 'Trial Balance: total debits = total credits', ok: Math.abs(trialBalance.totalDr - trialBalance.totalCr) < 0.5,
        detail: `Dr ${trialBalance.totalDr.toFixed(2)} vs Cr ${trialBalance.totalCr.toFixed(2)}` },
      { label: 'Every journal entry balances (Dr = Cr)', ok: journal.every((j) => Math.abs(j.totalDr - j.totalCr) < 0.01),
        detail: `${journal.length} entries checked` },
      { label: 'Balance Sheet balances every month (Assets = Capital + Liabilities)', ok: bs.every((b) => Math.abs(b.diff) < 0.5),
        detail: `largest difference ₹${Math.max(...bs.map((b) => Math.abs(b.diff))).toFixed(4)}` },
      { label: 'Trading A/c COGS = sum of units sold x weighted-average cost', ok: Math.abs(finalAccounts.trading.cogs - Y(cogs)) < 0.5,
        detail: `${finalAccounts.trading.cogs.toFixed(2)} vs ${Y(cogs).toFixed(2)}` },
      { label: 'Net profit: Final accounts = sum of monthly P&L', ok: Math.abs(finalAccounts.pl.netProfit - Y(netProfit)) < 0.5,
        detail: `${finalAccounts.pl.netProfit.toFixed(2)} vs ${Y(netProfit).toFixed(2)}` },
      { label: 'Cash budget closing cash = Bank ledger balance', ok: Math.abs(cash[N - 1] - ledger.balance('Bank')) < 0.5,
        detail: `${cash[N - 1].toFixed(2)} vs ${ledger.balance('Bank').toFixed(2)}` },
      { label: 'No stock-outs (purchase budget meets every month\'s demand)', ok: skuRuns.every((r) => r.rows.every((x) => x.stockoutU === 0)),
        detail: 'demand fully served' },
    ];

    return {
      bulk, months: MONTHS, P, feeRate, skuRuns,
      monthly: { sales, cogs, grossProfit, netProfit, purchases, supplierV, charges, cashPurchases, creditPurchases, creditorSettlements,
        cashSales, creditSales, collections, debtors, creditors, closingInv, packDeliver, fees, fixedTotal, depreciation, interest, cash, od },
      cashBudget: cb, bs, capital, ccc, journal, ledger, trialBalance, finalAccounts, liquidity, checks, creditorsCarried,
      totals: { sales: Y(sales), cogs: Y(cogs), grossProfit: Y(grossProfit), netProfit: Y(netProfit), interest: Y(interest),
        purchases: Y(purchases), peakOD: Math.max(0, ...od), monthsInOD: od.filter((x) => x > 0.5).length,
        peakODMonth: od.indexOf(Math.max(...od)),
        monthsOverLimit: od.map((x, m) => (x > g.odLimit + 0.5 ? m : -1)).filter((m) => m >= 0),
        lowestBeforeFinancing: Math.min(...cb.months.map((x) => x.beforeFinancing)),
        lowestMonth: cb.months.reduce((best, x, i, arr) => (x.beforeFinancing < arr[best].beforeFinancing ? i : best), 0) },
    };
  }

  /* -------------------------------------------------------------
     Journal (Module 1: double entry, golden rules) — monthly summary
     entries using the periodic (Trading account) method taught in class.
     ------------------------------------------------------------- */
  function buildJournal(x) {
    const J = [];
    const add = (month, narration, lines) => {
      const clean = lines.filter((l) => (l.dr || 0) > 0.004 || (l.cr || 0) > 0.004);
      if (!clean.length) return;
      J.push({ month, narration, lines: clean, totalDr: sum(clean.map((l) => l.dr || 0)), totalCr: sum(clean.map((l) => l.cr || 0)) });
    };
    add(-1, 'Opening balances brought down (1 April)', [
      { acct: 'Fixed Assets (net)', dr: x.faOpeningNet },
      { acct: 'Opening Stock', dr: x.openingInv },
      { acct: 'Sundry Debtors', dr: x.openingDebtors },
      { acct: 'Bank', dr: x.input.opening.cash },
      { acct: 'Sundry Creditors', cr: x.openingCreditors },
      { acct: 'Capital', cr: x.capital },
    ]);
    for (let m = 0; m < N; m++) {
      add(m, 'Goods purchased at landed cost; import charges paid; balance on credit', [
        { acct: 'Purchases', dr: x.purchases[m] },
        { acct: 'Bank', cr: x.cashPurchases[m] + x.charges[m] },
        { acct: 'Sundry Creditors', cr: x.creditPurchases[m] },
      ]);
      add(m, 'Goods sold — prepaid/COD received, balance on credit', [
        { acct: 'Bank', dr: x.cashSales[m] },
        { acct: 'Sundry Debtors', dr: x.creditSales[m] },
        { acct: 'Sales', cr: x.sales[m] },
      ]);
      add(m, 'Cash received from debtors', [
        { acct: 'Bank', dr: x.collections[m] },
        { acct: 'Sundry Debtors', cr: x.collections[m] },
      ]);
      add(m, 'Payment made to creditors', [
        { acct: 'Sundry Creditors', dr: x.creditorSettlements[m] },
        { acct: 'Bank', cr: x.creditorSettlements[m] },
      ]);
      const expLines = [
        ...x.fixedRows.map((r) => ({ acct: r.label, dr: r.values[m] })),
        { acct: 'Packaging & last-mile delivery', dr: x.packDeliver[m] },
        { acct: 'Payment gateway & marketplace fees', dr: x.fees[m] },
      ];
      add(m, 'Operating expenses paid', [...expLines, { acct: 'Bank', cr: sum(expLines.map((l) => l.dr)) }]);
      add(m, 'Depreciation charged for the month', [
        { acct: 'Depreciation on fixed assets', dr: x.depreciation[m] },
        { acct: 'Fixed Assets (net)', cr: x.depreciation[m] },
      ]);
      add(m, 'Interest on bank overdraft paid', [
        { acct: 'Interest on bank overdraft', dr: x.interest[m] },
        { acct: 'Bank', cr: x.interest[m] },
      ]);
      const c = x.cb.months[m];
      add(m, 'Overdraft drawn to keep minimum cash balance', [
        { acct: 'Bank', dr: c.odDrawn },
        { acct: 'Bank Overdraft', cr: c.odDrawn },
      ]);
      add(m, 'Overdraft repaid from surplus cash', [
        { acct: 'Bank Overdraft', dr: c.odRepaid },
        { acct: 'Bank', cr: c.odRepaid },
      ]);
    }
    return J;
  }

  function buildLedger(journal) {
    const accounts = new Map();
    journal.forEach((j, idx) => j.lines.forEach((l) => {
      if (!accounts.has(l.acct)) accounts.set(l.acct, []);
      accounts.get(l.acct).push({ entry: idx, month: j.month, narration: j.narration, dr: l.dr || 0, cr: l.cr || 0 });
    }));
    const balance = (acct) => {
      const p = accounts.get(acct) || [];
      return sum(p.map((x) => x.dr)) - sum(p.map((x) => x.cr));
    };
    return { accounts, balance, names: [...accounts.keys()] };
  }

  function buildTrialBalance(ledger) {
    const rows = ledger.names.map((name) => {
      const b = ledger.balance(name);
      return { account: name, dr: b > 0.004 ? b : 0, cr: b < -0.004 ? -b : 0 };
    }).filter((r) => r.dr || r.cr);
    return { rows, totalDr: sum(rows.map((r) => r.dr)), totalCr: sum(rows.map((r) => r.cr)) };
  }

  /* -------------------------------------------------------------
     COMPONENT 2 — landed cost sheet per SKU in the class cost-sheet
     format, with warehouse / admin / marketing overheads apportioned.
     ------------------------------------------------------------- */
  function costSheets(input) {
    const g = input.global;
    const { feeRate } = blendedCollection(input.channels);
    const units = input.skus.map((s) => sum(s.demand));
    const salesValue = input.skus.map((s, i) => units[i] * s.sellPrice);
    const groupTotal = (grp) => sum(input.expenses.filter((e) => e.group === grp).map((e) => sum(e.monthly)));
    const fa = input.opening.fixedAssets;
    const depYear = Math.min(fa.gross * pct(fa.depRatePct), Math.max(0, fa.gross - fa.accDep));
    const pools = {
      warehouse: { label: 'Warehouse overheads', total: groupTotal('warehouse'),
        basis: g.warehouseBasis === 'units' ? 'Units handled' : 'Storage volume (units x m³ per unit)',
        weights: input.skus.map((s, i) => (g.warehouseBasis === 'units' ? units[i] : units[i] * s.cbmPerUnit)) },
      admin: { label: 'Administration overheads (incl. depreciation)', total: groupTotal('admin') + depYear,
        basis: 'Sales value', weights: salesValue },
      selling: { label: 'Fixed selling overheads (marketing)', total: groupTotal('selling'),
        basis: 'Sales value', weights: salesValue },
    };
    Object.values(pools).forEach((p) => {
      const W = sum(p.weights);
      p.shares = p.weights.map((w) => (W > 0 ? w / W : 0));
      p.amounts = p.shares.map((s) => s * p.total);
      p.perUnit = p.amounts.map((a, i) => (units[i] > 0 ? a / units[i] : 0));
    });

    const sheets = input.skus.map((s, i) => {
      const lc = landedCost(s, g, 0);
      const fee = s.sellPrice * feeRate;
      const wh = pools.warehouse.perUnit[i];
      const ad = pools.admin.perUnit[i];
      const mk = pools.selling.perUnit[i];
      const warehouseCost = lc.landed + wh;
      const readyCost = warehouseCost + ad;
      const varSelling = s.packagingPerUnit + s.deliveryPerUnit + fee;
      const costOfSales = readyCost + varSelling + mk;
      const profit = s.sellPrice - costOfSales;
      const variableCost = lc.landed + varSelling;
      const contribution = s.sellPrice - variableCost;
      return {
        sku: s, units: units[i], lc, fee, wh, ad, mk, warehouseCost, readyCost, varSelling, costOfSales, profit,
        profitPct: safeDiv(profit, s.sellPrice) * 100, variableCost, contribution, pvRatio: safeDiv(contribution, s.sellPrice) * 100,
      };
    });
    return { pools, sheets, units, salesValue, feeRate };
  }

  /* -------------------------------------------------------------
     The "twin": base plan vs festive bulk buy, side by side
     ------------------------------------------------------------- */
  function compare(input) {
    const base = run(input, { bulk: false });
    const bulk = run(input, { bulk: true });
    const F = input.festive;
    const unitsBulk = bulk.skuRuns.map((r) => r.rows[F.buyMonth].buyU);
    const saving = sum(bulk.skuRuns.map((r, i) => unitsBulk[i] * (r.lcStd.landed - r.lcBulk.landed)));
    const firstODMonth = (res) => res.monthly.od.findIndex((x) => x > 0.5);
    return {
      base, bulk, unitsBulk, purchaseSaving: saving,
      firstODBase: firstODMonth(base), firstODBulk: firstODMonth(bulk),
      monthsAfterOrder: firstODMonth(bulk) >= 0 ? firstODMonth(bulk) - F.buyMonth : null,
    };
  }

  /* -------------------------------------------------------------
     Textbook / class-slide verification cases.
     Each step is computed by the SAME functions the twin uses and
     compared with the hand-solved answer.
     ------------------------------------------------------------- */
  function verifications() {
    const cases = [];
    const close = (a, b, tol) => a !== null && Math.abs(a - b) <= tol;
    const mk = (id, title, source, given, steps) => cases.push({ id, title, source, given, steps, pass: steps.every((s) => s.pass) });
    const step = (label, formula, value, expected, tol = 0.01) => ({ label, formula, value, expected, pass: close(value, expected, tol) });

    // 1. Inventory turnover — Module 2 slide 47
    {
      const salesV = 3000000, gm = 600000, avgInv = 300000;
      const cogs = salesV - gm;
      const itr = inventoryTurnover(cogs, avgInv);
      mk('V1', 'Inventory Turnover Ratio', 'Module 2 (Financial Accounting), slide 47 — class exercise',
        'Sales ₹30,00,000; Gross margin ₹6,00,000; Average inventory ₹3,00,000',
        [step('COGS', 'Sales − Gross margin = 30,00,000 − 6,00,000', cogs, 2400000),
         step('Inventory turnover', 'COGS ÷ Average inventory = 24,00,000 ÷ 3,00,000', itr, 8),
         step('Average days in inventory', '365 ÷ 8', inventoryDays(avgInv, cogs), 45.6, 0.05)]);
    }
    // 2. Current ratio — Module 2 slide 45
    {
      const cr = currentRatio(110000, 60000);
      mk('V2', 'Current Ratio', 'Module 2 (Financial Accounting), slide 45 — class exercise',
        'Total current assets ₹1,10,000; Total current liabilities ₹60,000',
        [step('Current ratio', 'CA ÷ CL = 1,10,000 ÷ 60,000', cr, 1.83, 0.005)]);
    }
    // 3. Purchase (production) budget + material budget — Module 5 slide 21
    {
      const prod = requiredPurchases(50000, 12000, 8000);
      const kgNeed = prod * 2;
      const kgBuy = requiredPurchases(kgNeed, 10000, 15000);
      mk('V3', 'Production & Material Purchase Budget', 'Module 5 (Budgetary Control), slide 21 — class exercise',
        'Sales 50,000 units; opening FG 8,000; desired closing FG 12,000; 2 kg per unit @ ₹150/kg; RM safety stock 10,000 kg; RM opening 15,000 kg',
        [step('Required production (units)', 'Sales + Closing − Opening = 50,000 + 12,000 − 8,000', prod, 54000),
         step('Material needed for production (kg)', '54,000 × 2 kg', kgNeed, 108000),
         step('Material to purchase (kg)', 'Need + Closing − Opening = 1,08,000 + 10,000 − 15,000', kgBuy, 103000),
         step('Material purchase value (₹)', '1,03,000 kg × ₹150', kgBuy * 150, 15450000),
         step('Labour hours / value (₹)', '54,000 × 1.5 h = 81,000 h × ₹200', prod * 1.5 * 200, 16200000)]);
    }
    // 4. Cash budget — Apex Traders format (Module 5 slide 22), figures set by the team
    {
      const cb = cashBudget({
        openingCash: 30000,
        receipts: [{ label: 'Collections (previous month sales)', values: [60000, 70000, 80000] }],
        payments: [{ label: 'Suppliers (previous month purchases)', values: [40000, 45000, 50000] },
                   { label: 'Office expenses (same month)', values: [10000, 12000, 11000] }],
        minCash: 0,
      });
      mk('V4', 'Cash Budget (April–June)', 'Module 5 slide 22 format (Apex Traders): credit sales collected and purchases paid one month later; our figures',
        'Opening cash ₹30,000. Sales: Mar 60,000, Apr 70,000, May 80,000. Purchases: Mar 40,000, Apr 45,000, May 50,000. Expenses: Apr 10,000, May 12,000, Jun 11,000',
        [step('April closing cash', '30,000 + 60,000 − (40,000 + 10,000)', cb.months[0].closing, 40000),
         step('May closing cash', '40,000 + 70,000 − (45,000 + 12,000)', cb.months[1].closing, 53000),
         step('June closing cash', '53,000 + 80,000 − (50,000 + 11,000)', cb.months[2].closing, 72000)]);
    }
    // 5. Cash Conversion Cycle — textbook-style problem (team set, hand solved)
    {
      const cogs = 2920000, creditSales = 3650000, creditPurch = 3000000;
      const avgInv = average(360000, 440000), avgDeb = average(250000, 350000), avgCred = average(220000, 280000);
      const dio = inventoryDays(avgInv, cogs), dso = debtorDays(avgDeb, creditSales), dpo = creditorDays(avgCred, creditPurch);
      mk('V5', 'Cash Conversion Cycle', 'Module 1 (CCC) + Module 2 (activity ratios) — textbook-style problem, solved by hand',
        'Credit sales ₹36,50,000; COGS ₹29,20,000; credit purchases ₹30,00,000; Inventory 3,60,000 → 4,40,000; Debtors 2,50,000 → 3,50,000; Creditors 2,20,000 → 2,80,000',
        [step('Inventory turnover', '29,20,000 ÷ 4,00,000', inventoryTurnover(cogs, avgInv), 7.3),
         step('Inventory days (DIO)', '365 ÷ 7.3', dio, 50),
         step('Debtor days (DSO)', '3,00,000 ÷ 36,50,000 × 365', dso, 30),
         step('Creditor days (DPO)', '2,50,000 ÷ 30,00,000 × 365', dpo, 30.42),
         step('Cash Conversion Cycle', '50 + 30 − 30.42', cashConversionCycle(dio, dso, dpo), 49.58)]);
    }
    // 6. Landed cost of an imported sneaker — team problem, hand solved
    {
      const lc = landedCost({ currency: 'USD', purchasePrice: 15, freightPerUnit: 90, insurancePct: 1.125, bcdPct: 35, swsPct: 10,
        clearingPerUnit: 30, inlandFreightPerUnit: 20 }, { fxRate: 84 });
      mk('V6', 'Landed Cost per Unit (imported)', 'Module 3 cost elements applied to an import — team problem, solved by hand',
        'FOB $15 @ ₹84/$; ocean freight ₹90; insurance 1.125% of (FOB + freight); BCD 35%; SWS 10% of BCD; clearing ₹30; inland freight ₹20',
        [step('Purchase price in ₹', '15 × 84', lc.priceINR, 1260),
         step('Insurance', '1.125% × (1,260 + 90)', lc.insurance, 15.19, 0.01),
         step('Assessable value (CIF)', '1,260 + 90 + 15.19', lc.assessable, 1365.19, 0.01),
         step('Basic customs duty', '35% × 1,365.19', lc.bcd, 477.82, 0.01),
         step('Social welfare surcharge', '10% × 477.82', lc.sws, 47.78, 0.01),
         step('Landed cost per unit', '1,365.19 + 477.82 + 47.78 + 30 + 20', lc.landed, 1940.78, 0.01)]);
    }
    return cases;
  }

  return {
    N, DAYS, MONTHS, sum,
    average, inventoryTurnover, inventoryDays, debtorDays, creditorDays, cashConversionCycle,
    currentRatio, quickRatio, currentRatioBand, requiredPurchases,
    landedCost, cashBudget, validate, run, costSheets, compare, verifications, blendedCollection,
  };
});
