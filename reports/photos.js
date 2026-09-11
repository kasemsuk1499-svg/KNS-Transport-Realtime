export const MAX_PHOTOS=5;
export async function preparePhoto(file){
  if(!/^image\/(jpeg|png|webp)$/i.test(file.type))throw new Error('รองรับรูป JPG, PNG และ WebP');
  if(file.size>20*1024*1024)throw new Error('รูปแต่ละไฟล์ต้องไม่เกิน 20 MB');
  const url=URL.createObjectURL(file);const img=new Image();
  try{
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('อ่านรูปไม่ได้ กรุณาเลือกไฟล์ใหม่'));img.src=url;});
    let scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');let dataUrl='';
    for(let attempt=0;attempt<5;attempt++){
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      dataUrl=canvas.toDataURL('image/jpeg',.8);
      if(dataUrl.length<=850000)break;scale*=.75;
    }
    if(!/^data:image\/jpeg;base64,/.test(dataUrl)||dataUrl.length>850000)throw new Error('รูปนี้มีขนาดใหญ่เกินไปหลังย่อ กรุณาเลือกรูปอื่น');
    return {id:crypto.randomUUID(),name:file.name,width:canvas.width,height:canvas.height,dataUrl};
  }finally{URL.revokeObjectURL(url);}
}
export function validPhoto(data){return typeof data==='string'&&data.length<=850000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data);}
export function buildIssueWrite(day,id,data,photos,timestamp){
  const metadata=photos.map(({id,name,width,height})=>({id,name,width,height}));
  const patch={[`knsTransport/reports/issues/${day}/${id}`]:{...data,images:metadata,createdAt:timestamp}};
  for(const photo of photos)patch[`knsTransport/reportImages/${day}/${id}/${photo.id}`]={dataUrl:photo.dataUrl,name:photo.name};
  return patch;
}
