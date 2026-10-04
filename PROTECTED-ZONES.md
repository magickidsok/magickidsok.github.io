# MAGIC KIDS — ZONAS PROTEGIDAS

## 🔒 REGLA CRÍTICA: REPRODUCTOR ESTABLE

El reproductor de transmisión y su configuración estable son una zona prohibida para cambios accidentales.

Cuando se solicite modificar el chat, juegos, diseño, panel, navegación u otra función, NO modificar el reproductor salvo pedido explícito de Alex.

No modificar sin autorización explícita:
- sincronización de la programación y posición de reproducción;
- autoplay y lógica de reproducción;
- controles de volumen y pantalla completa;
- lógica de cambio de videos;
- correcciones de reproducción, reintentos o recuperación;
- transmisión y endpoints relacionados con el reproductor;
- configuración de R2/VOD que afecte la reproducción estable.

Funciones especialmente protegidas en `index.html`:
- `synchronizedPosition()`
- `syncScheduledToClock()`
- `setScheduledVideo()`
- `loadScheduledPlayer()`
- `stopScheduledPlayer()`
- variables y timers de `scheduledMode`, `scheduledVideos`, `channelStartedAt` y duración/sincronización.

## 💬 ZONA CHAT

La lógica del chat está separada en:
- `assets/chat.js` — autenticación, mensajes, presencia y moderación.
- `chat-worker/src/index.js` — API, sesiones y base de datos del chat.

Los usuarios entran con correo electrónico + contraseña.
El administrador entra en el sector privado del chat con el PIN numérico de 4 dígitos y usa el nick reservado `MAGICKIDS`.

## 🎮 ZONA JUEGOS

`juegos.html` es independiente del reproductor y contiene la trivia de Dragon Ball Z.

**Regla práctica:** si el pedido no menciona el reproductor, asumir que el reproductor NO se toca.
