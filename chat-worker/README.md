# Magic Kids Chat propio

Backend propio del chat de Magic Kids usando Cloudflare Workers + D1.

Incluye registro por correo y contraseña, nick único, MAGICKIDS reservado al administrador, coronita, mensajes, contador de conectados, anti-spam, bloqueo de enlaces, borrado y ban.

1. En Cloudflare creá una D1 llamada magic-kids-chat-db.
2. Copiá el database_id que Cloudflare te entrega y reemplazá REEMPLAZAR_CON_EL_ID_DE_D1 en wrangler.toml.
3. Configurá un secreto de Worker llamado SESSION_SECRET con una cadena larga y aleatoria.
4. Ejecutá npx wrangler deploy desde esta carpeta.
5. Copiá la URL workers.dev que te entregue Cloudflare.
6. En index.html reemplazá la URL REEMPLAZAR-CON-TU-WORKER.workers.dev por esa URL.

El primer registro del chat debe usar el nick MAGICKIDS. Ese primer usuario se convierte automáticamente en administrador. Luego el nick queda reservado y no puede ser registrado por otra persona.

El código crea las tablas D1 automáticamente en la primera petición.

Cloudflare documenta D1 como la base SQL de Workers y el uso de bindings para consultar la base desde el Worker. citeturn470527search4turn470527search7

El Worker usa Web Crypto con PBKDF2 para derivar hashes de contraseñas y HMAC para firmar sesiones. Cloudflare Workers soporta PBKDF2 y HMAC mediante Web Crypto. citeturn470527search2

## Panel privado de videos

El panel está publicado como `/admin-videos.html` en la web de GitHub Pages y usa el mismo login de administrador del chat.

Para activar las cargas a Cloudflare R2, el Worker necesita un binding R2 llamado `VIDEOS` apuntando al bucket de videos. El nombre real del bucket debe configurarse en Cloudflare; no se guardan credenciales ni claves en el repositorio.

Endpoints nuevos:
- `GET /api/videos` — biblioteca privada.
- `GET/POST /api/admin/categories` — categorías.
- `POST /api/admin/upload` — carga de videos a R2.
- `POST /api/admin/video/delete` — elimina video de R2 y D1.
- `GET /api/schedule` — programación pública.
- `GET/POST /api/admin/schedule` — gestión privada de la programación.
- `GET /media/<clave>` — entrega segura de un objeto R2 para reproducción web.

Importante: el panel ya está en el repositorio, pero las funciones R2 requieren que Cloudflare tenga configurado el binding `VIDEOS`.
