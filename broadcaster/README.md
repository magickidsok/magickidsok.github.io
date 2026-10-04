# Magic Kids Broadcaster

Este servicio convierte la programación guardada en el panel de Magic Kids en una señal continua RTMPS para Cloudflare Stream Live.

## Qué hace

- Lee `/api/schedule` y respeta exactamente el orden del panel.
- Cuando el panel está en `live`, reproduce los videos uno detrás de otro.
- Cuando apretás REINICIAR, vuelve al primer video.
- Cuando DETENER o FUERA DE AIRE, corta el emisor.
- Crea automáticamente un Live Input de Cloudflare Stream la primera vez.
- Guarda el Live Input en `/data/live-input.json`.
- Usa H.264 + AAC, 1280x720, 2500 kbps de video y 128 kbps de audio.
- Se reconecta al mismo Live Input entre videos; Cloudflare Stream está diseñado para tolerar reconexiones y mantener el directo mientras no se supere el timeout configurado.

## Variables

```
MAGIC_KIDS_API_URL=https://magickidsok-github-io.elmagickids.workers.dev
CF_ACCOUNT_ID=tu_account_id
CF_STREAM_API_TOKEN=token_con_Stream_Write
CF_STREAM_CUSTOMER_CODE=tu_customer_code
CF_STREAM_TIMEOUT_SECONDS=30
```

El token solo se guarda en el servidor del broadcaster. Nunca se coloca en el sitio público ni en JavaScript del navegador.

El API Token necesita permiso **Stream Write** para crear el Live Input. Cloudflare documenta que los Live Inputs reciben RTMPS/SRT y entregan HLS/DASH.

## Ejecutar

```
docker build -t magic-kids-broadcaster .
docker run -d --restart unless-stopped \
  --name magic-kids-broadcaster \
  -v magic-kids-broadcast:/data \
  -e MAGIC_KIDS_API_URL=https://magickidsok-github-io.elmagickids.workers.dev \
  -e CF_ACCOUNT_ID=... \
  -e CF_STREAM_API_TOKEN=... \
  -e CF_STREAM_CUSTOMER_CODE=... \
  magic-kids-broadcaster
```

La URL estable del canal queda:

`https://customer-TU_CODIGO.cloudflarestream.com/TU_LIVE_INPUT_ID/manifest/video.m3u8`

La URL usa el **Live Input ID**, por lo que no cambia cada vez que iniciás una transmisión. Cloudflare crea un Video ID interno para cada emisión, pero el endpoint del Live Input permanece estable.
