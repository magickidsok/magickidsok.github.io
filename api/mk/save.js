import { del } from '@vercel/blob';
import { readCatalog, writeCatalog, normalizeVideo, TEN_GB } from '../../lib/magic-store.js';
function sameSite(req){
  const origin=String(req.headers.origin||'');
  const referer=String(req.headers.referer||'');
  const host=String(req.headers.host||'');
  return !origin||origin==='https://'+host||referer.indexOf('https://'+host+'/magic-panel')===0;
}
function validMedia(v){return String(v||'').startsWith('media/')&&String(v||'').length<500;}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!sameSite(req))return res.status(403).json({error:'Origen no permitido'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const c=await readCatalog();
    let videos=c.videos.slice();
    if(body.action==='replace'){
      const incoming=Array.isArray(body.videos)?body.videos:[];
      const old=new Map(videos.map(v=>[String(v.id),v]));
      videos=incoming.map((v,i)=>normalizeVideo({...old.get(String(v.id)),...v,order:i},i)).filter(v=>v.url&&validMedia(v.pathname));
      if(videos.reduce((n,v)=>n+Number(v.size||0),0)>TEN_GB)throw new Error('La biblioteca superaría el límite de 10 GB');
      c.videos=videos;
    }else if(body.action==='upsert'){
      const v=normalizeVideo(body.video,videos.length);
      if(!v.url||!validMedia(v.pathname))throw new Error('Video inválido');
      const idx=videos.findIndex(x=>String(x.id)===v.id);
      if(idx>=0)videos[idx]=v;else videos.push(v);
      if(videos.reduce((n,x)=>n+Number(x.size||0),0)>TEN_GB){
        if(validMedia(v.pathname))try{await del(v.url)}catch{}
        throw new Error('La biblioteca superaría el límite de 10 GB');
      }
      c.videos=videos;
    }else if(body.action==='delete'){
      const id=String(body.id||'');const idx=videos.findIndex(v=>String(v.id)===id);
      if(idx<0)throw new Error('Video no encontrado');
      const v=videos[idx];if(validMedia(v.pathname))await del(v.url);
      videos.splice(idx,1);c.videos=videos;
    }else if(body.action==='channel'){
      const status=['live','paused','offair','stopped'].includes(body.status)?body.status:'live';
      c.channel={...c.channel,status,startedAt:status==='live'?Date.now():Number(c.channel.startedAt||Date.now()),pausedIndex:Number(body.pausedIndex||0),pausedPosition:Number(body.pausedPosition||0)};
    }else throw new Error('Acción inválida');
    c.videos=c.videos.map((v,i)=>({...v,order:i}));
    c.generation=Number(c.generation||c.channel.generation||0)+1;
    c.channel={...c.channel,generation:c.generation};
    await writeCatalog(c);
    return res.status(200).json({ok:true,channel:c.channel,videos:c.videos,quotaBytes:TEN_GB});
  }catch(e){return res.status(400).json({error:e?.message||'No se pudo guardar'});}
}