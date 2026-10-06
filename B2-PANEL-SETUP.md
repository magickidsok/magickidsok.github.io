# Magic Kids — panel B2 sin Floot

Esta variante deja intactas las zonas actuales del sitio y agrega un panel nuevo en /panel-b2.html y una WebTV en /webtv-b2.html.

## Arquitectura
- GitHub Pages: solo HTML/CSS/JS del sitio y del panel.
- Supabase Edge Function: API pequeña para firmar cargas y administrar catálogo.
- Backblaze B2: almacenamiento de MP4.
- Video público: URL S3 directa de B2; el navegador puede pedir rangos HTTP y recibir 206 Partial Content.

## Variables que hay que cargar como secrets en la función de Supabase
- B2_APPLICATION_KEY_ID_V2
- B2_APPLICATION_KEY_V2
- B2_S3_ENDPOINT_V2
- B2_REGION
- MK_ADMIN_TOKEN

B2_BUCKET es opcional; por defecto usa magic-kids-media-1991.

No se deben subir credenciales B2 al repositorio de GitHub.

## URLs
- https://magickidsok.online/webtv-b2.html
- https://magickidsok.online/panel-b2.html

El index.html y el reproductor público existente no se modifican por esta implementación.
