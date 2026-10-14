(()=>{
"use strict";
const API="https://uifchrnvigkzantaehgz.supabase.co/rest/v1/mk_program_schedule_state?select=schedule,updated_at&id=eq.true";
const KEY="sb_publishable_pN7752MhcIXDd7ZGLsp5Hw_DEPxDnSI";
let busy=false;
const minute=s=>{const m=/^(\\d{2}):(\\d{2})$/.exec(String(s||""));return m?Number(m[1])*60+Number(m[2]):-1};
async function read(){const r=await fetch(API,{headers:{apikey:KEY,Accept:"application/json"},cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);const rows=await r.json();const row=Array.isArray(rows)?rows[0]:rows;const entries=Array.isArray(row?.schedule)?row.schedule.filter(x=>x&&minute(x.start_time)>=0&&String(x.title||"").trim()).map(x=>({start_time:String(x.start_time),title:String(x.title).trim(),position:Number(x.position)||0})).sort((a,b)=>minute(a.start_time)-minute(b.start_time)):[];if(!entries.length)throw new Error("No hay títulos cargados");return {entries,updatedAt:row?.updated_at||null};}
function nowMinute(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"America/Argentina/Cordoba",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const h=Number(parts.find(x=>x.type==="hour")?.value||0),m=Number(parts.find(x=>x.type==="minute")?.value||0);return h*60+m;}
function render(entries){const now=nowMinute();let i=-1;for(let n=0;n<entries.length;n++){if(minute(entries[n].start_time)<=now)i=n;else break;}if(i<0)i=entries.length-1;const current=entries[i],next=entries[(i+1)%entries.length];const a=document.getElementById("now-title"),b=document.getElementById("later-title");if(a)a.textContent=current.title;if(b)b.textContent=next.title;const list=document.getElementById("publicSchedule");if(list){const f=document.createDocumentFragment();for(const e of entries){const item=document.createElement("div");item.className="prog";const time=document.createElement("time");time.textContent=e.start_time;const title=document.createElement("strong");title.textContent=e.title;item.append(time,title);f.append(item);}list.replaceChildren(f);}}
async function refresh(){if(busy)return;busy=true;try{const data=await read();render(data.entries);}catch(e){console.warn("Magic Kids: la programación no pudo actualizarse desde la base de datos.",e);}finally{busy=false;}}
function init(){refresh();window.setInterval(refresh,60000);}
window.MKProgramSchedule={refresh};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
