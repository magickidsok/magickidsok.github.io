# Magic Kids — arquitectura estable

## Objetivo

Separar completamente tres capas:

1. **Transmisión/reproductor público**: zona protegida. No se modifica al agregar funciones administrativas.
2. **Web pública**: interfaz de MagicKids.online.
3. **Panel privado**: administración de videos, categorías, programación, chat, avisos y estado.

## Regla principal

El panel administra **datos**. No controla ni reescribe el código del reproductor.

La transmisión debe poder continuar aunque el panel administrativo esté caído.

## Flujo

```
TRANSMISIÓN / HLS / VDO
          |
          v
   REPRODUCTOR PÚBLICO
          |
          +---- WEB MAGIC KIDS

PANEL PRIVADO
      |
      v
   API / D1 / R2
      |
      +---- videos
      +---- categorías
      +---- programación
      +---- avisos
      +---- moderación
```

## Backend actual

- Worker: `chat-worker/src/index.js`
- D1: `magic-kids-chat-db`
- R2: `magic-kids-videos`
- API: `https://magickidsok-github-io.elmagickids.workers.dev`
- Health: `/api/health`
- Panel: `/admin-videos.html`

## Panel

El panel conserva las funciones actuales:

- autenticación privada por PIN;
- videos;
- carga de archivos;
- cargas grandes por partes;
- categorías/carpetas;
- programación;
- tandas;
- estado del canal;
- contador de espectadores;
- avisos;
- generación de M3U8;
- reparación de claves R2.

El panel ahora muestra explícitamente si el Worker está **ONLINE** u **OFFLINE**.

## Estabilidad

No se hacen comprobaciones masivas de R2 en cada consulta pública de programación. Las reparaciones de claves se ejecutan desde el panel cuando son necesarias.

El reproductor público no debe depender de que `admin-videos.html` esté abierto.

## Despliegue

El Worker puede desplegarse automáticamente desde GitHub Actions cuando estén configurados los secretos:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

El despliegue conserva los secretos del Worker ya configurados en Cloudflare, como `ADMIN_PIN` y `SESSION_SECRET`.

## Importante

No se deben almacenar contraseñas, PIN, tokens ni secretos dentro del repositorio.
