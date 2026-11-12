import { payoutRates, urgentPayoutRate } from './tariffs.mjs';

export const scenarioMarkups = [30, 40, 50, 60];
const percent = amount => amount / 100;

export function calculate(input, listPrice = input.price) {
  const { model, purchase, quantity, unitsPerOrder, logistics, fixedCharges, extra } = input;
  const returns = percent(input.returnRate);
  const refused = percent(input.refusedRate);
  const canceled = percent(input.cancelRate);
  const kept = Math.max(0, 1 - returns - refused - canceled);
  const delivered = kept + returns;
  const dispatched = 1 - canceled;
  const realizedPrice = listPrice * (1 - percent(input.discount));
  const saleBase = input.discountBasis === 'coupon' && model !== 'EDBS' ? listPrice : realizedPrice;
  const netSales = kept * realizedPrice;
  const commission = input.bands.reduce((rate, [minimum, bandRate]) => listPrice >= minimum ? bandRate : rate, input.commission);
  const salesFee = kept * saleBase * percent(commission);
  const logisticsFee = kept * logistics;
  const payoutBase = netSales - salesFee - logisticsFee;
  const urgentShare = percent(input.urgentShare);
  const blendedPayout = model === 'EDBS' ? 0 : percent(payoutRates[input.payout] * (1 - urgentShare) + urgentPayoutRate * urgentShare);
  const stockLoss = purchase * (kept + returns * percent(input.returnLoss) + refused * percent(input.refusedLoss));
  const tax = input.taxBasis === 'included' ? netSales * input.tax / (100 + input.tax) : netSales * percent(input.tax);
  const variable = [
    ['Cost of goods and inventory write-offs', stockLoss, 'estimate'],
    [model === 'EDBS' ? 'EDBS service fee' : 'Sales commission', salesFee, input.rateSource],
    ['Uzum sales logistics', logisticsFee, input.logisticsSource],
    ['EDBS Auto service per placed order', input.auto ? 120000 / unitsPerOrder : 0, 'official'],
    ['Packaging, marking & handling', dispatched * input.packaging, 'estimate'],
    ['Supplier freight / warehouse inbound', dispatched * input.inbound, 'estimate'],
    ['Seller delivery / dispatch', dispatched * input.delivery / unitsPerOrder, 'estimate'],
    ['Buyer returns & refused-order handling', returns * input.returnHandling + refused * input.refusedHandling, 'estimate'],
    ['Payment processing & installments', netSales * percent(input.payment), 'estimate'],
    ['Order Boost', (input.boostReturned ? delivered : kept) * realizedPrice * percent(input.boostRate) * percent(input.boostShare), 'estimate'],
    ['Tax assumption', tax, 'estimate'],
    ['Payout fees', Math.max(0, payoutBase) * blendedPayout, 'estimate'],
  ];
  const period = [...fixedCharges];
  const factors = { placed: 1, shipped: dispatched, kept, returned: returns, refused, order: 1 / unitsPerOrder, revenue: netSales / 100 };
  for (const line of extra) {
    const amount = line.amount * (line.kind === 'credit' ? -1 : 1);
    if (line.basis === 'period') period.push([line.name, amount, 'estimate']);
    else variable.push([line.name, amount * factors[line.basis], 'estimate']);
  }
  const unitCost = variable.reduce((sum, [, value]) => sum + value, 0);
  const overhead = period.reduce((sum, [, value]) => sum + value, 0);
  const contribution = netSales - unitCost;
  const total = contribution * quantity - overhead;
  const revenue = netSales * quantity;
  const threshold = Math.max(0, overhead);
  const breakEvenUnits = contribution < -1e-8 ? null
    : threshold === 0 ? 0
    : contribution > 1e-8 ? Math.ceil(threshold / contribution - 1e-10)
    : null;
  return {
    listPrice, realizedPrice, commission, kept, returned: returns, refused, dispatched, delivered, payoutBase,
    contribution, total, overhead, unitCost, revenue, variable, period,
    profitPerPlaced: quantity ? total / quantity : null,
    profitPerKept: quantity && kept ? total / (quantity * kept) : null,
    contributionMargin: netSales ? 100 * contribution / netSales : null,
    margin: revenue ? 100 * total / revenue : null,
    markup: purchase ? 100 * (realizedPrice - purchase) / purchase : null,
    breakEvenUnits,
    breakEvenRevenue: breakEvenUnits === null ? null : breakEvenUnits * netSales,
    breakEvenKept: breakEvenUnits === null ? null : breakEvenUnits * kept,
  };
}

export function breakEvenPrice(input) {
  if (!input.quantity) return null;
  const limits = [0, ...input.bands.map(([minimum]) => minimum), Infinity];
  for (let index = 0; index + 1 < limits.length; index += 1) {
    const lower = limits[index];
    const upper = limits[index + 1] - 1;
    const atLower = calculate(input, lower);
    if (atLower.total >= -1e-7) return lower;
    if (upper <= lower) continue;
    const probe = Math.min(upper, lower + 1000);
    const atProbe = calculate(input, probe);
    const payoutSlope = (atProbe.payoutBase - atLower.payoutBase) / (probe - lower);
    const kink = payoutSlope > 0 && atLower.payoutBase < 0
      ? lower - atLower.payoutBase / payoutSlope : null;
    const starts = [lower];
    if (kink > lower && kink < upper) starts.push(kink);
    for (let segment = 0; segment < starts.length; segment += 1) {
      const start = starts[segment];
      const last = starts[segment + 1] ?? upper;
      const sample = Math.min(last, start + Math.max(1, start * 0.01));
      const point = calculate(input, start);
      const slope = (calculate(input, sample).total - point.total) / (sample - start);
      if (slope <= 0) continue;
      const root = start - point.total / slope;
      const whole = Math.ceil(root - 1e-8);
      for (const candidate of [whole - 1, whole, whole + 1]) {
        if (Number.isSafeInteger(candidate) && candidate >= lower && candidate <= upper
          && calculate(input, candidate).total >= -1e-7) return candidate;
      }
    }
  }
  return null;
}

export function priceForMarkup(purchase, markup) {
  return Math.round(purchase * (1 + markup / 100));
}
