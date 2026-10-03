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
