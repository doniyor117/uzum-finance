const option = (value, label) => [value, label];
const options = labels => labels.map((label, index) => option(String(index), label));
const field = (id, label, type, more = {}) => ({ id, label, type, ...more });
const text = (id, label, max = 100) => field(id, label, 'text', { max });
const n = (id, label, unit = 'UZS', max = 1e10, step = 1) => field(id, label, 'number', { unit, max, step });
const pct = (id, label, max = 100) => n(id, label, '%', max, 'any');
const count = (id, label, unit = 'units', max = 1000000) => n(id, label, unit, max);
const sel = (id, label, choices) => field(id, label, 'select', { choices });
const chk = (id, label) => field(id, label, 'checkbox');
const when = (item, show) => ({ ...item, show });
const group = (id, label, kind, fields, note) => ({ id, label, kind, fields, note });
export const usesUzumDelivery = p => ['FBO','FBS'].includes(p.model);
const sellersDeliver = p => ['DBS','EDBS'].includes(p.model);
const tier = p => p.rateMode === 'bands';
const chosenPenalty = p => p.slotViolation !== '';
const activeManualStorage = p => p.storageMethod === 'manual' || p.model !== 'FBO';

export const basics = [
  text('name','Product name'), text('sku','SKU / variant'),
  sel('model','Fulfillment model', [['FBO','FBO · Uzum warehouse'],['FBS','FBS · Seller warehouse'],['DBS','DBS · Seller delivery'],['EDBS','EDBS · External deal']]),
  n('purchase','Landed purchase cost / unit'), n('price','List price / unit'),
  count('quantity','Ordered units for the period'), n('unitsPerOrder','Average units per order','units',10000,'any'),
];

export const commissionFields = [
  sel('rateMode','Rate source',[['category','Category workbook'],['manual','Manual effective rate'],['bands','Manual price bands']]),
  when(pct('commission','Effective rate / lowest band'), p => p.rateMode !== 'category'),
  when(n('band2Price','Second band begins at'), tier), when(pct('band2Rate','Second band rate'), tier),
  when(n('band3Price','Third band begins at'), tier), when(pct('band3Rate','Third band rate'), tier),
  when(chk('autoFee','Apply EDBS Auto fee per placed order'), p => p.model === 'EDBS'),
];

export const packageFields = [
  when(sel('logisticsMode','Uzum sales logistics',[['dimensions','Packed dimensions on file'],['missing','Missing packed dimensions on Uzum'],['sim','SIM card fixed charge'],['manual','Seller cabinet / manual charge']]),usesUzumDelivery),
  when(n('logistics','Manual logistics / kept unit'),p => usesUzumDelivery(p) && p.logisticsMode === 'manual'),
  count('length','Packed length','mm',100000), count('width','Packed width','mm',100000),
  count('height','Packed height','mm',100000), count('weight','Packed weight','g',10000000),
  when(chk('fbsPickup','Use an FBS pickup point with a 6 kg limit'),p => p.model === 'FBS'),
  when(n('delivery','Seller delivery / dispatched order'),p => p.model !== 'FBO'),
  when(n('deliveryKg','Quoted carrier surcharge / kg','UZS',1e7,'any'),p => p.model !== 'FBO'),
  when(n('volumetricDivisor','Carrier volumetric divisor','cm³/kg',1e7),p => p.model !== 'FBO' && Number(p.deliveryKg) > 0),
];

export const sellerFields = [
  n('packaging','Packaging, marking & handling / shipped unit'), n('inbound','Additional inbound / shipped unit'),
  n('fixed','Fixed overhead for the period'), when(pct('payment','Payment processing / installments'),sellersDeliver),
  when(n('inboundQuote','Uzum inbound transport quote / period'),usesUzumDelivery),
  when(n('prepQuote','Preparation center quote / period'),usesUzumDelivery),
];

export const modules = [
  group('returns','Buyer returns, refusals & cancellations','assumption',[
    pct('returnRate','Returned after delivery'),pct('refusedRate','Refused / undelivered after dispatch'),
    pct('cancelRate','Cancelled before dispatch'), pct('returnLoss','Purchase cost lost per returned unit'),
    pct('refusedLoss','Purchase cost lost per refused unit'),n('returnHandling','Handling / returned unit'), n('refusedHandling','Handling / refused unit'),
  ], 'Enter disjoint shares of ordered units. Include seller-paid return freight for defective DBS or EDBS returns where applicable. Ordinary sales fees are charged on kept units.'),
  group('storageEnabled','Inventory storage','mixed',[
    when(sel('storageMethod','FBO storage source',[['official','Official tariff estimate'],['manual','Manual or billed amount']]),p=>p.model==='FBO'),
    when(n('storage','Inventory storage for the period'),activeManualStorage),
    when(sel('storageClass','Tariff class',[['auto','From category'],['standard','Standard'],['special','Reduced']]),p=>!activeManualStorage(p)),
    when(sel('turnoverMode','Turnover input',[['days','Enter turnover days'],['history','Use 15-day averages'],['nosales','No sales in last 15 days']]),p=>!activeManualStorage(p)),
    when(n('turnover','Turnover days','days',1e7,'any'),p=>!activeManualStorage(p)&&p.turnoverMode==='days'),
    when(n('recentStock','15-day avg. daily stock','units',1e6,'any'),p=>!activeManualStorage(p)&&p.turnoverMode==='history'),
    when(n('recentSales','15-day avg. daily sales','units',1e6,'any'),p=>!activeManualStorage(p)&&p.turnoverMode==='history'),
    when(n('stored','Avg. stock on billed days','units',1e6,'any'),p=>!activeManualStorage(p)),
    when(count('storageDays','Storage days in planning period','days',3660),p=>!activeManualStorage(p)),
    when(chk('newStock','Apply remaining new-SKU grace days'),p=>!activeManualStorage(p)),
    when(count('skuAge','Days since SKU went on sale','days',20000),p=>!activeManualStorage(p)&&p.newStock),
    when(count('graceOverride','Override free days (0 = category default)','days',3660),p=>!activeManualStorage(p)&&p.newStock),
  ], 'Uzum recalculates stock and turnover daily. The estimate holds the entered stock and band constant for the period. Use a billed amount if those change materially.'),
  group('warehouseReturns','Warehouse withdrawal & return storage','official',[
    sel('returnSize','Return size class',[['auto','From sum of packed dimensions'],['0','Small · up to 60 cm'],['1','Medium · up to 170 cm'],['2','Large · above 170 cm']]),
    when(count('collected','Regular FBO units collected'),p=>p.model==='FBO'),
    count('held','Units on the return waybill'), count('holdDays','Days from waybill assembled','days',3660),
    count('disposed','Units disposed under return waybill'),
    when(chk('disposalWriteOff','Include purchase-cost write-off for disposed units'),p=>p.disposed>0),
  ], 'Regular FBO stock collected from the warehouse has a handling fee. FBS and defective items are exempt from that handling fee. All applicable return waybills can incur storage after 10 days. For disposal, enter your allocation of the full waybill. Count inventory loss only once.'),
  group('promotionEnabled','Discounts, promo codes & advertising','mixed',[
    pct('discount','Seller-funded price discount',99.99),
    sel('discountBasis','Commission base for discount',[['sale','Reduced selling price'],['coupon','Pre-discount price · seller promo code']]),
    pct('boostRate','Order Boost bid'),pct('boostShare','Share attributed to Order Boost'),
    chk('boostReturned','Assume boost also charged on delivered returns'),
    count('impressions','Top Boost impressions','views',1e9),n('cpm','Top Boost rate per 1,000 impressions'),
    n('ads','Additional ads / campaign spend for period'),
  ], 'Enter the discount you fund. For special Uzum promotions or fee tiers, use the effective rate from the cabinet. Order Boost rate and attribution are editable.'),
  group('payoutEnabled','Payout schedule & urgent withdrawals','mixed',[
    sel('payout','Scheduled payout',[['fortnightly','Every two weeks · 0%'],['monthly','Monthly · 0%'],['weekly','Weekly · 1%'],['daily','Every workday · 1.5%']]),
    pct('urgentShare','Share withdrawn urgently · 2.5%'),
  ], 'The estimate uses positive proceeds after commission and sales logistics. Scheduled and urgent shares are applied separately. Use a custom adjustment for other settlement deductions.'),
  group('taxEnabled','Tax & VAT assumption','assumption',[
    pct('tax','Editable tax rate'), sel('taxBasis','Tax calculation',[['gross','Percentage of item revenue'],['included','Tax included in item price']]),
  ], 'Use the tax treatment that applies to your business. Add social tax, VAT credits or other amounts through fixed costs or a custom line where applicable.'),
  group('penaltyEnabled','Penalties & exceptions','official',[
    when(count('inboundIssues','Warehouse discrepancy / defect events'),usesUzumDelivery),
    when(field('date','Supply date for time-slot rules','date'),usesUzumDelivery),
    when(sel('slotViolation','Supply time-slot case',[['','None'],['minor','Late cancel / reschedule or 24–72 h late'],['missed','72+ h late or missed']]),p=>usesUzumDelivery(p)&&p.date>='2026-12-01'),
    when(count('slotEvents','Affected supplies','supplies'),p=>usesUzumDelivery(p)&&p.date>='2026-12-01'&&chosenPenalty(p)),
    when(count('slotUnits','Affected units per supply'),p=>usesUzumDelivery(p)&&p.date>='2026-12-01'&&chosenPenalty(p)),
    when(count('badDimsCount','FBS volume mismatch events','events'),p=>p.model==='FBS'),
    when(n('declaredLiters','Declared packed volume','L',1e7,'any'),p=>p.model==='FBS'&&Number(p.badDimsCount)>0),
    when(count('extensionCount','FBS delivery extensions','orders'),p=>p.model==='FBS'),
    when(count('wrongItemCount','FBS confirmed wrong-item returns'),p=>p.model==='FBS'),
    when(n('wrongItemValue','Charged value / wrong item'),p=>p.model==='FBS'&&Number(p.wrongItemCount)>0),
    when(count('cancelCount','Penalized cancellations','orders'),p=>p.model!=='FBO'),
    when(n('cancelHours','Hours from creation to cancellation','hours',10000,'any'),p=>p.model!=='FBO'&&Number(p.cancelCount)>0),
    when(n('penaltyOrderValue','Average affected order value'),p=>p.model!=='FBO'&&(Number(p.cancelCount)>0||p.model==='FBS'&&Number(p.extensionCount)>0)),
    count('prohibitedEvents','Prohibited item shipment violations','events'),n('otherPenalty','Other assessed fees / penalties'),
  ], 'Penalty event counts are separate from the order mix. Enter like-for-like events; use a custom line for other batches. Published supply time-slot penalties apply from 1 Dec 2026.'),
];

export const defaults = {
  name:'', sku:'', model:'FBO', date:'2026-11-12', purchase:0, price:0, quantity:100, unitsPerOrder:1,
  category:'', rateMode:'category', commission:0, band2Price:0, band2Rate:0, band3Price:0, band3Rate:0, autoFee:false,
  logisticsMode:'dimensions', logistics:5250,length:0,width:0,height:0,weight:0,fbsPickup:false,delivery:0,deliveryKg:0,volumetricDivisor:0,
  packaging:0,inbound:0,fixed:0,payment:0,inboundQuote:0,prepQuote:0, returns:false,returnRate:0,refusedRate:0,cancelRate:0,returnLoss:0,refusedLoss:0,returnHandling:0,refusedHandling:0,
  storageEnabled:false,storageMethod:'official',storage:0,storageClass:'auto',turnoverMode:'days',turnover:0,recentStock:0,recentSales:0,stored:0,storageDays:0,newStock:false,skuAge:0,graceOverride:0,
  warehouseReturns:false,returnSize:'auto',collected:0,held:0,holdDays:0,disposed:0,disposalWriteOff:false,promotionEnabled:false,discount:0,discountBasis:'sale',boostRate:0,boostShare:100,boostReturned:false,impressions:0,cpm:0,ads:0,
  payoutEnabled:false,payout:'fortnightly',urgentShare:0,taxEnabled:false,tax:0,taxBasis:'gross',
  penaltyEnabled:false,inboundIssues:0,slotViolation:'',slotEvents:0,slotUnits:0,badDimsCount:0,declaredLiters:0,extensionCount:0,wrongItemCount:0,wrongItemValue:0,cancelCount:0,cancelHours:0,penaltyOrderValue:0,prohibitedEvents:0,otherPenalty:0,extra:[],
};
export const example = { ...defaults, name:'Example phone case',sku:'CASE-01',category:'11937',purchase:24000,price:39000,quantity:120,length:170,width:92,height:20,weight:85,packaging:900,inbound:500,fixed:120000 };
export const extraBases = [['period','Per period'],['placed','Per ordered unit'],['shipped','Per dispatched unit'],['kept','Per kept unit'],['returned','Per buyer return'],['refused','Per refusal'],['order','Per placed order'],['revenue','% of item revenue']];
