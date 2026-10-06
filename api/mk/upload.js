import { handleUpload } from '@vercel/blob/client';
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const request=new Request('https://'+(req.headers.host||'localhost')+'/api/mk/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const out=await handleUpload({
      body,
      request,
      onBeforeGenerateToken:async()=>({allowedContentTypes:['video/mp4'],maximumSizeInBytes:4000000000,addRandomSuffix:true,cacheControlMaxAge:31536000,tokenPayload:'magic-kids-public-panel'})
    });
    return res.status(200).json(out);
  }catch(e){return res.status(400).json({error:e?.message||'No se pudo autorizar la subida'});}
}