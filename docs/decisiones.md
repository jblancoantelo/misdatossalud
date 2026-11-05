# Decisiones y hallazgos — misdatossalud

> Documento vivo. Fecha: 2026-11-01. Estado: **publicado en GitHub Pages; importación Zepp, cifrado, dashboard con filtro global de fechas y Google Health validado de extremo a extremo (pasos vía Health Connect). El sueño no llega a Google Health: la cuenta no tiene sesiones, no es un problema de filtro**.
> App: https://jblancoantelo.github.io/misdatossalud/
> Repo: https://github.com/jblancoantelo/misdatossalud (rama `poc` creada y publicada).

## 1. Decisiones confirmadas por el usuario

| Tema | Decisión |
|---|---|
| Tipo de producto | PWA instalable con almacenamiento local, **sin backend propio** |
| APIs externas | **Permitidas** (no exige aislamiento total de terceros) |
| Dispositivos de uso | **PC Windows + Android** |
| Multi-dispositivo | **Bases independientes** por dispositivo; no se comparte base entre PC y Android |
| Dispositivo | **Amazfit Balance** (solo Amazfit; sin Fitbit/Pixel) |
| Fuente Zepp | **Importar el ZIP de exportación de Zepp** (confirmado) |
| Ubicación del export | `export/` en local |
| Fuente Health Connect | **Sí, se quiere sincronizar**; vía elegida: HC → app Google Health → Google Health API |
| Google Health | **App instalada y vinculada a Health Connect** |
| Android | **Android 14** (backup nativo disponible, aunque no se usará) |
| Histórico | **Todo desde el principio**; se solicitará un export de Zepp completo |
| Aviso "app no verificada" | **Aceptado** (uso personal, menos de 100 usuarios) |
| OAuth | **Implícito con Google Identity Services** (token de 1 h, renovación silenciosa) |
| Backup de Health Connect | **No se importará**; basta con Google Health API + Zepp |
| Métricas | Todas las que tengan fuente: pasos/actividad, sueño, FC/HRV, SpO2/respiración, entrenamientos/GPS, peso/composición, nutrición si existe. Sin fuente: estrés, PAI y ciclo menstrual |
| Perfiles | **Un solo usuario** |
| Publicación | **GitHub Pages** |
| Nombre / licencia | **misdatossalud**, AGPL-3.0-only + CLA con relicencia |
| APK propia | **Solo si no hay otra alternativa** |
| Google Cloud / OAuth | Sí, dispuesto; **no hace falta Drive** para la vía Google Health API |
| Stack frontend | **React + TypeScript** |
| Cifrado local | **Sí, con contraseña** al abrir la PWA |
| Conflictos de origen | **Prioridad Zepp**; Google Health solo rellena huecos |
| Exportación | **No** hace falta CSV/PDF |
| Offline | **Offline total** tras la primera carga |
| Idioma / tema | **Español**, tema claro/oscuro según el sistema |
| Resumen | **Resumen semanal** dentro de la app, sin notificaciones push |
| Sincronización | **Al abrir + botón manual**; sin background |
| Backup | **Snapshot cifrado descargable** para recuperación |
| GPS | **Intentar TCX** vía API si el spike confirma GPS en Health Connect |
| Documentación | **README completo + `docs/`**; LICENSE AGPL-3.0 y CLA |

## 2. Hallazgos técnicos (verificados)

### 2.1 Health Connect no tiene API web

- Health Connect es un almacén **on-device** de Android. Solo se accede con el **SDK nativo** (Kotlin/Java) y permisos runtime por tipo de dato.
- No existe REST ni JavaScript SDK. Una PWA pura no puede leerlo directamente.
- Límite por defecto: las apps leen **30 días** hacia atrás desde el primer permiso; el histórico completo requiere `PERMISSION_READ_HEALTH_DATA_HISTORY` (restringido por Google Play).
- El backup nativo (Android 14+) genera `Health Connect.zip` con un **SQLite sin cifrar**. Solo se puede programar a un proveedor de nube (Drive, OneDrive, etc.); **no hay export local** desde Ajustes.
- Fuentes: https://developer.android.com/health-and-fitness/health-connect/read-data · https://support.google.com/android/answer/15323271 · https://www.androidauthority.com/health-connect-data-backup-3498985

### 2.2 Google Health API ≠ Health Connect

- `developers.google.com/health` es la **sucesora de la Fitbit Web API**, no la API de Health Connect.
- Agrega datos de **Fitbit, Pixel Watch y apps conectadas**, en la nube, vía OAuth 2.0.
- **Sí puede incluir datos de Health Connect**: la app Google Health permite "Manage Health Connect" y la documentación dice que los datos sincronizados desde Health Connect "inherit updates from the originating source" y se propagan.
  - https://developers.google.com/health/data-management
  - https://support.google.com/googlehealth/answer/14236613
- Todavía **no hay paridad completa** con Health Connect: Google prevé añadir más tipos en Q4 2026 / Q1 2027.
- Scopes: **todos restringidos**. Con menos de 100 usuarios se puede operar sin verificación, pero aparece la pantalla de "app no verificada". En modo Testing, los refresh tokens caducan a los 7 días.
  - https://developers.google.com/health/app-verification
  - https://developers.google.com/health/setup
- Las APIs de Google **soportan CORS**; se pueden llamar desde el navegador con `fetch` y Bearer token. El token se obtiene con Google Identity Services (modelo implícito, renovación silenciosa) o con Authorization Code + PKCE.
  - https://developers.google.com/identity/oauth2/web/guides/use-token-model
- La API impone límites de rango: 14 días para FC/calorías/minutos activos y 90 días para el resto en rollups; paginación de 25 para sueño/ejercicio. Obliga a sincronización por fases.
  - https://developers.google.com/health/data-types

**Consecuencia:** la vía `Zepp → Health Connect → app Google Health → Google Health API → PWA` es viable y **no requiere Drive**. Está validada con datos reales de pasos. El sueño **no llega** (ver 2.2.1) y queda por confirmar FC y entrenamientos.

#### 2.2.1 Resultado del spike (2026-10-31)

Ejecutado contra `health.googleapis.com` desde la PWA real, con Client ID de tipo aplicación web y sesión de Google en el navegador.

| Comprobación | Resultado |
|---|---|
| OAuth con GIS (flujo implícito) | **OK**: token obtenido con los 6 scopes, sin Client Secret |
| CORS desde el navegador | **OK**: las cuatro llamadas llegan y devuelven JSON; no hay bloqueo de origen |
| Endpoints y cuerpos | **OK**: `/users/me/identity`, `pairedDevices`, `dataPoints:dailyRollUp` y `dataPoints:reconcile` existen y validan la petición |
| Scopes | **Corregido**: `ListPairedDevices` exige `googlehealth.settings.readonly`; sin él devolvía `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT` |
| Cuenta | **OK** tras vincular Google Health: la identidad devuelve un `legacyUserId` y un `healthUserId` válidos |
| Datos reales | **OK**: 1 dispositivo `MobileTrack` y recuento de pasos de un día real |

**Vía validada:** `Zepp → Health Connect → app Google Health → Google Health API → PWA`. El dispositivo que reporta la API es `MobileTrack` (el propio móvil), no un Fitbit: confirma que los datos llegan por Health Connect.

**Sueño (2026-11-01):** la sonda completa en producción devuelve **5 checks OK** y el nuevo `Sueño (sin filtro)` también responde `{}`. Es decir, **no es un problema de filtro: la cuenta no tiene ninguna sesión de sueño** en Google Health. Además `pairedDevices` solo anuncia `DISTANCE`, `CALORIES` y `STEPS`, sin `SLEEP`. Conclusión: Health Connect reenvía actividad, pero **no el sueño**; hay que revisar los permisos de sueño en Health Connect (Zepp → Health Connect) y que la app Google Health sincronice ese tipo. La PWA ya maneja el caso vacío sin errores.

**Riesgo asumido:** dependencia de una app de Google y de que acepte los datos de un dispositivo no-Fitbit vía Health Connect. Si esa cadena se rompe, la vía cloud deja de aportar datos. Por eso el importador de Zepp sigue siendo la fuente principal y Google Health solo rellena huecos.

#### 2.2.2 Sincronización implementada (2026-11-02)

`src/sync/googleHealthSync.ts` descarga y escribe en la base con estas reglas:

| Aspecto | Decisión |
|---|---|
| Tipos soportados | 13 categorías: pasos, distancia, calorías activas, minutos activos, peso, altura, grasa corporal, frecuencia cardiaca, sueño, entrenamientos, pisos, oxígeno en sangre y VO2 máximo |
| Prioridad | `INSERT OR IGNORE` sobre `daily_activity`, `sleep_session`, `heart_rate` y `sport`: si Zepp ya tiene ese día o esa muestra, no se toca |
| Relleno de columnas | `fillGoogleDailyActivity` completa `distance_m`/`calories` con `COALESCE`, y **solo** en filas con `source = 'google'` (nunca en las de Zepp) |
| Métricas sin columna propia | Tabla `daily_metric` (`date`, `metric`, `value`, `source`): pisos, minutos activos por nivel, oxígeno y VO2 máximo |
| Tramos de pasos y rollups | Peticiones de 30 días (la API limita los rollups a 90) |
| Paginación de puntos | 25 por página (máximo de la API), hasta 200 páginas |
| Fecha de la noche | La del **despertar** (`civilEndTime`), igual que el CSV de Zepp; si falta, se usa la hora física convertida |
| Varias sesiones de sueño el mismo día | Se queda la más larga (sueño principal) |
| Fases del sueño | `stagesSummary`; si falta, se calculan desde los tramos; si tampoco, `minutesAsleep` va a sueño ligero |
| Filtros de la API | En crudo dentro de `URLSearchParams` (sin doble codificación); filtros físicos con margen de un día y civiles con `>= desde AND < hasta+1` |
| Unidades | Distancia mm → m, energía kcal, peso g → kg, altura mm → cm, oxígeno media diaria, VO2 último valor del día |
| Entrenamientos | `sport` con PK `(start_ts, type)`; los tipos comunes se mapean a códigos Zepp y el nombre real se guarda en `sport.label` |
| Escritura | Red primero y después una única transacción: si falla una llamada no se escribe nada |
| Resultado | La UI muestra cuántas categorías trajeron datos y, por categoría, cuántos registros nuevos de cuántos recibidos |
| UI | Ajustes → Google Health: atajos de 7/30/90 días y 1 año, campo libre de 1 a 3.650 días, y botón «Sincronizar ahora» |

**Verificado de extremo a extremo** con la cuenta de datos:

- Primera sincronización de 730 días: **7 de 13 categorías con datos nuevos** (pasos, distancia, calorías activas, peso, altura, frecuencia cardiaca y minutos activos). Sin datos en grasa corporal, sueño, entrenamientos, pisos, oxígeno ni VO2 máximo.
- Segunda sincronización de 30 días: **0 de 13 categorías con datos nuevos** (idempotente), con el aviso «No había huecos que rellenar: los datos de Zepp tienen prioridad.»

**Limitación conocida:** el sueño, los entrenamientos, los pisos, el oxígeno y el VO2 máximo no llegan a Google Health desde esta cuenta (ver 2.2.1). El código queda preparado y probado con datos sintéticos, pero no hay datos reales que validar. El importador de Zepp sigue siendo la fuente principal de sueño, frecuencia cardiaca, entrenamientos y cuerpo.

### 2.3 El ZIP de Zepp

- El export oficial de Zepp genera un ZIP enviado por email (Ajustes → Seguridad y privacidad → Exportar datos), con rango de fechas y tipos de dato.
- Según proyectos que lo parsean, el export masivo entrega **CSV** (no JSON) y los entrenamientos se exportan aparte.
- No hay API pública oficial de datos de usuario de Zepp. Existen vías no oficiales (`apptoken`) y proyectos que las encapsulan.

**Estructura real del export disponible en `export/` (Amazfit Balance, 2026-10-01 a 2026-10-29):**

| Carpeta | Columnas | Filas | Notas |
|---|---|---|---|
| `ACTIVITY` | `date, steps, distance, runDistance, calories` | 29 | Resumen diario |
| `ACTIVITY_MINUTE` | `date, time, steps` | 7.335 | Pasos por minuto |
| `ACTIVITY_STAGE` | `date, start, stop, distance, calories, steps` | 487 | Tramos de actividad |
| `BODY` | `time, weight, height, bmi, fatRate, bodyWaterRate, boneMass, metabolism, muscleRate, visceralFat` | 0 | Sin datos |
| `HEALTH_DATA` | `date, time, arm, calf, chest, hip, thigh, waist` | 0 | Sin datos |
| `HEARTRATE` | `time, heartRate` | 3 | Mediciones manuales |
| `HEARTRATE_AUTO` | `date, time, heartRate` | 22.793 | FC automática por minuto |
| `SLEEP` | `date, deepSleepTime, shallowSleepTime, wakeTime, start, stop, REMTime, naps` | 29 | Resumen diario |
| `SLEEP_MINUTE` | `date, time, stage, hr, respiratory_rate` | 13.196 | Fases + FC + respiración |
| `SPORT` | `type, startTime, sportTime(s), maxPace, minPace, distance(m), avgPace, calories(kcal)` | 15 | Entrenamientos |
| `USER` | `userId, gender, height, weight, nickName, avatar, birthday` | 1 | Perfil (no importar al repo) |

**Estructura del export completo disponible en `export_full/` (2020-2026):**

| Carpeta | Filas | Rango | Notas |
|---|---:|---|---|
| `ACTIVITY` | 2.404 | 2020-01-01 → 2026-10-29 | Resumen diario |
| `ACTIVITY_MINUTE` | 159.816 | 2025-01-09 → 2026-10-29 | Solo ~1,8 años de detalle |
| `ACTIVITY_STAGE` | 10.709 | 2025-01-09 → 2026-10-29 | Tramos |
| `BODY` | 10 | 2020-07-08 → 2026-07-19 | Peso/composición |
| `HEALTH_DATA` | 0 | — | Sin medidas corporales |
| `HEARTRATE` | 255 | 2020-01-06 → 2026-10-28 | Manuales |
| `HEARTRATE_AUTO` | 469.915 | 2025-01-09 → 2026-10-29 | FC por minuto |
| `SLEEP` | 2.404 | 2020-01-01 → 2026-10-29 | Resumen diario |
| `SLEEP_MINUTE` | 287.239 | 2025-01-10 → 2026-10-30 | Fases + FC + respiración |
| `SPORT` | 983 | 2020-01-02 → 2026-10-29 | Sin GPS ni series |
| `USER` | 1 | — | Perfil; excluir del importador |

**Volumen total:** ~930.000 filas. Es manejable, pero hay que medir el rendimiento de SQLite WASM en memoria + snapshot cifrado en Android.

**Limitaciones detectadas:**
- El export cubre **solo 29 días**; para "todo desde el principio" hay que solicitar un rango mayor o usar ZeppBridge/backfill.
- No aparecen SpO2, estrés, PAI, temperatura de piel, nutrición ni ciclo menstrual. Hay que comprobar si el export permite seleccionar esos tipos.
- `SPORT` no incluye GPS ni series; para eso haría falta el detalle por actividad o FIT/TCX.
- Los timestamps de sueño y sport llevan offset `+0000`; hay que normalizar a zona local.


### 2.4 Proyectos y apps relevantes encontrados

| Proyecto | Qué aporta | Licencia / coste | Encaje |
|---|---|---|---|
| **ZeppBridge** | App de escritorio local-first; sync oficial de Zepp, export JSON/CSV/GPX/FIT, CLI, API REST local y MCP | MIT | Muy alto: fuente Zepp automatizable sin depender del ZIP manual |
| **Gadgetbridge** | Alternativa open source a Zepp; sincroniza el reloj por Bluetooth y exporta a Health Connect, DB y auto-export | GPL | Alto si se quiere independencia de la nube de Zepp |
| **Health.md** | Exporta Health Connect a CSV/JSON/Markdown en carpeta local, programable, sin cuenta | Gratis en F-Droid; pago en Play | Alto: puente HC → fichero local |
| **Health Sync** | Exporta Health Connect a Google Drive en CSV/FIT/TCX/GPX de forma automática | Pago | Alto: puente HC → Drive |
| **Health Data Export** | Exporta HC/Google Fit a CSV/JSON | Freemium | Medio |
| **Health Connect Toolbox** | Lectura/escritura manual de HC para depurar | Gratis | Solo pruebas |
| **Open Wearables** | Plataforma self-hosted (MIT) que normaliza wearables; SDK Android para HC | MIT | Referencia de esquema; requiere backend |
| **Terra / Vital / Spike / Sahha / Rook** | Agregadores cloud con integración Zepp y HC | Pago | Descartable para uso personal |
| **Google Health API** | Nube de Google Health (Fitbit/Pixel + HC) | Gratis con OAuth | Alto si HC sincroniza a Google Health |

Fuentes:
- https://github.com/lingcang728/ZeppBridge
- https://gadgetbridge.org/basics/integrations/health-connect
- https://healthmd.app/health-connect-export
- https://healthsync.app/about
- https://github.com/the-momentum/open-wearables
- https://developers.google.com/health

### 2.5 Almacenamiento local en la PWA

- **OPFS** (Origin Private File System) funciona en Chrome Android y escritorio. Es la base para SQLite WASM o DuckDB WASM.
- **File System Access API** (leer carpetas reales del disco) **solo en escritorio Chromium**; Chrome Android no expone los selectores.
- **SQLite WASM + OPFS**: maduro, ligero, transaccional; ideal para datos personales y consultas SQL.
- **DuckDB WASM + OPFS**: analítica columnar, Parquet, muy potente; más pesado (~decenas de MB) y con soporte OPFS más reciente.
- Para importar ficheros en Android: `<input type="file">` y **Web Share Target** (compartir el CSV/ZIP desde el gestor de archivos a la PWA instalada).
- OPFS no es una copia de seguridad garantizada: el navegador puede desalojarla. Hay que ofrecer export/backup periódico.

### 2.6 Versión y actualizaciones (2026-11-03)

Se replica el flujo de `localizatugasolinera` adaptado a Vite + `vite-plugin-pwa`:

| Aspecto | Decisión |
|---|---|
| Versión | `package.json` (`version`), inyectada en el bundle con `define` como `__APP_VERSION__` |
| Fecha de compilación | `__BUILD_TIME__` con formato `YYYYMMDD-HHMMSS`, generada en cada build |
| Publicación | El build emite `version.json` (`{ version, buildTime }`), fuera del precache |
| Service worker | `registerType: 'prompt'`: la versión nueva queda en `waiting` hasta que el usuario la acepta |
| Registro | `src/pwa/update.ts` con `registerSW({ immediate: true })`; `injectRegister: null` |
| Buscar actualizaciones | Ajustes → Versión y actualizaciones: `registration.update()` + comparación de `version.json` |
| Descargar | Botón «Descargar la nueva versión»: `applyUpdate(true)` (SKIP_WAITING + recarga) |
| Aviso | Banner global cuando hay una versión esperando, con el mismo botón |
| Subir versión | `npm run bump [patch\|minor\|major]` actualiza `package.json` y `package-lock.json` |

**Verificado de extremo a extremo** en local: «Buscar actualizaciones» responde «Tienes la última versión»; con un `version.json` con otra compilación anuncia la nueva y muestra el botón; con una compilación real nueva el banner aparece, el botón descarga, recarga y el aviso desaparece.

**Por qué no autoUpdate:** actualizar sin avisar puede recargar la app en mitad de una importación o dejar la base en una pestaña antigua. El modo prompt mantiene el control en el usuario, igual que en la app de gasolineras.

### 2.7 Gráficas ampliables (2026-11-04)

Cada gráfica de ECharts se puede abrir en un modal para analizarla con más detalle:

| Aspecto | Decisión |
|---|---|
| Componente | `src/ui/Chart.tsx`: `ChartCanvas` (crear/actualizar/redimensionar) + `Chart` (marco con botón) |
| Apertura | Botón flotante «⤢» sobre la esquina superior derecha de la gráfica (`aria-label="Ampliar: …"`) |
| Modal | `<dialog>` nativo con `showModal()`: foco atrapado, fondo inerte y cierre con Escape gratis |
| Cierre | Escape (evento `close` del diálogo) o botón «Cerrar» |
| Tamaño | `min(1400px, 96vw)` × `min(900px, 92vh)`; el lienzo ocupa todo el cuerpo del diálogo |
| Redimensionado | `ResizeObserver` en cada lienzo: al abrir el modal ECharts recalcula el tamaño real |
| Montaje | El lienzo del modal solo se monta cuando está abierto, para no duplicar instancias de ECharts |

**Verificado de extremo a extremo** en local: en Actividad aparecen dos botones «Ampliar»; al pulsar uno se abre el diálogo con el título correcto y un canvas de 717×369 px, y el botón «Cerrar» lo cierra.

### 2.8 Modo apaisado (2026-11-04)

La PWA nace con `orientation: 'portrait'` en el manifest, así que al instalar la app el móvil no
giraba. Ahora se declara `orientation: 'any'` y el CSS se adapta al horizontal:

| Aspecto | Decisión |
|---|---|
| Manifest | `orientation: 'any'`; el navegador decide si rota según el ajuste del sistema |
| Pantallas anchas | A partir de 900 px de ancho, cabecera, pestañas y contenido pasan a 1400 px máximos |
| Poca altura (≤600 px) | Cabecera y tarjetas compactas, `stat-value` más pequeño y `.two-col` en dos columnas |
| Móvil estrecho girado (≤700 px) | `.two-col` vuelve a una columna para no dejar gráficas minúsculas |
| Modal de gráficas | En horizontal ocupa el 98 % del ancho y el 94 % del alto |
| Pantalla de bloqueo | Menos relleno y tarjeta algo más ancha para que no haya que hacer scroll |
| Gráficas | No requieren cambios: `ResizeObserver` recalcula al girar |

**Verificado de extremo a extremo** con Chrome CDP y `Emulation.setDeviceMetricsOverride`:

| Viewport | Resultado |
|---|---|
| 390×844 (vertical) | `.two-col` a una columna, rejilla de métricas a 2 columnas, sin desbordamiento |
| 844×390 (móvil girado) | `.two-col` a dos columnas, rejilla a 6 columnas, modal 827×367 px (98 % × 94 %) |
| 640×360 (móvil pequeño girado) | `.two-col` vuelve a una columna para no dejar gráficas minúsculas |
| 1280×720 (escritorio) | contenido a 1400 px y `.two-col` a dos columnas |

En los cuatro casos `scrollWidth` coincide con el ancho del cuerpo (cero desbordamiento
horizontal) y las gráficas se redimensionan solas al girar.

## 3. Arquitectura

```
Zepp CSV (ZIP) ───────┐
Google Health API ────┼─► importadores en el navegador ─► normalización ─► SQLite WASM (OPFS) ─► dashboard
                      ┘                                      (origen, device, zona horaria)
```

- **Sin servidor**: todo el parseo y las consultas ocurren en el navegador.
- **Origen por registro**: cada tabla lleva una columna `source` (`zepp`, `google_health`). Hoy escriben ambos importadores; las filas de Google nunca sobrescriben las de Zepp.
- **Deduplicación**: regla fija **prioridad Zepp**; Google Health solo rellena huecos (`INSERT OR IGNORE`). La UI muestra la cobertura por tabla para que la diferencia sea visible.
- **Backup**: copia cifrada de la base local; no es una exportación CSV/PDF para el usuario.

### 3.1 Estado de implementación

| Paso | Estado |
|---|---|
| 1. Spike de validación de Google Health | **Hecho**: OAuth, CORS, endpoints y datos reales (pasos de un día) con la cuenta vinculada a Google Health |
| 2. Repo y scaffold Vite + React + TS + PWA | Hecho |
| 3. Capa de datos: SQLite WASM + snapshot cifrado | Hecho |
| 4. Importador Zepp CSV | Hecho (11 carpetas, transacción única, `INSERT OR REPLACE`) |
| 5. Importador Google Health API | Hecho: 13 categorías con prioridad Zepp, tabla `daily_metric` y resultado por categoría |
| 6. Dashboard | Hecho: 7 vistas, filtro global de fechas (presets + desde/hasta), cobertura por tabla |
| 7. Resumen semanal | Hecho, con comparación frente a la semana anterior |
| 8. Backup local cifrado y recuperación | Hecho (descarga y restauración `.mdsalud`) |
| 9. Deploy en GitHub Pages | Hecho: https://jblancoantelo.github.io/misdatossalud/ |

### 3.2 Arquitectura implementada

```
src/
  db/
    schema.ts     11 tablas de datos + meta + profile, todas con columna source
    store.ts      HealthStore: inserción por lotes, consultas, resumen semanal, cobertura
    crypto.ts     AES-GCM-256 + PBKDF2-SHA256 (310.000 iteraciones), cabecera como AAD
    storage.ts    OPFS con reserva a IndexedDB
    session.ts    crear, abrir, guardar y nombrar el snapshot
    sqlLoader.ts  carga única de sql.js con el wasm servido desde el bundle
  import/zepp.ts  ZIP + CSV, mapeo por carpeta, timestamps UTC y locales
  sync/googleHealth.ts  sonda OAuth + identidad, dispositivos y JSON crudo
  sync/googleHealthSync.ts  sincronización de 13 categorías y mapeos a tablas
  state/useSession.ts   crear/desbloquear/bloquear/restaurar/descargar/autoguardado
  ui/             LockScreen, Chart (ECharts + modal) y vistas Resumen/Actividad/Sueño/Corazón/Deporte/Cuerpo/Ajustes
```

Detalles que difieren del diseño inicial:

- **No se usa SQLite WASM con VFS sobre OPFS.** La base vive en memoria (`sql.js`) y lo que se persiste en OPFS es el snapshot cifrado que devuelve `db.export()`. Es más simple, evita el VFS cifrado por bloques y mantiene el disco siempre cifrado. El coste es que abrir la app descifra y carga ~50 MB en memoria; medido en ~0,3 s en escritorio con 933.198 filas.
- **Autoguardado cada 4 s** si hay cambios pendientes, más en `pagehide` y `visibilitychange`.
- **Formato `.mdsalud`**: cabecera JSON + `\n` + ciphertext. La cabecera (`v`, `alg`, `kdf`, `iter`, `salt`, `iv`) es el AAD, así que alterarla invalida el descifrado.
- **Restaurar sustituye** la base del dispositivo; no hay merge, como estaba decidido.
- **Cifrado de extremo a extremo con la contraseña del usuario**: la clave nunca se guarda; se mantiene en memoria mientras la sesión está desbloqueada.

### 3.3 Orden de implementación (histórico)

1. **Spike de validación** (antes de construir UI): OAuth con GIS + llamada real a Google Health API; comprobar qué métricas de Zepp aparecen vía Health Connect.
2. Repo: `.gitignore` (`export/`, `*.zip`, `data/`), scaffold Vite + React + TS + PWA.
3. Capa de datos: SQLite WASM + OPFS con snapshot cifrado AES-GCM, esquema canónico y migraciones.
4. Importador Zepp CSV (11 carpetas) con deduplicación por `origen + id_externo`.
5. Importador Google Health API (paginación, rollups, reconciliación).
6. Dashboard: filtros por fecha/origen/métrica, KPIs, series temporales, tabla paginada y panel de cobertura por origen.
7. Resumen semanal.
8. Backup local cifrado y recuperación.
9. Deploy en GitHub Pages.

### 3.4 Spike de validación (bloqueante)

Antes de escribir la app hay que confirmar con datos reales:

- Que la app Google Health está subiendo a su nube los datos que Zepp escribe en Health Connect.
- Qué data types devuelve la API para tu cuenta (pasos, sueño, FC, SpO2, entrenamientos...).
- Si el histórico disponible coincide con lo que necesitas.

Si el spike falla, el plan B es el backup de Health Connect + parser del SQLite, y el plan C una APK Capacitor con el SDK de HC.

### 3.5 Cifrado local (decisión: contraseña)

SQLite WASM no trae SQLCipher de serie. La opción más simple y segura:

1. Derivar una clave con **PBKDF2-SHA256** (WebCrypto) a partir de la contraseña + salt aleatorio.
2. Mantener la base SQLite **en memoria** durante la sesión.
3. Persistir en OPFS un **snapshot cifrado con AES-GCM** (y un manifiesto con salt/IV/versión).
4. Al abrir: pedir contraseña, descifrar el snapshot y cargarlo en memoria.
5. Guardar de forma diferida (debounce) y al cerrar; mantener siempre la última copia buena.

Para decenas de MB es viable. Si el rendimiento se resiente, la alternativa es un VFS cifrado por bloques sobre `wa-sqlite`; se decide durante el spike.

Consecuencia: **si se pierde la contraseña, se pierden los datos**. Hay que avisarlo en la UI y ofrecer una copia de recuperación.

## 4. Pros y contras de los tres stacks (decisión: React + TS)

| Criterio | React + TS | Vue + TS | Svelte + TS |
|---|---|---|---|
| Ecosistema y librerías | Muy amplio | Amplio | Menor |
| Curva de aprendizaje | Media | Baja-media | Baja |
| Rendimiento en runtime | Bueno | Bueno | Muy bueno (sin VDOM) |
| PWA / service workers | Maduro | Maduro | Maduro (Vite) |
| Integración ECharts | Directa | Directa | Directa |
| Mantenimiento a largo plazo | Muy alto | Alto | Medio |
| Adecuado para un solo desarrollador | Sí, más código | Sí, equilibrio | Sí, menos código |
| Riesgo | Ninguno relevante | Ninguno relevante | Menos oferta de componentes |

Decisión: **React + TypeScript** por ecosistema, documentación y facilidad para encontrar ejemplos de SQLite WASM/OPFS y ECharts. Vue y Svelte quedan descartados para esta primera versión.

## 5. Diseño

El núcleo está cerrado. Las decisiones de producto se resolvieron en 5.3; queda la **validación técnica** del spike (3.2): confirmar qué datos de Zepp llegan a Google Health y con qué cobertura.

### 5.1 Alcance funcional de la primera versión

- Importar el ZIP de Zepp completo (CSV) con deduplicación.
- Conectar Google Health API con GIS y sincronizar por fases.
- Sincronización **al abrir la app** (si hay red y sesión) y **botón manual** para forzar; sin background.
- Dashboard con filtros por fecha, origen y métrica.
- KPIs, series temporales, tabla paginada y panel de cobertura por origen.
- Prioridad Zepp en duplicados; Google Health solo rellena huecos.
- Rutas TCX para entrenamientos con GPS, si el spike confirma que hay datos.
- Nutrición e hidratación solo si la API las devuelve.
- Resumen semanal dentro de la app.
- Base local cifrada con contraseña y offline total.
- Backup: snapshot cifrado **descargable** para recuperación.
- Sin exportación CSV/PDF y sin notificaciones push.

### 5.2 Fuera de alcance (por ahora)

- APK Capacitor con SDK de Health Connect.
- Backup nativo de Health Connect.
- Multiusuario.
- Verificación OAuth/CASA.
- Agregadores de pago (Terra, Vital, etc.).
- Ciclo menstrual, estrés y PAI (ver 5.4).
- Sincronización automática entre PC y Android: cada base es independiente.

### 5.3 Decisiones de producto resueltas

| Tema | Decisión |
|---|---|
| Multi-dispositivo | **Bases independientes**; el snapshot descargable es para recuperación, no para fusionar |
| Ciclo menstrual | **Omitido en v1** (API solo escritura, export sin datos) |
| Estrés y PAI | **Omitidos** (sin fuente) |
| Nutrición | **Solo si la API la devuelve**; sin registro manual |
| GPS | **Intentar TCX** con `location.readonly` si el spike confirma GPS |
| Sync | **Al abrir + botón**; sin background |
| Backup | **Snapshot cifrado descargable** |
| Documentación | **README completo + `docs/`**; LICENSE AGPL-3.0 y CLA |

Consecuencia de "bases independientes": el PC y el Android pueden mostrar datos distintos según lo que se haya importado en cada uno. No hay merge ni resolución de conflictos entre dispositivos; la prioridad Zepp se aplica dentro de cada base.

### 5.4 Métricas sin fuente en v1

| Métrica | Situación | Decisión |
|---|---|---|
| Ciclo menstrual | Google Health API es write-only; Zepp no lo exporta | Omitir |
| Estrés | No está en la API ni en el export | Omitir |
| PAI | Métrica de Zepp no exportada | Omitir |
| Temperatura de piel | Solo Pixel Watch 4/5 | No aplica |
| Nutrición / hidratación | Solo si se registra en Google Health/Fitbit | Importar si existe |
| SpO2 / HRV / respiración | La API los soporta; en esta cuenta `oxygen-saturation` no devuelve datos | Sincronizar si existen |
| GPS / rutas | `SPORT` no trae GPS; la API puede dar TCX | Intentar; condicionado al spike |

### 5.5 Pendientes técnicos

Resueltos durante la implementación:

- ~~Rendimiento de ~930k filas~~: la importación completa tarda 3-4 s y el snapshot cifrado ocupa ~50 MB. **Medido en Chrome de escritorio (2026-11-02)**: 50,8 MB y 933.198 filas; abrir hasta la pantalla de bloqueo 0,3 s, desbloquear 0,3 s, consultar los 2.494 días del preset «Todo» 0,2 s y ~165 MB de heap JS. Falta medir en Android.
- ~~Zona horaria~~: `ACTIVITY_MINUTE`/`HEARTRATE_AUTO` se interpretan en hora local del dispositivo; `SLEEP`/`SPORT`/`BODY` traen offset y se convierten a epoch. Las horas `>24` de algunos exports se normalizan con `Date`.
- ~~Excluir `USER` del importador~~: se importa solo a la tabla `profile`, nunca como fila de datos.
- ~~`base` de Vite y scope del service worker~~: configurados en `/misdatossalud/`.
- ~~Aceptar ZIP con rutas `\` o `/`~~: `Compress-Archive` de Windows genera barras invertidas y el importador lo soporta; si no reconoce ninguna tabla, aborta con un error claro.

Siguen abiertos:

- ~~Verificar CORS real de `health.googleapis.com`~~: confirmado, las llamadas desde el navegador funcionan.
- ~~Crear el cliente OAuth web en Google Cloud~~: hecho; Client ID propio de tipo *aplicación web*, con `localhost:4173` y `https://jblancoantelo.github.io` autorizados. El ID se configura en Ajustes y no se versiona.
- ~~Vincular la cuenta a Google Health~~: hecho con la cuenta de datos; la API devuelve identidad, dispositivo `MobileTrack` y pasos reales.
- ~~Confirmar cobertura de sueño~~: **resuelto**; la sonda sin filtro también devuelve vacío y el dispositivo no anuncia `SLEEP`, así que Google Health no tiene sueño de esta cuenta. Siguiente paso: revisar los permisos de sueño en Health Connect en el móvil.
- Renovación silenciosa de GIS y comportamiento si falla.
- Tipos sin `list` (solo `rollUp`/`dailyRollUp`) y paginación de 25 en sueño/ejercicio.
- ~~Escribir el importador definitivo de Google Health con prioridad Zepp (`INSERT OR IGNORE`)~~: hecho para **13 categorías** (`src/sync/googleHealthSync.ts`), con tabla `daily_metric` para las métricas sin columna propia y `sport.label` para el nombre del ejercicio.
- Verificar si las sesiones de Zepp en Health Connect incluyen GPS y si `exportExerciseTcx` devuelve ruta.
- Medir memoria y tiempo de desbloqueo en Android con el histórico completo.
- Probar la instalación de la PWA en Android desde la URL publicada.

## 6. Riesgos

- **Cobertura parcial**: Google Health API aún no tiene todos los tipos de Health Connect.
- **Dependencia de la app Google Health**: si no sincroniza HC, la vía cloud no trae los datos de Zepp.
- **Límite de 30 días** si se opta por app Android propia.
- **Datos duplicados** entre Zepp, HC y Google Health.
- **OPFS volátil**: sin backup explícito se puede perder la base.
- **Scopes restringidos**: verificación/CASA si algún día se abre a más usuarios.
- **Formato del ZIP de Zepp** no documentado oficialmente; hay que validarlo con un fichero real.
- **Bases independientes**: PC y Android pueden mostrar datos distintos; no hay merge ni resolución de conflictos entre dispositivos.
- **Sync solo al abrir**: los datos pueden quedar desactualizados hasta que se abra la app o se pulse el botón.
- **GPS incierto**: Zepp puede no escribir rutas en Health Connect, y el TCX puede venir sin puntos.
- **Nutrición vacía**: sin registro en Google Health/Fitbit no habrá datos que importar.
- **Métricas omitidas**: ciclo menstrual, estrés y PAI no se mostrarán en v1.

## 7. Estado del repositorio y privacidad

- Rama `poc` creada y subida a `origin`. Commits iniciales: `c118b38`, `b2213b0`, `6c98915` (licencia/CLA/workflow) y `cb98508` (decisiones en `docs/`).
- Aplicación implementada: scaffold PWA, capa de datos cifrada, importador de Zepp, sonda de Google Health y las 7 vistas.
- **Tests**: 52 pasando y 1 saltado (`parse`, `zepp`, `crypto`, `store`, `sync` y `real-export`). El test real importa 933.735 filas en ~3,6 s y se salta si falta `export_full/`.
- **E2E manual** con Chrome headless y CDP: crear base, importar el ZIP completo, recorrer las 7 pestañas sin excepciones y descargar la copia cifrada (53,2 MB).
- **Publicada** en https://jblancoantelo.github.io/misdatossalud/ con el workflow `.github/workflows/deploy.yml` (tests + build + `deploy-pages`). Pages debe estar en *Source: GitHub Actions*; con el modo antiguo (*Deploy from a branch*) se publicaba el código fuente sin compilar y la app no cargaba.
- Verificado en producción: carga, manifest, service worker con scope `/misdatossalud/`, SQLite WASM (`application/wasm`), creación de la base, snapshot cifrado en OPFS y desbloqueo tras recargar.
- `.gitignore` incluye `data/`, `*.zip`, `node_modules/`, `dist/`, `.env`, logs y artefactos de test.
- Los fixtures de los tests son sintéticos.
- Este documento vive en `docs/decisiones.md`.

## 8. Licencia y contribuciones

- **Licencia:** AGPL-3.0-only (`LICENSE`).
- **CLA:** licencia amplia con relicencia; el contribuyente conserva su copyright (`CLA.md`, bilingüe ES/EN, ley española).
- **Firma:** workflow `contributor-assistant/github-action@v2.6.1` en `.github/workflows/cla.yml`; firmas en la rama `cla-signatures`.
- **Modelo comercial:** AGPL para la comunidad + licencia comercial (`COMMERCIAL.md`).
- **Marca:** `TRADEMARK.md`.
- **Pendiente:** revisión del CLA por un abogado; GitHub mostrará AGPL-3.0 cuando `poc` se fusione en `main`. Titular legal y contacto: ver `NOTICE` y `COMMERCIAL.md`.
