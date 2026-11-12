import { usesUzumDelivery } from './fields.mjs';
import { models, packedVolume, officialLogistics, officialStorage, turnoverBand, returnSize, warehouseReturnFees, categoryRate, isAutoCategory, cancellationPenalty, extensionPenalty, dimensionsPenalty, timeSlotPenalty } from './tariffs.mjs';

export function preparePlan(raw, categories) {
  const p = raw;
  const errors = [];
  const notices = [];
  const fixedCharges = [['Fixed overhead', p.fixed, 'estimate']];
  const paidByUzum = usesUzumDelivery(p);
  if (paidByUzum) fixedCharges.push(['Quoted Uzum inbound transport',p.inboundQuote,'estimate'],['Quoted preparation-center services',p.prepQuote,'estimate']);
  const cat = categories[p.category];
  const auto = p.model === 'EDBS' && (p.autoFee || isAutoCategory(cat));
  const rate = categoryRate(cat, p.model);
  const commission = auto ? 0 : p.rateMode === 'category' ? rate : p.commission;
  const rateSource = auto ? 'official' : p.rateMode === 'category' ? 'snapshot' : 'estimate';
  if (commission === null) errors.push(cat ? 'This category has no published rate for the selected model in the workbook. Confirm eligibility and enter the effective rate from the cabinet.' : 'Choose an Uzum category or enter a manual rate.');
  if (p.model === 'EDBS') notices.push('EDBS requires seller approval and a separate legal entity if you also use FBO, FBS or DBS. Check the current category rules in §10.');
  const bands = [];
  if (p.rateMode === 'bands' && !auto) {
    if (p.band2Price > 0) bands.push([p.band2Price,p.band2Rate]);
    if (p.band3Price > 0) {
      if (!bands.length || p.band3Price <= p.band2Price) errors.push('Enter price-band thresholds in ascending order. Zero disables a threshold.');
      else bands.push([p.band3Price,p.band3Rate]);
    }
  }

  const packageKnown = p.length > 0 && p.width > 0 && p.height > 0;
  const volume = packageKnown ? packedVolume(p.length,p.width,p.height) : null;
  const size = volume ? returnSize(p.length + p.width + p.height) : null;
  const officialDim = paidByUzum && p.logisticsMode === 'dimensions';
  let logistics = 0;
  if (paidByUzum) {
    if (officialDim && !volume) errors.push('Enter all three packed dimensions, or choose missing dimensions or a manual logistics fee.');
    logistics = p.logisticsMode === 'manual' ? p.logistics : officialDim && !volume ? 0 : officialLogistics(volume?.rounded, p.logisticsMode);
  }
  const logisticsSource = paidByUzum && p.logisticsMode === 'manual' ? 'estimate' : 'official';
  if (paidByUzum && p.weight === 0) notices.push('Packed weight is missing. Check category and handover limits in the seller manual.');
  if (p.model === 'FBS' && p.fbsPickup && (p.weight * p.unitsPerOrder > 6000 || size > 0)) notices.push('Check another FBS handover point: this plan exceeds the selected small-item / 6 kg pickup-point limit.');
  if (paidByUzum && (p.weight > 30000 || size === 2)) notices.push('Check the category-specific packing and fulfillment requirements for this large or heavy product.');

  const orderWeight = p.weight / 1000 * p.unitsPerOrder;
  const volumetricWeight = volume && p.volumetricDivisor > 0 ? volume.liters * 1000 * p.unitsPerOrder / p.volumetricDivisor : 0;
  const deliveryWeight = Math.max(orderWeight, volumetricWeight);
  if (p.model !== 'FBO' && p.deliveryKg > 0) {
    if (!p.weight) errors.push('Enter packed weight to calculate the quoted per-kg delivery charge.');
    if (p.volumetricDivisor > 0 && !volume) errors.push('Enter packed dimensions to calculate the carrier’s volumetric weight.');
  }

  if (p.returns && p.returnRate + p.refusedRate + p.cancelRate > 100 + 1e-9) errors.push('Returns, refusals and cancellations must add up to 100% or less.');
  if (!(p.unitsPerOrder > 0)) errors.push('Average units per order must be above zero.');

  let storageNote = '';
  if (p.storageEnabled) {
    if (p.model !== 'FBO' || p.storageMethod === 'manual') fixedCharges.push(['Inventory storage',p.storage,'estimate']);
    else {
      const days = p.turnoverMode === 'nosales' ? Infinity : p.turnoverMode === 'history'
        ? p.recentSales > 0 ? p.recentStock / p.recentSales : Infinity : p.turnover;
      const tier = turnoverBand(days);
      const grace = p.graceOverride || cat?.[4] || 30;
      const billableDays = tier === 0 ? 0 : Math.max(0, p.storageDays - (p.newStock ? Math.max(0, grace - p.skuAge) : 0));
      const special = p.storageClass === 'auto' ? Boolean(cat?.[3]) : p.storageClass === 'special';
      if (p.storageClass === 'auto' && !cat) notices.push('Storage uses the standard tariff until you select a category or choose the reduced tariff.');
      if (!volume && billableDays > 0 && p.stored > 0) errors.push('Enter packed dimensions or a billed storage amount for paid FBO storage.');
      const daily = volume ? officialStorage(volume.rounded, tier, special) : 0;
      fixedCharges.push(['FBO inventory storage', daily * p.stored * billableDays, 'estimate']);
      storageNote = (special ? 'Reduced' : 'Standard') + ' tariff · ' + billableDays + ' billable days · ' + daily.toLocaleString('en-US') + ' UZS per stocked unit/day' + (p.newStock ? ' · ' + grace + ' initial free days' : '');
    }
  }
  if (p.warehouseReturns && paidByUzum) {
    const selectedSize = p.returnSize === 'auto' ? size : Number(p.returnSize);
    const collected = p.model === 'FBO' ? p.collected : 0;
    if (selectedSize === null && (collected > 0 || p.held > 0 && p.holdDays > 10 || p.disposed > 0)) errors.push('Enter the package dimensions or select a warehouse-return size class.');
    const fee = warehouseReturnFees(p.model, selectedSize ?? 0, collected, p.held, p.holdDays, p.disposed);
    fixedCharges.push(['FBO stock withdrawal handling',fee.assembly,'official'], ['Return-waybill storage',fee.storage,'official'], ['Return-waybill disposal',fee.disposal,'official']);
    if (p.disposalWriteOff) fixedCharges.push(['Disposed inventory write-off',p.purchase*p.disposed,'estimate']);
  }
  if (p.promotionEnabled) fixedCharges.push(['Top Boost (CPM)',p.impressions * p.cpm / 1000,'estimate'], ['Other campaign spend',p.ads,'estimate']);
  if (p.penaltyEnabled) {
    if (paidByUzum) {
      fixedCharges.push(['Warehouse intake discrepancies', p.inboundIssues * 2500, 'official']);
      fixedCharges.push(['Supply time-slot penalties', timeSlotPenalty(p.date,p.slotViolation,p.slotUnits,p.slotEvents), 'official']);
    }
    if (p.model === 'FBS') {
      if (p.badDimsCount > 0 && (!volume || !p.declaredLiters)) errors.push('Enter measured package dimensions and declared volume for FBS volume penalties.');
      fixedCharges.push(['FBS volume mismatch',p.badDimsCount * dimensionsPenalty(volume?.liters ?? 0,p.declaredLiters),'official']);
      fixedCharges.push(['FBS delivery extensions',p.extensionCount * extensionPenalty(p.penaltyOrderValue),'official']);
      fixedCharges.push(['FBS wrong-item return penalties',p.wrongItemCount * p.wrongItemValue,'official']);
    }
    if (p.model !== 'FBO') {
      if ((p.cancelCount > 0 || p.model === 'FBS' && p.extensionCount > 0) && !p.penaltyOrderValue) errors.push('Enter the affected order value for cancellation or extension penalties.');
      fixedCharges.push(['Seller cancellation penalties', p.cancelCount * cancellationPenalty(p.model,p.penaltyOrderValue,p.cancelHours),'official']);
    }
    fixedCharges.push(['Prohibited item shipment penalties',p.prohibitedEvents*5000000,'official'],['Other assessed penalties',p.otherPenalty,'estimate']);
  }
  const input = {
    ...p,
    commission, bands, rateSource, auto, logistics, logisticsSource, fixedCharges,
    delivery: p.model === 'FBO' ? 0 : p.delivery + p.deliveryKg * deliveryWeight,
    payment: ['DBS','EDBS'].includes(p.model) ? p.payment : 0,
    discount: p.promotionEnabled ? p.discount : 0,
    boostRate: p.promotionEnabled ? p.boostRate : 0,
    tax: p.taxEnabled ? p.tax : 0,
    payout: p.payoutEnabled ? p.payout : 'fortnightly',
    urgentShare: p.payoutEnabled ? p.urgentShare : 0,
    ...(!p.returns && { returnRate:0,refusedRate:0,cancelRate:0 }),
  };
  return { input, errors, notices, volume, size, deliveryWeight, storageNote, modelNote:models[p.model], rate };
}
