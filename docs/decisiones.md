# Decisiones y hallazgos — misdatossalud

> Documento vivo. Fecha: 2026-10-30. Estado: **implementado en local; importación Zepp, cifrado y dashboard funcionando. Google Health implementado como sonda, pendiente de ejecutar con un Client ID real**.
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
| Ubicación del export | `export/` en local; **no subir al repo**; añadir a `.gitignore` |
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

**Consecuencia:** la vía `Zepp → Health Connect → app Google Health → Google Health API → PWA` es viable y **no requiere Drive**. Está pendiente de validar en la práctica qué métricas de Zepp llegan a Health Connect y de ahí a Google Health.

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

## 3. Arquitectura

```
Zepp CSV (ZIP) ───────┐
Google Health API ────┼─► importadores en el navegador ─► normalización ─► SQLite WASM (OPFS) ─► dashboard
                      ┘                                      (origen, device, zona horaria)
```

- **Sin servidor**: todo el parseo y las consultas ocurren en el navegador.
- **Origen por registro**: cada tabla lleva una columna `source` (`zepp`, `google_health`). Hoy solo escribe `zepp` el importador; `google_health` queda preparado para el importador definitivo.
- **Deduplicación**: regla fija **prioridad Zepp**; Google Health solo rellena huecos (`INSERT OR IGNORE`). La UI muestra la cobertura por tabla para que la diferencia sea visible.
- **Backup**: copia cifrada de la base local; no es una exportación CSV/PDF para el usuario.

### 3.1 Estado de implementación

| Paso | Estado |
|---|---|
| 1. Spike de validación de Google Health | **Parcial**: código de la sonda escrito (OAuth GIS + 4 llamadas); falta ejecutarlo con un Client ID |
| 2. Repo y scaffold Vite + React + TS + PWA | Hecho |
| 3. Capa de datos: SQLite WASM + snapshot cifrado | Hecho |
| 4. Importador Zepp CSV | Hecho (11 carpetas, transacción única, `INSERT OR REPLACE`) |
| 5. Importador Google Health API | **No**: solo sonda de viabilidad |
| 6. Dashboard | Hecho: 7 vistas, filtros de periodo, cobertura por tabla |
| 7. Resumen semanal | Hecho, con comparación frente a la semana anterior |
| 8. Backup local cifrado y recuperación | Hecho (descarga y restauración `.mdsalud`) |
| 9. Deploy en GitHub Pages | Pendiente |

### 3.2 Arquitectura implementada

```
src/
  db/
    schema.ts     10 tablas de datos + meta + profile, todas con columna source
    store.ts      HealthStore: inserción por lotes, consultas, resumen semanal, cobertura
    crypto.ts     AES-GCM-256 + PBKDF2-SHA256 (310.000 iteraciones), cabecera como AAD
    storage.ts    OPFS con reserva a IndexedDB
    session.ts    crear, abrir, guardar y nombrar el snapshot
    sqlLoader.ts  carga única de sql.js con el wasm servido desde el bundle
  import/zepp.ts  ZIP + CSV, mapeo por carpeta, timestamps UTC y locales
  sync/googleHealth.ts  sonda OAuth + identidad, dispositivos, pasos, sueño
  state/useSession.ts   crear/desbloquear/bloquear/restaurar/descargar/autoguardado
  ui/             LockScreen, Chart (ECharts) y vistas Resumen/Actividad/Sueño/Corazón/Deporte/Cuerpo/Ajustes
```

Detalles que difieren del diseño inicial:

- **No se usa SQLite WASM con VFS sobre OPFS.** La base vive en memoria (`sql.js`) y lo que se persiste en OPFS es el snapshot cifrado que devuelve `db.export()`. Es más simple, evita el VFS cifrado por bloques y mantiene el disco siempre cifrado. El coste es que abrir la app descifra y carga ~50 MB en memoria; medido en unos segundos.
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
| SpO2 / HRV / respiración | La API los soporta; depende de HC → Google Health | Verificar en el spike |
| GPS / rutas | `SPORT` no trae GPS; la API puede dar TCX | Intentar; condicionado al spike |

### 5.5 Pendientes técnicos

Resueltos durante la implementación:

- ~~Rendimiento de ~930k filas~~: la importación completa tarda 3-4 s y el snapshot cifrado ocupa ~50 MB. Verificado en Chrome de escritorio; falta medir en Android.
- ~~Zona horaria~~: `ACTIVITY_MINUTE`/`HEARTRATE_AUTO` se interpretan en hora local del dispositivo; `SLEEP`/`SPORT`/`BODY` traen offset y se convierten a epoch. Las horas `>24` de algunos exports se normalizan con `Date`.
- ~~Excluir `USER` del importador~~: se importa solo a la tabla `profile`, nunca como fila de datos.
- ~~`base` de Vite y scope del service worker~~: configurados en `/misdatossalud/`.
- ~~Aceptar ZIP con rutas `\` o `/`~~: `Compress-Archive` de Windows genera barras invertidas y el importador lo soporta; si no reconoce ninguna tabla, aborta con un error claro.

Siguen abiertos:

- Verificar CORS real de `health.googleapis.com` desde el navegador (la sonda está escrita, sin ejecutar).
- Renovación silenciosa de GIS y comportamiento si falla.
- Tipos sin `list` (solo `rollUp`/`dailyRollUp`) y paginación de 25 en sueño/ejercicio.
- Escribir el importador definitivo de Google Health con prioridad Zepp (`INSERT OR IGNORE`).
- Verificar si las sesiones de Zepp en Health Connect incluyen GPS y si `exportExerciseTcx` devuelve ruta.
- Crear el cliente OAuth web en Google Cloud (orígenes `http://localhost:5173`, `http://localhost:4173` y `https://jblancoantelo.github.io`), habilitar la Google Health API y configurar la pantalla de consentimiento.
- Medir memoria y tiempo de desbloqueo en Android con el histórico completo.
- Configurar el despliegue en GitHub Pages y probar la instalación de la PWA.

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
- **Tests**: 28 pasando (`parse`, `zepp`, `crypto`, `store`, `real-export`). El test real importa 933.735 filas en ~3,6 s y se salta si falta `export_full/`.
- **E2E manual** con Chrome headless y CDP: crear base, importar el ZIP completo, recorrer las 7 pestañas sin excepciones y descargar la copia cifrada (53,2 MB).
- `.gitignore` incluye `export/`, `export_full/`, `data/`, `*.zip`, `node_modules/`, `dist/`, `.env`, logs y artefactos de test.
- **Ningún dato de salud se ha subido**: el repo contiene código, documentación y configuración; no hay CSV/ZIP de datos.
- Este documento vive en `docs/decisiones.md`.
- Regla: ningún dato de salud real se commitea; solo fixtures sintéticos si hacen falta para tests.

## 8. Licencia y contribuciones

- **Licencia:** AGPL-3.0-only (`LICENSE`).
- **CLA:** licencia amplia con relicencia; el contribuyente conserva su copyright (`CLA.md`, bilingüe ES/EN, ley española).
- **Firma:** workflow `contributor-assistant/github-action@v2.6.1` en `.github/workflows/cla.yml`; firmas en la rama `cla-signatures`.
- **Modelo comercial:** AGPL para la comunidad + licencia comercial (`COMMERCIAL.md`).
- **Marca:** `TRADEMARK.md`.
- **Pendiente:** confirmar titular legal y email comercial; revisión por un abogado; GitHub mostrará AGPL-3.0 cuando `poc` se fusione en `main`.
