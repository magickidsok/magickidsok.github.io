import { readState } from '../../lib/magic-store.js';
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  try{res.setHeader('Cache-Control','no-store,max-age=0');return res.status(200).json(await readState());}
  catch(e){return res.status(500).json({status:'live',generation:1,startedAt:Date.now(),pausedIndex:0,pausedPosition:0});}
}