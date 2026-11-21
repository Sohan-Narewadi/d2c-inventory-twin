/* =====================================================================
   D2C Inventory Twin — user interface
   Reads inputs, calls the pure Engine, and renders every working step.
   ===================================================================== */
(function () {
  'use strict';
  const E = window.Engine;
  const M = E.MONTHS;
  const STORE_KEY = 'd2c-inventory-twin:input:v1';

  /* ---------------- state ---------------- */
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let input = loadInput();
  let plan = 'base';
  let tab = 'dashboard';
  let R = null;                 // { val, cmp, cs }
  let inputsRendered = false;
  let resetArmed = false;
  const charts = {};
  const ui = { flowSku: 0, costSku: 0, ledgerAcct: 'Bank', journalMonth: 'all' };

  function loadInput() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.skus && parsed.global && parsed.channels) return parsed;
      }
    } catch (e) { /* storage blocked: fall back to sample */ }
    return clone(window.SAMPLE_INPUT);
  }
  function saveInput() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(input)); } catch (e) { /* ignore */ }
  }

  /* ---------------- formatting ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function inr(v, dp = 0) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const tiny = 0.5 * Math.pow(10, -dp);
    const s = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return v < -tiny ? `(${s})` : s;
  }
  const rs = (v, dp = 0) => (v === null || !isFinite(v) ? '—' : `₹${inr(v, dp)}`);
  function short(v) {
    if (v === null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    const sign = v < 0 ? '−' : '';
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
    return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
  }
  const num = (v, dp = 2) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const td = (v, dp = 0, cls = '') => `<td class="${v !== null && v < -0.5 * Math.pow(10, -dp) ? 'neg ' : ''}${cls}">${inr(v, dp)}</td>`;
  const sum = E.sum;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const planName = (p) => (p === 'bulk' ? 'Festive bulk buy' : 'Base: buy monthly');
  const pill = (p) => `<span class="pill ${p}">${planName(p)}</span>`;

  /* ---------------- compute ---------------- */
  function recompute() {
    const val = E.validate(input);
    showBanners(val);
    if (!val.ok) { R = R ? { ...R, val } : { val }; return; }
    R = { val, cmp: E.compare(input), cs: E.costSheets(input) };
  }
  const cur = () => (plan === 'bulk' ? R.cmp.bulk : R.cmp.base);

  function showBanners(val) {
    const eb = document.getElementById('errorBanner');
    const wb = document.getElementById('warnBanner');
    if (val.errors.length) {
      eb.hidden = false;
      eb.innerHTML = `<b>Fix these inputs (results are paused until they are valid):</b><ul>${val.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
    } else eb.hidden = true;
    if (val.warnings.length) {
      wb.hidden = false;
      wb.innerHTML = `<b>Check:</b><ul>${val.warnings.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
    } else wb.hidden = true;
  }

  /* ---------------- charts ---------------- */
  function chart(id, config) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    const text = css('--muted');
    const grid = css('--line');
    Chart.defaults.color = text;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    config.options = config.options || {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    config.options.interaction = { mode: 'index', intersect: false };
    const scales = config.options.scales || {};
    Object.values(scales).forEach((s) => { s.grid = Object.assign({ color: grid }, s.grid || {}); });
    charts[id] = new Chart(el, config);
  }
  const lakhTicks = { callback: (v) => short(v) };
  const tooltipINR = { callbacks: { label: (c) => `${c.dataset.label}: ${short(c.parsed.y)}` } };

  /* ---------------- tabs ---------------- */
  function showTab(name) {
    if (!document.getElementById(`tab-${name}`)) name = 'dashboard';
    tab = name;
    document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${name}`; });
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
    renderCurrent();
  }
  function renderCurrent() {
    if (tab === 'inputs') { if (!inputsRendered) renderInputs(); return; }
    const host = document.getElementById(`tab-${tab}`);
    if (!R || !R.cmp) {
      host.innerHTML = '<div class="card"><h3>Results paused</h3><p class="muted">Some inputs are invalid. Open the <a href="#inputs">Inputs</a> tab and fix the items listed in the red box above.</p></div>';
      return;
    }
    ({ dashboard: renderDashboard, flow: renderFlow, cost: renderCost, cash: renderCash, twin: renderTwin, checks: renderChecks })[tab]();
  }

  /* =================================================================
     DASHBOARD
     ================================================================= */
  function renderDashboard() {
    const res = cur();
    const t = res.totals;
    const c = res.ccc.textbook;
    const cm = res.ccc.monthlyAvg;
    const L = res.liquidity;
    const lim = input.global.odLimit;
    const cs = R.cs.sheets;
    const best = cs.reduce((a, b) => (b.profitPct > a.profitPct ? b : a));
    const worst = cs.reduce((a, b) => (b.profitPct < a.profitPct ? b : a));
    const cmp = R.cmp;
    const host = document.getElementById('tab-dashboard');
    host.innerHTML = `
      <div class="section-head">
        <div><h2>Dashboard</h2><p class="muted">${esc(input.company.name)} · ${esc(input.company.period)} · showing ${pill(plan)}</p></div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="k">Sales for the year</div><div class="v">${short(t.sales)}</div><div class="d">${inr(sum(res.skuRuns.map((r) => sum(r.rows.map((x) => x.soldU)))))} units</div></div>
        <div class="kpi"><div class="k">Gross profit</div><div class="v">${short(t.grossProfit)}</div><div class="d">${num(L.grossMarginPct, 1)}% gross margin</div></div>
        <div class="kpi"><div class="k">Net profit</div><div class="v ${t.netProfit < 0 ? 'bad-t' : ''}">${short(t.netProfit)}</div><div class="d">${num(L.netMarginPct, 1)}% net margin</div></div>
        <div class="kpi"><div class="k">Cash Conversion Cycle</div><div class="v">${num(c.ccc, 1)} days</div><div class="d">${num(cm.ccc, 1)} days on monthly averages</div></div>
        <div class="kpi"><div class="k">Inventory turnover</div><div class="v">${num(c.itr, 2)}×</div><div class="d">${num(c.dio, 1)} days of stock</div></div>
        <div class="kpi"><div class="k">Current ratio (31 Mar)</div><div class="v tone-${L.band.tone}">${L.currentRatio === null ? '—' : num(L.currentRatio, 2)}</div><div class="d">${esc(L.band.text)}</div></div>
        <div class="kpi"><div class="k">Peak overdraft</div><div class="v ${t.peakOD > lim ? 'bad-t' : ''}">${short(t.peakOD)}</div><div class="d">limit ${short(lim)}${t.peakOD > 0.5 ? ` · peak in ${M[t.peakODMonth]}` : ''}</div></div>
        <div class="kpi"><div class="k">Closing cash (31 Mar)</div><div class="v">${short(res.monthly.cash[11])}</div><div class="d">min. balance ${short(input.global.minCash)}</div></div>
      </div>

      <div class="card">
        <h3>How the three components feed each other</h3>
        <div class="pipeline">
          <div class="stage">
            <h4><span class="n">1</span>Order flow → CCC</h4>
            <ul>
              <li>Purchase budget: ${inr(sum(res.monthly.purchases))} worth of stock bought at landed cost</li>
              <li>Inventory ${num(c.dio, 1)} d + Debtors ${num(c.dso, 1)} d − Creditors ${num(c.dpo, 1)} d</li>
              <li><b>CCC = ${num(c.ccc, 1)} days</b></li>
            </ul>
            <div class="mods">M1 CCC · M2 activity ratios · M5 purchase budget</div>
          </div>
          <div class="stage">
            <h4><span class="n">2</span>Landed cost sheet</h4>
            <ul>
              <li>${esc(cs[0].sku.code)} landed cost ${rs(cs[0].lc.landed, 2)} per unit</li>
              <li>Best: ${esc(best.sku.code)} ${num(best.profitPct, 1)}% profit on price</li>
              <li>Weakest: ${esc(worst.sku.code)} ${num(worst.profitPct, 1)}% after full overheads</li>
            </ul>
            <div class="mods">M3 cost sheet · allocation &amp; apportionment</div>
          </div>
          <div class="stage">
            <h4><span class="n">3</span>Cash budget → ratios</h4>
            <ul>
              <li>Lowest cash before financing: ${short(t.lowestBeforeFinancing)} in ${M[t.lowestMonth]}</li>
              <li>Overdraft months: ${t.monthsInOD}${t.monthsOverLimit.length ? ` · <span class="bad-t">over limit in ${t.monthsOverLimit.map((m) => M[m]).join(', ')}</span>` : ''}</li>
              <li>Current ratio ${num(L.currentRatio, 2)} · Quick ratio ${num(L.quickRatio, 2)}</li>
            </ul>
            <div class="mods">M5 cash budget · M1 journal · M2 final accounts &amp; ratios</div>
          </div>
        </div>
      </div>

      <div class="grid two">
        <div class="card">
          <h3>Sales, net profit and net cash position by month</h3>
          <div class="chart-box"><canvas id="ch-dash"></canvas></div>
          <p class="small muted">Net cash position = closing cash − overdraft. It dips when stock is paid for before festive sales are collected.</p>
        </div>
        <div class="card">
          <h3>Integrity checks ${pill(plan)}</h3>
          ${res.checks.map((k) => `<div class="check"><span class="ic ${k.ok ? 'ok' : 'no'}">${k.ok ? '✓' : '✗'}</span><div><div>${esc(k.label)}</div><div class="small muted">${esc(k.detail)}</div></div></div>`).join('')}
          <div class="insight">
            <b>Festive twin:</b> buying Oct–Dec stock in ${M[input.festive.buyMonth]} saves ${short(cmp.purchaseSaving)} on purchase cost,
            but the overdraft peaks at ${short(cmp.bulk.totals.peakOD)} against a ${short(lim)} limit.
            <a href="#twin">See the comparison →</a>
          </div>
        </div>
      </div>`;
    chart('ch-dash', {
      data: {
        labels: M,
        datasets: [
          { type: 'bar', label: 'Sales', data: res.monthly.sales, backgroundColor: css('--base') + '99', order: 2 },
          { type: 'bar', label: 'Net profit', data: res.monthly.netProfit, backgroundColor: css('--good') + 'cc', order: 2 },
          { type: 'line', label: 'Net cash position', data: res.monthly.cash.map((x, m) => x - res.monthly.od[m]), borderColor: css('--bulk'), backgroundColor: css('--bulk'), tension: 0.25, order: 1 },
        ],
      },
      options: { scales: { y: { ticks: lakhTicks } }, plugins: { tooltip: tooltipINR } },
    });
  }

  /* =================================================================
     INPUTS
     ================================================================= */
  const nIn = (path, value, step = 'any') => `<input type="number" step="${step}" data-path="${path}" value="${value}">`;
  const tIn = (path, value) => `<input type="text" data-path="${path}" value="${esc(value)}">`;
  const sIn = (path, value, options) => `<select data-path="${path}">${options.map((o) => `<option value="${o[0]}" ${o[0] === value ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  const monthOpts = M.map((m, i) => [String(i), m]);

  function renderInputs() {
    inputsRendered = true;
    const g = input.global;
    const op = input.opening;
    const host = document.getElementById('tab-inputs');
    host.innerHTML = `
      <div class="section-head">
        <div><h2>Inputs</h2><p class="muted">Every figure below drives the twin. Changes recalculate everything immediately and are saved in this browser.</p></div>
        <div class="toolbar">
          <button class="btn" id="btnAddSku" type="button">+ Add SKU</button>
          <button class="btn" id="btnExport" type="button">Export inputs (JSON)</button>
          <label class="btn" for="fileImport">Import inputs (JSON)</label>
          <input type="file" id="fileImport" accept="application/json,.json" hidden>
          <button class="btn" id="btnReset" type="button">Reset to sample data</button>
        </div>
      </div>

      <div class="card">
        <h3>Company and policies</h3>
        <div class="fields">
          <div class="field"><label>Company</label><input type="text" data-path="company.name" value="${esc(input.company.name)}"></div>
          <div class="field"><label>Period</label><input type="text" data-path="company.period" value="${esc(input.company.period)}"></div>
          <div class="field"><label>Exchange rate (₹ per US$)</label>${nIn('global.fxRate', g.fxRate)}</div>
          <div class="field"><label>Stock cover policy (months of next month's demand)</label>${nIn('global.coverMonths', g.coverMonths, '0.25')}</div>
          <div class="field"><label>Minimum cash balance (₹)</label>${nIn('global.minCash', g.minCash, '10000')}</div>
          <div class="field"><label>Overdraft interest (% p.a.)</label>${nIn('global.odRatePct', g.odRatePct, '0.25')}</div>
          <div class="field"><label>Sanctioned overdraft limit (₹)</label>${nIn('global.odLimit', g.odLimit, '100000')}</div>
          <div class="field"><label>Warehouse overhead apportionment basis</label>${sIn('global.warehouseBasis', g.warehouseBasis, [['volume', 'Storage volume (m³)'], ['units', 'Units handled']])}</div>
        </div>
      </div>

      <div class="card">
        <h3>SKUs: purchase terms, landed cost elements and selling price</h3>
        <div class="table-wrap"><table class="inp-table">
          <thead><tr><th>Code</th><th class="l">Name</th><th class="l">Source</th><th class="l">Currency</th><th>Purchase price</th><th>Freight / unit ₹</th><th>Insurance %</th><th>BCD %</th><th>SWS % of BCD</th><th>Clearing / unit ₹</th><th>Inland freight ₹</th><th>Selling price ₹</th><th>Packaging ₹</th><th>Delivery ₹</th><th>m³ / unit</th><th>Opening units</th><th></th></tr></thead>
          <tbody>${input.skus.map((s, i) => `<tr>
            <td>${tIn(`skus.${i}.code`, s.code)}</td><td>${tIn(`skus.${i}.name`, s.name)}</td>
            <td>${sIn(`skus.${i}.source`, s.source, [['Import', 'Import'], ['Domestic', 'Domestic']])}</td>
            <td>${sIn(`skus.${i}.currency`, s.currency, [['USD', 'US$'], ['INR', '₹']])}</td>
            <td>${nIn(`skus.${i}.purchasePrice`, s.purchasePrice)}</td><td>${nIn(`skus.${i}.freightPerUnit`, s.freightPerUnit)}</td>
            <td>${nIn(`skus.${i}.insurancePct`, s.insurancePct)}</td><td>${nIn(`skus.${i}.bcdPct`, s.bcdPct)}</td><td>${nIn(`skus.${i}.swsPct`, s.swsPct)}</td>
            <td>${nIn(`skus.${i}.clearingPerUnit`, s.clearingPerUnit)}</td><td>${nIn(`skus.${i}.inlandFreightPerUnit`, s.inlandFreightPerUnit)}</td>
            <td>${nIn(`skus.${i}.sellPrice`, s.sellPrice)}</td><td>${nIn(`skus.${i}.packagingPerUnit`, s.packagingPerUnit)}</td><td>${nIn(`skus.${i}.deliveryPerUnit`, s.deliveryPerUnit)}</td>
            <td>${nIn(`skus.${i}.cbmPerUnit`, s.cbmPerUnit, '0.0005')}</td><td>${nIn(`skus.${i}.openingUnits`, s.openingUnits, '1')}</td>
            <td><button class="btn small" type="button" data-remove-sku="${i}" title="Remove SKU" ${input.skus.length < 2 ? 'disabled' : ''}>✕</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="small muted">Insurance is on (price + freight). Assessable value for customs = CIF. BCD = Basic Customs Duty; SWS = Social Welfare Surcharge (charged on BCD). Set duty fields to 0 for domestic goods.</p>
      </div>

      <div class="card">
        <h3>Monthly demand forecast (units) = sales budget</h3>
        <div class="table-wrap"><table class="inp-table">
          <thead><tr><th>SKU</th>${M.map((m) => `<th>${m}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>${input.skus.map((s, i) => `<tr><td>${esc(s.code)}</td>${s.demand.map((d, m) => `<td>${nIn(`skus.${i}.demand.${m}`, d, '1')}</td>`).join('')}<td>${inr(sum(s.demand))}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="grid two">
        <div class="card">
          <h3>Sales channels and collection pattern</h3>
          <div class="table-wrap"><table class="inp-table">
            <thead><tr><th>Channel</th><th>Share %</th><th>% in month</th><th>% after 1 m</th><th>% after 2 m</th><th>Fee % of price</th></tr></thead>
            <tbody>${input.channels.map((c, i) => `<tr><td>${tIn(`channels.${i}.name`, c.name)}</td><td>${nIn(`channels.${i}.sharePct`, c.sharePct)}</td>
              ${c.profilePct.map((p, k) => `<td>${nIn(`channels.${i}.profilePct.${k}`, p)}</td>`).join('')}<td>${nIn(`channels.${i}.feePct`, c.feePct)}</td></tr>`).join('')}</tbody>
          </table></div>
          <p class="small muted">The share-weighted pattern decides cash sales (collected in the month) and credit sales (go to debtors).</p>
        </div>
        <div class="card">
          <h3>Supplier payment pattern (goods value)</h3>
          <div class="table-wrap"><table class="inp-table">
            <thead><tr><th>Supplier type</th><th>% in month of receipt</th><th>% after 1 m</th><th>% after 2 m</th></tr></thead>
            <tbody>${Object.keys(input.supplierTerms).map((k) => `<tr><td>${esc(k)}</td>${input.supplierTerms[k].map((p, j) => `<td>${nIn(`supplierTerms.${k}.${j}`, p)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <p class="small muted">Freight, insurance, customs duty and clearing are paid in cash in the month the goods arrive.</p>
          <h4>Opening position (1 April)</h4>
          <div class="fields">
            <div class="field"><label>Cash at bank (₹)</label>${nIn('opening.cash', op.cash)}</div>
            <div class="field"><label>Debtors collected in Apr (₹)</label>${nIn('opening.debtorsDue.0', op.debtorsDue[0])}</div>
            <div class="field"><label>Debtors collected in May (₹)</label>${nIn('opening.debtorsDue.1', op.debtorsDue[1])}</div>
            <div class="field"><label>Creditors paid in Apr (₹)</label>${nIn('opening.creditorsDue.0', op.creditorsDue[0])}</div>
            <div class="field"><label>Creditors paid in May (₹)</label>${nIn('opening.creditorsDue.1', op.creditorsDue[1])}</div>
            <div class="field"><label>Fixed assets: gross block (₹)</label>${nIn('opening.fixedAssets.gross', op.fixedAssets.gross)}</div>
            <div class="field"><label>Accumulated depreciation (₹)</label>${nIn('opening.fixedAssets.accDep', op.fixedAssets.accDep)}</div>
            <div class="field"><label>Depreciation (SLM % p.a. on gross)</label>${nIn('opening.fixedAssets.depRatePct', op.fixedAssets.depRatePct)}</div>
          </div>
          <p class="small muted">Opening stock = opening units × landed cost. Capital is the balancing figure of the opening Balance Sheet.</p>
        </div>
      </div>

      <div class="card">
        <h3>Fixed operating expenses (₹ per month, paid in the same month)</h3>
        <div class="table-wrap"><table class="inp-table">
          <thead><tr><th>Expense</th><th class="l">Cost-sheet group</th>${M.map((m) => `<th>${m}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>${input.expenses.map((e, i) => `<tr><td>${tIn(`expenses.${i}.label`, e.label)}</td>
            <td>${sIn(`expenses.${i}.group`, e.group, [['warehouse', 'Warehouse'], ['admin', 'Administration'], ['selling', 'Selling (fixed)']])}</td>
            ${e.monthly.map((v, m) => `<td>${nIn(`expenses.${i}.monthly.${m}`, v, '1000')}</td>`).join('')}<td>${inr(sum(e.monthly))}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="card">
        <h3>Festive bulk-buy scenario</h3>
        <div class="fields">
          <div class="field"><label>Bulk order placed and received in</label>${sIn('festive.buyMonth', String(input.festive.buyMonth), monthOpts)}</div>
          <div class="field"><label>Stock covers sales up to</label>${sIn('festive.coverToMonth', String(input.festive.coverToMonth), monthOpts)}</div>
          <div class="field"><label>Volume discount on supplier price (%)</label>${nIn('festive.discountPct', input.festive.discountPct, '0.5')}</div>
        </div>
      </div>`;
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  }
  const INT_PATHS = /^(festive\.(buyMonth|coverToMonth))$/;

  function onFieldChange(el) {
    const path = el.dataset.path;
    if (!path) return;
    let val;
    if (el.type === 'number') {
      val = el.value.trim() === '' ? NaN : Number(el.value);
      el.classList.toggle('invalid', !isFinite(val));
    } else if (INT_PATHS.test(path)) {
      val = parseInt(el.value, 10);
    } else val = el.value;
    setPath(input, path, val);
    saveInput();
    recompute();
    if (tab !== 'inputs') inputsRendered = false;
    else refreshInputTotals();
    if (tab !== 'inputs') renderCurrent();
    updateHeader();
  }
  function refreshInputTotals() {
    // light refresh of row totals on the inputs page without stealing focus
    const host = document.getElementById('tab-inputs');
    host.querySelectorAll('table').forEach((tbl) => {
      tbl.querySelectorAll('tbody tr').forEach((tr) => {
        const inputs = [...tr.querySelectorAll('input[type=number]')];
        const last = tr.lastElementChild;
        if (!last || last.querySelector('input,button')) return;
        const vals = inputs.filter((i) => /\.(demand|monthly)\.\d+$/.test(i.dataset.path)).map((i) => Number(i.value) || 0);
        if (vals.length === 12) last.textContent = inr(sum(vals));
      });
    });
  }

  /* =================================================================
     COMPONENT 1 — ORDER FLOW & CCC
     ================================================================= */
  function renderFlow() {
    const res = cur();
    const i = Math.min(ui.flowSku, res.skuRuns.length - 1);
    const sr = res.skuRuns[i];
    const mo = res.monthly;
    const c = res.ccc;
    const P = res.P;
    const host = document.getElementById('tab-flow');
    const T = c.textbook;
    const A = c.monthlyAvg;
    const totalRow = (rows, f) => sum(rows.map(f));

    host.innerHTML = `
      <div class="section-head">
        <div><h2>Component 1: order flow → inventory, debtor and creditor days → Cash Conversion Cycle</h2>
        <p class="muted">Purchase orders come from the purchase budget; sales orders come from demand. ${pill(plan)}</p></div>
      </div>

      <div class="card">
        <div class="section-head"><h3>Purchase budget and stock ledger (weighted-average cost)</h3>
          <div class="toolbar"><label class="small muted" for="selFlowSku">SKU</label>
          <select id="selFlowSku">${res.skuRuns.map((r, k) => `<option value="${k}" ${k === i ? 'selected' : ''}>${esc(r.sku.code)} — ${esc(r.sku.name)}</option>`).join('')}</select></div>
        </div>
        <div class="formula">
          <b>Purchases</b> = Sales (demand) + Desired closing stock − Opening stock &nbsp; (Module 5 purchase budget)<br>
          <b>Desired closing stock</b> = ${input.global.coverMonths} × next month's demand${plan === 'bulk' ? ` · in the bulk plan, stock bought in ${M[input.festive.buyMonth]} covers sales up to ${M[input.festive.coverToMonth]}` : ''}<br>
          <b>Weighted-average cost</b> = (Opening value + Purchase value) ÷ (Opening units + Purchases) &nbsp; · &nbsp; <b>COGS</b> = Units sold × weighted-average cost
        </div>
        <div class="table-wrap" style="margin-top:10px"><table>
          <thead><tr><th>Month</th><th>Opening units</th><th>Sales units</th><th>Desired closing</th><th>Purchases (units)</th><th>Landed cost / unit</th><th>Purchase value</th><th>Wtd. avg cost</th><th>COGS</th><th>Closing units</th><th>Closing stock value</th></tr></thead>
          <tbody>${sr.rows.map((r) => `<tr>
            <td>${M[r.month]}</td>${td(r.openU)}${td(r.demand)}${td(r.closingTarget)}
            ${td(r.buyU, 0, r.isBulkBuy ? 'bulkcell' : '')}${td(r.unitLanded, 2, r.isBulkBuy ? 'bulkcell' : '')}${td(r.buyV)}${td(r.avgCost, 2)}${td(r.cogs)}${td(r.closeU)}${td(r.closeV)}</tr>`).join('')}
            <tr class="total"><td>Total</td><td></td>${td(totalRow(sr.rows, (r) => r.demand))}<td></td>${td(totalRow(sr.rows, (r) => r.buyU))}<td></td>${td(totalRow(sr.rows, (r) => r.buyV))}<td></td>${td(totalRow(sr.rows, (r) => r.cogs))}<td></td><td></td></tr>
          </tbody></table></div>
        ${plan === 'bulk' ? `<p class="small muted">Highlighted: the bulk order at ${num(input.festive.discountPct, 1)}% off the supplier price, which lowers the landed cost per unit.</p>` : ''}
      </div>

      <div class="grid two">
        <div class="card">
          <h3>Debtors schedule (sales orders → cash)</h3>
          <div class="formula">Share-weighted collection pattern: <b>${num(P[0] * 100, 1)}%</b> in month of sale (cash sales) · <b>${num(P[1] * 100, 1)}%</b> after 1 month · <b>${num(P[2] * 100, 1)}%</b> after 2 months<br>
          <b>Closing debtors</b> = Opening + Credit sales − Collections</div>
          <div class="table-wrap" style="margin-top:10px"><table>
            <thead><tr><th>Month</th><th>Sales</th><th>Cash sales</th><th>Credit sales</th><th>Collections</th><th>Closing debtors</th></tr></thead>
            <tbody><tr class="sub"><td>Opening</td><td></td><td></td><td></td><td></td>${td(c.openingDebtors)}</tr>
            ${M.map((m, k) => `<tr><td>${m}</td>${td(mo.sales[k])}${td(mo.cashSales[k])}${td(mo.creditSales[k])}${td(mo.collections[k])}${td(mo.debtors[k])}</tr>`).join('')}
            <tr class="total"><td>Total</td>${td(sum(mo.sales))}${td(sum(mo.cashSales))}${td(sum(mo.creditSales))}${td(sum(mo.collections))}<td></td></tr></tbody></table></div>
        </div>
        <div class="card">
          <h3>Creditors schedule (purchase orders → cash)</h3>
          <div class="formula">Import: ${input.supplierTerms.Import.join('/')}% · Domestic: ${input.supplierTerms.Domestic.join('/')}% (month of receipt / +1 / +2)<br>
          <b>Closing creditors</b> = Opening + Credit purchases − Payments to creditors</div>
          <div class="table-wrap" style="margin-top:10px"><table>
            <thead><tr><th>Month</th><th>Supplier value</th><th>Paid on receipt</th><th>Credit purchases</th><th>Paid to creditors</th><th>Closing creditors</th></tr></thead>
            <tbody><tr class="sub"><td>Opening</td><td></td><td></td><td></td><td></td>${td(c.openingCreditors)}</tr>
            ${M.map((m, k) => `<tr><td>${m}</td>${td(mo.supplierV[k])}${td(mo.cashPurchases[k])}${td(mo.creditPurchases[k])}${td(mo.creditorSettlements[k])}${td(mo.creditors[k])}</tr>`).join('')}
            <tr class="total"><td>Total</td>${td(sum(mo.supplierV))}${td(sum(mo.cashPurchases))}${td(sum(mo.creditPurchases))}${td(sum(mo.creditorSettlements))}<td></td></tr></tbody></table></div>
        </div>
      </div>

      <div class="card">
        <h3>Inventory, debtor and creditor days → Cash Conversion Cycle</h3>
        <div class="grid two">
          <div>
            <h4>Textbook method: average = (opening + closing) ÷ 2</h4>
            <div class="calc-list">
              <div class="calc"><span class="name">Average inventory</span><span class="f">(${inr(c.openingInv)} + ${inr(c.closeInv)}) ÷ 2</span><span class="r">${rs(T.avgInv)}</span></div>
              <div class="calc"><span class="name">Inventory turnover</span><span class="f">COGS ${inr(c.cogs)} ÷ ${inr(T.avgInv)}</span><span class="r">${num(T.itr, 2)}×</span></div>
              <div class="calc"><span class="name">Inventory days (DIO)</span><span class="f">365 ÷ ${num(T.itr, 2)}</span><span class="r">${num(T.dio, 1)} d</span></div>
              <div class="calc"><span class="name">Debtor days (DSO)</span><span class="f">Avg debtors ${inr(T.avgDeb)} ÷ credit sales ${inr(c.creditSales)} × 365</span><span class="r">${num(T.dso, 1)} d</span></div>
              <div class="calc"><span class="name">Creditor days (DPO)</span><span class="f">Avg creditors ${inr(T.avgCred)} ÷ credit purchases ${inr(c.creditPurchases)} × 365</span><span class="r">${num(T.dpo, 1)} d</span></div>
              <div class="calc" style="background:var(--accent-soft)"><span class="name">CCC = DIO + DSO − DPO</span><span class="f">${num(T.dio, 1)} + ${num(T.dso, 1)} − ${num(T.dpo, 1)}</span><span class="r">${num(T.ccc, 1)} days</span></div>
            </div>
            ${cccBar(T)}
          </div>
          <div>
            <h4>Seasonality check: average of 13 month-end balances</h4>
            <div class="calc-list">
              <div class="calc"><span class="name">Average inventory</span><span class="f">mean of opening + 12 month-ends</span><span class="r">${rs(A.avgInv)}</span></div>
              <div class="calc"><span class="name">Inventory turnover</span><span class="f">${inr(c.cogs)} ÷ ${inr(A.avgInv)}</span><span class="r">${num(A.itr, 2)}×</span></div>
              <div class="calc"><span class="name">Inventory days (DIO)</span><span class="f">365 ÷ ${num(A.itr, 2)}</span><span class="r">${num(A.dio, 1)} d</span></div>
              <div class="calc"><span class="name">Debtor days (DSO)</span><span class="f">${inr(A.avgDeb)} ÷ ${inr(c.creditSales)} × 365</span><span class="r">${num(A.dso, 1)} d</span></div>
              <div class="calc"><span class="name">Creditor days (DPO)</span><span class="f">${inr(A.avgCred)} ÷ ${inr(c.creditPurchases)} × 365</span><span class="r">${num(A.dpo, 1)} d</span></div>
              <div class="calc" style="background:var(--accent-soft)"><span class="name">CCC</span><span class="f">${num(A.dio, 1)} + ${num(A.dso, 1)} − ${num(A.dpo, 1)}</span><span class="r">${num(A.ccc, 1)} days</span></div>
            </div>
            ${cccBar(A)}
          </div>
        </div>
        <div class="insight">${cccInsight(T, A)}</div>
      </div>

      <div class="grid two">
        <div class="card"><h3>Month-end balances</h3><div class="chart-box"><canvas id="ch-bal"></canvas></div></div>
        <div class="card"><h3>Units: demand vs purchases (all SKUs)</h3><div class="chart-box"><canvas id="ch-units"></canvas></div></div>
      </div>`;

    document.getElementById('selFlowSku').onchange = (e) => { ui.flowSku = +e.target.value; renderFlow(); };
    chart('ch-bal', {
      type: 'line',
      data: { labels: ['Open', ...M], datasets: [
        { label: 'Inventory', data: [c.openingInv, ...mo.closingInv], borderColor: '#0d9488', backgroundColor: '#0d9488', tension: 0.25 },
        { label: 'Debtors', data: [c.openingDebtors, ...mo.debtors], borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.25 },
        { label: 'Creditors', data: [c.openingCreditors, ...mo.creditors], borderColor: '#9333ea', backgroundColor: '#9333ea', tension: 0.25 },
      ] },
      options: { scales: { y: { ticks: lakhTicks } }, plugins: { tooltip: tooltipINR } },
    });
    const demandU = M.map((_, k) => sum(res.skuRuns.map((r) => r.rows[k].demand)));
    const buyU = M.map((_, k) => sum(res.skuRuns.map((r) => r.rows[k].buyU)));
    chart('ch-units', {
      type: 'bar',
      data: { labels: M, datasets: [
        { label: 'Demand (units)', data: demandU, backgroundColor: css('--base') + 'aa' },
        { label: 'Purchases (units)', data: buyU, backgroundColor: css('--bulk') + 'cc' },
      ] },
      options: { scales: { y: { ticks: { callback: (v) => v.toLocaleString('en-IN') } } } },
    });
  }

  function cccBar(d) {
    if (d.dio === null || d.dso === null || d.dpo === null) return '';
    const span = Math.max(d.dio + d.dso, d.dpo, 1);
    const pctW = (x) => `${(Math.max(0, x) / span) * 100}%`;
    const cccStart = Math.min(d.dpo, d.dio + d.dso);
    return `<div class="cccbar"><div class="track">
      <div class="seg inv" style="left:0;width:${pctW(d.dio)}" title="Inventory days">Stock ${num(d.dio, 0)}d</div>
      <div class="seg deb" style="left:${pctW(d.dio)};width:${pctW(d.dso)}" title="Debtor days">Debtors ${num(d.dso, 0)}d</div>
      <div class="seg cre" style="left:0;width:${pctW(d.dpo)}" title="Creditor days">Creditors ${num(d.dpo, 0)}d</div>
      ${d.ccc > 0 ? `<div class="seg ccc" style="left:${pctW(cccStart)};width:${pctW(d.ccc)}" title="Cash Conversion Cycle">CCC ${num(d.ccc, 0)}d</div>` : ''}
    </div><div class="legend">Top: days cash is locked in stock and debtors · Bottom: days suppliers fund us, and the gap we must finance (CCC).</div></div>`;
  }

  function cccInsight(T, A) {
    const gap = A.ccc - T.ccc;
    let s = `<b>Reading it:</b> every rupee spent on stock comes back as cash after about <b>${num(T.ccc, 0)} days</b> on year-end balances. `;
    if (Math.abs(gap) > 5) s += `On monthly averages it is <b>${num(A.ccc, 0)} days</b>: the 31 March snapshot ${gap > 0 ? 'hides' : 'overstates'} the festive stock build-up, so seasonal businesses should track the cycle month by month. `;
    if (T.dpo > T.dio) s += 'Suppliers wait longer than stock takes to sell, so creditors fund the stock and the cycle is driven by debtor days. Shifting B2B and marketplace sales towards prepaid channels shortens it most.';
    else s += 'Stock sits longer than suppliers give credit, so stock is the first lever: smaller, more frequent orders.';
    return s;
  }

  /* =================================================================
     COMPONENT 2 — LANDED COST SHEET
     ================================================================= */
  function renderCost() {
    const cs = R.cs;
    const i = Math.min(ui.costSku, cs.sheets.length - 1);
    const s = cs.sheets[i];
    const sku = s.sku;
    const lc = s.lc;
    const U = s.units;
    const imp = sku.source === 'Import' || lc.duty > 0 || lc.insurance > 0;
    const pools = cs.pools;
    const row = (label, work, per, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="work">${work}</td>${td(per, 2)}${td(per * U)}</tr>`;
    const feeW = `${num(cs.feeRate * 100, 3)}% blended channel fee × ${inr(sku.sellPrice)}`;
    const lossMakers = cs.sheets.filter((x) => x.profit < 0);
    const bulkRows = R.cmp.bulk.skuRuns;

    const host = document.getElementById('tab-cost');
    host.innerHTML = `
      <div class="section-head">
        <div><h2>Component 2: landed cost sheet per SKU</h2>
        <p class="muted">Module 3 cost sheet format: purchase price → landed cost (prime cost) → overheads apportioned → cost of sales → profit → selling price. Based on the annual demand budget at standard (non-discounted) prices.</p></div>
        <div class="toolbar"><label class="small muted" for="selCostSku">SKU</label>
          <select id="selCostSku">${cs.sheets.map((x, k) => `<option value="${k}" ${k === i ? 'selected' : ''}>${esc(x.sku.code)} — ${esc(x.sku.name)}</option>`).join('')}</select></div>
      </div>

      <div class="grid two">
        <div class="card">
          <h3>Cost sheet: ${esc(sku.code)} ${esc(sku.name)} <span class="pill">${esc(sku.source)} · ${inr(U)} units / year</span></h3>
          <div class="table-wrap"><table class="tt">
            <thead><tr><th>Particulars</th><th class="l">Working</th><th>Per unit (₹)</th><th>Total (₹)</th></tr></thead>
            <tbody>
              ${row(`Purchase price${lc.fx !== 1 ? ' (FOB)' : ''}`, lc.fx !== 1 ? `$${num(sku.purchasePrice, 2)} × ₹${num(lc.fx, 2)}` : 'supplier invoice price', lc.priceINR)}
              ${row(imp ? 'Add: Ocean / international freight' : 'Add: Freight inward', 'per unit, from shipment', lc.freight)}
              ${imp ? row('Add: Marine insurance', `${num(sku.insurancePct, 3)}% × (${num(lc.priceINR, 2)} + ${num(lc.freight, 2)})`, lc.insurance) : ''}
              ${imp ? row('Assessable value (CIF)', 'price + freight + insurance', lc.assessable, 'sub') : ''}
              ${imp ? row('Add: Basic customs duty', `${num(sku.bcdPct, 2)}% × ${num(lc.assessable, 2)}`, lc.bcd) : ''}
              ${imp ? row('Add: Social welfare surcharge', `${num(sku.swsPct, 2)}% × BCD ${num(lc.bcd, 2)}`, lc.sws) : ''}
              ${imp ? row('Add: Clearing & port charges', 'customs house agent, handling', lc.clearing) : ''}
              ${imp ? row('Add: Inland freight to warehouse', 'port → warehouse', lc.inland) : ''}
              ${row('LANDED COST (Prime cost)', 'inventory is valued here (Ind AS 2); GST excluded as input credit', lc.landed, 'hl')}
              ${row('Add: Warehouse overheads', `${num(pools.warehouse.shares[i] * 100, 2)}% of ${inr(pools.warehouse.total)} ÷ ${inr(U)} units (${pools.warehouse.basis})`, s.wh)}
              ${row('Warehouse cost (≈ Works cost)', 'landed cost + warehouse overheads', s.warehouseCost, 'sub')}
              ${row('Add: Administration overheads', `${num(pools.admin.shares[i] * 100, 2)}% of ${inr(pools.admin.total)} ÷ ${inr(U)} (sales value basis)`, s.ad)}
              ${row('Cost of goods ready for sale (≈ Cost of production)', 'warehouse cost + admin overheads', s.readyCost, 'sub')}
              ${row('Add: Packaging', 'per order', sku.packagingPerUnit)}
              ${row('Add: Last-mile delivery', 'per order', sku.deliveryPerUnit)}
              ${row('Add: Gateway & marketplace fees', feeW, s.fee)}
              ${row('Add: Marketing overheads', `${num(pools.selling.shares[i] * 100, 2)}% of ${inr(pools.selling.total)} ÷ ${inr(U)} (sales value basis)`, s.mk)}
              ${row('COST OF SALES', 'ready-for-sale cost + selling & distribution', s.costOfSales, 'hl')}
              ${row(s.profit >= 0 ? 'Profit' : 'Loss', `${num(s.profitPct, 2)}% of selling price`, s.profit)}
              ${row('SELLING PRICE (ex-GST)', 'cost of sales + profit', sku.sellPrice, 'total')}
            </tbody></table></div>
        </div>
        <div>
          <div class="card">
            <h3>Marginal view of the same SKU</h3>
            <div class="calc-list">
              <div class="calc"><span class="name">Variable cost / unit</span><span class="f">landed ${num(lc.landed, 2)} + packaging ${num(sku.packagingPerUnit, 2)} + delivery ${num(sku.deliveryPerUnit, 2)} + fees ${num(s.fee, 2)}</span><span class="r">${rs(s.variableCost, 2)}</span></div>
              <div class="calc"><span class="name">Contribution / unit</span><span class="f">${inr(sku.sellPrice)} − ${num(s.variableCost, 2)}</span><span class="r">${rs(s.contribution, 2)}</span></div>
              <div class="calc"><span class="name">P/V ratio</span><span class="f">contribution ÷ price × 100</span><span class="r">${num(s.pvRatio, 2)}%</span></div>
              <div class="calc"><span class="name">Fixed overheads absorbed / unit</span><span class="f">warehouse ${num(s.wh, 2)} + admin ${num(s.ad, 2)} + marketing ${num(s.mk, 2)}</span><span class="r">${rs(s.wh + s.ad + s.mk, 2)}</span></div>
            </div>
            ${s.profit < 0 && s.contribution > 0 ? `<div class="insight"><b>${esc(sku.code)} shows a loss after full absorption, but its contribution is positive (${rs(s.contribution, 2)} a unit).</b> Dropping it would not save the fixed overheads; they would move onto the other SKUs. Better levers: a price rise, a cheaper freight contract, or a smaller marketing share.</div>` : ''}
          </div>
          <div class="card">
            <h3>Cost of sales build-up, all SKUs (per unit)</h3>
            <div class="chart-box"><canvas id="ch-cost"></canvas></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Overhead apportionment (Module 3: allocation → apportionment → absorption)</h3>
        <div class="grid three">
          ${Object.values(pools).map((p) => `<div>
            <h4>${esc(p.label)}: ${rs(p.total)} <span class="pill">${esc(p.basis)}</span></h4>
            <div class="table-wrap"><table>
              <thead><tr><th>SKU</th><th>Basis</th><th>Share</th><th>Apportioned</th><th>Per unit</th></tr></thead>
              <tbody>${cs.sheets.map((x, k) => `<tr><td>${esc(x.sku.code)}</td>${td(p.weights[k], p.weights[k] < 1000 ? 2 : 0)}<td>${num(p.shares[k] * 100, 2)}%</td>${td(p.amounts[k])}${td(p.perUnit[k], 2)}</tr>`).join('')}
              <tr class="total"><td>Total</td>${td(sum(p.weights), sum(p.weights) < 1000 ? 2 : 0)}<td>100%</td>${td(sum(p.amounts))}<td></td></tr></tbody>
            </table></div></div>`).join('')}
        </div>
        <p class="small muted">Warehouse costs follow the space each SKU occupies (a sneaker box takes about 8× the space of a folded tee), so they are apportioned on storage volume. Admin and marketing benefit SKUs in proportion to sales, so they are apportioned on sales value.</p>
      </div>

      <div class="card">
        <h3>Summary for all SKUs</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>SKU</th><th>Units / yr</th><th>Landed cost</th><th>Cost of sales</th><th>Selling price</th><th>Profit / unit</th><th>Profit %</th><th>Contribution / unit</th><th>P/V %</th><th>Bulk landed cost</th><th>Bulk saving / unit</th></tr></thead>
          <tbody>${cs.sheets.map((x, k) => `<tr><td>${esc(x.sku.code)}</td>${td(x.units)}${td(x.lc.landed, 2)}${td(x.costOfSales, 2)}${td(x.sku.sellPrice, 2)}${td(x.profit, 2)}<td class="${x.profit < 0 ? 'neg' : ''}">${num(x.profitPct, 1)}%</td>${td(x.contribution, 2)}<td>${num(x.pvRatio, 1)}%</td>${td(bulkRows[k].lcBulk.landed, 2)}${td(x.lc.landed - bulkRows[k].lcBulk.landed, 2)}</tr>`).join('')}</tbody>
        </table></div>
        ${lossMakers.length ? `<p class="small muted">Loss after full absorption: ${lossMakers.map((x) => esc(x.sku.code)).join(', ')}. Check contribution before deciding to discontinue.</p>` : ''}
      </div>`;

    document.getElementById('selCostSku').onchange = (e) => { ui.costSku = +e.target.value; renderCost(); };
    chart('ch-cost', {
      type: 'bar',
      data: { labels: cs.sheets.map((x) => x.sku.code), datasets: [
        { label: 'Landed cost', data: cs.sheets.map((x) => x.lc.landed), backgroundColor: '#0d9488', stack: 'c' },
        { label: 'Warehouse + admin', data: cs.sheets.map((x) => x.wh + x.ad), backgroundColor: '#64748b', stack: 'c' },
        { label: 'Selling & distribution', data: cs.sheets.map((x) => x.varSelling + x.mk), backgroundColor: '#9333ea', stack: 'c' },
        { type: 'line', label: 'Selling price', data: cs.sheets.map((x) => x.sku.sellPrice), borderColor: css('--bulk'), backgroundColor: css('--bulk'), showLine: false, pointRadius: 7, pointStyle: 'rectRot' },
      ] },
      options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => `₹${v.toLocaleString('en-IN')}` } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ₹${num(c.parsed.y, 2)}` } } } },
    });
  }

  /* =================================================================
     COMPONENT 3 — CASH BUDGET, BOOKS, FINAL ACCOUNTS, RATIOS
     ================================================================= */
  function renderCash() {
    const res = cur();
    const cb = res.cashBudget;
    const mo = res.monthly;
    const g = input.global;
    const fa = res.finalAccounts;
    const L = res.liquidity;
    const yb = fa.bs;
    const T = res.ccc.textbook;
    const lineRow = (label, vals, cls = '', withTotal = true) => `<tr class="${cls}"><td>${esc(label)}</td>${vals.map((v) => td(v)).join('')}${withTotal ? td(sum(vals)) : '<td></td>'}</tr>`;
    const months = cb.months;

    const host = document.getElementById('tab-cash');
    host.innerHTML = `
      <div class="section-head">
        <div><h2>Component 3: cash budget → books → final accounts → liquidity ratios</h2>
        <p class="muted">Module 5 cash budget (Apex Traders format), Module 1 journal and ledger, Module 2 final accounts and ratios. ${pill(plan)}</p></div>
      </div>

      <div class="card">
        <h3>Cash budget, ${esc(input.company.period)}</h3>
        <p class="small muted">Keeps a minimum balance of ${rs(g.minCash)} by drawing on the overdraft (limit ${rs(g.odLimit)}, interest ${num(g.odRatePct, 2)}% p.a. on the opening overdraft balance). Surplus cash repays the overdraft first. Red cells: overdraft above the sanctioned limit.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Particulars (₹)</th>${M.map((m) => `<th>${m}</th>`).join('')}<th>Total</th></tr></thead>
          <tbody>
            <tr class="sub"><td>Opening cash balance (A)</td>${months.map((x) => td(x.opening)).join('')}<td></td></tr>
            <tr><td colspan="${M.length + 2}" class="l muted small">Receipts</td></tr>
            ${cb.receipts.map((r) => lineRow(r.label, r.values)).join('')}
            ${lineRow('Total receipts (B)', months.map((x) => x.totalReceipts), 'sub')}
            <tr><td colspan="${M.length + 2}" class="l muted small">Payments</td></tr>
            ${cb.payments.map((r) => lineRow(r.label, r.values)).join('')}
            ${lineRow('Interest on overdraft', months.map((x) => x.interest))}
            ${lineRow('Total payments (C)', months.map((x) => x.totalPayments), 'sub')}
            ${lineRow('Net cash flow (B − C)', months.map((x) => x.net))}
            <tr class="sep"><td>Cash before financing (A + B − C)</td>${months.map((x) => td(x.beforeFinancing, 0, x.beforeFinancing < g.minCash ? 'flag' : '')).join('')}<td></td></tr>
            ${lineRow('Overdraft drawn', months.map((x) => x.odDrawn))}
            ${lineRow('Overdraft repaid', months.map((x) => x.odRepaid))}
            <tr class="hl"><td>Closing cash balance</td>${months.map((x) => td(x.closing)).join('')}<td></td></tr>
            <tr><td>Overdraft balance (closing)</td>${months.map((x) => td(x.odClosing, 0, x.odClosing > g.odLimit + 0.5 ? 'flag' : '')).join('')}<td></td></tr>
          </tbody></table></div>
      </div>

      <div class="grid two">
        <div class="card"><h3>Closing cash and overdraft</h3><div class="chart-box"><canvas id="ch-cash"></canvas></div></div>
        <div class="card"><h3>Current ratio and quick ratio by month-end</h3><div class="chart-box"><canvas id="ch-cr"></canvas></div>
          <p class="small muted">Shaded band 1.2–3 = balanced liquidity (class slide). Gaps mean no current liabilities that month.</p></div>
      </div>

      <div class="grid two">
        <div class="card">
          <h3>Trading and Profit &amp; Loss Account for the year ended 31 March</h3>
          ${tAccount('Trading Account', [
            ['To Opening stock', fa.trading.openingStock], ['To Purchases (at landed cost)', fa.trading.purchases],
            ...(fa.trading.grossProfit >= 0 ? [['To Gross profit c/d', fa.trading.grossProfit, 'res']] : []),
          ], [
            ['By Sales', fa.trading.sales], ['By Closing stock', fa.trading.closingStock],
            ...(fa.trading.grossProfit < 0 ? [['By Gross loss c/d', -fa.trading.grossProfit, 'res']] : []),
          ])}
          <div style="height:12px"></div>
          ${tAccount('Profit & Loss Account', [
            ...(fa.trading.grossProfit < 0 ? [['To Gross loss b/d', -fa.trading.grossProfit]] : []),
            ...fa.pl.expenses.map((e) => [`To ${e.label}`, e.amount]),
            ...(fa.pl.netProfit >= 0 ? [['To Net profit (to Capital)', fa.pl.netProfit, 'res']] : []),
          ], [
            ...(fa.trading.grossProfit >= 0 ? [['By Gross profit b/d', fa.trading.grossProfit]] : []),
            ...(fa.pl.netProfit < 0 ? [['By Net loss (to Capital)', -fa.pl.netProfit, 'res']] : []),
          ])}
          <p class="small muted">Closing stock is valued at weighted-average landed cost and sits outside the trial balance, as taught in class.</p>
        </div>
        <div class="card">
          <h3>Balance Sheet as at 31 March</h3>
          ${tAccount('Liabilities | Assets', [
            ['Capital (opening, balancing figure)', res.capital, 'ind'], [`${fa.pl.netProfit >= 0 ? 'Add' : 'Less'}: Net ${fa.pl.netProfit >= 0 ? 'profit' : 'loss'}`, Math.abs(fa.pl.netProfit), 'ind'],
            ['Capital (closing)', res.capital + fa.pl.netProfit], ['Sundry creditors', yb.creditors], ['Bank overdraft', yb.od],
          ], [
            ['Fixed assets (net of depreciation)', yb.faNet], ['Closing stock', yb.inventory], ['Sundry debtors', yb.debtors], ['Cash at bank', yb.cash],
          ], ['Liabilities', 'Assets'])}
          <h4>Liquidity and efficiency ratios (31 March)</h4>
          <div class="calc-list">
            <div class="calc"><span class="name">Current ratio</span><span class="f">CA (stock ${inr(yb.inventory)} + debtors ${inr(yb.debtors)} + cash ${inr(yb.cash)}) ÷ CL (creditors ${inr(yb.creditors)} + overdraft ${inr(yb.od)})</span><span class="r tone-${L.band.tone}">${L.currentRatio === null ? '—' : num(L.currentRatio, 2)}</span></div>
            <div class="calc"><span class="name">Quick (liquid) ratio</span><span class="f">(${inr(L.ca)} − stock ${inr(L.inventory)}) ÷ ${inr(L.cl)}</span><span class="r">${L.quickRatio === null ? '—' : num(L.quickRatio, 2)}</span></div>
            <div class="calc"><span class="name">Inventory turnover</span><span class="f">COGS ${inr(res.ccc.cogs)} ÷ avg inventory ${inr(T.avgInv)}</span><span class="r">${num(T.itr, 2)}×</span></div>
            <div class="calc"><span class="name">Gross profit margin</span><span class="f">${inr(fa.trading.grossProfit)} ÷ ${inr(fa.trading.sales)} × 100</span><span class="r">${num(L.grossMarginPct, 2)}%</span></div>
            <div class="calc"><span class="name">Net profit margin</span><span class="f">${inr(fa.pl.netProfit)} ÷ ${inr(fa.trading.sales)} × 100</span><span class="r">${num(L.netMarginPct, 2)}%</span></div>
          </div>
          <div class="insight"><b>${esc(L.band.text)}.</b> ${liquidityInsight(res)}</div>
        </div>
      </div>

      <div class="card">
        <h3>Books of account (Module 1): journal → ledger → trial balance</h3>
        <div class="grid two">
          <div>
            <div class="toolbar"><label class="small muted" for="selJM">Journal for</label>
              <select id="selJM"><option value="all">All months</option><option value="-1" ${ui.journalMonth === '-1' ? 'selected' : ''}>Opening</option>${M.map((m, k) => `<option value="${k}" ${String(k) === ui.journalMonth ? 'selected' : ''}>${m}</option>`).join('')}</select>
              <span class="small muted">Monthly summary entries, periodic (Trading account) method</span></div>
            <div class="table-wrap" style="max-height:460px;margin-top:8px"><table class="tt">
              <thead><tr><th>Month</th><th class="l">Particulars</th><th>Dr (₹)</th><th>Cr (₹)</th></tr></thead>
              <tbody>${res.journal.filter((j) => ui.journalMonth === 'all' || String(j.month) === ui.journalMonth).map((j) => `
                ${j.lines.map((l, li) => `<tr><td>${li === 0 ? (j.month < 0 ? 'Open' : M[j.month]) : ''}</td><td class="l">${l.dr ? `${esc(l.acct)} A/c &nbsp;Dr` : `&nbsp;&nbsp;&nbsp;&nbsp;To ${esc(l.acct)} A/c`}</td>${l.dr ? td(l.dr, 2) : '<td></td>'}${l.cr ? td(l.cr, 2) : '<td></td>'}</tr>`).join('')}
                <tr class="sep"><td></td><td class="l small muted">(Being ${esc(j.narration.charAt(0).toLowerCase() + j.narration.slice(1))})</td><td class="small muted">${inr(j.totalDr, 2)}</td><td class="small muted">${inr(j.totalCr, 2)}</td></tr>`).join('')}
              </tbody></table></div>
          </div>
          <div>
            <div class="toolbar"><label class="small muted" for="selAcct">Ledger account</label>
              <select id="selAcct">${res.ledger.names.map((n) => `<option ${n === ui.ledgerAcct ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
            ${ledgerT(res, ui.ledgerAcct)}
            <h4>Trial Balance as at 31 March (before closing entries)</h4>
            <div class="table-wrap"><table>
              <thead><tr><th>Account</th><th>Dr (₹)</th><th>Cr (₹)</th></tr></thead>
              <tbody>${res.trialBalance.rows.map((r) => `<tr><td>${esc(r.account)}</td>${r.dr ? td(r.dr, 2) : '<td></td>'}${r.cr ? td(r.cr, 2) : '<td></td>'}</tr>`).join('')}
              <tr class="total"><td>Total ${Math.abs(res.trialBalance.totalDr - res.trialBalance.totalCr) < 0.5 ? '<span class="good">✓ Dr = Cr</span>' : '<span class="bad-t">✗ not equal</span>'}</td>${td(res.trialBalance.totalDr, 2)}${td(res.trialBalance.totalCr, 2)}</tr></tbody>
            </table></div>
          </div>
        </div>
      </div>`;

    document.getElementById('selJM').onchange = (e) => { ui.journalMonth = e.target.value; renderCash(); };
    document.getElementById('selAcct').onchange = (e) => { ui.ledgerAcct = e.target.value; renderCash(); };

    chart('ch-cash', {
      data: { labels: M, datasets: [
        { type: 'line', label: 'Closing cash', data: mo.cash, borderColor: css('--good'), backgroundColor: css('--good'), tension: 0.25, order: 1 },
        { type: 'bar', label: 'Overdraft balance', data: mo.od, backgroundColor: mo.od.map((x) => (x > g.odLimit + 0.5 ? css('--bad') : css('--bulk') + 'cc')), order: 2 },
        { type: 'line', label: 'Overdraft limit', data: M.map(() => g.odLimit), borderColor: css('--bad'), borderDash: [6, 4], pointRadius: 0, order: 0 },
      ] },
      options: { scales: { y: { ticks: lakhTicks } }, plugins: { tooltip: tooltipINR } },
    });
    chart('ch-cr', {
      type: 'line',
      data: { labels: M, datasets: [
        { label: 'Current ratio', data: res.bs.map((b) => b.currentRatio), borderColor: css('--base'), backgroundColor: css('--base'), tension: 0.25, spanGaps: false },
        { label: 'Quick ratio', data: res.bs.map((b) => b.quickRatio), borderColor: '#9333ea', backgroundColor: '#9333ea', tension: 0.25, spanGaps: false },
        { label: 'Balanced band from 1.2', data: M.map(() => 1.2), borderColor: css('--good'), borderDash: [4, 4], pointRadius: 0, fill: false },
        { label: 'to 3.0', data: M.map(() => 3), borderColor: css('--good'), borderDash: [4, 4], pointRadius: 0, fill: '-1', backgroundColor: css('--good') + '18' },
      ] },
      options: { scales: { y: { beginAtZero: true } }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y === null ? '—' : num(c.parsed.y, 2)}` } } } },
    });
  }

  function tAccount(title, left, right, heads = ['Dr', 'Cr']) {
    const total = Math.max(sum(left.filter((r) => r[2] !== 'ind').map((r) => r[1])), sum(right.filter((r) => r[2] !== 'ind').map((r) => r[1])));
    const side = (rows) => rows.map((r) => `<div class="row ${r[2] || ''}"><span class="${r[2] === 'ind' ? 'ind' : ''}">${esc(r[0])}</span><span>${inr(r[1], 2)}</span></div>`).join('');
    return `<div class="small muted" style="margin-bottom:4px"><b>${esc(title)}</b></div><div class="tform">
      <div><h4><span>${heads[0]}</span><span>₹</span></h4>${side(left)}<div class="row tot"><span>Total</span><span>${inr(total, 2)}</span></div></div>
      <div><h4><span>${heads[1]}</span><span>₹</span></h4>${side(right)}<div class="row tot"><span>Total</span><span>${inr(total, 2)}</span></div></div>
    </div>`;
  }

  function ledgerT(res, acct) {
    const posts = res.ledger.accounts.get(acct) || [];
    const dr = posts.filter((p) => p.dr);
    const cr = posts.filter((p) => p.cr);
    const bal = res.ledger.balance(acct);
    const tot = Math.max(sum(dr.map((p) => p.dr)) + (bal < 0 ? -bal : 0), sum(cr.map((p) => p.cr)) + (bal > 0 ? bal : 0));
    const line = (p, amt) => `<div class="row"><span>${p.month < 0 ? 'Open' : M[p.month]} · ${esc(p.narration.length > 34 ? p.narration.slice(0, 32) + '…' : p.narration)}</span><span>${inr(amt, 2)}</span></div>`;
    return `<div class="tform" style="margin-top:8px;max-height:300px;overflow:auto">
      <div><h4><span>Dr — ${esc(acct)} A/c</span><span>₹</span></h4>${dr.map((p) => line(p, p.dr)).join('')}${bal < -0.004 ? `<div class="row res"><span>Balance c/d</span><span>${inr(-bal, 2)}</span></div>` : ''}<div class="row tot"><span>Total</span><span>${inr(tot, 2)}</span></div></div>
      <div><h4><span>Cr</span><span>₹</span></h4>${cr.map((p) => line(p, p.cr)).join('')}${bal > 0.004 ? `<div class="row res"><span>Balance c/d</span><span>${inr(bal, 2)}</span></div>` : ''}<div class="row tot"><span>Total</span><span>${inr(tot, 2)}</span></div></div>
    </div>`;
  }

  function liquidityInsight(res) {
    const crs = res.bs.map((b) => b.currentRatio).filter((x) => x !== null);
    const minCR = Math.min(...crs);
    const minM = res.bs.findIndex((b) => b.currentRatio === minCR);
    let s = `The lowest month-end current ratio is <b>${num(minCR, 2)} in ${M[minM]}</b>. `;
    if (res.liquidity.currentRatio !== null && res.liquidity.currentRatio > 3) s += 'At year-end, cash from festive collections has piled up. It could repay the overdraft early, fund the next season\'s stock, or be placed in short-term deposits. ';
    if (res.totals.monthsOverLimit.length) s += `<span class="bad-t">The overdraft goes above the sanctioned limit in ${res.totals.monthsOverLimit.map((m) => M[m]).join(', ')}, so this plan cannot be executed unless the bank raises the limit.</span>`;
    return s;
  }

  /* =================================================================
     FESTIVE TWIN — base vs bulk
     ================================================================= */
  function renderTwin() {
    const c = R.cmp;
    const b = c.base;
    const u = c.bulk;
    const F = input.festive;
    const g = input.global;
    const minCR = (res) => Math.min(...res.bs.map((x) => (x.currentRatio === null ? Infinity : x.currentRatio)));
    const peakInv = (res) => Math.max(...res.monthly.closingInv);
    const metrics = [
      ['Purchase cost saving from bulk discount', 0, c.purchaseSaving, 'money', true],
      ['Gross profit', b.totals.grossProfit, u.totals.grossProfit, 'money', true],
      ['Interest on overdraft', b.totals.interest, u.totals.interest, 'money', false],
      ['Net profit', b.totals.netProfit, u.totals.netProfit, 'money', true],
      ['Peak inventory held (month-end)', peakInv(b), peakInv(u), 'money', false],
      ['Lowest cash before financing', b.totals.lowestBeforeFinancing, u.totals.lowestBeforeFinancing, 'money', true],
      ['Peak overdraft needed', b.totals.peakOD, u.totals.peakOD, 'money', false],
      ['Months above the overdraft limit', b.totals.monthsOverLimit.length, u.totals.monthsOverLimit.length, 'int', false],
      ['Inventory turnover (monthly averages)', b.ccc.monthlyAvg.itr, u.ccc.monthlyAvg.itr, 'x', true],
      ['CCC on monthly averages (days)', b.ccc.monthlyAvg.ccc, u.ccc.monthlyAvg.ccc, 'd', false],
      ['CCC on year-end balances (days)', b.ccc.textbook.ccc, u.ccc.textbook.ccc, 'd', false],
      ['Lowest month-end current ratio', minCR(b), minCR(u), 'x', true],
    ];
    const fmtM = (v, k) => (k === 'money' ? rs(v) : k === 'int' ? String(v) : k === 'x' ? num(v, 2) : num(v, 1));
    const better = (d, upGood) => (Math.abs(d) < 1e-6 ? '' : (d > 0) === upGood ? 'good' : 'bad-t');
    const over = u.totals.monthsOverLimit;
    const multiple = g.odLimit > 0 ? u.totals.peakOD / g.odLimit : null;
    const host = document.getElementById('tab-twin');
    host.innerHTML = `
      <div class="section-head">
        <div><h2>Festive twin: does the bigger festive order pay off?</h2>
        <p class="muted">Same demand and prices, two purchase plans. ${pill('base')} buys every month to keep ${g.coverMonths} month of cover. ${pill('bulk')} buys all stock for ${M[F.buyMonth]}–${M[F.coverToMonth]} in ${M[F.buyMonth]} at ${num(F.discountPct, 1)}% off the supplier price.</p></div>
      </div>

      <div class="card">
        <div class="fields">
          <div class="field"><label>Bulk order month</label>${sIn('festive.buyMonth', String(F.buyMonth), monthOpts)}</div>
          <div class="field"><label>Covers sales up to</label>${sIn('festive.coverToMonth', String(F.coverToMonth), monthOpts)}</div>
          <div class="field"><label>Volume discount (%)</label>${nIn('festive.discountPct', F.discountPct, '0.5')}</div>
          <div class="field"><label>Sanctioned overdraft limit (₹)</label>${nIn('global.odLimit', g.odLimit, '100000')}</div>
          <div class="field"><label>Import supplier: % paid on receipt</label>${nIn('supplierTerms.Import.0', input.supplierTerms.Import[0])}</div>
          <div class="field"><label>Import supplier: % paid after 1 month</label>${nIn('supplierTerms.Import.1', input.supplierTerms.Import[1])}</div>
          <div class="field"><label>Import supplier: % paid after 2 months</label>${nIn('supplierTerms.Import.2', input.supplierTerms.Import[2])}</div>
        </div>
      </div>

      <div class="${over.length ? 'verdict' : 'verdict good'}">
        <b>Verdict.</b> The bulk order lowers landed cost and saves <b>${short(c.purchaseSaving)}</b> on purchases. Net profit changes by
        <b>${short(u.totals.netProfit - b.totals.netProfit)}</b> even after ${short(u.totals.interest)} of overdraft interest.
        ${over.length
          ? `But the cash leaves in ${M[F.buyMonth]}–${M[Math.min(F.buyMonth + 2, 11)]}, while festive sales are collected only from ${M[Math.min(F.coverToMonth - 1, 11)]} onwards. The overdraft peaks at <b>${short(u.totals.peakOD)} in ${M[u.totals.peakODMonth]}</b>, which is <b>${num(multiple, 1)}×</b> the ${short(g.odLimit)} limit, and stays above it in <b>${over.map((m) => M[m]).join(', ')}</b>. On paper the plan is more profitable, but it cannot be carried out on the current banking line: from ${M[over[0]]} the firm cannot pay its suppliers, customs and staff on time, and the crunch is worst ${u.totals.peakODMonth - F.buyMonth} month(s) after the order.`
          : 'The overdraft stays within the sanctioned limit, so the plan is affordable with the current banking line.'}
      </div>

      <div class="card" style="margin-top:16px">
        <h3>Side-by-side</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Metric</th><th>${pill('base')}</th><th>${pill('bulk')}</th><th>Change</th></tr></thead>
          <tbody>${metrics.map(([label, x, y, k, upGood]) => `<tr><td>${esc(label)}</td><td>${fmtM(x, k)}</td><td>${fmtM(y, k)}</td><td class="${better(y - x, upGood)}">${y - x >= 0 ? '+' : '−'}${fmtM(Math.abs(y - x), k)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="grid two">
        <div class="card"><h3>Overdraft needed vs sanctioned limit</h3><div class="chart-box tall"><canvas id="ch-twin-od"></canvas></div></div>
        <div class="card"><h3>Stock held (closing inventory value)</h3><div class="chart-box tall"><canvas id="ch-twin-inv"></canvas></div></div>
      </div>

      <div class="card">
        <h3>Corrective actions (budgetary control)</h3>
        <div class="grid two">
          <ul>
            <li><b>Staggered deliveries:</b> keep the bulk price but take delivery and pay in three tranches (Aug, Sep, Oct).</li>
            <li><b>Shrink the bulk window and add supplier credit:</b> credit alone only delays the crunch. Buying in Sep for Sep–Nov roughly halves the peak overdraft, and 60-day import terms (0 / 50 / 50) bring it close to the limit. Try both in the controls above (each payment pattern must total 100%).</li>
            <li><b>Arrange finance before ordering:</b> get the overdraft limit raised, or use invoice discounting against B2B debtors.</li>
          </ul>
          <ul>
            <li><b>Shorten debtor days:</b> push prepaid offers and cut COD and 60-day B2B terms during the festive season.</li>
            <li><b>Bulk-buy only fast movers:</b> tees and joggers turn fastest. Keep slow, high-value sneakers on monthly orders.</li>
            <li><b>Pre-orders:</b> collect cash for festive drops before paying the supplier, which makes the CCC negative for those units.</li>
          </ul>
        </div>
      </div>`;

    chart('ch-twin-od', {
      data: { labels: M, datasets: [
        { type: 'bar', label: 'Base: overdraft', data: b.monthly.od, backgroundColor: css('--base') + 'cc' },
        { type: 'bar', label: 'Bulk: overdraft', data: u.monthly.od, backgroundColor: css('--bulk') + 'dd' },
        { type: 'line', label: 'Sanctioned limit', data: M.map(() => g.odLimit), borderColor: css('--bad'), borderDash: [6, 4], pointRadius: 0 },
      ] },
      options: { scales: { y: { ticks: lakhTicks } }, plugins: { tooltip: tooltipINR } },
    });
    chart('ch-twin-inv', {
      type: 'line',
      data: { labels: ['Open', ...M], datasets: [
        { label: 'Base: inventory', data: [b.ccc.openingInv, ...b.monthly.closingInv], borderColor: css('--base'), backgroundColor: css('--base'), tension: 0.25 },
        { label: 'Bulk: inventory', data: [u.ccc.openingInv, ...u.monthly.closingInv], borderColor: css('--bulk'), backgroundColor: css('--bulk'), tension: 0.25 },
      ] },
      options: { scales: { y: { ticks: lakhTicks } }, plugins: { tooltip: tooltipINR } },
    });
  }

  /* =================================================================
     TEXTBOOK CHECKS
     ================================================================= */
  function renderChecks() {
    const cases = E.verifications();
    const passed = cases.filter((c) => c.pass).length;
    const host = document.getElementById('tab-checks');
    const both = [['base', R.cmp.base], ['bulk', R.cmp.bulk]];
    host.innerHTML = `
      <div class="section-head">
        <div><h2>Textbook and class-slide checks</h2>
        <p class="muted">Each result is computed live by the same engine functions the twin uses, then compared with the hand-solved answer. ${passed}/${cases.length} cases match.</p></div>
      </div>
      <div class="grid two">
        ${cases.map((c) => `<div class="card vcase ${c.pass ? '' : 'fail'}">
          <h3>${esc(c.id)}. ${esc(c.title)} ${c.pass ? '<span class="pill" style="background:var(--good-soft);color:var(--good)">✓ matches</span>' : '<span class="pill" style="background:var(--bad-soft);color:var(--bad)">✗ mismatch</span>'}</h3>
          <p class="small muted">${esc(c.source)}</p>
          <p class="small"><b>Given:</b> ${esc(c.given)}</p>
          <div class="table-wrap"><table class="tt">
            <thead><tr><th>Step</th><th class="l">Working</th><th>Tool</th><th>Hand answer</th><th></th></tr></thead>
            <tbody>${c.steps.map((s) => `<tr><td>${esc(s.label)}</td><td class="work">${esc(s.formula)}</td><td>${num(s.value, s.expected % 1 === 0 && Math.abs(s.value - Math.round(s.value)) < 1e-9 ? 0 : 2)}</td><td>${num(s.expected, s.expected % 1 === 0 ? 0 : 2)}</td><td>${s.pass ? '<span class="good">✓</span>' : '<span class="bad-t">✗</span>'}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>`).join('')}
      </div>
      <div class="grid two">
        ${both.map(([p, res]) => `<div class="card"><h3>Accounting integrity ${pill(p)}</h3>
          ${res.checks.map((k) => `<div class="check"><span class="ic ${k.ok ? 'ok' : 'no'}">${k.ok ? '✓' : '✗'}</span><div><div>${esc(k.label)}</div><div class="small muted">${esc(k.detail)}</div></div></div>`).join('')}</div>`).join('')}
      </div>`;
  }

  /* ---------------- header & events ---------------- */
  function updateHeader() {
    document.getElementById('companyLine').textContent = `${input.company.name} · ${input.company.period}`;
    document.querySelectorAll('.plan-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.plan === plan));
  }

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-path]')) onFieldChange(el);
    if (el.id === 'fileImport' && el.files && el.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.skus || !data.global || !data.channels || !data.expenses || !data.opening || !data.festive || !data.supplierTerms) throw new Error('missing sections');
          input = data;
          saveInput(); recompute(); renderInputs(); updateHeader();
        } catch (err) {
          const eb = document.getElementById('errorBanner');
          eb.hidden = false;
          eb.textContent = `Could not import that file: ${err.message}. Export a file from this tool to see the expected format.`;
        }
      };
      reader.readAsText(el.files[0]);
      el.value = '';
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches('.plan-toggle button')) { plan = t.dataset.plan; updateHeader(); renderCurrent(); }
    if (t.id === 'btnReset') {
      if (!resetArmed) { resetArmed = true; t.textContent = 'Click again to confirm reset'; t.classList.add('primary'); setTimeout(() => { resetArmed = false; if (document.body.contains(t)) { t.textContent = 'Reset to sample data'; t.classList.remove('primary'); } }, 4000); return; }
      resetArmed = false;
      input = clone(window.SAMPLE_INPUT);
      saveInput(); recompute(); renderInputs(); updateHeader();
    }
    if (t.id === 'btnExport') {
      const blob = new Blob([JSON.stringify(input, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'd2c-inventory-twin-inputs.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (t.id === 'btnAddSku') {
      const last = input.skus[input.skus.length - 1];
      const copy = clone(last);
      copy.code = `NEW-${input.skus.length + 1}`;
      copy.name = 'New SKU';
      input.skus.push(copy);
      saveInput(); recompute(); renderInputs();
    }
    if (t.dataset && t.dataset.removeSku !== undefined && input.skus.length > 1) {
      input.skus.splice(+t.dataset.removeSku, 1);
      ui.flowSku = 0; ui.costSku = 0;
      saveInput(); recompute(); renderInputs();
    }
  });

  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => renderCurrent());

  /* ---------------- boot ---------------- */
  recompute();
  updateHeader();
  showTab(location.hash.slice(1) || 'dashboard');
})();
