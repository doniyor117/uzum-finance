import { basics, commissionFields, packageFields, sellerFields, modules, defaults, example, extraBases, usesUzumDelivery } from './fields.mjs';
import { categoryRate, sources } from './tariffs.mjs';
import { preparePlan } from './plan.mjs';
import { calculate, breakEvenPrice, priceForMarkup, scenarioMarkups } from './model.mjs';

const byId = id => document.getElementById(id);
const form = byId('planner');
const query = byId('category-query');
const searchResults = byId('category-results');
const chooser = byId('product-select');
const newKey = 'uzum-profit-products-v2';
const legacyKey = 'sof-shops-uzum-planner-v1';
const format = new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const precise = new Intl.NumberFormat('en-US',{maximumFractionDigits:4});
const num = v => v === null || !Number.isFinite(v) ? '—' : format.format(Math.abs(v) < .005 ? 0 : v);
const pct = v => Number.isFinite(v) ? num(v) + '%' : '—';
const money = v => Number.isFinite(v) ? num(v) + ' UZS' : '—';
const write = (id,value) => { byId(id).textContent = value; };
const signed = (el,v) => {
  el.classList.toggle('gain',v >= .005);
  el.classList.toggle('loss',v <= -.005);
};
const element = (tag, className, content) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined) el.textContent = content;
  return el;
};
const badgeLabels = { official:'Official rule', snapshot:'Workbook rate', estimate:'Estimate' };
const badgeClass = { official:'verified', snapshot:'snapshot', estimate:'assumption' };
const labelBadge = (kind, label = badgeLabels[kind]) => element('span','badge ' + badgeClass[kind],label);
const displayMoney = (id,value) => {
  const el = byId(id);
  el.textContent = num(value);
  if (Number.isFinite(value)) el.append(element('span','money-unit',' UZS'));
};
const orderLabels = [
  ['total','total'],['unit-profit','profitPerKept'],['contribution','contribution'],
];
const resultIds = ['total','unit-profit','net-margin','markup','contribution','contribution-margin','break-even','break-even-revenue','break-even-price'];
let categories = {};
let searchIndex = [];
let catalogError = false;
let products = [];
let active = '';
let plan;
const fields = new Map();
const moduleBodies = new Map();

function createProduct(values) {
  return { ...structuredClone(defaults), ...structuredClone(values), id:crypto.randomUUID() };
}

function migrate(old) {
  const examples = { Sofmart:'Wallet',Sofcase:'Phone case',Sofgear:'Power bank' };
  return Object.entries(old?.shops ?? {}).map(([shop,p]) => createProduct({
    name:examples[shop] || 'Imported product',
    purchase:Number(p.purchase),price:Number(p.price),quantity:Number(p.quantity),fixed:Number(p.fixed),
    category:String(p.category || ''),rateMode:p.commissionMode || 'category',commission:Number(p.commission),
    logisticsMode:p.logisticsMode,logistics:Number(p.logistics),length:Number(p.length),width:Number(p.width),height:Number(p.height),
    packaging:Number(p.packaging),inbound:Number(p.inbound),payout:p.payout,payoutEnabled:p.payout && p.payout!=='fortnightly',
    tax:Number(p.tax),taxEnabled:Number(p.tax)>0,
    storageEnabled:Number(p.storage)>0||Number(p.billed)>0,storageMethod:p.storageMode,storage:Number(p.storage),
    storageClass:p.storageClass,turnover:[0,61,181,361][Number(p.storageTier)]||0,stored:Number(p.stored),storageDays:Number(p.billed),
    extra:Number(p.otherUnit)>0?[{name:'Other variable costs',basis:'kept',kind:'cost',amount:Number(p.otherUnit)}]:[],
  }));
}

function readSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(newKey));
    if (Array.isArray(data?.products)) {
      products = data.products.filter(p => p && typeof p.id === 'string').map(p => ({...structuredClone(defaults),...p}));
      active = data.active;
    }
    if (!products.length && !data) {
      const old = JSON.parse(localStorage.getItem(legacyKey));
      products = migrate(old);
      const index = Object.keys(old?.shops ?? {}).indexOf(old?.active);
      active = products[index]?.id;
    }
  } catch {
    write('save-status','Browser storage is unavailable.');
  }
  if (!products.length) products.push(createProduct(example));
  return products.find(p => p.id===active) || products[0];
}

function save() {
  try {
    localStorage.setItem(newKey,JSON.stringify({active,products}));
    write('save-status','Plans stay in this browser.');
  } catch {
    write('save-status','Browser storage is unavailable.');
  }
}

function drawChooser() {
  chooser.replaceChildren(...products.map((p,index) => {
    const option = element('option','',p.name.trim() || 'Untitled product ' + (index + 1));
    option.value = p.id;
    return option;
  }));
  chooser.value = active;
}

function makeField(definition) {
  const {id,label,type,choices,unit,max,step} = definition;
  const labelNode = element('label','field' + (type==='checkbox'?' inline-check':''));
  const title = element('span','',label);
  labelNode.htmlFor = id;
  const input = document.createElement(type==='select'?'select':'input');
  input.id = id;
  if (type==='select') {
    for (const [value,name] of choices) {
      const option = element('option','',name);
      option.value = value;
      input.append(option);
    }
  } else {
    input.type = type;
    if (type==='number') {
      input.min = 0;
      input.max = max;
      input.step = step;
      input.required = true;
      input.inputMode = step===1?'numeric':'decimal';
    } else if (type==='text') input.maxLength = max;
    else if (type==='date') input.required = true;
  }
  if (type==='number') {
    const control = element('span','control');
    control.append(input,element('span','',unit));
    labelNode.append(title,control);
  } else if (type==='checkbox') labelNode.append(input,title);
  else labelNode.append(title,input);
  fields.set(id,{labelNode,input,definition});
  return labelNode;
}

function fillFields(container,defs) {
  const body = element('div','fields');
  for (const field of defs) body.append(makeField(field));
  container.append(body);
}

function buildForm() {
  fillFields(byId('basics'),basics);
  fillFields(byId('commission-fields'),commissionFields);
  fillFields(byId('package-fields'),packageFields);
  fillFields(byId('seller-fields'),sellerFields);
  for (const module of modules) {
    const section = element('section','input-section');
    const header = element('div','module-head');
    const check = makeField({ id:module.id,label:module.label,type:'checkbox' });
    const body = element('div','module-body');
    header.append(check,labelBadge(module.kind==='official'?'official':'estimate',module.kind==='mixed'?'Rule + inputs':module.kind==='official'?'Published fees':'Optional'));
    fillFields(body,module.fields);
    body.append(element('p','hint',module.note));
    if (module.id==='storageEnabled') {
      const note=element('p','hint');
      note.id='storage-note';
      body.append(note);
    }
    section.append(header,body);
    byId('modules').append(section);
    moduleBodies.set(module.id,{section,body,fields:module.fields.map(f=>f.id)});
  }
  const shortcuts = element('div','shortcuts');
  for (const [id,label] of [['11937','Phone cases'],['12514','Earbud cases'],['13165','Wallets'],['14037','Power banks'],['14225','Wall chargers'],['12171','Cables & adapters']]) {
    const button = element('button','',label);
    button.type='button';
    button.dataset.category=id;
    shortcuts.append(button);
  }
  shortcuts.addEventListener('click',chooseCategory);
  query.closest('label').before(shortcuts);
  for (const [name,url] of Object.values(sources)) {
    const link = element('a','',name + ' ↗');
    link.href=url;
    link.target='_blank';
    link.rel='noopener noreferrer';
    byId('official-links').append(link);
  }
}

function drawPlan(product) {
  plan = product;
  active = plan.id;
  for (const [id,{input}] of fields) {
    if (input.type==='checkbox') input.checked = Boolean(plan[id]);
    else input.value = plan[id] ?? defaults[id];
  }
  query.value='';
  searchResults.hidden=true;
  drawChooser();
  drawExtras();
  render();
  save();
}

function drawExtras() {
  const container = byId('extra-lines');
  container.replaceChildren();
  for (const [index,line] of plan.extra.entries()) {
    const row = element('div','fields custom-line');
    for (const [key, label, choices] of [['name','Label',null],['amount','Amount',null],['basis','Charged by',extraBases],['kind','Type',[['cost','Cost'],['credit','Credit']]]]) {
      const wrap = element('label','field');
      const input = document.createElement(choices?'select':'input');
      if (choices) {
        for (const [value,name] of choices) {
          const option=element('option','',name);
          option.value=value;
          input.append(option);
        }
      } else if (key==='amount') {
        input.type='number';
        input.min=0;
        input.max=1e10;
        input.step='any';
        input.required=true;
      } else input.maxLength=70;
      input.value=line[key];
      input.dataset.extraIndex=index;
      input.dataset.extraKey=key;
      wrap.append(element('span','',label),input);
      row.append(wrap);
    }
    const remove = element('button','button remove','Remove line');
    remove.type='button';
    remove.addEventListener('click',() => {
      plan.extra.splice(index,1);
      drawExtras();
      render();
      save();
    });
    row.append(remove);
    container.append(row);
  }
  write('extra-count',plan.extra.length ? plan.extra.length + ' added' : 'Optional');
}

const normalizeSearch = text => text.toLowerCase().normalize('NFKC').replace(/['’‘ʻʼ\x60]/g,'');
function chooseCategory(event) {
  const result = event.target.closest('[data-category]');
  if (!result) return;
  const oldCategory=plan.category;
  plan.category = result.dataset.category;
  if (plan.category==='16263' && plan.logisticsMode==='dimensions') plan.logisticsMode='sim';
  else if (oldCategory==='16263' && plan.category!=='16263' && plan.logisticsMode==='sim') plan.logisticsMode='dimensions';
  byId('logisticsMode').value=plan.logisticsMode;
  query.value = '';
  searchResults.hidden = true;
  query.focus();
  render();
  save();
}
searchResults.addEventListener('click',chooseCategory);
query.addEventListener('input',() => {
  const terms = normalizeSearch(query.value.trim()).split(/\s+/).filter(Boolean);
  searchResults.replaceChildren();
  searchResults.hidden = !terms.length;
  if (!terms.length) return;
  const matching = searchIndex.filter(([id, , index]) => terms.every(term => /^\d+$/.test(term)?id.startsWith(term):index.includes(term))).slice(0,14);
  for (const [id,cat] of matching) {
    const rate=categoryRate(cat,plan.model);
    const button=element('button','',cat[0]||cat[1]);
    button.type='button';
    button.dataset.category=id;
    button.append(element('small','', '#' + id + ' · ' + (rate===null?'Check model eligibility':pct(rate)+' '+plan.model) + (cat[0]&&cat[1]?' · '+cat[1]:'')));
    searchResults.append(button);
  }
  if (!matching.length) searchResults.append(element('p','',catalogError?'Workbook lookup unavailable. Use a manual rate from the cabinet.':'No matches. Try a category ID or fewer words.'));
});
query.addEventListener('keydown',event => {
  if (event.key==='Escape') searchResults.hidden=true;
  if (event.key==='ArrowDown' && !searchResults.hidden && searchResults.firstElementChild?.tagName==='BUTTON') {
    event.preventDefault();
    searchResults.firstElementChild.focus();
  }
});
form.addEventListener('submit',event=>event.preventDefault());
form.addEventListener('input',event => {
  const input=event.target;
  if (input===query) return;
  if (input.dataset.extraKey) {
    const key=input.dataset.extraKey;
    if (input.validity.valid) plan.extra[Number(input.dataset.extraIndex)][key]=key==='amount'?input.valueAsNumber:input.value;
  } else if (fields.has(input.id)) {
    if (input.validity.valid) plan[input.id]=input.type==='checkbox'?input.checked:input.type==='number'?input.valueAsNumber:input.value;
    if (input.id==='name') drawChooser();
  }
  render();
  if (input.validity.valid) save();
});

function syncVisibility() {
  const hiddenModuleFields=new Set();
  for (const [id,module] of moduleBodies) {
    const applicable=(id!=='warehouseReturns'||usesUzumDelivery(plan))&&(id!=='payoutEnabled'||plan.model!=='EDBS');
    module.section.hidden=!applicable;
    module.body.hidden=!applicable||!plan[id];
    if (module.body.hidden) for (const field of module.fields) hiddenModuleFields.add(field);
  }
  const errors=[];
  for (const [id,{input,labelNode,definition}] of fields) {
    labelNode.hidden=hiddenModuleFields.has(id)||Boolean(definition.show&&!definition.show(plan));
    const invalid=!labelNode.hidden&&!input.closest('section[hidden]')&&!input.validity.valid;
    if (invalid) {
      input.setAttribute('aria-invalid','true');
      errors.push(definition.label);
    } else input.removeAttribute('aria-invalid');
  }
  for (const input of byId('extra-lines').querySelectorAll('input[type=number]')) {
    if (!input.validity.valid || !Number.isFinite(input.valueAsNumber)) errors.push('Custom line amount');
  }
  if (plan.extra.some(l=>l.basis==='revenue'&&l.amount>100)) errors.push('Custom revenue percentage (0–100%)');
  return [...new Set(errors)];
}

function render() {
  const invalid=syncVisibility();
  const context=preparePlan(plan,categories);
  const {input,errors,notices,volume,size,deliveryWeight,modelNote,storageNote,rate}=context;
  const cat=categories[plan.category];
  if (catalogError) notices.unshift('Category workbook could not load. Enter an effective rate from the cabinet.');
  if (invalid.length) errors.unshift('Check these fields: '+invalid.join(', ')+'.');
  write('category-current',cat?'#'+plan.category+' · '+(cat[0]||cat[1]):'Choose a category or enter the rate shown in your seller cabinet.');
  const result=errors.length?null:calculate(input);
  const displayRate=result?.commission??input.commission;
  const rateBadge=labelBadge(input.rateSource,input.rateSource==='snapshot'?'Uzum workbook':undefined);
  rateBadge.id='rate-badge';
  byId('rate-badge').replaceWith(rateBadge);
  write('commission-note',modelNote + ' ' + (input.auto?'Official Auto fee: 120,000 UZS per placed order.':displayRate===null?'Check the category and model.':pct(displayRate)+' effective rate'+(plan.rateMode==='bands'?' at the entered list price.':'.'))+(rate!==null&&plan.rateMode!=='category'&&!input.auto?' Workbook reference: '+pct(rate)+'.':''));
  const logisticsBadge=labelBadge(input.logisticsSource);
  logisticsBadge.id='logistics-badge';
  byId('logistics-badge').replaceWith(logisticsBadge);
  const packing=volume?precise.format(volume.liters)+' L packed → '+num(volume.rounded)+' L for Uzum tariffs · '+['small','medium','large'][size]+' return size':'Package volume is unavailable';
  const logistics=usesUzumDelivery(plan)?money(input.logistics)+' per kept unit':'No Uzum sales logistics fee';
  const quoted=plan.model!=='FBO'&&plan.deliveryKg>0?' · '+num(deliveryWeight)+' kg carrier billing weight':'';
  write('package-note',packing+' · '+logistics+quoted+'. Weight affects carrier quotes and handover eligibility. Uzum’s sales tariff uses liters.');
  write('seller-note',plan.model==='DBS'?'Include buyer delivery in the item price and enter your actual delivery cost above.':'Enter incremental seller costs in this section. Keep the purchase cost free of costs already entered here.');
  write('storage-note',storageNote);
  const feedback=byId('validation');
  feedback.hidden=!errors.length&&!notices.length;
  feedback.replaceChildren(...errors.map(text=>element('p','',text)),...notices.map(text=>element('p','notice',text)));
  if (!result) {
    for (const id of resultIds) write(id,'—');
    for (const id of ['profit-status','unit-profit','net-margin','contribution']) signed(byId(id),0);
    write('profit-status','Check inputs');
    write('revenue-caption','Complete the product details to see the projection.');
    write('break-even-price-caption','At planned volume');
    write('comparison-note','Complete the required inputs to compare prices.');
    write('variable-summary','');
    byId('ledger').replaceChildren();
    byId('scenarios').replaceChildren();
    return;
  }
  for (const [id,key] of orderLabels) displayMoney(id,result[key]);
  write('revenue-caption',money(result.revenue)+' item revenue · '+num(input.quantity*result.kept)+' expected kept / '+num(input.quantity)+' ordered');
  write('profit-status',result.total>.005?'Projected profit':result.total<-.005?'Projected loss':'Break-even');
  signed(byId('profit-status'),result.total);
  signed(byId('unit-profit'),result.profitPerKept);
  signed(byId('contribution'),result.contribution);
  write('net-margin',pct(result.margin));
  write('markup',pct(result.markup));
  write('contribution-margin',result.contributionMargin===null?'No retained sales revenue':pct(result.contributionMargin)+' of net item revenue');
  write('break-even',result.breakEvenUnits===null?'Unreachable':num(result.breakEvenUnits)+' ordered');
  write('break-even-revenue',result.breakEvenUnits===null?'Needs positive contribution':num(result.breakEvenKept)+' kept · '+money(result.breakEvenRevenue));
  const floor=breakEvenPrice(input);
  displayMoney('break-even-price',floor);
  write('break-even-price-caption',!input.quantity?'Enter planned units':floor===null?'Unreachable at these rates':'At '+num(input.quantity)+' ordered units');
  drawScenarios(input,result);
  drawLedger(input,result);
}

function drawScenarios(input,result) {
  const body=byId('scenarios');
  body.replaceChildren();
  write('comparison-note',input.purchase?'Amounts in UZS. Use a scenario’s list price in your plan.':'Enter a purchase cost above zero to compare markups.');
  if (!input.purchase) return;
  const choices=scenarioMarkups.map(markup=>[pct(markup),priceForMarkup(input.purchase,markup)]);
  for (const [label,price] of choices) {
    const estimate=calculate(input,price);
    const row=body.insertRow();
    const current=price===result.listPrice;
    row.classList.toggle('active',current);
    const heading=element('th','',label);
    heading.scope='row';
    row.append(heading);
    for (const [text,value] of [[num(price),0],[pct(estimate.margin),estimate.margin],[estimate.breakEvenUnits===null?'Unreachable':num(estimate.breakEvenUnits),0],[num(estimate.total),estimate.total]]) {
      const cell=row.insertCell();
      cell.textContent=text;
      signed(cell,value);
    }
    const use=element('button','apply',current?'In use':'Use price');
    use.type='button';
    use.disabled=current||price>Number(byId('price').max);
    use.setAttribute('aria-label','Use price for '+label+' markup');
    use.addEventListener('click',()=>{
      plan.price=price;
      byId('price').value=price;
      render();
      save();
      byId('price').focus();
    });
    row.insertCell().append(use);
  }
}

function drawLedger(input,result) {
  const ledger=byId('ledger');
  write('variable-summary',money(result.unitCost)+' / ordered unit');
  const lines = [
    ['Variable costs for the period',null],
    ...result.variable.map(([label,value,kind])=>[label,value*input.quantity,kind]),
    ['Period charges',null], ...result.period,
    ['Total projected costs',result.unitCost*input.quantity+result.overhead],
    ['Profit per ordered unit',result.profitPerPlaced],
  ];
  ledger.replaceChildren(...lines.filter(([,amount,kind])=>kind===undefined||Math.abs(amount)>=.005).map(([name,amount,kind])=>{
    const line=element('div',amount===null?'ledger-group':kind===undefined?'ledger-total':'');
    const label=element('span','entry-name',name);
    if (kind) label.append(labelBadge(kind));
    line.append(label);
    if (amount!==null) line.append(element('strong','',money(amount)));
    return line;
  }));
}

chooser.addEventListener('change',()=>drawPlan(products.find(p=>p.id===chooser.value)));
byId('new-product').addEventListener('click',()=>{
  const p=createProduct(defaults);
  products.push(p);
  drawPlan(p);
  byId('name').focus();
});
byId('copy-product').addEventListener('click',()=>{
  const p=createProduct({...plan,name:(plan.name||'Product')+' copy'});
  products.push(p);
  drawPlan(p);
  byId('name').focus();
});
byId('delete-product').addEventListener('click',()=>{
  if (!window.confirm('Delete this saved product from this browser?')) return;
  products=products.filter(p=>p.id!==active);
  if (!products.length) products.push(createProduct(defaults));
  drawPlan(products[0]);
});
byId('add-line').addEventListener('click',()=>{
  plan.extra.push({name:'Custom fee',basis:'period',kind:'cost',amount:0});
  drawExtras();
  render();
  save();
  byId('extra-lines').lastElementChild.querySelector('input').focus();
});

buildForm();
try {
  const response=await fetch(new URL('./categories.json',import.meta.url));
  if (!response.ok) throw new Error('Unavailable category snapshot');
  categories=await response.json();
  searchIndex=Object.entries(categories).map(([id,cat])=>[id,cat,normalizeSearch(cat.slice(0,2).join(' '))]);
} catch {
  catalogError=true;
}
drawPlan(readSaved());
