import sharp from 'sharp';
import {createHash} from 'node:crypto';

const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function lines(text,width){
  const rows=[''];
  for(const word of String(text).match(/[^\s]{1,60}/gu)??[]){
    const last=rows.length-1;
    if(rows[last] && rows[last].length+word.length+1>width)rows.push('');
    rows[rows.length-1]+=(rows.at(-1)?' ':'')+word;
  }
  return rows;
}
export async function renderGraphic(formations,scan){
  let y=95;const parts=[];
  function line(text,size,color,weight='normal'){
    y+=size+11;
    parts.push('<text x="48" y="'+y+'" font-family="Arial, sans-serif" font-size="'+size+'" fill="'+color+'" font-weight="'+weight+'">'+escape(text)+'</text>');
  }
  for(const f of formations){
    y+=22;
    for(const t of lines(f.location,44))line(t,26,'#62e2cb','bold');
    const lead=[f.scanner_record?.status,f.facts[0]?.statement??f.scanner_record?.theme].filter(Boolean).join(' · ');
    for(const t of lines(lead,65))line(t,23,'#ffffff');
    for(const t of lines(f.actors.join(' · '),74))line(t,20,'#bdd4df');
    y+=18;parts.push('<path d="M48 '+y+' H1130" stroke="#47677b"/>');
  }
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="'+(y+36)+'"><rect width="100%" height="100%" fill="#082737"/><text x="48" y="69" fill="white" font-family="Arial" font-size="40" font-weight="bold">EMRADAR</text><text x="1130" text-anchor="end" y="65" fill="#add1dc" font-size="23">'+escape(scan.snapshot_date)+'</text>'+parts.join('')+'</svg>';
  const bytes=await sharp(Buffer.from(svg)).png().toBuffer();
  return {visual_base64:bytes.toString('base64'),visual_sha256:createHash('sha256').update(bytes).digest('hex'),visual_mime:'image/png'};
}
