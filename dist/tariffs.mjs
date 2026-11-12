export const models = {
  FBO: 'Uzum stores and delivers stock.',
  FBS: 'You store stock and hand orders to Uzum for delivery.',
  DBS: 'You store and deliver orders. Include delivery in the item price.',
  EDBS: 'You handle payment and delivery. Uzum invoices an information and advertising service.',
};
export const modelIndex = Object.keys(models);
export const payoutRates = { fortnightly: 0, monthly: 0, weekly: 1, daily: 1.5 };
export const urgentPayoutRate = 2.5;
export const sources = {
  manual: ['Seller manual', 'https://seller.uzum.uz/manual/uz/'],
  tariffs: ['Commission, logistics & payouts · §3', 'https://seller.uzum.uz/manual/uz/3.tariffs/'],
  offer: ['Seller offer · 9 Nov 2026', 'https://seller.uzum.uz/seller/agreement/uz/'],
  eligibility: ['Product and fulfillment limits · §2', 'https://seller.uzum.uz/manual/2.seller-requirements/'],
  dimensions: ['Packed dimensions & FBS penalty · §5.16', 'https://seller.uzum.uz/manual/5.product-creation/'],
  warehouse: ['Inbound, storage & preparation · §6', 'https://seller.uzum.uz/manual/uz/6.product-preparation/'],
  returns: ['Warehouse returns · §7.5', 'https://seller.uzum.uz/manual/uz/7.work/'],
  fbs: ['FBS handover, returns & penalties · §8', 'https://seller.uzum.uz/manual/uz/8.fbs/'],
  dbs: ['DBS delivery, returns & penalties · §9', 'https://seller.uzum.uz/manual/uz/9.dbs/'],
  edbs: ['EDBS eligibility, service & penalties · §10', 'https://seller.uzum.uz/manual/uz/10.edbs/'],
  edbsOffer: ['EDBS cancellation and fee adjustments · Offer annex 6', 'https://seller.uzum.uz/seller/agreement/6.attachment-5/'],
  disposal: ['Disposal of return waybills · §7.8', 'https://seller.uzum.uz/news/33'],
  packing: ['Preparation and packaging quote · Uzum', 'https://packing.uzum.uz/'],
  logistics: ['Inbound transport quote · Uzum Logistics', 'https://logistics.uzum.uz/'],
  promotion: ['Promos, promo codes, CPM & Order Boost · §11', 'https://seller.uzum.uz/manual/10.promotion/'],
};

export function packedVolume(length, width, height) {
  const liters = length * width * height / 1_000_000;
  return { liters, rounded: Math.ceil(liters) };
}

export function officialLogistics(liters, kind) {
  if (kind === 'missing') return 50_000;
  if (kind === 'sim') return 20_000;
  return Math.min(50_000, 5_250 + 250 * (Math.max(1, liters) - 1));
}

export function officialStorage(liters, tier, special) {
  const rates = special ? [0, 12, 14, 18] : [0, 12, 18, 24];
  return Math.min(special ? 3_000 : 5_000, rates[tier] * liters);
}

export function turnoverBand(days) {
  return days > 360 ? 3 : days > 180 ? 2 : days > 60 ? 1 : 0;
}

export function returnSize(sumMm) {
  return sumMm <= 600 ? 0 : sumMm <= 1700 ? 1 : 2;
}

export function warehouseReturnFees(model, size, collected, held, days, disposed = 0) {
  return {
    assembly: model === 'FBO' ? [2500, 5000, 10000][size] * collected : 0,
    storage: [500, 1500, 3000][size] * held * Math.max(0, days - 10),
    disposal: [4000, 8000, 40000][size] * disposed,
  };
}

const boundedPercent = (amount, rate, minimum, maximum) => Math.min(maximum, Math.max(minimum, amount * rate / 100));

export function cancellationPenalty(model, amount, hours) {
  if (model === 'FBS') return hours <= 24 ? 0 : boundedPercent(amount, 9, 10000, 360000);
  if (model !== 'DBS' && model !== 'EDBS' || hours <= 12) return 0;
  const band = hours <= 24 ? 0 : Math.min(5, Math.ceil(hours / 24) - 1);
  const rate = [3, 5, 6, 7, 8, 9][band];
  return boundedPercent(amount, rate, 10000, rate * 40000);
}

export function extensionPenalty(orderValue) {
  return boundedPercent(orderValue, 2.5, 5000, 100000);
}

export function dimensionsPenalty(measured, declared) {
  return declared > 0 && measured > declared * 1.3 && measured - declared > 1 ? 50000 : 0;
}

export function timeSlotPenalty(date, violation, units, events) {
  if (date < '2026-12-01' || !violation) return 0;
  return events * Math.min(300000, units * (violation === 'missed' ? 2500 : 300));
}

export function categoryRate(category, model) {
  return category?.[2][modelIndex.indexOf(model)] ?? null;
}

export function isAutoCategory(category) {
  return Boolean(category && /^(авто|автомобили|avtomobillar|avto)(?:\s*›|$)/iu.test(category[0])
    || category && /^(авто|автомобили|avtomobillar|avto)(?:\s*›|$)/iu.test(category[1]));
}
