# MAGIC KIDS — Cloudflare Workers (PROGRAMACIÓN only)

This is an isolated deployment candidate. It does not change the Wix sites, the public player, HLS, or any other panel section.

## Routes
- GET /health
- GET /schedule — reads the current JSON in GitHub
- POST /schedule/session — validates the existing Wix admin bearer token against the existing admin-state endpoint, then issues an 8-hour HMAC schedule session
- POST /schedule — validates the signed session and commits the new JSON to the migration branch

The public page should poll GET /schedule every 60 seconds (not use SSE). The schedule titles change every 30 minutes, so a 60-second check is sufficient and avoids persistent connections. The Worker GET route is cacheable for 15 seconds.

## Required Worker secrets
Configure these with `wrangler secret put` or the Cloudflare dashboard:
- GITHUB_TOKEN: fine-grained GitHub token with Contents read/write only for magickidsok/magickidsok.github.io
- SCHEDULE_SIGNING_SECRET: a long random secret. Must match the existing Render value while the migration is tested.

## Deployment
1. Create a Cloudflare Worker named `magic-kids-programacion`.
2. Add the two secrets above.
3. Deploy with Wrangler from this directory, or paste `src/index.js` into the dashboard editor and set the same secrets.
4. Test /health, GET /schedule, authenticated save, and public polling.
5. Only after all tests pass, update ONLY the PROGRAMACIÓN API URL in the Wix private panel and the public schedule script. Keep Render online as rollback until then.

No Cloudflare account credentials are included in this repository. Do not commit secrets.
