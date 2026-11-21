/* =====================================================================
   Sample scenario: StrideKart — a fictional D2C sneaker & apparel brand
   FY 2026-27 (April 2026 – March 2027). All amounts in ₹, excluding GST
   (GST is recoverable as input tax credit, so it is not a cost).
   Month index: 0 = Apr ... 4 = Aug, 6 = Oct, 7 = Nov, 8 = Dec ... 11 = Mar
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SAMPLE_INPUT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    company: { name: 'StrideKart (fictional D2C sneaker & apparel brand)', period: 'FY 2026-27 (Apr 2026 – Mar 2027)' },

    global: {
      fxRate: 84,              // ₹ per US$
      coverMonths: 1,          // stock policy: hold next month's demand as closing stock
      minCash: 1000000,        // minimum cash balance to keep (₹10 lakh)
      odRatePct: 12,           // bank overdraft interest, % per annum
      odLimit: 3000000,        // overdraft limit sanctioned by the bank (₹30 lakh)
      warehouseBasis: 'volume' // apportion warehouse overheads by storage volume ('volume' | 'units')
    },

    skus: [
      { code: 'SNK-RUN', name: 'AeroStride running shoe', source: 'Import', supplier: 'Vietnam OEM', currency: 'USD',
        purchasePrice: 15, freightPerUnit: 90, insurancePct: 1.125, bcdPct: 35, swsPct: 10, clearingPerUnit: 30, inlandFreightPerUnit: 20,
        sellPrice: 3499, packagingPerUnit: 35, deliveryPerUnit: 80, cbmPerUnit: 0.012, openingUnits: 450,
        demand: [400, 400, 375, 400, 450, 500, 900, 1000, 650, 550, 450, 475] },
      { code: 'SNK-CAS', name: 'CityLite casual sneaker', source: 'Import', supplier: 'Vietnam OEM', currency: 'USD',
        purchasePrice: 11, freightPerUnit: 80, insurancePct: 1.125, bcdPct: 35, swsPct: 10, clearingPerUnit: 30, inlandFreightPerUnit: 20,
        sellPrice: 2499, packagingPerUnit: 35, deliveryPerUnit: 80, cbmPerUnit: 0.011, openingUnits: 400,
        demand: [360, 360, 340, 360, 405, 450, 810, 900, 585, 495, 405, 430] },
      { code: 'TEE-ORG', name: 'Organic cotton tee', source: 'Domestic', supplier: 'Tiruppur knitter', currency: 'INR',
        purchasePrice: 240, freightPerUnit: 8, insurancePct: 0, bcdPct: 0, swsPct: 0, clearingPerUnit: 0, inlandFreightPerUnit: 0,
        sellPrice: 699, packagingPerUnit: 12, deliveryPerUnit: 45, cbmPerUnit: 0.0015, openingUnits: 1500,
        demand: [1440, 1440, 1350, 1440, 1620, 1800, 3240, 3600, 2340, 1980, 1620, 1710] },
      { code: 'HOD-FLC', name: 'Fleece hoodie', source: 'Domestic', supplier: 'Ludhiana mill', currency: 'INR',
        purchasePrice: 520, freightPerUnit: 15, insurancePct: 0, bcdPct: 0, swsPct: 0, clearingPerUnit: 0, inlandFreightPerUnit: 0,
        sellPrice: 1499, packagingPerUnit: 18, deliveryPerUnit: 55, cbmPerUnit: 0.005, openingUnits: 100,
        demand: [60, 50, 50, 60, 100, 180, 450, 650, 700, 550, 250, 120] },
      { code: 'JOG-ATH', name: 'Athleisure joggers', source: 'Domestic', supplier: 'Tiruppur knitter', currency: 'INR',
        purchasePrice: 330, freightPerUnit: 10, insurancePct: 0, bcdPct: 0, swsPct: 0, clearingPerUnit: 0, inlandFreightPerUnit: 0,
        sellPrice: 999, packagingPerUnit: 15, deliveryPerUnit: 50, cbmPerUnit: 0.003, openingUnits: 700,
        demand: [640, 640, 600, 640, 720, 800, 1440, 1600, 1040, 880, 720, 760] },
    ],

    // Sales channels: share of sales, % collected in the month of sale / +1 month / +2 months, and channel fee %
    channels: [
      { name: 'Website — prepaid (UPI / cards)', sharePct: 45, profilePct: [100, 0, 0], feePct: 2 },
      { name: 'Website — cash on delivery', sharePct: 15, profilePct: [60, 40, 0], feePct: 2.5 },
      { name: 'Marketplace (payout after 30 days)', sharePct: 25, profilePct: [0, 100, 0], feePct: 18 },
      { name: 'B2B retail partners (60-day credit)', sharePct: 15, profilePct: [0, 0, 100], feePct: 0 },
    ],

    // Supplier payment pattern for the goods value: % paid in month of receipt / +1 / +2
    supplierTerms: {
      Import: [50, 50, 0],     // 50% against shipping documents, 50% after 30 days
      Domestic: [0, 50, 50],   // 30–60 day credit from domestic mills
    },

    // Fixed monthly operating expenses (paid in the same month). group drives cost-sheet apportionment.
    expenses: [
      { key: 'warehouse', label: 'Warehouse rent, staff & utilities', group: 'warehouse',
        monthly: [250000, 250000, 250000, 250000, 250000, 250000, 250000, 250000, 250000, 250000, 250000, 250000] },
      { key: 'salaries', label: 'Office salaries', group: 'admin',
        monthly: [600000, 600000, 600000, 600000, 600000, 600000, 600000, 600000, 600000, 600000, 600000, 600000] },
      { key: 'rent', label: 'Office rent', group: 'admin',
        monthly: [150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000, 150000] },
      { key: 'tech', label: 'Website, software & tech', group: 'admin',
        monthly: [80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000, 80000] },
      { key: 'marketing', label: 'Marketing & performance ads', group: 'selling',
        monthly: [650000, 650000, 650000, 650000, 750000, 1050000, 1550000, 1650000, 950000, 850000, 700000, 700000] },
    ],

    // Opening position on 1 April 2026
    opening: {
      cash: 2500000,
      debtorsDue: [2250000, 750000],       // opening debtors collected in Apr, May
      creditorsDue: [2200000, 500000],     // opening creditors paid in Apr, May
      fixedAssets: { gross: 3000000, accDep: 600000, depRatePct: 20 },  // SLM on gross block
    },

    // Festive bulk-buy scenario: order in August for Oct–Dec at a volume discount on the supplier price
    festive: { buyMonth: 4, coverToMonth: 8, discountPct: 8 },
  };
});
