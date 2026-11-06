import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {getDatabase,ref,get,set,update,push,query,orderByKey,startAt,endAt,onValue,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import {firebaseConfig} from './config.js';
import {thaiDate} from './audit.js';
import {CARRIER_PATH,DEFAULT_CARRIERS,carrierList,normalizeCarrier,carrierTotals,periodRange} from './carriers.js';
import {PAGES,STATUS_LABELS,BATCH_LABELS,collectTrips,mergeWithSaved,countTrips,weekRange,weeklyData} from './closeout-core.js';

const db=getDatabase(initializeApp(firebaseConfig));
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value||0).toLocaleString('th-TH',{maximumFractionDigits:2});
const statusMessage=(id,message,error=false,success=false)=>{const el=$(id);el.textContent=message;el.className='status'+(error?' error':success?' success':'');};
const closeoutRef=day=>ref(db,'knsTransport/reports/closeouts/'+day);
const weeklyRef=monday=>ref(db,'knsTransport/reports/weeklyCloseouts/'+monday);
const batchRef=day=>ref(db,'knsTransport/reports/batchChanges/'+day);
const rangeRead=(base,start,end)=>get(query(ref(db,base),orderByKey(),startAt(start),endAt(end)));
const prettyPage=page=>page==='OUT'?'ส่งออก':page;
let dayTrips=[],daySaved=null,dayLoaded='',dailyBusy=false;
let weekData=null,weekSaved=null,weekStart='',weeklyBusy=false;
let carrierStore={},carrierNames=[...DEFAULT_CARRIERS],carrierData=null,carrierRange=null,carrierBusy=false;
let dayBatchEvents=[],weekBatchEvents=[];
onValue(ref(db,CARRIER_PATH),snapshot=>{
  carrierStore=snapshot.val()||{};
  carrierNames=carrierList(carrierStore);
  refreshCarrierSelectors();
},error=>console.error('ไม่สามารถอ่านรายชื่อขนส่ง',error));

const requestedDay=new URLSearchParams(location.search).get('day')||'';
const initialDay=/^\d{4}-\d{2}-\d{2}$/.test(requestedDay)?requestedDay:thaiDate();
$('day').value=initialDay;
$('weekDay').value=initialDay;
$('carrierDate').value=initialDay;
function renderMetrics(id,stats,savedDays){
  if(!stats){$(id).innerHTML='';return;}
  const metrics=[
    ['ทั้งหมด',stats.total,''],['ตรงแผน',stats.ok,''],['ไม่ตรงแผน',stats.mismatch,'danger'],
    ['เลื่อนไปวันถัดไป',stats.rollover,''],['มีปัญหาแบชเล็ก',stats.small,''],['มีปัญหาแบชใหญ่',stats.large,'']
  ];
  $(id).innerHTML=metrics.map(([label,n,cls])=>'<div class="'+cls+'"><span>'+esc(label)+'</span><strong>'+number(n)+'</strong></div>').join('');
}
const statusOptions=selected=>Object.entries(STATUS_LABELS).map(([v,l])=>'<option value="'+v+'"'+(selected===v?' selected':'')+'>'+esc(l)+'</option>').join('');
const batchOptions=selected=>Object.entries(BATCH_LABELS).map(([v,l])=>'<option value="'+v+'"'+(selected===v?' selected':'')+'>'+esc(l)+'</option>').join('');
const transportOptions=selected=>{
  const names=carrierList(carrierStore,selected);
  return '<option value="">-- เลือกขนส่ง --</option>'+names.map(name=>'<option value="'+esc(name)+'"'+(selected===name?' selected':'')+'>'+esc(name)+'</option>').join('');
};
function refreshCarrierSelectors(){
  for(const select of $('dayTrips').querySelectorAll('select[data-field="transportCompany"]')){
    const value=select.value;
    select.innerHTML=transportOptions(value);
    select.value=value;
  }
}
$('dayTrips').addEventListener('click',async event=>{
  const button=event.target.closest('[data-add-company]');if(!button)return;
  const index=Number(button.closest('tr')?.dataset.index);
  if(!Number.isInteger(index)||!dayTrips[index])return;
  const raw=prompt('เพิ่มบริษัทขนส่งใหม่');
  if(raw===null)return;
  const name=normalizeCarrier(raw);
  if(!name){alert('กรุณาระบุชื่อบริษัท');return;}
  button.disabled=true;
  try{
    if(!carrierList(carrierStore).some(c=>c.toLocaleLowerCase('th-TH')===name.toLocaleLowerCase('th-TH'))){
      await set(push(ref(db,CARRIER_PATH)),{name,createdAt:serverTimestamp()});
    }
    dayTrips[index].transportCompany=name;
    renderDay();
  }catch(error){alert('เพิ่มบริษัทขนส่งไม่สำเร็จ: '+error.message);}
  finally{button.disabled=false;}
});
function renderDay(){
  renderMetrics('dayStats',countTrips(dayTrips));
  $('dayRevision').textContent=daySaved?'บันทึกแล้ว • ฉบับแก้ไข '+(daySaved.revision||1):'ยังไม่บันทึก';
  $('dayTrips').innerHTML=dayTrips.map((t,i)=>'<tr data-index="'+i+'">'+
    '<td><strong>'+esc(prettyPage(t.page))+' / '+esc(t.tripNo)+'</strong><br><span class="pill">'+number(t.items)+' แถวสินค้า</span><br>'+number(t.bags)+' ถุง</td>'+
    '<td>'+esc(t.bookingNo||'—')+'<br>'+esc((t.products||[]).join(', ')||'—')+'</td>'+
    '<td><div style="display:flex;gap:5px;align-items:flex-start"><select data-field="transportCompany" aria-label="บริษัทขนส่ง">'+transportOptions(t.transportCompany)+'</select><button type="button" data-add-company="1" class="alt" title="เพิ่มบริษัทขนส่ง" style="padding:8px 10px">+</button></div></td>'+
    '<td><select data-field="status">'+statusOptions(t.status)+'</select></td>'+
    '<td><select data-field="batchIssue">'+batchOptions(t.batchIssue)+'</select></td>'+
    '<td><textarea data-field="batchIssueNote" maxlength="2000" placeholder="เช่น แบชที่ควรมา / มาจริง">'+esc(t.batchIssueNote)+'</textarea></td>'+
    '<td><textarea data-field="feedback" maxlength="3000" placeholder="ข้อความที่ได้รับภายหลัง">'+esc(t.feedback)+'</textarea></td>'+
    '<td><textarea data-field="resolution" maxlength="3000" placeholder="วิธีแก้ไข / ปิดปัญหา">'+esc(t.resolution)+'</textarea></td></tr>'
  ).join('')||'<tr><td colspan="8" class="empty">ไม่มีคันรถสำหรับวันที่เลือก</td></tr>';
}
$('dayTrips').addEventListener('input',event=>{
  const el=event.target.closest('[data-field]');
  if(!el)return;
  const index=Number(el.closest('tr')?.dataset.index),field=el.dataset.field;
  if(!Number.isInteger(index)||!dayTrips[index]||!['transportCompany','status','batchIssue','batchIssueNote','feedback','resolution'].includes(field))return;
  dayTrips[index][field]=el.value;
  if(field==='status'||field==='batchIssue')renderMetrics('dayStats',countTrips(dayTrips));
});

function batchTitle(kind){
  return kind==='batch_edited'?'แก้เลขแบช':kind==='manual_item_added'?'เพิ่มรายการสินค้าโดยตรง':'เหตุการณ์แบช';
}
function batchStatus(value){
  return value==='confirmed'?'ยืนยันเป็นปัญหา':value==='not_issue'?'งานปกติ / ไม่ใช่ปัญหา':'รอตรวจสอบ';
}
function renderBatchChanges(events){
  $('batchChangeCount').textContent=number(events.length)+' เหตุการณ์';
  $('batchChanges').innerHTML=events.map(event=>'<tr>'+
    '<td>'+esc(event.createdAt?new Date(event.createdAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}):'กำลังยืนยันเวลา')+'</td>'+
    '<td>'+esc(prettyPage(event.page))+' / '+esc(event.tripNo||'—')+(event.bookingNo?'<br>Booking '+esc(event.bookingNo):'')+'</td>'+
    '<td>'+esc(batchTitle(event.kind))+'</td><td>'+esc(event.productName||'—')+'</td>'+
    '<td>'+esc(event.oldBatchNo||'—')+' → '+esc(event.newBatchNo||'—')+'</td>'+
    '<td><select data-batch-id="'+esc(event.id)+'"><option value="needs_review"'+(!['confirmed','not_issue'].includes(event.reviewStatus)?' selected':'')+'>รอตรวจสอบ</option>'+
    '<option value="confirmed"'+(event.reviewStatus==='confirmed'?' selected':'')+'>ยืนยันเป็นปัญหา</option>'+
    '<option value="not_issue"'+(event.reviewStatus==='not_issue'?' selected':'')+'>งานปกติ</option></select></td></tr>'
  ).join('')||'<tr><td colspan="6" class="empty">ยังไม่มีเหตุการณ์แก้แบชหรือเพิ่มรายการโดยตรงในวันนี้</td></tr>';
}
$('batchChanges').addEventListener('change',async event=>{
  const select=event.target.closest('[data-batch-id]');
  if(!select)return;
  const row=dayBatchEvents.find(item=>item.id===select.dataset.batchId);
  if(!row||!dayLoaded){renderBatchChanges(dayBatchEvents);return;}
  const value=select.value;
  select.disabled=true;
  try{
    await update(ref(db,'knsTransport/reports/batchChanges/'+dayLoaded+'/'+row.id),{reviewStatus:value,reviewedAt:serverTimestamp()});
    row.reviewStatus=value;
  }catch(error){
    alert('บันทึกผลตรวจสอบแบชไม่สำเร็จ: '+error.message);
    renderBatchChanges(dayBatchEvents);
  }finally{select.disabled=false;}
});
function renderWeekBatchEvents(){
  $('weekBatchChanges').innerHTML=weekBatchEvents.map(e=>'<tr>'+
    '<td>'+esc(e.planDate||e.day||'')+'</td><td>'+esc(prettyPage(e.page))+' / '+esc(e.tripNo||'—')+'</td>'+
    '<td>'+esc(batchTitle(e.kind))+' • '+esc(e.productName||'—')+'</td>'+
    '<td>'+esc(e.oldBatchNo||'—')+' → '+esc(e.newBatchNo||'—')+'</td>'+
    '<td>'+esc(batchStatus(e.reviewStatus))+'</td></tr>').join('')||
    '<tr><td colspan="5" class="empty">ไม่มีเหตุการณ์ในสัปดาห์นี้</td></tr>';
}
function flattenBatchEvents(raw){
  return Object.entries(raw||{}).flatMap(([day,items])=>Object.entries(items||{}).map(([id,event])=>({...event,id,day})))
    .sort((a,b)=>String(a.planDate||a.day).localeCompare(String(b.planDate||b.day)) || (a.createdAt||0)-(b.createdAt||0));
}
async function getPlans(day){
  const entries=await Promise.all(PAGES.map(async page=>{
    const path='knsTransport/pages/'+page+'/plans/'+day+'/rows';
    const snap=await get(ref(db,path));
    let value=snap.val()||{};
    if(page==='STP'&&!Object.keys(value).length){
      const legacy=await get(ref(db,'knsTransport/plans/'+day+'/rows'));
      value=legacy.val()||{};
    }
    return [page,value];
  }));
  return Object.fromEntries(entries);
}
async function loadDay(restore=true){
  const day=$('day').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return statusMessage('dailyStatus','กรุณาเลือกวันที่',true);
  if(dailyBusy)return;
  dailyBusy=true;$('loadDay').disabled=true;$('resetToPlan').disabled=true;
  statusMessage('dailyStatus','กำลังอ่านแผน STP / PTR / ส่งออก และรายงานที่เคยบันทึก…');
  try{
    const [source,snap,batches]=await Promise.all([getPlans(day),get(closeoutRef(day)),get(batchRef(day))]);
    daySaved=snap.val()||null;
    dayBatchEvents=Object.entries(batches.val()||{}).map(([id,event])=>({...event,id})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    renderBatchChanges(dayBatchEvents);
    const fresh=collectTrips(source);
    // Once closed, the saved report is authoritative. Do not silently merge
    // later plan edits into a completed day's historical snapshot.
    const savedTrips=daySaved?.trips;
    dayTrips=restore && savedTrips
      ? (Array.isArray(savedTrips)?savedTrips:Object.values(savedTrips)).filter(Boolean).map(t=>({...t}))
      : fresh;
    dayLoaded=day;
    $('dailyNote').value=restore?(daySaved?.note||''):'';
    renderDay();
    const stats=countTrips(dayTrips);
    const warning=stats.pending?' • ยังไม่ระบุสถานะ '+stats.pending+' คัน':'';
    statusMessage('dailyStatus','วันที่ '+day+' • '+stats.total+' คัน/ตู้ • ไม่ตรงแผน '+stats.mismatch+' คัน'+warning+
      (daySaved&&restore?' • กำลังดูฉบับที่เคยบันทึก (กดดึงแผนล่าสุดหากต้องการแทนที่)':' • กำลังดูข้อมูลจากแผน'),false,true);
  }catch(error){statusMessage('dailyStatus','โหลดข้อมูลไม่สำเร็จ: '+error.message,true);}
  finally{dailyBusy=false;$('loadDay').disabled=false;$('resetToPlan').disabled=false;}
}
$('loadDay').onclick=()=>loadDay(true);
$('resetToPlan').onclick=()=>{
  if(dayTrips.some(t=>t.feedback||t.resolution)&&!confirm('ดึงข้อมูลแผนล่าสุดจะล้างฟีดแบ็คที่กำลังแก้ไขบนหน้าจอ (ไม่ลบรีพอร์ตที่บันทึกไว้) ต้องการดำเนินการต่อไหม?'))return;
  loadDay(false);
};
$('day').onchange=()=>{dayLoaded='';daySaved=null;dayTrips=[];dayBatchEvents=[];renderBatchChanges([]);$('dailyNote').value='';renderDay();statusMessage('dailyStatus','กดโหลดแผนและรีพอร์ตสำหรับวันที่เลือก');};

async function saveDaily(){
  if(dailyBusy||!dayLoaded||dayLoaded!==$('day').value)return statusMessage('dailyStatus','กรุณาโหลดข้อมูลวันที่นี้ก่อนบันทึก',true);
  if(!dayTrips.length)return statusMessage('dailyStatus','ไม่มีคันรถในแผน จึงยังบันทึกจบงานไม่ได้',true);
  const count=countTrips(dayTrips);
  if(count.pending&&!confirm('ยังมี '+count.pending+' คันที่ไม่ระบุสถานะ ต้องการบันทึกจบงานทั้งที่ยังรอสถานะหรือไม่?'))return;
  dailyBusy=true;$('saveDay').disabled=true;
  statusMessage('dailyStatus','กำลังบันทึกรีพอร์ตประจำวัน…');
  try{
    const old=(await get(closeoutRef(dayLoaded))).val();
    if(old && Number(old.revision||0)>Number(daySaved?.revision||0)&&
       !confirm('มีผู้บันทึกรีพอร์ตฉบับใหม่หลังจากคุณโหลดหน้านี้ ต้องการเขียนทับฉบับใหม่หรือไม่?'))return;
    const revision=(old?.revision||0)+1;
    const payload={day:dayLoaded,revision,createdAt:old?.createdAt||serverTimestamp(),updatedAt:serverTimestamp(),
      note:$('dailyNote').value.trim(),summary:count,trips:dayTrips.map(t=>({...t,
        transportCompany:String(t.transportCompany||'').trim(),
        batchIssueNote:String(t.batchIssueNote||'').trim(),feedback:String(t.feedback||'').trim(),
        resolution:String(t.resolution||'').trim()
      }))};
    await set(closeoutRef(dayLoaded),payload);
    // The in-memory snapshot is only a revision marker; do not pretend to have a server timestamp.
    daySaved={...payload,revision};
    renderDay();
    statusMessage('dailyStatus','บันทึกจบงาน '+dayLoaded+' เรียบร้อย • ฉบับแก้ไข '+revision+' • ไม่ตรงแผน '+count.mismatch+' คัน',false,true);
  }catch(error){statusMessage('dailyStatus','บันทึกไม่สำเร็จ: '+error.message,true);}
  finally{dailyBusy=false;$('saveDay').disabled=false;}
}
$('saveDay').onclick=saveDaily;

function reportRows(trips){
  return trips.map(t=>({
    'วันที่':t.day||dayLoaded,'หน้า':prettyPage(t.page),'คัน/ตู้':t.tripNo,'Booking':t.bookingNo||'',
    'บริษัทขนส่ง':t.transportCompany||'','สถานะ':STATUS_LABELS[t.status]||STATUS_LABELS.pending,
    'ปัญหาแบช':BATCH_LABELS[t.batchIssue]||BATCH_LABELS.none,
    'รายละเอียดแบช':t.batchIssueNote||'','ฟีดแบ็ค':t.feedback||'','การแก้ไข':t.resolution||'',
    'ถุง':t.bags||0,'กก.':t.kg||0,'แถวสินค้า':t.items||0,'สินค้า':(t.products||[]).join(', ')
  }));
}
function ensureXlsx(statusId){
  if(window.XLSX)return true;
  statusMessage(statusId,'โหลดตัวสร้างไฟล์ Excel ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วเปิดหน้าใหม่',true);
  return false;
}
function exportExcel(filename,summaryRows,tripRows){
  const wb=window.XLSX.utils.book_new();
  const ws=window.XLSX.utils.json_to_sheet(summaryRows);
  ws['!cols']=[{wch:17},{wch:19},{wch:16},{wch:15},{wch:18},{wch:16},{wch:16},{wch:18},{wch:60}];
  window.XLSX.utils.book_append_sheet(wb,ws,'Summary');
  const details=window.XLSX.utils.json_to_sheet(tripRows);
  details['!cols']=[{wch:15},{wch:12},{wch:15},{wch:20},{wch:25},{wch:19},{wch:25},{wch:50},{wch:50},{wch:45},{wch:12},{wch:14},{wch:12},{wch:40}];
  window.XLSX.utils.book_append_sheet(wb,details,'Trip Details');
  window.XLSX.writeFile(wb,filename);
}
$('excelDay').onclick=()=>{
  if(!dayLoaded||dayLoaded!==$('day').value||!dayTrips.length)return statusMessage('dailyStatus','กรุณาโหลดรายวันก่อนส่งออก Excel',true);
  if(!ensureXlsx('dailyStatus'))return;
  const m=countTrips(dayTrips);
  exportExcel('KNS-Closeout-'+dayLoaded+'.xlsx',[{
    'วันที่':dayLoaded,'ทั้งหมด':m.total,'ตรงแผน':m.ok,'ไม่ตรงแผน':m.mismatch,
    'เลื่อน':m.rollover,'ยังไม่ระบุ':m.pending,'แบชเล็ก':m.small,'แบชใหญ่':m.large,
    'หมายเหตุ':$('dailyNote').value.trim()
  }],reportRows(dayTrips));
};
async function loadWeek(){
  if(weeklyBusy)return;
  const chosen=$('weekDay').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(chosen))return statusMessage('weekStatus','กรุณาเลือกวันที่',true);
  const range=weekRange(chosen);
  weeklyBusy=true;$('loadWeek').disabled=true;
  statusMessage('weekStatus','กำลังอ่านรายงานที่ปิดงานแล้ว 7 วัน…');
  try{
    const [items,old,batches]=await Promise.all([
      Promise.all(range.days.map(async day=>[day,(await get(closeoutRef(day))).val()])),
      get(weeklyRef(range.start)),
      rangeRead('knsTransport/reports/batchChanges',range.start,range.end)
    ]);
    const reports=Object.fromEntries(items);
    weekData=weeklyData(reports,range.days);
    weekBatchEvents=flattenBatchEvents(batches.val());
    renderWeekBatchEvents();
    weekStart=range.start;weekSaved=old.val()||null;
    $('weeklyNote').value=weekSaved?.note||'';
    renderWeek(range);
    const unsaved=range.days.filter(day=>!reports[day]);
    statusMessage('weekStatus','ช่วง '+range.start+' ถึง '+range.end+' • มีรีพอร์ต '+weekData.savedDays+'/7 วัน • รวมไม่ตรงแผน '+weekData.totals.mismatch+' คัน'+(unsaved.length?' • วันที่ยังไม่มีรีพอร์ต: '+unsaved.join(', '):''),false,true);
  }catch(error){statusMessage('weekStatus','โหลดรายสัปดาห์ไม่สำเร็จ: '+error.message,true);}
  finally{weeklyBusy=false;$('loadWeek').disabled=false;}
}
function renderWeek(range){
  renderMetrics('weekStats',weekData.totals);
  $('weekTrips').innerHTML=weekData.trips.map(t=>'<tr><td>'+esc(t.day)+'</td><td>'+esc(prettyPage(t.page))+' / '+esc(t.tripNo)+'</td><td>'+esc(t.transportCompany||'—')+'</td><td>'+esc(STATUS_LABELS[t.status]||STATUS_LABELS.pending)+'</td><td>'+esc(BATCH_LABELS[t.batchIssue]||BATCH_LABELS.none)+'</td><td>'+esc(t.batchIssueNote||'')+'</td><td>'+esc(t.feedback||'')+'</td><td>'+esc(t.resolution||'')+'</td></tr>').join('')||'<tr><td colspan="8" class="empty">ไม่มีคันในรายงานรายวันที่บันทึกไว้</td></tr>';
  $('weekDays').innerHTML=weekData.days.map(t=>'<tr>'+
    '<td>'+esc(t.day)+'</td><td>'+ (t.saved?'<span class="pill">บันทึกแล้ว (v'+number(t.revision)+')</span>':'<span style="color:#b54732">ยังไม่มีรีพอร์ต</span>')+'</td>'+
    '<td>'+(t.saved?number(t.total):'—')+'</td><td>'+(t.saved?number(t.ok):'—')+'</td>'+
    '<td>'+(t.saved?number(t.mismatch):'—')+'</td><td>'+(t.saved?number(t.rollover):'—')+'</td>'+
    '<td>'+(t.saved?number(t.small):'—')+'</td><td>'+(t.saved?number(t.large):'—')+'</td>'+
    '<td>'+esc(t.note||'')+'</td></tr>').join('');
}
$('loadWeek').onclick=loadWeek;
$('weekDay').onchange=()=>{weekData=null;weekSaved=null;weekStart='';weekBatchEvents=[];renderWeekBatchEvents();renderMetrics('weekStats',null);$('weekDays').innerHTML='<tr><td colspan="9" class="empty">กดรวบรวมรีพอร์ตสัปดาห์</td></tr>';$('weekTrips').innerHTML='<tr><td colspan="8">กรุณาเลือกรายงานสัปดาห์</td></tr>';statusMessage('weekStatus','กดรวบรวมรีพอร์ตสำหรับสัปดาห์ใหม่');};
$('saveWeek').onclick=async()=>{
  if(weeklyBusy||!weekData||weekStart!==weekRange($('weekDay').value).start)return statusMessage('weekStatus','กรุณารวบรวมรีพอร์ตรายสัปดาห์ก่อน',true);
  if(!weekData.savedDays)return statusMessage('weekStatus','ยังไม่มีรีพอร์ตรายวันให้บันทึกรายสัปดาห์',true);
  if(weekData.savedDays<7&&!confirm('มีรีพอร์ตเพียง '+weekData.savedDays+'/7 วัน ต้องการบันทึกรีพอร์ตสัปดาห์แบบยังไม่ครบวันหรือไม่?'))return;
  weeklyBusy=true;$('saveWeek').disabled=true;statusMessage('weekStatus','กำลังบันทึกรีพอร์ตสัปดาห์…');
  try{
    const old=(await get(weeklyRef(weekStart))).val();
    if(old && Number(old.revision||0)>Number(weekSaved?.revision||0) &&
      !confirm('มีผู้แก้รีพอร์ตสัปดาห์ฉบับใหม่ ต้องการบันทึกทับหรือไม่?'))return;
    const payload={start:weekStart,end:weekRange(weekStart).end,revision:(old?.revision||0)+1,
      createdAt:old?.createdAt||serverTimestamp(),updatedAt:serverTimestamp(),
      savedDays:weekData.savedDays,note:$('weeklyNote').value.trim(),totals:weekData.totals,
      days:weekData.days,trips:weekData.trips,batchChanges:weekBatchEvents};
    await set(weeklyRef(weekStart),payload);weekSaved=payload;
    statusMessage('weekStatus','บันทึกรีพอร์ตสัปดาห์ '+weekStart+' • ฉบับแก้ไข '+payload.revision+' เรียบร้อย',false,true);
  }catch(error){statusMessage('weekStatus','บันทึกไม่สำเร็จ: '+error.message,true);}
  finally{weeklyBusy=false;$('saveWeek').disabled=false;}
};
$('excelWeek').onclick=()=>{
  if(!weekData||weekStart!==weekRange($('weekDay').value).start)return statusMessage('weekStatus','กรุณารวบรวมรีพอร์ตสัปดาห์ก่อนส่งออก Excel',true);
  if(!weekData.savedDays)return statusMessage('weekStatus','ยังไม่มีรีพอร์ตรายวันที่บันทึกแล้ว',true);
  if(!ensureXlsx('weekStatus'))return;
  exportExcel('KNS-Weekly-Closeout-'+weekStart+'.xlsx',
    weekData.days.map(d=>({'วันที่':d.day,'บันทึกแล้ว':d.saved?'ใช่':'ยังไม่มีรีพอร์ต',
      'ทั้งหมด':d.saved?d.total:'','ตรงแผน':d.saved?d.ok:'',
      'ไม่ตรงแผน':d.saved?d.mismatch:'','เลื่อน':d.saved?d.rollover:'',
      'ยังไม่ระบุ':d.saved?d.pending:'','แบชเล็ก':d.saved?d.small:'',
      'แบชใหญ่':d.saved?d.large:'','หมายเหตุ':d.note||''})),
    reportRows(weekData.trips));
};
loadDay(true);
loadWeek();
