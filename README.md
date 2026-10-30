# misdatossalud

PWA local-first para consultar tus datos de salud de Amazfit/Zepp y Health Connect, sin backend propio.

**App publicada:** https://jblancoantelo.github.io/misdatossalud/

> **Estado:** funcional y desplegada. Importa el export completo de Zepp, cifra la base con contraseña y muestra resumen, actividad, sueño, frecuencia cardiaca, entrenamientos y cuerpo. La sincronización con Google Health está implementada como **prueba de viabilidad** (OAuth + sondeo de la API), pendiente de ejecutar con un Client ID real.

## Qué hace

- **Importa el ZIP de exportación de Zepp** (las 11 carpetas de CSV) con una sola transacción e inserción idempotente.
- **Guarda todo en el navegador** con SQLite WASM en memoria y un snapshot cifrado en OPFS (o IndexedDB como reserva).
- **Cifra con contraseña** usando AES-GCM-256 con clave derivada por PBKDF2-SHA256 (310.000 iteraciones).
- **Funciona offline** tras la primera carga: el service worker precachea app, CSS y el binario de SQLite.
- **Resumen semanal** con comparación frente a la semana anterior.
- **Vistas**: Resumen, Actividad, Sueño (con hipnograma), Corazón, Deporte, Cuerpo y Ajustes.
- **Copia de seguridad** en un fichero `.mdsalud` cifrado, descargable y restaurable en otro dispositivo.
- **Tema claro/oscuro** según el sistema, en español.

## Privacidad

- Sin backend propio: los datos no salen del dispositivo salvo las llamadas a las APIs que autorices.
- La base vive en memoria mientras está desbloqueada; en disco solo hay un snapshot cifrado.
- No se suben datos de salud al repositorio: `export/` y `export_full/` están en `.gitignore`.
- Si pierdes la contraseña, los datos no se pueden recuperar: no hay servidor ni puerta trasera.

## Cómo funciona el cifrado

El fichero `.mdsalud` tiene una cabecera JSON con parámetros (`v`, `alg`, `kdf`, `iter`, `salt`, `iv`), un salto de línea y el ciphertext. La cabecera se usa como **datos autenticados adicionales (AAD)**, así que modificar las iteraciones o la sal invalida el descifrado.

El autoguardado se dispara cada 4 segundos si hay cambios pendientes, además de en `pagehide` y `visibilitychange`.

## Stack

React 19 + TypeScript + Vite 8, ECharts 6, sql.js 1.15 (SQLite WASM), JSZip y PapaParse. PWA con `vite-plugin-pwa`.

## Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo
npm run build      # typecheck + build de producción
npm run preview    # sirve dist/ (necesario para probar OPFS y el service worker)
npm test           # tests con Vitest
```

Nota: el proyecto se sirve bajo `/misdatossalud/` (GitHub Pages). En `dev` y `preview` la URL es `http://localhost:5173/misdatossalud/` y `http://localhost:4173/misdatossalud/`.

Los tests incluyen una prueba de integración con el export real (`src/import/real-export.test.ts`) que se **salta automáticamente** si no existe la carpeta `export_full/`. Con el histórico completo (933.735 filas) la importación tarda unos 3-4 segundos en un portátil.

## Despliegue

Cada push a `main` o `poc` ejecuta `.github/workflows/deploy.yml`: instala dependencias, pasa los tests, compila y publica `dist/` en GitHub Pages.

En **Settings → Pages → Source** hay que elegir **GitHub Actions**. Con el modo antiguo (*Deploy from a branch*) GitHub publica el código fuente sin compilar: el `index.html` apunta a `/src/main.tsx` y la app no carga.

## Estructura

```
src/
  db/        esquema SQLite, store, cifrado, almacenamiento y sesión
  import/    importador del ZIP de Zepp
  sync/      prueba de viabilidad de Google Health API
  state/     ciclo crear/desbloquear/guardar/restaurar
  ui/        vistas y componentes
  lib/       fechas, formato y series
docs/        decisiones y arquitectura
```

## Google Health (prueba de viabilidad)

La vista de Ajustes permite pegar un Client ID OAuth de Google Cloud y lanzar cuatro comprobaciones contra `health.googleapis.com`: identidad, dispositivos emparejados, pasos diarios (`dailyRollUp`) y sesiones de sueño (`reconcile`). Muestra el estado HTTP, la latencia, un resumen y el JSON crudo de cada llamada.

Sirve para confirmar antes de escribir la sincronización definitiva: que el flujo implícito de Google Identity Services funciona, que la API responde con CORS desde el navegador y qué forma tienen los datos reales. **No guarda nada en la base todavía.**

Requisitos: cliente OAuth de tipo *aplicación web* con el origen autorizado, Google Health API habilitada y los scopes `googlehealth.{activity_and_fitness,health_metrics_and_measurements,sleep,location,profile}.readonly`. Al ser una app sin verificar, Google mostrará el aviso de «Google no ha verificado esta aplicación».

## Documentación

- [Decisiones y arquitectura](docs/decisiones.md)

## Licencia

Este proyecto se distribuye bajo **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). Consulta [LICENSE](LICENSE).

### Licencia comercial

Si quieres usar misdatossalud en un producto o servicio propietario sin las obligaciones de la AGPL, hay una licencia comercial disponible. Consulta [COMMERCIAL.md](COMMERCIAL.md) o escribe a jblancoantelo@gmail.com.

## Contribuir

Las contribuciones son bienvenidas. Antes de fusionar un pull request hay que firmar el [CLA](CLA.md). El bot de CLA lo pedirá automáticamente. Consulta [CONTRIBUTING.md](CONTRIBUTING.md).

## Aviso

misdatossalud no es un producto sanitario y no sustituye el consejo de un profesional de la salud.
