# misdatossalud

PWA local-first para consultar tus datos de salud de Amazfit/Zepp y Health Connect, sin backend propio.

**App publicada:** https://jblancoantelo.github.io/misdatossalud/

> **Estado:** funcional y desplegada. Importa el export completo de Zepp, cifra la base con contraseña y muestra resumen, actividad, sueño, frecuencia cardiaca, entrenamientos y cuerpo, con filtro global de fechas. La integración con Google Health está **validada de extremo a extremo**: OAuth, CORS y sincronización de 13 categorías. En esta cuenta la API solo devuelve pasos, distancia, calorías activas, minutos activos, peso, altura y frecuencia cardiaca; el sueño, los entrenamientos, los pisos, el oxígeno y el VO2 máximo no llegan desde Health Connect.

## Qué hace

- **Importa el ZIP de exportación de Zepp** (las 11 carpetas de CSV) con una sola transacción e inserción idempotente.
- **Sincroniza con Google Health** (Health Connect) hasta 13 categorías: pasos, distancia, calorías activas, minutos activos, peso, altura, grasa corporal, frecuencia cardiaca, sueño, entrenamientos, pisos, oxígeno en sangre y VO2 máximo. Solo rellena los huecos: los datos de Zepp tienen prioridad y nunca se sobrescriben. Al terminar indica cuántas categorías trajeron datos nuevos y el desglose por categoría.
- **Guarda todo en el navegador** con SQLite WASM en memoria y un snapshot cifrado en OPFS (o IndexedDB como reserva).
- **Cifra con contraseña** usando AES-GCM-256 con clave derivada por PBKDF2-SHA256 (310.000 iteraciones).
- **Funciona offline** tras la primera carga: el service worker precachea app, CSS y el binario de SQLite.
- **Resumen semanal** con comparación frente a la semana anterior.
- **Filtro de fechas global**: presets de hoy, 7/30/90 días, 1 año y todo el histórico, más dos campos *desde/hasta* para elegir un día o un intervalo concreto. Se aplica a todas las vistas y se mantiene al cambiar de pestaña.
- **Vistas**: Resumen, Actividad, Sueño (con hipnograma), Corazón, Deporte, Cuerpo y Ajustes. Las gráficas se pueden ampliar a un modal para analizarlas con más detalle.
- **Copia de seguridad** en un fichero `.mdsalud` cifrado, descargable y restaurable en otro dispositivo.
- **Versión y actualizaciones**: en Ajustes se ve la versión instalada y su fecha de compilación, se puede buscar una versión nueva y descargarla con un botón (también aparece un aviso cuando el service worker tiene una actualización esperando).
- **Tema claro/oscuro** según el sistema, en español.

## Privacidad

- Sin backend propio: los datos no salen del dispositivo salvo las llamadas a las APIs que autorices.
- La base vive en memoria mientras está desbloqueada; en disco solo hay un snapshot cifrado.
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

## Google Health

La vista de Ajustes permite pegar un Client ID OAuth de Google Cloud, probar la conexión y sincronizar el histórico que elijas (de 1 a 3.650 días). La sincronización descarga **13 categorías** y las escribe en una única transacción: si una llamada falla, la base no se modifica.

| Categoría | Origen en la API | Destino |
|---|---|---|
| Pasos | `steps` (`dailyRollUp`) | `daily_activity.steps` |
| Distancia | `distance` (`dailyRollUp`) | `daily_activity.distance_m` |
| Calorías activas | `active-energy-burned` (`dailyRollUp`) | `daily_activity.calories` |
| Minutos activos | `active-minutes` (`dailyRollUp` por nivel) | `daily_metric` |
| Peso | `weight` | `body_measurement.weight_kg` |
| Altura | `height` | `body_measurement.height_cm` |
| Grasa corporal | `body-fat` | `body_measurement.fat_rate` |
| Frecuencia cardiaca | `heart-rate` | `heart_rate` |
| Sueño | `sleep` (`reconcile`) | `sleep_session` |
| Entrenamientos | `exercise` | `sport` (con `label`) |
| Pisos | `floors` | `daily_metric` |
| Oxígeno en sangre | `oxygen-saturation` | `daily_metric` (media diaria) |
| VO2 máximo | `vo2-max` | `daily_metric` |

Reglas de convivencia con Zepp:

- `INSERT OR IGNORE`: un día o una muestra que ya existe desde Zepp no se toca.
- Las columnas que pueden faltar en una fila de Google se completan con `COALESCE`, y solo si esa fila es de origen `google`.
- Las métricas sin columna propia van a `daily_metric` (`date`, `metric`, `value`, `source`).

Requisitos: cliente OAuth de tipo *aplicación web* con el origen autorizado, Google Health API habilitada y los scopes `googlehealth.{activity_and_fitness,health_metrics_and_measurements,sleep,location,profile}.readonly`. Al ser una app sin verificar, Google mostrará el aviso de «Google no ha verificado esta aplicación».

## Documentación

- [Decisiones y arquitectura](docs/decisiones.md)
- [Guía para agentes](AGENTS.md): cómo trabajar, probar de extremo a extremo y desplegar

## Licencia

Este proyecto se distribuye bajo **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). Consulta [LICENSE](LICENSE).

### Licencia comercial

Si quieres usar misdatossalud en un producto o servicio propietario sin las obligaciones de la AGPL, hay una licencia comercial disponible. Consulta [COMMERCIAL.md](COMMERCIAL.md) o escribe a jblancoantelo@gmail.com.

## Contribuir

Las contribuciones son bienvenidas. Antes de fusionar un pull request hay que firmar el [CLA](CLA.md). El bot de CLA lo pedirá automáticamente. Consulta [CONTRIBUTING.md](CONTRIBUTING.md).

## Aviso

misdatossalud no es un producto sanitario y no sustituye el consejo de un profesional de la salud.
