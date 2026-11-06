// Shared catalog of carrier names for the transport plan and closeout reports.
export const DEFAULT_CARRIERS = ['KNS','มีโชค','จิรภัทร'];
export const CARRIER_PATH = 'knsTransport/settings/transportCompanies';

export function normalizeCarrier(name){
  return String(name??'').trim().replace(/\s+/g,' ').slice(0,150);
}
export function carrierList(saved={},selected=''){
  const map=new Map();
  for(const raw of [...DEFAULT_CARRIERS,...Object.values(saved||{}).map(x=>typeof x==='string'?x:x?.name),selected]){
    const name=normalizeCarrier(raw);
    if(name && !map.has(name.toLocaleLowerCase('th-TH')))map.set(name.toLocaleLowerCase('th-TH'),name);
  }
  return [...map.values()];
}
export function carrierTotals(reports, start, end){
  const stats=new Map();let reportDays=0;
  const entries=Object.entries(reports||{}).filter(([day])=>day>=start&&day<=end).sort(([a],[b])=>a.localeCompare(b));
  for(const [day,report] of entries){
    if(!report?.trips)continue;
    reportDays++;
    const trips=Array.isArray(report.trips)?report.trips:Object.values(report.trips);
    for(const trip of trips){
      if(!trip || !['STP','PTR','OUT'].includes(trip.page))continue;
      const name=normalizeCarrier(trip.transportCompany)||'ไม่ระบุขนส่ง';
      const key=name.toLocaleLowerCase('th-TH');
      if(!stats.has(key))stats.set(key,{name,assigned:0,completed:0,ok:0,mismatch:0,rollover:0,pending:0,days:new Set(),byPage:{STP:0,PTR:0,OUT:0}});
      const item=stats.get(key);
      item.assigned++;
      const status=['ok','mismatch','rollover'].includes(trip.status)?trip.status:'pending';
      item[status]++;
      if(status==='ok'||status==='mismatch'){item.completed++;item.byPage[trip.page]++;item.days.add(day);}
    }
  }
  const carriers=[...stats.values()].map(({days,...r})=>({...r,workedDays:days.size}))
    .sort((a,b)=>b.completed-a.completed || a.name.localeCompare(b.name,'th'));
  const total=carriers.reduce((obj,r)=>{
    for(const f of ['assigned','completed','ok','mismatch','rollover','pending'])obj[f]+=r[f];
    return obj;
  },{assigned:0,completed:0,ok:0,mismatch:0,rollover:0,pending:0});
  return {carriers,total,reportDays};
}
export function periodRange(period,iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))throw Error('Invalid ISO date');
  if(period==='month'){
    const [year,month]=iso.split('-').map(Number);
    if(month<1||month>12)throw Error('Invalid month');
    return {start:iso.slice(0,7)+'-01',end:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)};
  }
  if(period==='year')return {start:iso.slice(0,4)+'-01-01',end:iso.slice(0,4)+'-12-31'};
  const date=new Date(iso+'T12:00:00Z');
  if(Number.isNaN(date.getTime()))throw Error('Invalid date');
  const day=date.getUTCDay(), offset=(day+6)%7;
  const monday=new Date(date);monday.setUTCDate(date.getUTCDate()-offset);
  const sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);
  return {start:monday.toISOString().slice(0,10),end:sunday.toISOString().slice(0,10)};
}
