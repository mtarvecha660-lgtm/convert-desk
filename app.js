const $=s=>document.querySelector(s);
const input=$('#file-input'),queue=$('#queue'),results=$('#results');
let items=[],busy=false;
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc='libs/pdfjs/pdf.worker.min.js';

const IMGS=['jpg','jpeg','png','webp','bmp','gif','heic'];
function ext(n){const m=String(n).toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:'';}
function kind(f){
  const e=ext(f.name);
  if(f.type.startsWith('image/')||IMGS.includes(e))return 'image';
  if(e==='pdf'||f.type==='application/pdf')return 'pdf';
  if(e==='csv')return 'csv';
  if(['xlsx','xls'].includes(e))return 'xlsx';
  if(e==='docx')return 'docx';
  if(['txt','md','json','log','srt','xml','html'].includes(e))return 'text';
  return null;
}
function targets(k){
  if(k==='image')return ['png','jpg','webp','pdf'];
  if(k==='pdf')return ['png','jpg','txt'];
  if(k==='csv')return ['xlsx','pdf'];
  if(k==='xlsx')return ['csv'];
  if(k==='docx')return ['txt'];
  if(k==='text')return ['pdf'];
  return [];
}
function baseName(n){return n.replace(/\.[^.]+$/,'');}
function human(b){return b>1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB';}

function render(){
  queue.innerHTML=items.map((it,i)=>`
  <div class="card" data-i="${i}">
    <div class="frow">
      <div class="fname"><b>${esc(it.file.name)}</b><small>${human(it.file.size)} · ${it.kind?esc(it.kind.toUpperCase()):'not supported'}</small></div>
      <button class="x" data-rm="${i}">×</button>
    </div>
    ${it.kind?`<div class="tolabel">CONVERT TO</div><div class="opts">${targets(it.kind).map(t=>`<label class="chip${it.target===t?' on':''}"><input type="radio" name="fmt${i}" value="${t}"${it.target===t?' checked':''} data-set="${t}"><span>${t.toUpperCase()}</span></label>`).join('')}</div>
    ${it.target!=='pdf'&&it.kind==='image'?`<div class="slider"><span>quality</span><input type="range" min="30" max="100" value="${it.q}" data-q><b>${it.q}%</b></div>
    <div class="slider"><span>resize</span><input type="range" min="20" max="100" value="${it.w}" data-w><b>${it.w}%</b></div>`:''}`:`<div class="bad">I can't convert this file type offline. Supported: jpg, png, webp, bmp, gif, pdf, csv, xlsx, docx, txt, md, json.</div>`}
  </div>`).join('');
  if(items.filter(i=>kind(i.file)==='image'&&!i.merged).length>1){
    queue.insertAdjacentHTML('beforeend',`<div class="card"><label class="merge"><input type="checkbox" id="merge-pdf"${merge?' checked':''}> Merge all images into one PDF (in list order)</label></div>`);
  }
  const can=items.length&&items.some(i=>i.kind&&i.target)&&!busy;
  queue.insertAdjacentHTML('beforeend',`<button class="btn" id="go" ${can?'':'disabled'}>${busy?'Converting…':'Convert'}</button>`);
}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
let merge=true;

function addFiles(fl){
  let lastBad='';
  for(const f of fl){
    const k=kind(f);
    if(!k){lastBad=ext(f.name)||'?';items.push({file:f,kind:null,target:null});continue;}
    items.push({file:f,kind:k,target:targets(k)[0],q:90,w:100});
  }
  if(lastBad)toast(`.${lastBad} not supported offline yet — check the list on its card`);
  render();
}
queue.addEventListener('click',e=>{
  const rm=e.target.closest('[data-rm]');
  if(rm){items.splice(Number(rm.dataset.rm),1);render();return;}
  if(e.target.id==='go')convert();
});
queue.addEventListener('change',e=>{
  if(e.target.id==='merge-pdf'){merge=e.target.checked;return;}
  const set=e.target.closest('[data-set]');
  if(!set)return;
  const card=set.closest('.card'),it=items[Number(card.dataset.i)];
  it.target=set.value;
  card.querySelectorAll('.chip').forEach(c=>c.classList.toggle('on',c.contains(set)));
  const hasSliders=it.kind==='image'&&it.target!=='pdf';
  let sl=card.querySelector('.slider');
  if(!hasSliders&&sl){sl.parentElement.querySelectorAll('.slider').forEach(x=>x.remove());}
});
queue.addEventListener('input',e=>{
  const card=e.target.closest('.card');if(!card)return;
  const it=items[Number(card.dataset.i)];
  if(e.target.dataset.q)it.q=Number(e.target.value);
  if(e.target.dataset.w)it.w=Number(e.target.value);
  const row=e.target.closest('.slider');if(row)row.querySelector('b').textContent=e.target.value+'%';
});
input.addEventListener('change',()=>{addFiles(input.files);input.value='';});
const drop=$('#drop');
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');}));
drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));

let tT;function toast(m,bad){const t=$('#toast');t.textContent=m;t.hidden=false;t.style.color=bad?'var(--err)':'#fff';clearTimeout(tT);tT=setTimeout(()=>t.hidden=true,3200);}

// ---------- conversions ----------
function loadImg(file){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('not a readable image'));i.src=URL.createObjectURL(file);});}
async function toCanvas(file,maxPct){
  const img=await loadImg(file);
  const sc=(maxPct||100)/100;
  const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*sc));c.height=Math.max(1,Math.round(img.naturalHeight*sc));
  const x=c.getContext('2d');x.drawImage(img,0,0,c.width,c.height);
  return c;
}
function canvasBlob(c,type,q){return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('encode failed')),type,q/100));}
async function imgTo(item,fmt,q){
  const c=await toCanvas(item.file,item.w);
  const mime=fmt==='png'?'image/png':fmt==='jpg'?'image/jpeg':'image/webp';
  return {blob:await canvasBlob(c,mime,q||item.q),name:baseName(item.file.name)+'.'+fmt};
}
async function imgsToPdf(list,q){
  const doc=await PDFLib.PDFDocument.create();
  for(const it of list){
    let bytes;
    if(ext(it.file.name)==='jpg'||ext(it.file.name)==='jpeg')bytes=await it.file.arrayBuffer();
    else{const c=await toCanvas(it.file,100);const b=await canvasBlob(c,'image/jpeg',Math.max(q||it.q,85));bytes=await b.arrayBuffer();}
    const img=await doc.embedJpg(bytes);
    const page=doc.addPage([img.width,img.height]);
    page.drawImage(img,{x:0,y:0,width:img.width,height:img.height});
  }
  const out=await doc.save();
  return {blob:new Blob([out],{type:'application/pdf'}),name:baseName(list[0].file.name)+(list.length>1?`_+${list.length-1}`:'')+'.pdf'};
}
async function pdfToImgs(file,fmt){
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const outs=[];
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const vp=page.getViewport({scale:2});
    const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    const mime=fmt==='png'?'image/png':'image/jpeg';
    outs.push({blob:await canvasBlob(c,mime,90),name:`${baseName(file.name)}_p${p}.${fmt}`});
  }
  return outs;
}
async function pdfToText(file){
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  let txt='';
  for(let p=1;p<=pdf.numPages;p++){const page=await pdf.getPage(p);const tc=await page.getTextContent();txt+=tc.items.map(i=>i.str).join(' ')+'\n\n';}
  return {blob:new Blob([txt],{type:'text/plain'}),name:baseName(file.name)+'.txt'};
}
async function csvToXlsx(file){
  const wb=XLSX.read(await file.text(),{type:'string'});
  const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  return {blob:new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name:baseName(file.name)+'.xlsx'};
}
async function xlsxToCsv(file){
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
  const csv=XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
  return {blob:new Blob([csv],{type:'text/csv'}),name:baseName(file.name)+'.csv'};
}
async function docxToText(file){
  const r=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
  return {blob:new Blob([r.value],{type:'text/plain'}),name:baseName(file.name)+'.txt'};
}
async function textToPdf(file){
  const txt=await file.text();
  const doc=await PDFLib.PDFDocument.create();
  const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const W=595,H=842,M=50,LH=15,maxCh=Math.floor((W-2*M)/6.1);
  const words=txt.replace(/\r/g,'').split('\n');
  let y=H-M,page=doc.addPage([W,H]);
  const line=raw=>{if(y<M){page=doc.addPage([W,H]);y=H-M;}page.drawText(raw,{x:M,y,size:10.5,font,lineHeight:LH});y-=LH;};
  for(let ln of words){
    if(!ln.trim()){y-=LH;continue;}
    while(ln.length>maxCh){line(ln.slice(0,maxCh));ln=ln.slice(maxCh);}
    line(ln);
  }
  const out=await doc.save();
  return {blob:new Blob([out],{type:'application/pdf'}),name:baseName(file.name)+'.pdf'};
}

async function convertOne(it){
  const k=kind(it.file),t=it.target;
  if(k==='image'){
    if(t==='pdf')return imgsToPdf([it]);
    return imgTo(it,t);
  }
  if(k==='pdf'){if(t==='txt')return pdfToText(it.file);return (await pdfToImgs(it.file,t));}
  if(k==='csv')return t==='xlsx'?csvToXlsx(it.file):textToPdf(it.file);
  if(k==='xlsx')return xlsxToCsv(it.file);
  if(k==='docx')return docxToText(it.file);
  if(k==='text')return textToPdf(it.file);
  throw new Error('unsupported');
}
async function convert(){
  busy=true;render();results.innerHTML='';
  const imgList=items.filter(i=>kind(i.file)==='image'&&i.target==='pdf');
  const useMerge=merge&&imgList.length>1;
  const out=[];
  try{
    if(useMerge){out.push(await imgsToPdf(imgList));}
    for(const it of items){
      if(!it.kind||!it.target)continue;
      if(useMerge&&kind(it.file)==='image'&&it.target==='pdf')continue;
      const r=await convertOne(it);
      (Array.isArray(r)?r:[r]).forEach(x=>out.push(x));
    }
    results.innerHTML=out.map((o,i)=>`<div class="card res"><div class="nm">${esc(o.name)}</div><button class="dl" data-dl="${i}">Download</button></div>`).join('');
    results.dataset.blobs=JSON.stringify(out.map(o=>({name:o.name,size:o.blob.size})));
    window._out=out;
    toast(`Done. ${out.length} file${out.length>1?'s':''} ready.`);
  }catch(err){
    console.error(err);
    toast('Conversion failed: '+err.message,true);
  }
  busy=false;render();
}
results.addEventListener('click',e=>{
  const b=e.target.closest('[data-dl]');if(!b)return;
  const o=window._out[Number(b.dataset.dl)];
  const u=URL.createObjectURL(o.blob);
  const a=document.createElement('a');a.href=u;a.download=o.name;a.click();
  setTimeout(()=>URL.revokeObjectURL(u),4000);
  if(navigator.canShare&&navigator.canShare({files:[new File([o.blob],o.name)]})){
    navigator.share({files:[new File([o.blob],o.name)]}).catch(()=>{});
  }
});
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
