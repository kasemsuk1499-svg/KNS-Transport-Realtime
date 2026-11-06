import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CARRIERS,carrierList,carrierTotals,periodRange} from './carriers.js';

test('starts with three requested carriers and supports saved names without duplicates',()=>{
  assert.deepEqual(DEFAULT_CARRIERS,['KNS','มีโชค','จิรภัทร']);
  const names=carrierList({a:{name:'ขนส่งใหม่'},b:{name:'KNS'},c:' จิรภัทร '});
  assert.deepEqual(names,['KNS','มีโชค','จิรภัทร','ขนส่งใหม่']);
});

test('groups repeated product rows as distinct trip records already normalized by closeout',()=>{
  const data=carrierTotals({
    '2026-11-03':{trips:[
      {page:'STP',tripNo:'1',transportCompany:'KNS',status:'ok'},
      {page:'PTR',tripNo:'1',transportCompany:'KNS',status:'mismatch'},
      {page:'STP',tripNo:'2',transportCompany:'มีโชค',status:'rollover'},
      {page:'PTR',tripNo:'3',transportCompany:'จิรภัทร',status:'pending'}
    ]},
    '2026-11-04':{trips:[
      {page:'STP',tripNo:'1',transportCompany:'KNS',status:'ok'},
      {page:'STP',tripNo:'2',transportCompany:'',status:'mismatch'}
    ]}
  },'2026-11-01','2026-11-30');
  assert.equal(data.reportDays,2);
  assert.equal(data.total.completed,4);
  assert.equal(data.total.rollover,1);
  assert.equal(data.total.pending,1);
  assert.equal(data.carriers.find(x=>x.name==='KNS').completed,3);
  assert.equal(data.carriers.find(x=>x.name==='KNS').byPage.PTR,1);
  assert.equal(data.carriers.find(x=>x.name==='มีโชค').completed,0);
  assert.equal(data.carriers.find(x=>x.name==='ไม่ระบุขนส่ง').completed,1);
});

test('month and year boundaries are correct, including leap years',()=>{
  assert.deepEqual(periodRange('week','2026-11-06'),{start:'2026-11-02',end:'2026-11-08'});
  assert.deepEqual(periodRange('month','2026-11-06'),{start:'2026-11-01',end:'2026-11-30'});
  assert.deepEqual(periodRange('month','2028-02-01'),{start:'2028-02-01',end:'2028-02-29'});
  assert.deepEqual(periodRange('year','2026-11-06'),{start:'2026-01-01',end:'2026-12-31'});
});

test('only reports inside requested range count',()=>{
  const a=carrierTotals({'2026-11-01':{trips:[{page:'STP',status:'ok',transportCompany:'KNS'}]},
    '2026-12-01':{trips:[{page:'STP',status:'ok',transportCompany:'มีโชค'}]}},'2026-11-01','2026-11-30');
  assert.equal(a.total.completed,1);
  assert.equal(a.carriers.length,1);
});
