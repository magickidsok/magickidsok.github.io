# Magic Kids Panel — Windows 11

Programa nativo WinForms/.NET 8 para gestionar una biblioteca de videos y controlar el canal Magic Kids sin Chrome.

## Funciones
- Secciones TANDAS, SERIES y PELICULAS.
- Selección múltiple y subida hasta 3 archivos simultáneos.
- Subida por chunks a VCDN mediante REST API.
- Espera automática de procesamiento HLS y captura del master.m3u8.
- Biblioteca local persistente en %APPDATA%\\MagicKidsPanel.
- Ordenación subir/bajar para cambiar la programación.
- INICIAR, STOP, FUERA DE AIRE, REINICIAR, PAUSAR y REANUDAR.
- Estado del canal guardado en la nube: puede seguir al aire aunque el PC esté apagado después de haber iniciado.
- Contador de espectadores del sitio público.
- URL permanente de lista: https://uifchrnvigkzantaehgz.supabase.co/functions/v1/mk-vcdn-channel/magic-kids.m3u8
- La app no usa Chrome, Electron ni navegador embebido.

## VCDN
VCDN documenta REST API de init/chunk/complete y devuelve playback_url HLS master.m3u8.

La primera configuración requiere pegar una API Key de VCDN en AJUSTES. Esa clave se guarda cifrada con Windows DPAPI para el usuario actual.

## Importante
El endpoint M3U8 de Magic Kids es una playlist externa de fuentes HLS de VCDN. El reproductor web de Magic Kids usa además el catálogo/estado cloud para sincronización lineal.

El instalador se construye en GitHub Actions y se publica en /downloads/MagicKidsPanelSetup.exe.
