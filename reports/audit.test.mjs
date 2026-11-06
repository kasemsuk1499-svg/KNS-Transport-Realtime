import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudit} from './audit.js';

function mockDatabase(rows){
  let next=0,lastPatch=null;
  const ref=(_db,path='')=>({toString:()=>('https://db.example.test/'+path)});
  const api={
    ref,
    get:async r=>{
      const path=new URL(r.toString()).pathname.slice(1);
      return {val:()=>rows[path]??null};
    },
    push:()=>({key:'event'+(++next)}),
    serverTimestamp:()=>1234567,
    update:async(_target,patch)=>{lastPatch=patch;return true;},
    remove:async()=>true
  };
  return {api,ref,getPatch:()=>lastPatch};
}

test('batch number edit creates a separate automatic log atomically with the plan change',async()=>{
  const key='knsTransport/pages/STP/plans/2026-11-06/rows/idA';
  const db=mockDatabase({[key]:{tripNo:7,productName:'Flour',batchNo:'OLD',tankCode:'T1'}});
  const audit=createAudit({},db.api);
  await audit.update(db.ref({},key),{batchNo:'NEW',updatedAt:1234567});
  const patch=db.getPatch();
  assert.equal(patch[key+'/batchNo'],'NEW');
  const batchKey=Object.keys(patch).find(k=>k.startsWith('knsTransport/reports/batchChanges/2026-11-06/'));
  assert.ok(batchKey);
  assert.equal(patch[batchKey].oldBatchNo,'OLD');
  assert.equal(patch[batchKey].newBatchNo,'NEW');
  assert.equal(patch[batchKey].reviewStatus,'needs_review');
  assert.equal(patch[batchKey].tripNo,'7');
  assert.equal(Object.keys(patch).filter(k=>k.startsWith('knsTransport/reports/batchChanges/')).length,1);
});

test('location-only edits do not become batch problems',async()=>{
  const key='knsTransport/pages/PTR/plans/2026-11-06/rows/idB';
  const db=mockDatabase({[key]:{batchNo:'A',location:'1A-02'}});
  await createAudit({},db.api).update(db.ref({},key),{location:'2A-02',updatedAt:1234567});
  const patch=db.getPatch();
  assert.equal(Object.keys(patch).filter(k=>k.includes('/reports/batchChanges/')).length,0);
  assert.equal(Object.keys(patch).filter(k=>k.includes('/reports/edits/')).length,0);
});

test('new blank rows are not falsely logged as batch edits',async()=>{
  const key='knsTransport/pages/STP/plans/2026-11-06/rows/newRow';
  const db=mockDatabase({});
  await createAudit({},db.api).update(db.ref({},''),{[key]:{batchNo:'',tripNo:1}});
  assert.equal(Object.keys(db.getPatch()).filter(k=>k.includes('/reports/batchChanges/')).length,0);
});
