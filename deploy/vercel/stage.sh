#!/usr/bin/env bash
# Assembles .vercel-stage/, the folder deployed to Vercel: one project, one domain, no CORS.
#   /            landing page          (web/landing.html, renamed index.html)
#   /app         the navigator         (web/index.html, renamed app.html; cleanUrls drops .html)
#   /api, /health, /docs, /openapi.json   the FastAPI app (api/app) as a Python function
# Before: build the web for Vercel (needs the terrain tiles in web/public/tiles, `npm run tiles`):
#   cd web && VERCEL=1 npm run build
# Then:  bash deploy/vercel/stage.sh && cd .vercel-stage && npx vercel deploy --prod
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/.vercel-stage"
test -f "$ROOT/web/dist/landing.html" || { echo "web/dist is missing: build the web first (VERCEL=1 npm run build)"; exit 1; }

mkdir -p "$OUT"
rm -rf "$OUT/public" "$OUT/server" "$OUT/data" "$OUT/api"   # keeps $OUT/.vercel (the project link)
cp -r "$ROOT/web/dist" "$OUT/public"
mv "$OUT/public/index.html" "$OUT/public/app.html"
mv "$OUT/public/landing.html" "$OUT/public/index.html"

mkdir -p "$OUT/api" "$OUT/server"
cp -r "$ROOT/api/app" "$OUT/server/app"
find "$OUT/server" -name __pycache__ -type d -prune -exec rm -rf {} +
cp "$ROOT/deploy/vercel/index.py" "$OUT/api/index.py"
cp "$ROOT/deploy/vercel/requirements.txt" "$OUT/requirements.txt"
cp "$ROOT/deploy/vercel/vercel.json" "$OUT/vercel.json"
cp "$ROOT/deploy/vercel/.vercelignore" "$OUT/.vercelignore"   # never upload the .env.local that `vercel link` writes

# the committed datasets, without the git-ignored raw downloads
(cd "$ROOT" && tar --exclude='data/raw' -cf - data) | (cd "$OUT" && tar -xf -)

du -sh "$OUT/public" "$OUT/server" "$OUT/data"
