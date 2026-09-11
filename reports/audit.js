export function thaiDate(now=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function createAudit(db,api){
  const pathOf=r=>decodeURIComponent(new URL(r.toString()).pathname).replace(/^\/+|\/+$/g,'');
  const ignored=new Set(['location','updatedAt','createdAt','locationUpdatedAt','locationSyncedAt','tripStatusUpdatedAt']);
  async function update(target,values){
    const base=pathOf(target),patch={};
    for(const [key,value] of Object.entries(values))patch[[base,key].filter(Boolean).join('/')]=value;
    const grouped=new Map();
    for(const [path,value] of Object.entries(patch)){
      const match=path.match(/^(knsTransport(?:\/pages\/([^/]+))?\/plans\/([^/]+)\/rows\/([^/]+))(?:\/(.+))?$/);
      if(!match)continue;
      const [,rowPath,page,planDate,rowId,field]=match;
      if(!grouped.has(rowPath))grouped.set(rowPath,{page:page||'STP',planDate,rowId,writes:[]});
      grouped.get(rowPath).writes.push({field,value});
    }
    const changes=[];
    for(const [path,group] of grouped){
      const before=(await api.get(api.ref(db,path))).val();
      if(!before)continue; // New records are not edits.
      let after={...before};
      for(const {field,value} of group.writes){if(!field)after=value;else if(!field.includes('/')){if(value===null)delete after[field];else after[field]=value;}}
      const fields=[];
      for(const field of new Set([...Object.keys(before),...Object.keys(after||{})])){
        if(ignored.has(field))continue;
        const oldValue=before[field]??null,newValue=after?.[field]??null;
        if(JSON.stringify(oldValue)!==JSON.stringify(newValue))fields.push({field,before:oldValue,after:newValue});
      }
      if(fields.length)changes.push({page:group.page,planDate:group.planDate,rowId:group.rowId,productName:before.productName||'',batchNo:before.batchNo||'',deleted:after===null,fields});
    }
    if(changes.length){
      const day=thaiDate();const key=api.push(api.ref(db,`knsTransport/reports/edits/${day}`)).key;
      patch[`knsTransport/reports/edits/${day}/${key}`]={day,createdAt:api.serverTimestamp(),changes};
    }
    // Data and history succeed or fail together, with one atomic write.
    return api.update(api.ref(db),patch);
  }
  async function remove(target){
    if(/\/plans\/[^/]+\/rows\//.test(pathOf(target)))return update(api.ref(db),{[pathOf(target)]:null});
    return api.remove(target);
  }
  return {update,remove};
}
