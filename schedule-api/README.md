# MAGIC KIDS Schedule API

Private write API for the isolated PROGRAMACIÓN migration.

## Required Render environment variables
- GITHUB_TOKEN: fine-grained GitHub token with Contents read/write access only to magickidsok/magickidsok.github.io.
- ADMIN_API_KEY: long random secret shared only with the authenticated Wix panel backend.
- GITHUB_OWNER=magickidsok
- GITHUB_REPO=magickidsok.github.io
- GITHUB_BRANCH=migration/programacion-github-json
- GITHUB_FILE_PATH=data/programacion.json

## Routes
- GET /health
- GET /schedule
- GET /events (Server-Sent Events)
- POST /schedule (Authorization: Bearer ADMIN_API_KEY)

Do not expose either secret in browser JavaScript. Restrict the POST route to an authenticated Wix backend proxy before production.
The service is intentionally deployed on an isolated migration branch; it does not change either Wix site.
