import { readCatalog } from '../../lib/magic-store.js';
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{
    const c=await readCatalog();
    res.setHeader('Cache-Control','no-store,max-age=0');
    return res.status(200).json({channel:c.channel,videos:c.videos.slice().sort((a,b)=>Number(a.order||0)-Number(b.order||0)),quotaBytes:10000000000});
  }catch(e){return res.status(500).json({error:'No se pudo cargar el catálogo'});}
}