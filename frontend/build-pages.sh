#!/usr/bin/env bash
# Build de Cloudflare Pages para este frontend.
#
# Proyecto Pages > Settings > Builds:
#   Root directory:    frontend
#   Build command:     bash build-pages.sh
#   Output directory:  dist
#   Variables de entorno de build (Settings > Environment variables):
#     SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL (ej. https://nas.aeromapscolombia.com)
#
# Replica lo que hoy hace frontend/Dockerfile, pero generando una carpeta
# estatica (dist/) en vez de una imagen nginx: clona y compila vendor/potree
# (no esta en git, ver ../fetch-sources.sh), genera config.js desde las
# variables de entorno del build, y arma dist/ = public/ + potree-lib/.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d vendor/potree ]; then
  echo "Clonando potree/potree (1.8.2)..."
  git clone --branch 1.8.2 --depth 1 https://github.com/potree/potree.git vendor/potree
fi

echo "Compilando Potree..."
npm --prefix vendor/potree install
npm --prefix vendor/potree run build

echo "Generando config.js desde variables de entorno del build..."
cat > public/config.js <<EOF
window.APP_CONFIG = {
  SUPABASE_URL: '${SUPABASE_URL:?falta la variable de entorno SUPABASE_URL en Cloudflare Pages}',
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY:?falta la variable de entorno SUPABASE_ANON_KEY en Cloudflare Pages}',
  API_BASE_URL: '${API_BASE_URL:-}',
};
EOF

echo "Armando dist/..."
rm -rf dist
mkdir -p dist/potree-lib/build
cp -r public/. dist/
cp -r vendor/potree/build/potree dist/potree-lib/build/potree
cp -r vendor/potree/libs dist/potree-lib/libs

echo "Listo: frontend/dist/"
