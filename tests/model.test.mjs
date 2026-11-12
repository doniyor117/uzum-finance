import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { defaults, example } from '../dist/fields.mjs';
import { preparePlan } from '../dist/plan.mjs';
import { calculate, breakEvenPrice, priceForMarkup } from '../dist/model.mjs';
import { packedVolume, officialLogistics, officialStorage, turnoverBand, returnSize, warehouseReturnFees, cancellationPenalty, extensionPenalty, dimensionsPenalty, timeSlotPenalty, categoryRate } from '../dist/tariffs.mjs';

const catalog = JSON.parse(readFileSync(new URL('../dist/categories.json',import.meta.url)));
const close = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-7, actual+' vs '+expected);
const readLine = (lines,name) => lines.find(([label])=>label===name)?.[1];
function input(overrides) {
  const prepared = preparePlan({...example,...overrides},catalog);
  assert.deepEqual(prepared.errors,[]);
  return prepared.input;
}

test('bilingual snapshot contains per-model rates and unknowns are not zero',()=>{
  assert.equal(Object.keys(catalog).length,4980);
  assert.deepEqual(catalog[11937][2],[20.5,20.5,20.5,20]);
  assert.equal(categoryRate(catalog[13165],'FBO'),30);
  assert.equal(categoryRate(catalog[14037],'FBO'),25.5);
  assert.equal(categoryRate(undefined,'DBS'),null);
  assert.ok(preparePlan({...defaults,length:100,width:100,height:100},catalog).errors.length);
});

test('official logistics example, rounding, missing package, SIM and cap',()=>{
  assert.deepEqual(packedVolume(500,380,300),{liters:57,rounded:57});
  assert.equal(officialLogistics(57,'dimensions'),19250);
  assert.equal(officialLogistics(packedVolume(100,100,100).rounded,'dimensions'),5250);
  assert.equal(officialLogistics(packedVolume(101,100,100).rounded,'dimensions'),5500);
  assert.equal(officialLogistics(1000,'dimensions'),50000);
  assert.equal(officialLogistics(undefined,'missing'),50000);
  assert.equal(officialLogistics(undefined,'sim'),20000);
  assert.equal(input({model:'DBS',logisticsMode:'missing'}).logistics,0);
});

test('storage tiers, caps, remaining new-stock grace and seller storage',()=>{
  assert.deepEqual([60,60.1,180,180.1,360,360.1].map(turnoverBand),[0,1,1,2,2,3]);
  assert.deepEqual([0,1,2,3].map(i=>officialStorage(6,i,false)),[0,72,108,144]);
  assert.deepEqual([0,1,2,3].map(i=>officialStorage(6,i,true)),[0,72,84,108]);
  assert.equal(officialStorage(1280,3,false),5000);
  assert.equal(officialStorage(1280,3,true),3000);
  const warehouse = {storageEnabled:true,storageDays:20,stored:30,newStock:true,skuAge:20,turnoverMode:'history',recentStock:30,recentSales:0};
  assert.equal(readLine(input(warehouse).fixedCharges,'FBO inventory storage'),7200);
  assert.equal(readLine(input({...warehouse,category:'13165'}).fixedCharges,'FBO inventory storage'),0);
  assert.equal(readLine(input({...warehouse,model:'FBS',storage:4400}).fixedCharges,'Inventory storage'),4400);
});

test('warehouse return size boundaries, grace, exemptions and disposal',()=>{
  assert.deepEqual([600,601,1700,1701].map(returnSize),[0,1,1,2]);
  assert.deepEqual(warehouseReturnFees('FBO',1,3,4,12,2),{assembly:15000,storage:12000,disposal:16000});
  assert.deepEqual(warehouseReturnFees('FBS',2,3,4,10,1),{assembly:0,storage:0,disposal:40000});
});

test('seller penalties honor time boundaries, minimums, caps and effective date',()=>{
  assert.equal(cancellationPenalty('FBS',100000,24),0);
  assert.equal(cancellationPenalty('FBS',100000,24.01),10000);
  assert.equal(cancellationPenalty('DBS',100000,12),0);
  assert.equal(cancellationPenalty('EDBS',1000000,24),30000);
  assert.equal(cancellationPenalty('DBS',1000000,24.01),50000);
  assert.equal(cancellationPenalty('DBS',9000000,120.01),360000);
  assert.equal(extensionPenalty(100000),5000);
  assert.equal(extensionPenalty(9000000),100000);
  assert.equal(dimensionsPenalty(3,2),0);
  assert.equal(dimensionsPenalty(4,2),50000);
  assert.equal(dimensionsPenalty(13,10),0);
  assert.equal(timeSlotPenalty('2026-11-30','missed',200,2),0);
  assert.equal(timeSlotPenalty('2026-12-01','missed',200,2),600000);
});

test('return and refusal avoid sales fees while dispatch and inventory losses remain',()=>{
  const p=input({purchase:20000,price:50000,quantity:100,fixed:100000,packaging:1000,inbound:0,returns:true,returnRate:10,refusedRate:5,cancelRate:5,returnLoss:50,returnHandling:2000,refusedHandling:1000});
  const r=calculate(p);
  close(r.kept,.8);
  close(r.dispatched,.95);
  close(r.revenue,4000000);
  close(readLine(r.variable,'Cost of goods and inventory write-offs'),17000);
  close(readLine(r.variable,'Sales commission'),8200);
  close(readLine(r.variable,'Uzum sales logistics'),4200);
  close(readLine(r.variable,'Buyer returns & refused-order handling'),250);
  close(r.contribution,9400);
  close(r.total,840000);
  close(r.profitPerKept,10500);
  close(r.margin,21);
  assert.equal(r.breakEvenUnits,11);
  assert.equal(breakEvenPrice(p),36793);
  assert.ok(preparePlan({...example,returns:true,returnRate:70,refusedRate:40},catalog).errors.length);
});

test('coupon, settlement, carrier delivery and custom credit calculate on their own bases',()=>{
  const p=input({model:'DBS',price:100000,quantity:10,purchase:40000,unitsPerOrder:2,delivery:6000,deliveryKg:1000,weight:1000,packaging:0,inbound:0,
    rateMode:'manual',commission:20,promotionEnabled:true,discount:10,discountBasis:'coupon',boostRate:2,boostShare:50,
    payoutEnabled:true,payout:'weekly',urgentShare:20,taxEnabled:true,tax:12,taxBasis:'included',
    extra:[{name:'Payout credit',amount:500,basis:'placed',kind:'credit'}]});
  const r=calculate(p);
  close(r.realizedPrice,90000);
  close(readLine(r.variable,'Sales commission'),20000);
  close(readLine(r.variable,'Seller delivery / dispatch'),4000);
  close(readLine(r.variable,'Order Boost'),900);
  close(readLine(r.variable,'Payout fees'),910);
  close(readLine(r.variable,'Tax assumption'),90000*12/112);
  close(readLine(r.variable,'Payout credit'),-500);
});

test('EDBS uses service rather than sales commission and Auto counts placed orders',()=>{
  const p=input({model:'EDBS',returns:true,returnRate:10,cancelRate:10,unitsPerOrder:2});
  const r=calculate(p);
  close(readLine(r.variable,'EDBS service fee'),.8*39000*.20);
  assert.equal(readLine(r.variable,'Uzum sales logistics'),0);
  assert.equal(readLine(r.variable,'Payout fees'),0);
  const auto=calculate({...p,auto:true,commission:0});
  assert.equal(readLine(auto.variable,'EDBS Auto service per placed order'),60000);
});

test('break-even handles discontinuous bands and checks the first whole-soum price',()=>{
  const priceJump=input({purchase:1400,fixed:0,packaging:0,inbound:0,logisticsMode:'manual',logistics:0,rateMode:'bands',commission:90,band2Price:2000,band2Rate:20,band3Price:5000,band3Rate:70});
  assert.equal(breakEvenPrice(priceJump),2000);
  assert.equal(calculate(priceJump,1999).commission,90);
  assert.equal(calculate(priceJump,2000).commission,20);
  assert.equal(calculate(priceJump,5000).commission,70);
  for (const model of ['FBO','FBS','DBS','EDBS']) {
    for (const commission of [0,20.5,70,95]) {
      const p=input({model,rateMode:'manual',commission,payoutEnabled:true,payout:'daily',urgentShare:50,returns:true,returnRate:5,refusedRate:3,cancelRate:2});
      const price=breakEvenPrice(p);
      assert.ok(calculate(p,price).total>=-1e-7);
      assert.ok(calculate(p,price-1).total<0);
    }
  }
  assert.equal(priceForMarkup(24000,60),38400);
});

test('zero sales and negative contribution use explicit unavailable results',()=>{
  const p=input({quantity:0,fixed:110000});
  const r=calculate(p);
  assert.equal(r.total,-110000);
  assert.equal(r.profitPerKept,null);
  assert.equal(r.margin,null);
  assert.equal(breakEvenPrice(p),null);
  assert.equal(calculate(input({price:500,fixed:0})).breakEvenUnits,null);
});
