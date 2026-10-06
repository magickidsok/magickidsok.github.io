import { list, put } from '@vercel/blob';
import { VIEWERS_PREFIX } from '../../lib/magic-store.js';
const ACTIVE_MS=45000;
export default async function handler(req,res){
  try{
    if(req.method==='POST'){
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
      const id=String(body.viewerId||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,100);
      if(!id)throw new Error('viewerId requerido');
      await put(VIEWERS_PREFIX+id,JSON.stringify({lastSeen:Date.now()}),{access:'public',contentType:'application/json',allowOverwrite:true,cacheControlMaxAge:0});
    }else if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
    let count=0,cursor,now=Date.now();
    do{
      const r=await list({prefix:VIEWERS_PREFIX,limit:250,cursor});
      for(const b of r.blobs){const t=Number(b.uploadedAt||0);if(t&&now-t<=ACTIVE_MS)count++;}
      cursor=r.cursor;
    }while(cursor);
    res.setHeader('Cache-Control','no-store,max-age=0');
    return res.status(200).json({count});
  }catch(e){return res.status(500).json({count:0});}
}