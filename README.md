# Visor web de nubes de puntos LAS (basado en Potree)

Sube un archivo LAS/LAZ, se convierte automaticamente al formato octree de
Potree en segundo plano, y queda disponible en un visor 3D interactivo en el
navegador.

## Arquitectura

```
navegador --(sube LAS)--> nginx --(proxy)--> api --(encola)--> redis
                                                |
                                                v
                                           postgres (metadata del job)

worker <--(toma trabajo)-- redis
worker --(descarga LAS)--> minio (bucket raw-las)
worker --(ejecuta PotreeConverter)--> genera octree
worker --(sube resultado)--> minio (bucket pointclouds)

navegador --(visor Potree)--> nginx --(proxy)--> minio (bucket pointclouds)
```

Servicios en `docker-compose.yml`:

- **postgres**: metadata de cada trabajo (estado, nombre de archivo, error).
- **redis**: cola de trabajos (BullMQ).
- **minio**: almacenamiento tipo S3, self-hosted. Bucket `raw-las` (archivos
  originales) y `pointclouds` (resultado convertido, lectura publica).
- **api**: recibe la subida en streaming y la reenvia a MinIO, crea el
  trabajo, expone `GET /api/jobs` y `GET /api/jobs/:id`.
- **worker**: descarga el LAS, ejecuta `PotreeConverter`, sube el resultado.
  Se compila desde el codigo fuente oficial en el Dockerfile.
- **frontend**: nginx sirviendo la pagina de subida, el visor Potree, y
  haciendo de proxy hacia la api y hacia el bucket de MinIO.

## Como levantarlo

```bash
cp .env.example .env
# edita .env y cambia las claves por defecto

# 1. clona en tu maquina el codigo de Potree y PotreeConverter
#    (los Dockerfiles los copian desde aqui, no los clonan dentro del build)
./fetch-sources.sh

# 2. construye y levanta todo
docker compose up -d --build
```

La primera vez tardara varios minutos: el frontend compila Potree (JS), y el
worker compila PotreeConverter (C++) con cmake.

Abre `http://localhost:8080`.

### Si `fetch-sources.sh` o el `git clone` fallan

- Confirma que puedes llegar a GitHub por HTTPS normal: `curl -I https://github.com`.
- Si estas detras de un proxy corporativo, exporta `HTTPS_PROXY`/`HTTP_PROXY`
  antes de correr el script.
- Si el problema fue especificamente dentro de `docker build` (y no al correr
  `fetch-sources.sh` en tu terminal), es casi siempre que el contenedor de
  build no tiene la misma red/DNS que tu maquina (VPN, IPv6 mal configurado
  en Docker Desktop, firewall). Por eso los Dockerfiles ya no clonan nada
  dentro del build: solo copian `frontend/vendor/potree` y
  `worker/vendor/PotreeConverter`, generados por `fetch-sources.sh` en el
  host, donde la red si funciona.
- Si un `git clone` puntual falla por timeout, reintenta: a veces es
  simplemente la conexion del momento.

## Escalar la conversion

Cada contenedor `worker` procesa un trabajo a la vez (PotreeConverter ya usa
varios hilos internamente). Para procesar varios archivos en paralelo, agrega
mas contenedores en vez de aumentar la concurrencia interna:

```bash
docker compose up -d --scale worker=3
```

## Puntos a tener en cuenta antes de produccion

1. **Compatibilidad PotreeConverter 2.x / visor Potree 1.8**: hay reportes
   recientes en el repo de casos donde el visor 1.8 no carga bien la salida
   de PotreeConverter 2.x. Antes de usarlo en serio, prueba con un archivo
   real. Si falla, la alternativa es usar PotreeConverter 1.7 (genera muchos
   archivos en vez de 3, pero es la combinacion "clasica") o generar COPC con
   PDAL/untwine en vez de octree propio.
2. **El build de Potree puede fallar si cambia el nombre del script npm**: el
   Dockerfile de `frontend` asume `npm run build`. Si tras clonar
   `potree/potree` ese script no existe, revisa `package.json` del repo y
   ajusta la linea del Dockerfile.
3. **Subida grande a traves de nginx/api**: este scaffold sube el archivo en
   streaming a traves de nginx -> api -> MinIO, lo cual es simple y
   suficiente para empezar. Si mas adelante subes archivos de cientos de GB
   de forma habitual, conviene pasar a subida directa del navegador a MinIO/S3
   con URLs prefirmadas (multipart), para no hacer pasar todo el trafico por
   tu API.
4. **Seguridad**: falta autenticacion (cualquiera con acceso a la URL puede
   subir archivos y ver todas las nubes), TLS, y limitar los puertos 9000/9001
   de MinIO al exterior. Esto es un punto de partida funcional, no una
   configuracion lista para produccion publica.
5. **Espacio en disco**: el volumen `worker_tmp` necesita espacio libre
   equivalente a varias veces el tamano del LAS de entrada (archivo original +
   estructuras temporales + salida antes de subirla). Vigila el disco del
   host si conviertes archivos de decenas de GB.
6. **Storage en produccion**: para uso real considera reemplazar MinIO por
   almacenamiento administrado (Cloudflare R2, AWS S3, etc.) con un CDN
   delante, sobre todo si muchas personas van a visualizar las mismas nubes.
