#!/usr/bin/env bash
# Clona en el host las dos dependencias que los Dockerfiles necesitan
# (evita depender de la red dentro de "docker build"). Correr una vez,
# y de nuevo si quieres actualizar de version.
set -euo pipefail

mkdir -p frontend/vendor worker/vendor

if [ ! -d frontend/vendor/potree ]; then
  echo "Clonando potree/potree (1.8.2)..."
  git clone --branch 1.8.2 --depth 1 https://github.com/potree/potree.git frontend/vendor/potree
else
  echo "frontend/vendor/potree ya existe, se omite (borralo si quieres re-clonar)"
fi

if [ ! -d worker/vendor/PotreeConverter ]; then
  echo "Clonando potree/PotreeConverter (2.1.1)..."
  git clone --branch 2.1.1 --depth 1 https://github.com/potree/PotreeConverter.git worker/vendor/PotreeConverter
else
  echo "worker/vendor/PotreeConverter ya existe, se omite (borralo si quieres re-clonar)"
fi

echo "Listo. Ahora corre: docker compose up -d --build"
