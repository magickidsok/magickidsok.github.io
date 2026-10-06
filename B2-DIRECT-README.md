# Magic Kids — B2 directo, sin Floot

Esta variante agrega:
- /panel-b2-direct.html
- /webtv-b2-direct.html

No toca index.html, app-player.html ni el reproductor público existente.

Arquitectura:
1. GitHub Pages: código.
2. Backblaze B2: MP4 + catalog.json.
3. Plyr.js: interfaz del reproductor.
4. B2/S3: subida multipart desde el navegador.
5. Los MP4 se entregan con Range HTTP; B2 documenta respuestas 206 Partial Content para rangos.

La primera vez, en el panel:
- poné tu B2 Application Key ID y Application Key;
- verificá el endpoint/región/bucket;
- conectá B2;
- pulsá CONFIGURAR CORS si tu bucket todavía no acepta peticiones del navegador.

Las credenciales no están en el repositorio.
