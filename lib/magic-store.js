import { list, put } from '@vercel/blob';
export const MEDIA_PREFIX='media/';
export const CATALOG_PATH='__magic__/catalog.json';
export const STATE_PATH='__magic__/state.json';
export const VIEWERS_PREFIX='__magic__/viewers/';
export const TEN_GB=10000000000;
const fallback=()=>({version:1,generation:1,videos:[],channel:{status:'live',generation:1,startedAt:Date.now(),pausedIndex:0,pausedPosition:0}});
export async function readBlobJson(path,fallbackValue){
  const r=await list({prefix:path,limit:10});
  const b=r.blobs.find(x=>x.pathname===path);
  if(!b)return fallbackValue;
  try{const q=await fetch(b.url,{cache:'no-store'});if(!q.ok)return fallbackValue;return await q.json();}catch{return fallbackValue;}
}
export async function readCatalog(){
  const d=await readBlobJson(CATALOG_PATH,fallback());
  d.videos=Array.isArray(d.videos)?d.videos:[];
  d.channel=d.channel&&typeof d.channel==='object'?d.channel:fallback().channel;
  d.generation=Number(d.generation||d.channel.generation||1);
  d.channel.generation=d.generation;
  return d;
}
export async function readState(){const c=await readCatalog();return await readBlobJson(STATE_PATH,c.channel);}
export async function writeState(state){await put(STATE_PATH,JSON.stringify(state),{access:'public',contentType:'application/json',allowOverwrite:true,cacheControlMaxAge:0});}
export async function writeCatalog(c){await put(CATALOG_PATH,JSON.stringify(c),{access:'public',contentType:'application/json',allowOverwrite:true,cacheControlMaxAge:0});await writeState(c.channel);}
export function normalizeVideo(v,i){return {id:String(v.id||('video-'+Date.now()+'-'+i)),title:String(v.title||v.pathname||'Video').slice(0,160),url:String(v.url||''),pathname:String(v.pathname||''),size:Number(v.size||0),durationSeconds:Number(v.durationSeconds||0),startTime:String(v.startTime||'00:00'),order:Number(v.order??i),enabled:v.enabled!==false,commercial:v.commercial===true,uploadedAt:Number(v.uploadedAt||Date.now())};}