# ---- Etapa 1: compilar la libreria Potree ----
FROM node:18-bullseye AS potree-build

WORKDIR /src
# Codigo de Potree copiado desde ./vendor/potree (clonado en el host con
# fetch-sources.sh) en vez de clonarlo aqui dentro, para que "docker build"
# no dependa de la red del contenedor.
COPY vendor/potree /src
RUN npm install
# NOTA: si este paso falla porque el script se llama distinto en tu version,
# revisa la seccion "scripts" de vendor/potree/package.json y ajusta el comando.
RUN npm run build

# ---- Etapa 2: imagen final, solo nginx sirviendo archivos estaticos ----
FROM nginx:alpine

COPY --from=potree-build /src/build/potree /usr/share/nginx/html/potree-lib/build/potree
COPY --from=potree-build /src/libs /usr/share/nginx/html/potree-lib/libs

COPY public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
