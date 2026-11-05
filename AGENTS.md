# Guía para agentes

Documento de trabajo para que cualquier agente (o persona) pueda retomar el proyecto sin dudas.
Explica **cómo está montado**, **cómo se prueba de verdad** y **qué pasos seguir al cambiar algo**.
Si cambias comportamiento, actualiza también este fichero, `README.md` y `docs/decisiones.md`.

> Última revisión: 2026-11-05 · versión 0.4.0 · rama de trabajo `main`.

---

## 1. Qué es

PWA local-first en español para consultar datos de salud de Amazfit/Zepp y Google Health
(Health Connect). Sin backend propio: todo ocurre en el navegador y los datos se guardan cifrados
en el dispositivo.

- App publicada: https://jblancoantelo.github.io/misdatossalud/
- Repo: https://github.com/jblancoantelo/misdatossalud (rama `main`)
- Un solo usuario, PC Windows + Android, tema claro/oscuro según el sistema.
- Licencia AGPL-3.0-only + CLA. No es un producto sanitario.

---

## 2. Comandos

```bash
npm install
npm run dev        # http://localhost:5173/misdatossalud/
npm run build      # tsc --noEmit + vite build → dist/
npm run preview    # http://localhost:4173/misdatossalud/ (necesario para OPFS y service worker)
npm test           # vitest run
npm run bump minor # sube versión en package.json y package-lock.json
```

Notas del entorno Windows de este repo:

- Si `npm` no está en el `PATH`, invócalo con la ruta de tu instalación de Node (en Windows, por
  defecto `C:\Program Files\nodejs`):
  `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build`
- npm escribe un warning en stderr (`Unknown user config "allow-scripts"`). PowerShell lo trata como
  error y devuelve **código de salida 1 aunque el comando haya ido bien**. Fíjate en la salida
  (`✓ built in …`, `Tests 52 passed`), no en el código.
- `vite preview` escucha en `::1`: usa `http://localhost:4173/misdatossalud/`, **no** `127.0.0.1`.
- El proyecto se sirve siempre bajo `/misdatossalud/` (`base` de Vite y scope del service worker).

---

## 3. Flujo obligatorio al cambiar algo

1. **Lee** la parte afectada y respeta estructura, nombres y estilo (ver §4 y §5).
2. **Implementa** el cambio en la capa que corresponda: `db/`, `import/`, `sync/`, `ui/`.
3. **Añade o ajusta tests** en `src/**/*.test.ts` (Vitest, entorno `node`).
4. `npm run build` (typecheck incluido) y `npm test`.
5. **Pruébalo de verdad** en `npm run preview` con Chrome + CDP (§10). No basta con que compile:
   OPFS, cifrado y service worker solo se comportan como en producción en `preview`/Pages.
6. **Actualiza documentación**: `README.md`, `docs/decisiones.md` y este `AGENTS.md`.
7. **Sube versión** con `npm run bump patch|minor|major` si el cambio es visible para el usuario.
8. **Commit y push** a `main`; el workflow `.github/workflows/deploy.yml` despliega a Pages.
9. **Verifica producción**: `gh run watch <id> --exit-status`, luego
   `https://jblancoantelo.github.io/misdatossalud/version.json` debe devolver la versión nueva.

Commits en español, con Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).

---

## 4. Arquitectura

```
Zepp CSV (ZIP) ───────┐
Google Health API ────┼─► importadores/sync en el navegador ─► normalización ─► SQLite WASM (memoria)
                      ┘                                                        └─► snapshot cifrado (OPFS)
                                                                                        └─► IndexedDB (reserva)
```

```
src/
  db/
    schema.ts      DDL de 13 tablas (11 de datos + meta + profile) y DATA_TABLES
    store.ts       HealthStore: insertBatch, consultas, cobertura, migraciones ligeras
    crypto.ts      AES-GCM-256 + PBKDF2-SHA256 (310.000 iteraciones), cabecera como AAD
    storage.ts     OPFS con reserva a IndexedDB
    session.ts     crear, abrir, guardar y nombrar el snapshot
    sqlLoader.ts   carga única de sql.js (wasm servido desde el bundle)
  import/zepp.ts   ZIP + CSV, mapeo por carpeta, timestamps UTC y locales
  sync/googleHealth.ts      sonda OAuth/identidad/dispositivos/JSON crudo
  sync/googleHealthSync.ts  sincronización real de 13 categorías
  state/useSession.ts       crear/desbloquear/bloquear/restaurar/descargar/autoguardado
  pwa/update.ts             registro del SW y comprobación/descarga de versiones
  ui/                       LockScreen, Chart (ECharts + modal) y 7 vistas
  lib/                      fechas, formato y series
docs/decisiones.md          decisiones y hallazgos (documento vivo)
```

Decisiones clave que **no** hay que “mejorar” sin hablarlo:

- **No hay VFS de SQLite sobre OPFS.** La base vive en memoria (`sql.js`) y a disco solo va el
  snapshot cifrado de `db.export()`. Abrir la app descifra ~50 MB en memoria (~0,3 s en escritorio).
- **Autoguardado cada 4 s** si hay cambios pendientes, más en `pagehide` y `visibilitychange`.
- **Formato `.mdsalud`**: cabecera JSON + `\n` + ciphertext. La cabecera (`v`, `alg`, `kdf`, `iter`,
  `salt`, `iv`) es el **AAD**: si se altera, el descifrado falla a propósito.
- **Sin backend y sin telemetría.** Cualquier sincronización la dispara el usuario.

---

## 5. Modelo de datos y prioridad Zepp

Tablas de datos: `daily_activity`, `minute_activity`, `activity_stage`, `body_measurement`,
`body_circumference`, `heart_rate`, `heart_rate_auto`, `sleep_session`, `sleep_minute`, `sport`,
`daily_metric` (además de `meta` y `profile`). Todas llevan columna `source`.

### Reglas de oro

1. **Zepp manda.** Las escrituras de Google usan `INSERT OR IGNORE`; nunca sobrescriben una fila
   existente de Zepp.
2. **`fillGoogleDailyActivity`** rellena con `COALESCE` las columnas vacías de `daily_activity`
   (`steps`, `distance_m`, `calories`) **solo si `source = 'google'`**. Es la única excepción a
   “no tocar lo existente”, y existe porque pasos, distancia y calorías llegan en llamadas
   distintas y la primera inserta la fila con columnas a `NULL`.
3. **`insertBatch(table, columns, rows, mode)`**:
   - `mode = 'replace'` → `INSERT OR REPLACE` (importador de Zepp, reimportable).
   - `mode = 'ignore'` → `INSERT OR IGNORE` (Google).
   - Devuelve **filas realmente insertadas** (`db.getRowsModified()`), que es lo que se muestra en
     el resultado de la sincronización.
   - Trocea para no pasar de ~900 parámetros por sentencia (máx. 200 filas).
4. **Métricas sin columna propia** → tabla `daily_metric(date, metric, value, source)` con PK
   `(date, metric)`. Claves usadas: `floors`, `oxygen_saturation`, `vo2_max`,
   `active_minutes_light|moderate|vigorous`.
5. **Migraciones sin romper bases existentes**: el esquema se crea con `CREATE TABLE IF NOT EXISTS`
   y las columnas nuevas se añaden con `ensureColumn()` (`PRAGMA table_info` + `ALTER TABLE`).
   Ejemplo vivo: `sport.label`. `SCHEMA_VERSION` está en `schema.ts`.
6. **Fechas**: `date` es siempre `YYYY-MM-DD` en hora civil local. El sueño se fecha por el
   **despertar** (`civilEndTime`, con reserva a la hora física convertida), igual que el CSV de Zepp.
   Los timestamps `ts` son epoch en **segundos**.

### Cómo añadir una métrica nueva

1. Decide destino: columna existente o `daily_metric`.
2. `schema.ts`: columna/tabla + `ensureColumn` si es columna nueva.
3. `store.ts`: getter de consulta (y cobertura si aplica).
4. `sync/googleHealthSync.ts`: interfaz del punto, `map…()`, llamada de red, filtro `inRange`,
   escritura en la transacción y entrada en `categories` (clave + etiqueta en español).
5. Test del mapeo en `sync/googleHealthSync.test.ts` (unidades incluidas).
6. Vista que lo muestre (`ActivityView`, `BodyView`, `HeartView`…).
7. `README.md` (tabla de categorías), `docs/decisiones.md` y este fichero.

---

## 6. Sincronización con Google Health

- Base de la API: `https://health.googleapis.com/v4`, OAuth **implícito** con Google Identity
  Services (`src/sync/googleHealth.ts`). No hay Client Secret.
- Endpoints usados:
  - `dataPoints:dailyRollUp` (POST): pasos, distancia, calorías activas, minutos activos.
  - `dataPoints:list` (GET, con `filter`): peso, altura, grasa corporal, FC, oxígeno, VO2.
  - `dataPoints:reconcile` (POST, con `filter`): sueño, entrenamientos, pisos.
- **Ventanas de 30 días** en los rollups (la API limita a 90) y paginación de 25 en
  sueño/ejercicio (máximo de la API) y 1.000 en muestras; tope de 200 páginas.
- **Filtros**: se pasan en crudo dentro de `URLSearchParams` (nunca doble codificación).
  - Físicos: margen de un día → `campo >= "desde-1T00:00:00Z" AND campo < "hasta+2T00:00:00Z"`.
  - Civiles: `campo >= "desde" AND campo < "hasta+1"`.
  - Después se normaliza y se vuelve a filtrar con `inRange()` por fecha civil.
- **Unidades**: distancia mm → m, energía kcal, peso g → kg, altura mm → cm, oxígeno **media
  diaria**, VO2 **último valor del día**, minutos activos separados por nivel.
- **Entrenamientos**: PK `(start_ts, type)`; tipos comunes mapeados a códigos Zepp, desconocidos a
  `999`, y el nombre real en `sport.label` (la UI hace `row.label ?? sportLabel(row.type)`).
- **Una única transacción** al final: si falla cualquier llamada, la base no se modifica.
- **Resultado**: `SyncResult { categories, warnings }`; cada categoría lleva `received` (lo que
  devolvió la API) y `added` (lo que se escribió). La UI muestra “N de 13 categorías con datos
  nuevos” y el desglose. Si `added` total es 0, se añade el aviso
  «No había huecos que rellenar: los datos de Zepp tienen prioridad.»

### Estado real de la cuenta de datos (2026-11-04)

| Con datos | Sin datos |
|---|---|
| pasos, distancia, calorías activas, minutos activos, peso, altura, frecuencia cardiaca | grasa corporal, sueño, entrenamientos, pisos, oxígeno, VO2 máximo |

El código de las categorías vacías está probado con datos sintéticos en los tests, pero **no hay
datos reales para validarlo**. No lo borres: la cuenta puede empezar a recibirlos.

---

## 7. UI

- 7 pestañas en `App.tsx`: Resumen, Actividad, Sueño, Corazón, Deporte, Cuerpo, Ajustes.
- **Filtro de fechas global** en `App.tsx` (presets Hoy/7/30/90 días/1 año/Todo + `desde`/`hasta`).
  Las vistas reciben `range` y recalculan con `useMemo` sobre `[store, version, from, to]`.
- **Gráficas**: siempre a través de `Chart` de `src/ui/Chart.tsx`.
  - `ChartCanvas` crea/destruye ECharts y se redimensiona con `ResizeObserver`.
  - `Chart` añade el botón flotante «⤢» y un `<dialog>` nativo con `showModal()`; se cierra con
    Escape o con «Cerrar». El lienzo del modal solo se monta cuando está abierto.
  - Colores y estilos de ejes/tooltip están exportados (`PALETTE`, `AXIS_LABEL`, `SPLIT_LINE`…).
  - `expandable={false}` para gráficos auxiliares.
- Estilos en un único `src/styles.css` con variables CSS (`--bg`, `--bg-elev`, `--text`,
  `--border`, `--accent`, `--accent-soft`, `--radius`). Respeta el tema claro/oscuro; no metas
  colores fijos que solo funcionen en un tema.
- Componentes compartidos en `src/ui/components.tsx`: `Section`, `Card`, `StatGrid`, `DataTable`,
  `Empty`, `Field`, `Callout`, `DateRangePicker`.
- Todo el texto de interfaz va en **español**, con `aria-label` en botones icónicos.
- **Modo apaisado**: el manifest declara `orientation: 'any'` para poder girar el móvil. En
  `@media (orientation: landscape)` hay dos bloques: uno para pantallas anchas (contenido hasta
  1400 px) y otro para poca altura (≤600 px) con tarjetas compactas, `.two-col` en dos columnas y
  el modal de gráficas al 98 % del viewport. En móviles estrechos (≤700 px) `.two-col` vuelve a una
  columna. Si tocas el layout, comprueba horizontal **y** vertical: las gráficas se redimensionan
  solas por el `ResizeObserver`.

---

## 8. Versión y actualizaciones

- `package.json.version` se inyecta como `__APP_VERSION__`; cada build genera `__BUILD_TIME__`
  (`YYYYMMDD-HHMMSS`).
- El build emite `version.json` (`{ version, buildTime }`) **fuera del precache**: la app lo pide a
  la red con `cache: 'no-store'` para saber si hay algo nuevo.
- Service worker en `registerType: 'prompt'`: la versión nueva queda en `waiting` hasta que el
  usuario pulsa «Descargar la nueva versión» (`downloadUpdate()` → `applyUpdate(true)`).
- `checkForUpdate()` combina `registration.update()` con la comparación de `version.json`.
- `npm run bump` actualiza `package.json` **y** `package-lock.json`; no lo edites a mano.

---

## 9. Pruebas

- `npm test` → Vitest, entorno `node`, patrón `src/**/*.test.ts`.
- Cobertura actual: parseo, importador Zepp, cifrado, store, sincronización (mapeos y unidades) y
  una integración con el export real.
- `src/import/real-export.test.ts` **se salta solo** si no existe la carpeta `export_full/`.
- Los tests de sync comprueban unidades y formas reales de la API; si cambias un mapeo, actualiza su
  test en el mismo commit.

---

## 10. Prueba E2E real (Chrome + CDP)

Es la forma de comprobar OPFS, cifrado, OAuth y service worker como en producción.

### Entorno

| Dato | Valor |
|---|---|
| Chrome | instalación estándar de Chrome en Windows (`chrome.exe`) |
| Perfil CDP | carpeta temporal propia, fuera del repo (por ejemplo `<carpeta-de-pruebas>/chrome-profile`) |
| Puerto CDP | `9226` |
| App local | `http://localhost:4173/misdatossalud/` |
| App producción | `https://jblancoantelo.github.io/misdatossalud/` |
| Base de pruebas | se crea al vuelo con una contraseña local; **no se documenta** |
| OAuth | el Client ID que ya esté guardado en Ajustes o uno propio de Google Cloud |

Arranque:

```powershell
$profile = "<carpeta-de-pruebas>/chrome-profile"
$chrome = "<ruta-de-chrome>/chrome.exe"
Start-Process -FilePath $chrome -ArgumentList "--headless=new","--disable-gpu","--no-first-run","--remote-debugging-port=9226","--user-data-dir=$profile","about:blank" -WindowStyle Hidden
```

```powershell
npm run preview -- --port 4173 --strictPort
```

### Receta

1. Crea una pestaña con `PUT http://127.0.0.1:9226/json/new?about:blank` y conéctate por WebSocket
   al `webSocketDebuggerUrl`.
2. `Network.enable` + `Network.setBypassServiceWorker { bypass: true }` y navega a
   `APP + '?v=' + Date.now()`. **Sin el bypass, el service worker sirve el precache antiguo.**
3. Si aparece «Desbloquear», escribe la contraseña de esa base con el setter nativo de React y
   `form.requestSubmit()`; espera a que aparezca «Bloquear».
4. Navega con `[...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Ajustes').click()`.
5. Para OAuth: pulsa «Sincronizar ahora», espera la ventana emergente de `accounts.google.com`
   (búscala en `/json/list`), pulsa la cuenta de pruebas (`[data-email]`) y, si sale el aviso,
   en este orden: «Configuración avanzada» → «no seguro» → «Continuar» → «Permitir».
6. Espera el texto «categorías con datos nuevos» en el cuerpo de la app.

Scripts de referencia (viven fuera del repo, en la carpeta de pruebas; no se versionan):

| Script | Qué hace |
|---|---|
| `sync-full-e2e.mjs` | sync larga + desglose + vistas + modal |
| `sync-again.mjs` | segunda sync corta para comprobar idempotencia |
| `diag-todo.mjs` | preset «Todo» y vistas Corazón/Actividad |
| `probe-types3.mjs` | sonda de rollups/reconcile de tipos extra |
| `prod-check.mjs` | versión y textos nuevos en producción |
| `diag-views.mjs` | recorrido por todas las pestañas |
| `landscape2.mjs` | modo apaisado con `Emulation.setDeviceMetricsOverride` |

Consejos:

- Usa `Runtime.evaluate` con `returnByValue: true, awaitPromise: true` y `userGesture: true` al
  pulsar botones.
- Para inputs controlados por React, no asignes `.value` directamente: usa el setter del prototipo y
  lanza `new Event('input', { bubbles: true })`.
- Las sync largas (730 días) tardan varios minutos; las cortas (30 días) segundos.
- Cierra las pestañas con `GET /json/close/<id>` y para Chrome/preview al terminar.

---

## 11. Trampas conocidas

- **`vite preview` en `::1`**: `127.0.0.1:4173` no responde; usa `localhost`.
- **Service worker con precache viejo** en E2E: bypass + query string.
- **`INSERT OR IGNORE` no rellena columnas**: por eso existe `fillGoogleDailyActivity`.
- **El sueño se fecha por el despertar**, no por el inicio.
- **`getBodyMeasurements` devuelve filas ascendentes por `ts`**: para “último” usa `reduce` por `ts`
  y ordena una copia para las tablas.
- **La PK de `sport` es `(start_ts, type)`**: dos sesiones del mismo tipo al mismo segundo colisionan.
- **No metas el snapshot ni datos reales en el bundle**: el build solo incluye `src/` y assets.
- **PowerShell + npm**: warning en stderr ⇒ exit code 1 aunque todo vaya bien.
- **`version.json` no debe entrar en el precache** (si entra, nunca se detectan versiones nuevas).
- **Cambiar `SCHEMA_VERSION` sin migración** rompe bases ya creadas: usa `CREATE TABLE IF NOT EXISTS`
  y `ensureColumn`.

---

## 12. Documentación

| Fichero | Contenido |
|---|---|
| `README.md` | qué hace, stack, desarrollo, despliegue y tabla de categorías de Google Health |
| `docs/decisiones.md` | decisiones, hallazgos y verificaciones E2E fechadas |
| `AGENTS.md` | esta guía: cómo trabajar, probar y desplegar |

Al terminar un cambio visible: actualiza los tres y sube versión.
