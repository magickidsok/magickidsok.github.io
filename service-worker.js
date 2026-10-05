const CACHE_NAME="magic-kids-pwa-v17";
// Actualización silenciosa de UNA sola vez para publicar la nueva programación.
// Queda limitada exclusivamente a esta versión; las futuras no fuerzan recargas.
const FORCE_REFRESH_ONCE = CACHE_NAME === "magic-kids-pwa-v17";
const APP_SHELL=[
  "./",
  "./index.html",
  "./programacion.html",
  "./donar.html",
  "./que-vuelva-magic.html",
  "./descargar-aplicacion.html",
  "./assets/magic-kids-logo.webp","./assets/magic-star.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))
    ))
    .then(()=>self.clients.claim())
    .then(async()=>{
      if(!FORCE_REFRESH_ONCE)return;
      const list=await self.clients.matchAll({type:"window",includeUncontrolled:true});
      await Promise.all(list.map(async client=>{
        try{
          const u=new URL(client.url);
          if((u.pathname==="/"||u.pathname==="/index.html") && "navigate" in client){
            await client.navigate(client.url);
          }
        }catch(_){}
      }));
    })
  );
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin) return;

  // Always fetch HTML/navigation from the network first so new
  // deployments reach visitors without Ctrl+F5.
  if(req.mode==="navigate" || req.destination==="document" || url.pathname.endsWith(".html")){
    event.respondWith(
      fetch(req,{cache:"no-store"}).catch(()=>caches.match(req).then(r=>r||caches.match("./index.html")))
    );
    return;
  }

  // Same-origin assets are also network-first; cache is only a fallback.
  event.respondWith(
    fetch(req,{cache:"no-store"}).then(res=>{
      if(res && res.ok){
        const copy=res.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));
      }
      return res;
    }).catch(()=>caches.match(req))
  );
});
