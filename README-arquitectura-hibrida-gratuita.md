# Arquitectura híbrida de bajo costo — Visor LAS/LAZ + Potree

## 1. Objetivo

Construir una plataforma web para:

1. Subir archivos LAS/LAZ.
2. Registrar trabajos de procesamiento.
3. Encolar trabajos.
4. Procesar archivos con `PotreeConverter`.
5. Generar los datos necesarios para Potree.
6. Almacenar originales y resultados en una NAS.
7. Visualizar nubes de puntos desde el navegador.
8. Soportar aproximadamente 10–50 usuarios.
9. Minimizar el costo mensual de infraestructura cloud.
10. Mantener una arquitectura segura y evolucionable.

La estrategia inicial es utilizar servicios gratuitos y la infraestructura propia de la NAS siempre que sea razonable.

---

## 2. Arquitectura objetivo

```text
                            INTERNET
                                |
                                v
                    +----------------------+
                    |      CLOUDFLARE      |
                    |                      |
                    | DNS                  |
                    | HTTPS / SSL          |
                    | Cloudflare Pages     |
                    | Cloudflare Tunnel    |
                    +----------+-----------+
                               |
                +--------------+--------------+
                |                             |
                v                             v
       +------------------+          +------------------+
       | Cloudflare Pages |          |    SUPABASE      |
       |                  |          |                  |
       | Frontend         |          | PostgreSQL       |
       | Potree Viewer    |          | Auth (si aplica) |
       +--------+---------+          +------------------+
                |
                | HTTPS
                v
       +-------------------------------------------+
       |                    NAS                    |
       |                                           |
       |                  Docker                   |
       |                                           |
       |   +-------------+                         |
       |   |    Nginx    |                         |
       |   +------+------+
       |          |
       |   +------v------+       +-------------+   |
       |   |     API     +------>|    Redis    |   |
       |   +------+------+
       |          |              BullMQ queue      |
       |          |                               |
       |          |              +-------------+  |
       |          +------------->|    Worker   |  |
       |                         | PotreeConv.  |  |
       |                         +------+-------+  |
       |                                |          |
       |                         +------v-------+  |
       |                         |    MinIO     |  |
       |                         +------+-------+  |
       |                                |          |
       |                    +-----------+--------+ |
       |                    |                    | |
       |                 raw-las            pointclouds
       |                                           |
       +-------------------------------------------+
```

---

## 3. Principios

### Reducir costos

No utilizar inicialmente, salvo necesidad real:

- Google Cloud Run
- Cloud SQL
- Memorystore
- Google Cloud Storage
- GKE
- Google Cloud Load Balancer

### Mantener archivos pesados en la NAS

Los LAS/LAZ y los resultados de Potree permanecen en MinIO sobre la NAS.

No almacenar LAS/LAZ en Supabase.

### Usar cloud solo donde aporte valor

**Cloud:**
- Cloudflare Pages
- Cloudflare DNS
- Cloudflare Tunnel
- Supabase PostgreSQL

**NAS:**
- Nginx
- API
- Redis
- MinIO
- Worker
- PotreeConverter

---

## 4. Cloudflare Pages

Responsabilidad:

- alojar frontend
- servir HTML/CSS/JavaScript
- servir Potree
- CI/CD desde Git

Costo objetivo:

```text
$0/mes
```

---

## 5. Cloudflare DNS y Tunnel

Cloudflare administrará el DNS y HTTPS.

Cloudflare Tunnel conectará Cloudflare con la NAS sin exponer directamente la NAS mediante puertos públicos.

Flujo:

```text
Internet
   |
Cloudflare
   |
Cloudflare Tunnel
   |
NAS
   |
Nginx
   |
API
```

No abrir innecesariamente:

```text
80
443
9000
9001
5432
6379
```

hacia Internet.

---

## 6. Supabase

Supabase será PostgreSQL administrado.

Responsabilidad:

- usuarios
- metadata de jobs
- estados
- errores
- rutas
- timestamps
- información necesaria para consultar trabajos

Tabla conceptual:

```text
jobs
--------------------------------
id
user_id
filename
status
progress
error
storage_path
created_at
started_at
completed_at
```

Estados:

```text
PENDING
PROCESSING
COMPLETED
FAILED
CANCELLED
```

Los archivos LAS/LAZ NO deben almacenarse en PostgreSQL.

---

## 7. MinIO

MinIO continuará ejecutándose en la NAS mediante Docker.

Buckets:

```text
raw-las
pointclouds
```

`raw-las` contiene los originales.

`pointclouds` contiene los resultados generados por PotreeConverter.

No exponer públicamente los puertos administrativos de MinIO.

---

## 8. Redis

Redis continuará en Docker dentro de la NAS.

Responsabilidad:

- BullMQ
- cola de trabajos
- reintentos
- comunicación API → Worker
- estado temporal de procesamiento

Flujo:

```text
API
 |
 v
Redis / BullMQ
 |
 v
Worker
```

No reemplazar Redis inicialmente por Pub/Sub.

---

## 9. API

La API continuará ejecutándose en la NAS.

Responsabilidades:

- autenticación
- autorización
- creación de jobs
- interacción con Supabase
- operaciones sobre MinIO
- publicación de jobs en Redis
- consulta de estados

Endpoints mínimos orientativos:

```text
POST /api/jobs
GET  /api/jobs
GET  /api/jobs/:id
POST /api/jobs/:id/cancel
```

Antes de crear o modificar endpoints, revisar el código actual.

---

## 10. Worker

El Worker continuará en la NAS.

Flujo:

```text
Redis
  |
  v
Worker
  |
  +--> MinIO raw-las
  |
  +--> PotreeConverter
  |
  +--> MinIO pointclouds
  |
  +--> Supabase
```

Cada worker debe procesar inicialmente un único trabajo simultáneamente.

Escalamiento:

```text
worker x 1
worker x 2
worker x 3
```

La cantidad máxima dependerá de CPU, RAM, I/O y almacenamiento de la NAS.

---

## 11. Potree

Versiones existentes:

```text
Potree: 1.8.2
PotreeConverter: 2.1.1
```

No cambiar versiones automáticamente.

Primero probar con archivos LAS/LAZ reales y validar compatibilidad.

---

## 12. Nginx

Nginx continuará dentro de la NAS.

Responsabilidades:

- reverse proxy
- enrutar `/api`
- headers
- límites de requests
- integración con Cloudflare Tunnel

No exponer directamente MinIO ni Redis.

---

## 13. Upload de archivos grandes

El flujo actual del proyecto pasa por:

```text
Browser
   |
Nginx
   |
API
   |
MinIO
```

Para archivos grandes, la arquitectura objetivo debe intentar:

```text
Browser
   |
   | solicitar upload
   v
API
   |
   | operación/URL temporal
   v
MinIO
   ^
   |
   | LAS/LAZ
   |
Browser
```

El archivo grande debe evitar atravesar innecesariamente la API.

Evaluar:

- URLs prefirmadas
- multipart upload
- cargas reanudables
- checksum
- límites de Cloudflare

No implementar una solución de archivos grandes sin verificar primero las restricciones reales de Cloudflare Tunnel/Proxy y MinIO.

---

## 14. Flujo de procesamiento

```text
1. Usuario selecciona LAS/LAZ
           |
           v
2. Frontend solicita creación del job
           |
           v
3. API crea job en Supabase
           |
           v
4. API prepara upload a MinIO
           |
           v
5. Browser sube archivo
           |
           v
6. API confirma/encola job
           |
           v
7. Worker obtiene job de Redis
           |
           v
8. Worker obtiene LAS/LAZ desde MinIO
           |
           v
9. PotreeConverter procesa
           |
           v
10. Resultado -> MinIO/pointclouds
           |
           v
11. Worker actualiza Supabase
           |
           v
12. Frontend consulta estado
           |
           v
13. Usuario abre visor Potree
```

---

## 15. Visualización

El navegador debe acceder a los resultados sin exponer los puertos administrativos de MinIO.

Evaluar:

```text
Browser
   |
Cloudflare
   |
Nginx / endpoint seguro
   |
MinIO
```

o:

```text
Browser
   |
API
   |
URL temporal
   |
MinIO
```

Elegir la alternativa con mejor seguridad y rendimiento.

---

## 16. Seguridad

Implementar:

- autenticación
- autorización
- CORS correcto
- rate limiting
- headers de seguridad
- permisos mínimos
- secretos fuera de Git

Un usuario no debe poder:

- ver jobs de otros usuarios
- descargar archivos de otros usuarios
- acceder a buckets completos
- obtener credenciales MinIO

No exponer:

```text
9000
9001
6379
```

Los secretos deben manejarse mediante `.env` local/servidor y `.env.example` sin valores reales.

---

## 17. Usuarios

Objetivo:

```text
10–50 usuarios
```

Esto no implica 50 conversiones simultáneas.

Diferenciar:

```text
usuarios conectados
```

de:

```text
jobs simultáneos
```

El cuello de botella esperado será principalmente la NAS:

- CPU
- RAM
- I/O
- espacio temporal
- almacenamiento
- red

---

## 18. Almacenamiento temporal

PotreeConverter puede necesitar varias veces el tamaño del LAS original.

No asumir un factor exacto sin medirlo.

Implementar una política para:

```text
worker_tmp/
```

que contemple:

- limpieza
- archivos huérfanos
- jobs fallidos
- jobs cancelados
- límites de espacio

---

## 19. Backups

La NAS no es automáticamente un backup.

Diseñar una estrategia de bajo costo para:

```text
Supabase
MinIO raw-las
MinIO pointclouds
Configuración Docker
Variables de entorno
Código
```

---

## 20. Observabilidad

Inicialmente:

- Docker logs
- Nginx logs
- API logs
- Worker logs
- MinIO logs
- Redis logs

Posteriormente, si la NAS tiene recursos:

- Prometheus
- Grafana
- Uptime Kuma

---

## 21. CI/CD

Frontend:

```text
GitHub
   |
   v
Cloudflare Pages
```

Servicios NAS:

```text
GitHub
   |
   v
NAS
   |
   v
docker compose
```

No exponer SSH públicamente solo para CI/CD. Diseñar un mecanismo seguro.

---

## 22. Estructura sugerida

```text
project/
│
├── frontend/
├── api/
├── worker/
├── nginx/
│   └── nginx.conf
│
├── docker-compose.yml
├── .env.example
├── fetch-sources.sh
├── README.md
│
└── infra/
    ├── cloudflare/
    └── supabase/
```

No crear archivos innecesarios sin revisar primero el proyecto existente.

---

## 23. Variables de entorno

Ejemplo conceptual:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=

REDIS_URL=

API_URL=
FRONTEND_URL=
```

Determinar las variables reales revisando el código.

Nunca colocar secretos reales en Git.

---

## 24. Restricciones

La IA debe respetar:

1. No introducir servicios cloud de pago sin justificarlo.
2. No mover LAS/LAZ a cloud sin necesidad.
3. No sustituir MinIO inicialmente.
4. No sustituir Redis inicialmente.
5. No sustituir Potree/PotreeConverter sin razón técnica.
6. No cambiar versiones de Potree sin pruebas.
7. No exponer MinIO directamente.
8. No almacenar LAS/LAZ en Supabase.
9. No guardar secretos en Git.
10. No implementar todo de una vez.
11. Cada fase debe probarse antes de continuar.
12. Antes de modificar código, leerlo y entenderlo.
13. Explicar impactos de seguridad y costos.
14. Preferir soluciones gratuitas/self-hosted.
15. Verificar límites actuales de los Free Tier cuando sean relevantes.
16. No asumir que un Free Tier es ilimitado.

---

## 25. Metodología de trabajo con IA

La IA NO debe implementar toda la arquitectura de una sola vez.

Cada fase debe seguir:

```text
1. Explicar objetivo
2. Explicar arquitectura
3. Mostrar archivos a modificar
4. Implementar
5. Ejecutar/prponer pruebas
6. Verificar resultado
7. Documentar
8. Esperar confirmación
9. Pasar a la siguiente fase
```

Si algo falla:

```text
NO continuar.
```

Primero solucionar el problema.

---

## 26. Fases

### Fase 0 — Auditoría

Revisar:

- docker-compose.yml
- Dockerfiles
- API
- Worker
- Frontend
- Nginx
- variables de entorno
- scripts

Crear un plan de migración sin modificar código.

---

### Fase 1 — Entorno Docker funcional

Confirmar:

```text
Frontend
API
Redis
MinIO
Worker
Potree
PotreeConverter
```

funcionando mediante Docker Compose.

---

### Fase 2 — Supabase

Migrar PostgreSQL local a Supabase.

Objetivos:

- crear proyecto
- crear tablas
- índices
- conexión
- migración de metadata
- eliminar dependencia de PostgreSQL local

No mover archivos a Supabase Storage.

---

### Fase 3 — MinIO en NAS

Confirmar:

```text
MinIO
 |
 +-- raw-las
 |
 +-- pointclouds
```

con persistencia.

---

### Fase 4 — Redis

Confirmar:

```text
API
 |
Redis
 |
Worker
```

y probar BullMQ.

---

### Fase 5 — Worker

Probar con archivos reales.

Medir:

- tiempo
- CPU
- RAM
- espacio temporal
- tamaño de salida

---

### Fase 6 — Upload grande

Implementar una estrategia eficiente.

Evaluar:

- URLs prefirmadas
- multipart
- cargas reanudables
- límites de Cloudflare

---

### Fase 7 — Frontend en Cloudflare Pages

Desplegar el frontend y configurar variables públicas.

---

### Fase 8 — Cloudflare Tunnel

Configurar:

```text
Cloudflare
    |
Tunnel
    |
NAS
    |
Nginx
```

---

### Fase 9 — Seguridad

Implementar:

- autenticación
- autorización
- permisos
- CORS
- rate limiting
- headers
- secretos

---

### Fase 10 — Visualización

Confirmar:

```text
Browser
   |
Potree
   |
pointclouds
   |
MinIO
```

---

### Fase 11 — Backups

Implementar backup de:

```text
Supabase
MinIO
configuración
```

---

### Fase 12 — Observabilidad

Agregar métricas y monitoreo.

---

### Fase 13 — Optimización

Medir:

- usuarios
- jobs/minuto
- duración
- CPU
- RAM
- I/O
- red
- tamaños
- errores

Después decidir si hace falta cloud adicional.

---

## 27. Regla para servicios de pago

Antes de añadir cualquier servicio de pago, responder:

```text
1. ¿Por qué es necesario?
2. ¿Qué problema resuelve?
3. ¿Existe alternativa gratuita?
4. ¿Existe alternativa en la NAS?
5. ¿Cuál es el costo mensual?
6. ¿Qué límite del Free Tier se alcanzaría?
7. ¿Podemos posponerlo?
```

No introducir servicios de pago si existe una solución gratuita razonable.

---

## 28. Primera instrucción para la IA

Al comenzar el desarrollo, NO implementar todavía.

Primero:

1. Leer este README.
2. Leer el `docker-compose.yml` existente.
3. Leer Dockerfiles.
4. Leer el código de API.
5. Leer el Worker.
6. Leer Nginx.
7. Leer frontend.
8. Identificar dependencias.
9. Comparar arquitectura actual y objetivo.
10. Identificar qué puede mantenerse.
11. Identificar qué debe modificarse.
12. Identificar riesgos.
13. Crear el plan de migración.
14. Presentar únicamente la Fase 0.

Después de presentar la Fase 0, esperar confirmación antes de modificar archivos.

---

## 29. Prioridades

```text
FUNCIONALIDAD
    ↓
SEGURIDAD
    ↓
ESTABILIDAD
    ↓
COSTO
    ↓
ESCALABILIDAD
```

Objetivo inicial:

```text
≈ $0/mes de infraestructura cloud
```

La arquitectura podrá evolucionar posteriormente hacia servicios administrados como:

```text
Cloud Run
Cloud Storage
Cloud SQL
Pub/Sub
GKE
```

si la carga o los requisitos lo justifican.

---

## 30. Resultado final esperado

El sistema debe permitir:

- usuarios autenticados
- subir LAS/LAZ
- manejar archivos grandes
- crear jobs
- consultar estados
- procesar con PotreeConverter
- almacenar originales en NAS
- almacenar resultados en NAS
- visualizar nubes con Potree
- procesar múltiples trabajos
- reintentar jobs
- recuperar errores
- proteger recursos
- realizar backups
- desplegar frontend automáticamente
- actualizar Docker de forma controlada
- soportar aproximadamente 10–50 usuarios
- mantener el costo cloud cercano a $0 inicialmente

---

## 31. Estado de referencia del proyecto existente

La arquitectura Docker original contiene:

```text
nginx
api
redis
postgres
minio
worker
frontend
```

El objetivo es transformarla progresivamente en:

```text
Cloudflare Pages
       |
Cloudflare Tunnel
       |
      Nginx
       |
      API
       |
   +---+---+
   |       |
Redis   Supabase
   |
Worker
   |
MinIO
   |
NAS
```

sin perder funcionalidad.

---

## 32. Comando base

Una vez completada la auditoría:

```bash
docker compose up -d --build
```

La IA debe verificar primero que el entorno base funciona antes de iniciar cualquier migración.
