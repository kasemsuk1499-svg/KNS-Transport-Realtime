import test from 'node:test';
import assert from 'node:assert/strict';
import {collectTrips,countTrips,mergeWithSaved,weekRange,weeklyData} from './closeout-core.js';

test('counts one truck even when it carries multiple product rows',()=>{
  const trips=collectTrips({
    STP:{
      row1:{tripNo:1,productName:'Flour A',bags:40,tripStatus:'mismatch',transportCompany:'Carrier A',batchIssue:'small'},
      row2:{tripNo:1,productName:'Flour B',bags:20,tripStatus:'mismatch',batchIssue:'large'}
    },
    PTR:{row3:{tripNo:1,productName:'Flour C',tripStatus:'ok'}}
  });
  assert.equal(trips.length,2);
  const totals=countTrips(trips);
  assert.equal(totals.total,2);
  assert.equal(totals.mismatch,1);
  assert.equal(totals.ok,1);
  assert.equal(totals.small,1);
  assert.equal(totals.large,1);
  assert.equal(trips[0].bags,60);
  assert.equal(trips[0].transportCompany,'Carrier A');
  assert.equal(trips[0].batchIssue,'both');
});

test('same outbound container number in different bookings is not merged',()=>{
  const trips=collectTrips({OUT:{
    a:{bookingNo:'BK-A',tripNo:1,productName:'Product A'},
    b:{bookingNo:'BK-B',tripNo:1,productName:'Product B'}
  }});
  assert.equal(trips.length,2);
  assert.equal(countTrips(trips).total,2);
});

test('reopening a report retains feedback, including deleted source trips',()=>{
  const originally=collectTrips({STP:{a:{tripNo:2,productName:'Flour',tripStatus:'mismatch'}}});
  const stored=[{...originally[0],feedback:'Confirmed shortage',resolution:'Adjusted inventory'}];
  const retained=mergeWithSaved(collectTrips({STP:{}}),stored);
  assert.equal(retained.length,1);
  assert.equal(retained[0].feedback,'Confirmed shortage');
  assert.equal(retained[0].archived,true);
});

test('weeks use Monday through Sunday and do not assume unreported days have zero trips',()=>{
  const range=weekRange('2026-11-06');
  assert.equal(range.start,'2026-11-02');
  assert.equal(range.end,'2026-11-08');
  const trip=collectTrips({PTR:{a:{tripNo:1,productName:'A',tripStatus:'mismatch'}}})[0];
  const summary=weeklyData({'2026-11-06':{trips:[trip],note:'late batch'}},range.days);
  assert.equal(summary.savedDays,1);
  assert.equal(summary.totals.mismatch,1);
  assert.equal(summary.days.filter(d=>!d.saved).length,6);
});
