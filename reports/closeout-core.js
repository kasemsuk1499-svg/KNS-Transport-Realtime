// KNS daily/weekly closeout: pure calculation helpers (no database side effects).
export const PAGES = ['STP', 'PTR', 'OUT'];
export const BATCH_TYPES = ['none', 'small', 'large', 'both'];
export const STATUS_LABELS = { ok:'ตรงแผน', mismatch:'ไม่ตรงแผน', rollover:'เลื่อนไปวันถัดไป', pending:'ยังไม่ระบุ' };
export const BATCH_LABELS = {none:'ไม่มี',small:'แบชเล็ก',large:'แบชใหญ่',both:'ทั้งแบชเล็กและแบชใหญ่'};
const str = value => String(value ?? '').trim();
const numeric = value => { const n=Number(String(value ?? '').replace(/,/g,''));return Number.isFinite(n)?n:0; };
const validType = v => BATCH_TYPES.includes(v) ? v : 'none';
const validStatus = v => Object.hasOwn(STATUS_LABELS,v) ? v : 'pending';
export function tripKey(page, bookingNo, tripNo, rowId=''){
  return JSON.stringify([page, page==='OUT'?str(bookingNo):'', str(tripNo) || '@'+str(rowId)]);
}
export function collectTrips(sourceByPage){
  const output = new Map();
  for(const page of PAGES){
    const raw = sourceByPage?.[page] || {};
    for(const [id,row] of Object.entries(raw)){
      if(!row || typeof row!=='object') continue;
      // Ignore completely blank placeholders; they are not a dispatched trip.
      const meaningful = ['tripNo','exportRound','bookingNo','productName','batchNo','tankCode','bags','kg','remark','transportCompany','tripStatus'].some(k=>str(row[k]));
      if(!meaningful) continue;
      const tripNo = str(row.tripNo || row.exportRound);
      const bookingNo = page==='OUT'?str(row.bookingNo):'';
      const key = tripKey(page,bookingNo,tripNo,id);
      if(!output.has(key)) output.set(key,{
        key,page,tripNo:tripNo||'ไม่ระบุ',bookingNo,transportCompany:'',
        batchIssue:'none',batchIssueNote:'',status:'pending',
        bags:0,kg:0,items:0,feedback:'',resolution:'',products:[],rowIds:[]
      });
      const item=output.get(key);
      item.rowIds.push(id);
      item.items++;
      item.bags+=numeric(row.bags);
      item.kg+=numeric(row.kg);
      if(str(row.productName) && !item.products.includes(str(row.productName)))item.products.push(str(row.productName));
      if(!item.transportCompany && str(row.transportCompany))item.transportCompany=str(row.transportCompany);
      if(!item.batchIssueNote && str(row.batchIssueNote))item.batchIssueNote=str(row.batchIssueNote);
      const type=validType(row.batchIssue);
      if(type!=='none'){
        const types=new Set([item.batchIssue,type].flatMap(v=>v==='both'?['small','large']:v==='none'?[]:[v]));
        item.batchIssue=types.size===2?'both':types.has('small')?'small':'large';
      }
      const status=validStatus(row.tripStatus);
      const rank={pending:0,ok:1,rollover:2,mismatch:3};
      if(rank[status]>rank[item.status])item.status=status;
    }
  }
  return [...output.values()].sort((a,b)=> PAGES.indexOf(a.page)-PAGES.indexOf(b.page) ||
    (Number(a.tripNo)-Number(b.tripNo) || a.tripNo.localeCompare(b.tripNo,'th')) ||
    a.bookingNo.localeCompare(b.bookingNo,'th'));
}
export function mergeWithSaved(fresh, savedTrips){
  const old = Array.isArray(savedTrips)?savedTrips:Object.values(savedTrips||{});
  const oldByKey=new Map(old.filter(Boolean).map(t=>[t.key,t]));
  const refreshed=fresh.map(trip=>{
    const prev=oldByKey.get(trip.key);
    if(!prev)return trip;
    // Previously reviewed fields belong to the report. Refresh quantities from current plan.
    return {...trip,
      transportCompany:str(prev.transportCompany ?? trip.transportCompany),
      batchIssue:validType(prev.batchIssue ?? trip.batchIssue),
      batchIssueNote:str(prev.batchIssueNote ?? trip.batchIssueNote),
      status:validStatus(prev.status ?? trip.status),
      feedback:str(prev.feedback),
      resolution:str(prev.resolution)
    };
  });
  // A plan row can be deleted after closeout. Do not silently discard its saved
  // historical result or feedback when the report is reopened.
  const visible=new Set(refreshed.map(t=>t.key));
  return [...refreshed,...old.filter(t=>!visible.has(t.key)).map(t=>({...t,archived:true}))];
}
export function countTrips(trips){
  const data={total:0,ok:0,mismatch:0,rollover:0,pending:0,small:0,large:0,bags:0,kg:0,byPage:{}};
  for(const page of PAGES)data.byPage[page]={total:0,ok:0,mismatch:0,rollover:0,pending:0};
  for(const t of trips||[]){
    const status=validStatus(t.status),batch=validType(t.batchIssue);
    data.total++;data[status]++;data.byPage[t.page] ??= {total:0,ok:0,mismatch:0,rollover:0,pending:0};
    data.byPage[t.page].total++;data.byPage[t.page][status]++;
    if(batch==='small'||batch==='both')data.small++;
    if(batch==='large'||batch==='both')data.large++;
    data.bags+=numeric(t.bags);data.kg+=numeric(t.kg);
  }
  return data;
}
function utcISO(d){return d.toISOString().slice(0,10);}
export function addDays(iso,days){
  const date=new Date(iso+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return utcISO(date);
}
export function weekRange(iso){
  const day=new Date(iso+'T12:00:00Z').getUTCDay();
  const monday=addDays(iso,-((day+6)%7));
  return {start:monday,end:addDays(monday,6),days:Array.from({length:7},(_,i)=>addDays(monday,i))};
}
export function weeklyData(reports, days){
  const rows=[],dayRows=[];
  for(const day of days){
    const report=reports?.[day];
    if(!report){dayRows.push({day,saved:false,...countTrips([])});continue;}
    const trips=Array.isArray(report.trips)?report.trips:Object.values(report.trips||{});
    const metrics=countTrips(trips);
    dayRows.push({day,saved:true,...metrics,note:str(report.note),revision:report.revision||1});
    for(const t of trips)rows.push({...t,day});
  }
  return {days:dayRows,trips:rows,totals:countTrips(rows),savedDays:dayRows.filter(d=>d.saved).length};
}
