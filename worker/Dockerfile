FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        ca-certificates \
        libtbb-dev \
    && rm -rf /var/lib/apt/lists/*

# El codigo de PotreeConverter se copia desde ./vendor/PotreeConverter
# (clonado en el host con fetch-sources.sh) en vez de clonarlo aqui dentro,
# para que "docker build" no dependa de la red del contenedor.
COPY vendor/PotreeConverter /opt/PotreeConverter

RUN mkdir -p /opt/PotreeConverter/build \
    && cd /opt/PotreeConverter/build \
    && cmake .. \
    && make -j"$(nproc)" \
    && BIN=$(find . -maxdepth 3 -type f -iname "PotreeConverter*" -perm -u+x | head -n1) \
    && test -n "$BIN" \
    && cp "$BIN" /usr/local/bin/PotreeConverter \
    && chmod +x /usr/local/bin/PotreeConverter

ENV POTREE_CONVERTER_BIN=/usr/local/bin/PotreeConverter

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src

CMD ["node", "src/worker.js"]
