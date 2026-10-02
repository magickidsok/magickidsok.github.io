const CACHE_NAME="magic-kids-pwa-v10";
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
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET") return;
  const url=new URL(req.url);

  // Never cache the live HLS stream or Firebase traffic.
  if(url.hostname.includes("vdopanel.com") || url.hostname.includes("firebaseio.com") || url.hostname.includes("googleapis.com")) return;

  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        if(res && res.ok && url.origin===self.location.origin){
          const copy=res.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));
        }
        return res;
      }).catch(()=>{
        if(req.mode==="navigate") return caches.match("./index.html");
        return cached;
      });
    })
  );
});