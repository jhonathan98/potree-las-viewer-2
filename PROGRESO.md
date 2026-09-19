# Progreso del proyecto

> Este archivo se debe actualizar cada vez que se implemente una funcionalidad
> nueva o se complete un paso de infraestructura relevante (ver "Como
> mantener este archivo" al final). Es la fuente de verdad de que se hizo y
> por que, para que futuras sesiones de trabajo (humanas o de Claude Code) no
> tengan que reconstruir el contexto leyendo todo el historial de git.

## Objetivo del proyecto

Plataforma web para subir archivos LAS/LAZ, convertirlos automaticamente al
formato octree de Potree, y visualizarlos en un visor 3D interactivo desde el
navegador. Pensada para 10-50 usuarios, priorizando mantener el costo de
infraestructura cloud cercano a $0/mes: los datos pesados (LAS/LAZ originales
y resultados convertidos) y el procesamiento viven en una NAS propia via
Docker; solo autenticacion/base de datos (Supabase) y borde de red
(Cloudflare: DNS, Tunnel, hosting del frontend) usan servicios cloud
gratuitos. El detalle completo de la arquitectura objetivo y las reglas que
la gobiernan estan en `README-arquitectura-hibrida-gratuita.md`.

## Estado actual (resumen)

- Stack completo (Nginx, API, Redis, MinIO, Worker, PotreeConverter)
  corriendo en Docker en la NAS del usuario.
- Autenticacion y metadata de jobs en Supabase (Postgres + Auth), reemplazando
  el Postgres local original.
- Subida de archivos via URLs prefirmadas directo a MinIO (no pasa por la
  API), con limpieza automatica de subidas abandonadas.
- Frontend desplegado en Cloudflare (Workers con assets estaticos, proyecto
  `potree-viewer`), ademas de seguir sirviendose desde la NAS.
- Cloudflare Tunnel conectando el frontend de Cloudflare con la API de la NAS
  en `nas.aeromapscolombia.com`, verificado end-to-end.
- Subagentes de rol (`arquitectura`, `seguridad`, `pruebas`, `desarrollo`) y
  `CLAUDE.md` configurados para guiar el trabajo futuro con Claude Code en
  este repo.
- **Confirmado (2026-09-09): el flujo completo funciona de punta a punta** —
  Supabase (login/auth), Cloudflare (frontend + Tunnel) y la NAS (API,
  worker, MinIO) ya estan conectados y operando juntos en produccion.

## Pendiente / proximos pasos

- **UI/UX**: falta "ponerle bonito" el frontend — hoy es funcional pero sin
  trabajo de diseno (sigue siendo el HTML minimo del scaffold inicial).
- **Dominio propio**: reemplazar la URL actual
  `https://potree-viewer.aeromapscolombia.workers.dev` por
  `potreevista.aeromapscolombia.com` (agregar como Custom Domain en el
  proyecto de Cloudflare y actualizar `FRONTEND_URL` en el `.env` de la NAS).
- **Bucket `pointclouds` publico (riesgo conocido, sin resolver)**:
  `docker-compose.yml` (`minio-init`) sigue con `mc anonymous set download
  local/pointclouds` — cualquiera con la URL de una nube de puntos puede
  descargarla sin loguearse. Hoy la unica proteccion es que el ID del job es
  un UUID no adivinable (seguridad por oscuridad, no control de acceso real).
  El README (seccion 15) ya dejaba esta decision abierta entre "bucket
  publico via proxy" vs "URL temporal via API" — sigue sin resolverse a
  favor de la segunda opcion.
- **Limite de subida de Cloudflare (bloqueador para usuarios externos)**: la
  subida sigue siendo un unico `PUT` prefirmado directo a MinIO (sin
  multipart). El plan gratuito de Cloudflare limita a ~100MB por request en
  el trafico que pasa por el Tunnel/proxy, asi que archivos reales de
  decenas de GB solo se pueden subir hoy desde la LAN (sin pasar por
  Cloudflare). Es la Fase 6 del README ("Upload grande") que sigue
  pendiente — sin ella la app no cumple su proposito para usuarios externos.

### Verificado (2026-09-19): la validacion de auth en la API si esta activa

Antes de asumir que faltaba, se probo en vivo contra la NAS real
(`https://nas.aeromapscolombia.com`):

- `curl` a `/api/jobs` sin token -> `401` (no devuelve datos).
- `curl` a `/api/jobs` con un token invalido -> `401 {"error":"Token invalido o expirado"}`.

Esto confirma que `requireAuth` (`backend/src/auth.js`, verificacion JWKS de
Supabase) esta aplicado en `/api/jobs` y `/api/uploads`
(`router.use(requireAuth)` en ambos routers), y que la tabla `jobs` ya tiene
`user_id` (FK a `auth.users`) con `getJob`/`listJobs` filtrando siempre por
el usuario dueno — ver `backend/src/db.js`. Estos dos puntos **ya estaban
resueltos**, no son pendientes.

## Historial de tareas (segun git log en `main`)

| Fecha | Commit | Que se hizo |
|---|---|---|
| 2026-08-09 | `c4409fa` | Scaffold inicial: API, worker, frontend, docker-compose, y el README de arquitectura hibrida que gobierna el proyecto. |
| 2026-08-09 | `0674b68` | Cambio de Postgres local a Supabase para la metadata de jobs. |
| 2026-08-09 | `281e891` | Refactor de subida de archivos: de streaming por la API a URLs prefirmadas directo a MinIO; actualizacion del manejo de estados de job. |
| 2026-08-09 | `df6cebd` | Proceso de limpieza de subidas abandonadas (`cleanupStaleUploads`), integrado al arranque de la API. |
| 2026-08-09 | `aa11961` | Integracion de Supabase Auth: verificacion de JWT, jobs propios por usuario (`user_id`). |
| 2026-09-05 | `5c65dad` | Ajustes para desplegar el frontend en Cloudflare: `API_BASE_URL`/`BACKEND_PUBLIC_URL` para separar el origen del frontend del de la API, `build-pages.sh`, mejoras del visor (diagnostico en pantalla, deteccion automatica de atributo de color). |
| 2026-09-05 | `b26c3fa` | Merge de la rama `despliegueFreev1` a `main` (PR #1). |
| 2026-09-05 | `6971d31` | Node 18 -> 22 para el build de Cloudflare (su runner exige >= 20.18.1). |
| 2026-09-05 | `621d063` | `wrangler.jsonc`: el proyecto de Cloudflare resulto ser un Worker con assets estaticos (no Pages clasico), que necesita este archivo para saber que carpeta publicar. |

## Cambios de infraestructura fuera de git (cuentas/dashboards)

Estos pasos no dejan rastro en el historial de git pero son parte del estado
real del proyecto:

- **2026-09**: Dominio `aeromapscolombia.com` (Hostinger) agregado a
  Cloudflare; nameservers migrados.
- **2026-09**: Proyecto de Cloudflare Workers `potree-viewer` creado,
  conectado al repo de GitHub (`main`), con build command `bash
  build-pages.sh` y variables de entorno `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `API_BASE_URL` configuradas en el dashboard del
  proyecto (no en este repo).
- **2026-09**: Cloudflare Tunnel creado (`nas-potree`), corriendo como
  servicio `cloudflared` en la NAS (`docker compose --profile cloudflare up
  -d`), con Public Hostname `nas.aeromapscolombia.com` -> `http://frontend:80`.
  Verificado con `curl` (401 esperado en `/api/jobs` sin token).

## Como mantener este archivo actualizado

Cada vez que se implemente una funcionalidad nueva, se complete una fase del
README de arquitectura, o se haga un cambio de infraestructura relevante
(cuenta/dashboard, no solo codigo):

1. Agregar una fila a la tabla de historial (si hay commit) o a la lista de
   infraestructura (si no lo hay), con fecha.
2. Si cambia, actualizar la seccion "Estado actual".
3. Si el cambio afecta como funciona el sistema (no solo que se agrego),
   reflejarlo tambien en `CLAUDE.md`, que es el que leen las sesiones futuras
   de Claude Code para entender la arquitectura.

El rol `desarrollo` (`.claude/agents/desarrollo.md`) tiene esto como parte de
su checklist antes de dar un cambio por terminado.
