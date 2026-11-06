# Ampliaciones posibles — misdatossalud

> Documento vivo. Fecha: 2026-11-06. Estado: **propuesta; nada de esto está implementado**.
> Complementa `docs/decisiones.md`: allí van las decisiones cerradas, aquí las ideas abiertas y la
> auditoría de cobertura. Si una idea se aprueba, se implementa y se mueve a `decisiones.md`.
> App: https://jblancoantelo.github.io/misdatossalud/ · Repo: https://github.com/jblancoantelo/misdatossalud

---

## 0. Resumen

Auditoría de cobertura (2026-11-05): **Health Connect no se lee en absoluto**. Lo que se lee es
**Google Health API**, que es otra cosa y solo recibe una parte de lo que hay en el móvil.

- Se piden **13 tipos** de unos **40** que declara la API; de esos 13, solo **7 tienen datos** en
  esta cuenta.
- El scope de **ubicación ya está concedido y no se usa**: el GPS está a una llamada
  (`exportExerciseTcx`) si algún día hay entrenamientos en la nube.
- El **sueño** sigue vacío por esta vía; el `Health Connect.zip` sí lo tiene (con fases).
- Google Health **no tiene** tipos para presión arterial, mindfulness ni composición corporal
  ampliada: eso solo sale del export de Health Connect o del CSV de Zepp.

Tres vías de ampliación, por relación valor/coste:

1. **Ampliar Google Health** (barato, sin arquitectura nueva).
2. **Importar `Health Connect.zip`** (lo que de verdad abre el grifo; reabre una decisión cerrada).
3. **Puente local con la API no oficial de Zepp** (experimental: estrés, PAI, Body Battery, readiness).

---

## 1. Auditoría: qué se saca hoy

### 1.1 Lo que pide el código

Scopes solicitados en `src/sync/googleHealth.ts` (`GOOGLE_HEALTH_SCOPES`):

| Scope | ¿Se usa? |
|---|---|
| `activity_and_fitness.readonly` | sí (pasos, distancia, calorías, minutos activos, entrenamientos, pisos) |
| `health_metrics_and_measurements.readonly` | sí (peso, altura, grasa, FC, SpO₂, VO₂) |
| `sleep.readonly` | sí (aunque devuelve vacío en esta cuenta) |
| `location.readonly` | **no** (no hay ninguna llamada a TCX ni a rutas) |
| `profile.readonly` | identidad |
| `settings.readonly` | `ListPairedDevices` |

Categorías en `src/sync/googleHealthSync.ts` y estado real de la cuenta (2026-11-04):

| # | key | dataType | Endpoint | Destino | ¿Datos? |
|---|---|---|---|---|---|
| 1 | steps | `steps` | `dailyRollUp` | `daily_activity.steps` | ✅ |
| 2 | distance | `distance` | `dailyRollUp` | `daily_activity.distance_m` | ✅ |
| 3 | calories | `active-energy-burned` | `dailyRollUp` | `daily_activity.calories` | ✅ |
| 4 | active-minutes | `active-minutes` | `dailyRollUp` | `daily_metric` (3 niveles) | ✅ |
| 5 | weight | `weight` | `list` | `body_measurement` | ✅ |
| 6 | height | `height` | `list` | `body_measurement` | ✅ |
| 7 | heart-rate | `heart-rate` | `list` | `heart_rate_auto` | ✅ |
| 8 | body-fat | `body-fat` | `list` | `body_measurement.fat_rate` | ❌ vacío |
| 9 | sleep | `sleep` | `reconcile` | `sleep_session` | ❌ vacío |
| 10 | exercise | `exercise` | `reconcile` | `sport` | ❌ vacío |
| 11 | floors | `floors` | `reconcile` | `daily_metric.floors` | ❌ vacío |
| 12 | oxygen | `oxygen-saturation` | `list` | `daily_metric.oxygen_saturation` | ❌ vacío |
| 13 | vo2-max | `vo2-max` | `list` | `daily_metric.vo2_max` | ❌ vacío |

### 1.2 Hallazgos concretos

1. **Health Connect directo = 0.** No hay SDK ni parser de su export; por diseño (no tiene API web).
   `decisiones.md` §2.1 lo confirma y §1 decidió "no importar el backup".
2. **13 de ~40 tipos** y **7 con datos**: la cobertura efectiva es del ~17 % de la API y mucho menor
   respecto a lo que hay en el móvil.
3. **`location.readonly` concedido y sin usar.** `exportExerciseTcx` exige justo
   `activity_and_fitness` + `location`, que ya están. La función está a una llamada, pero depende de
   que exista un `exercise` en la nube (hoy vacío).
4. **El agujero es el sueño.** `Zepp → Health Connect` sí escribe sueño con fases; la app Google
   Health no lo propaga a su nube. No es un problema de filtros (sonda sin filtro: vacío).
5. **Se promedian muestras de SpO₂** en vez de usar `daily-oxygen-saturation`, que ya viene agregado
   por día. Con huecos de muestreo, la media propia puede diferir de la oficial.
6. **Revisar `active-minutes`:** la doc limita los rollups de `active-minutes`,
   `heart-rate`, `total-calories` y `calories-in-heart-rate-zone` a **14 días**, y el código usa
   ventanas de 30 (`ROLLUP_WINDOW_DAYS`). Hoy llegan datos, así que el límite no se está aplicando
   como dice la doc; si algún día aparece `INVALID_ARGUMENT`, es esto.
7. **El embudo real:**

```
Health Connect (40+ tipos)
   └─ Zepp escribe ~26
        └─ app Google Health sube un subconjunto
             └─ Google Health API declara ~40 tipos
                  └─ la PWA usa 13
                       └─ con datos: 7
```

---

## 2. Huecos de Google Health: tipos legibles que no se piden

Todos con los scopes ya concedidos salvo donde se indique. Destino natural: `daily_metric`
(PK `date, metric`) o una columna nueva si se consulta mucho.

| dataType | Endpoint | Destino propuesto | Valor | Coste |
|---|---|---|---|---|
| `daily-heart-rate-variability` | `list`/`reconcile` | `daily_metric.hrv_rmssd` | recuperación y tendencia | S |
| `heart-rate-variability` | `list`/`reconcile` | `heart_rate_auto` o tabla propia | HRV intradía | S |
| `daily-resting-heart-rate` | `list`/`reconcile` | `daily_metric.resting_hr` | base para avisos y carga | S |
| `daily-heart-rate-zones` | `list`/`reconcile` | `daily_metric.zone_*` | zonas sin calcularlas | S |
| `time-in-heart-rate-zone` | `list`/`rollup` | `daily_metric` | entrenamiento por zonas | S-M |
| `total-calories` | **solo rollup** | `daily_metric.total_kcal` | gasto total vs activo | S |
| `daily-oxygen-saturation` | `list`/`reconcile` | `daily_metric.oxygen_saturation` | sustituye la media propia | S |
| `daily-respiratory-rate` | `list`/`reconcile` | `daily_metric.respiratory_rate` | salud respiratoria | S |
| `respiratory-rate-sleep-summary` | `list` | `daily_metric` | respiración nocturna | S |
| `daily-sleep-temperature-derivations` | `list` | `daily_metric.skin_temp_delta` | solo si el dispositivo lo da | S |
| `daily-vo2-max` / `run-vo2-max` | `list`/`reconcile` | `daily_metric.vo2_max` | más cobertura que `vo2-max` | S |
| `activity-level` | `list`/`reconcile` | `daily_metric` | sedentarismo vs actividad | S |
| `sedentary-period` | `list`/`rollup` | `daily_metric.sedentary_min` | tiempo sentado | S |
| `active-zone-minutes` | `list`/`rollup` | `daily_metric.azm` | distinto de `active-minutes` | S |
| `altitude` | `list`/`rollup` | `daily_metric.elevation_m` | desnivel diario | S |
| `swim-lengths-data` | `list` | `daily_metric` / `sport` | natación | S |
| `core-body-temperature` | `list` | `daily_metric` | requiere sensor | S |
| `blood-glucose` | `list` | tabla nueva | solo si hay glucómetro | M |
| `nutrition-log` | `list`/`rollup` | tabla `nutrition_day` | **scope nuevo** `nutrition.readonly` | M |
| `hydration-log` | `list`/`rollup` | tabla `nutrition_day` | **scope nuevo** `nutrition.readonly` | S |
| `food` / `food-measurement-unit` | `list` | catálogo interno | detalle de comidas | M |
| `electrocardiogram` | `list` | tabla nueva | **scope** `ecg.readonly`; dispositivo no compatible | L |
| `irregular-rhythm-notification` | `list` | tabla nueva | **scope** `irn.readonly`; dispositivo no compatible | L |

Notas de implementación (seguir `AGENTS.md` §5):

- Los `rollup`-only (`total-calories`, `calories-in-heart-rate-zone`) necesitan un camino de mapeo
  distinto al de `list` y ventanas de **14 días**.
- Añadir scopes obliga a **volver a dar consentimiento** con el Client ID. Conviene un botón
  "Ampliar permisos" en Ajustes y no romper si el usuario deniega uno.
- `time-in-heart-rate-zone` puede sustituir el cálculo propio de zonas desde `heart_rate`, que es
  más caro pero no depende de la API.

---

## 3. Lo que Google Health no cubre (y dónde está)

| Dato | Dónde vive | Por qué no llega | Cómo sacarlo |
|---|---|---|---|
| Sueño con fases | Health Connect | la app Google Health no lo sube (verificado) | export HC |
| Presión arterial | Health Connect | **no existe tipo en Google Health API** | export HC o entrada manual |
| Composición ampliada (músculo, agua, hueso, BMR) | Zepp / báscula → HC | GH solo tiene `weight`, `height`, `body-fat` | CSV de Zepp u export HC |
| Estrés, PAI, Body Battery, readiness | Zepp (propietario) | no están en HC ni en GH | API no oficial de Zepp |
| Rutas GPS | Health Connect / GH (`exportExerciseTcx`) | depende de que exista `exercise` con `hasGps` | TCX desde GH o export HC |
| Mindfulness | Health Connect | GH solo tiene scope de escritura | export HC |
| Ciclo menstrual, síntomas, moods | Health Connect | en GH son **write-only** | export HC |
| Nutrición / hidratación | GH (`nutrition-log`, `hydration-log`) | falta scope | ampliar permisos |
| Histórico > 30 días por SDK | Health Connect | límite de permisos de Android | export HC (sin límite) |

---

## 4. Vías de sincronización comparadas

| Vía | Requisito | Qué aporta | Coste | Veredicto |
|---|---|---|---|---|
| **Google Health API** | ya montado | ~20 tipos más de los usados | S | ✅ ahora |
| **`Health Connect.zip`** (export programado, Android 14+) | Drive/Nextcloud + descarga | sueño con fases, HRV, FC reposo, SpO₂, presión, nutrición, GPS, histórico completo | M | ✅✅ el salto |
| **`health-connect-data-exporter`** | APK open source, sin internet | lo mismo en NDJSON, más fácil de parsear | S-M | plan B |
| **`ghc-db-manager`** | PC + SQLite | inspeccionar/limpiar el export antes de importar | S | apoyo |
| **API no oficial de Zepp** (`apptoken`) | captura HAR o cookie, ~30 días | estrés, PAI, Body Battery, readiness, sueño detallado, GPS/GPX, FC/minuto | M | ⚠️ experimental |
| **Webhooks de Google Health** | HTTPS público + proyecto GCP + IAM | push en vez de polling | L | ❌ rompe "sin backend" |
| **Agregadores** (Terra, Vital, Rook, Open Wearables, FitMesh) | cuenta/backend propio | normalizan todo | L + coste | ❌ no compensa |
| **Gadgetbridge** | dispositivo soportado | escribe a Health Connect | — | ❌ no cubre Zepp OS ni el histórico ya subido |
| **Fitbit Web API** | — | — | — | ❌ apagada el 2026-11-02 |

---

## 5. Ideas de funcionalidad

### 5.1 Análisis con los datos actuales (sin fuentes nuevas)

| Idea | Detalle | Coste |
|---|---|---|
| Zonas de FC calculadas | desde `heart_rate` + minutos por zona/día | S |
| Panel "Recuperación" | HRV + FC reposo + sueño + carga, fórmula explicable | M |
| Deuda de sueño y regularidad | horarios, desfase fin de semana | S |
| Carga de entrenamiento | TRIMP, agudo:crónico, monotonía | M |
| Correlaciones | pasos↔sueño, FC reposo↔peso, con lag 0-3 días | S |
| Diario y etiquetas | viaje, enfermedad, alcohol, estrés | S |
| Objetivos y rachas | metas y cumplimiento | S |
| Avisos suaves | FC reposo +7 lpm sobre basal, SpO₂ baja, 3 noches <6 h | M |
| Informe semanal imprimible | `window.print()` → PDF para el médico | S |
| Timeline de un día | todo junto + búsqueda | M |
| Exportar CSV/JSON | por tabla; GPX/TCX para rutas | S-M |

### 5.2 Datos nuevos (dependen de §2 y §4)

| Idea | Fuente | Coste |
|---|---|---|
| Sueño real con fases y siestas | export HC | M |
| HRV, FC reposo, respiración, temperatura de piel | GH + export HC | S-M |
| Presión arterial con rangos | export HC o manual | M |
| Nutrición e hidratación + balance energético | GH (`nutrition`) + export HC | M |
| Rutas en mapa + splits | GH TCX o export HC | L |
| Estrés / PAI / Body Battery | API Zepp | M |
| Ciclo menstrual y correlaciones | export HC | M |

### 5.3 Producto y confianza

| Idea | Detalle | Coste |
|---|---|---|
| Prioridad de fuentes configurable | Zepp > Health Connect > Google > manual, por métrica | M |
| Detección de conflictos | mismo día con valores distintos según fuente | M |
| Recordatorio de backup | "última copia hace X días" | S |
| Sync al abrir + botón | hoy solo manual | S |
| Modo "resumen médico" | PDF con rango y métricas clave | S |

---

## 6. Roadmap propuesto

### Fase 1 — "más con lo mismo" (2-3 días)

- HRV diaria, FC reposo, respiración, `daily-oxygen-saturation`, `daily-vo2-max`, `total-calories`.
- Zonas de FC calculadas.
- Informe semanal imprimible y export CSV.
- Tests de mapeo por cada tipo nuevo (unidades incluidas).
- **No** requiere migración de esquema: todo cabe en `daily_metric`.

### Fase 2 — "independencia de la nube" (1-2 semanas)

- `src/import/healthConnect.ts`: abre el ZIP (JSZip), extrae `health_connect_export.db` y lo lee con
  `sql.js` (ya es dependencia).
- Prioridad de fuentes configurable y deduplicación por `package_name`.
- Sueño con fases, HRV, FC reposo, SpO₂, presión, nutrición, GPS.
- `meta.hc_last_import` para importación incremental e idempotente.
- **Reabre** la decisión "el backup de Health Connect no se importará" (§9).

### Fase 3 — "lo que solo Zepp sabe" (experimental)

- Script local `npm run puente:zepp` (fuera del bundle) que lee `apptoken` y genera un JSON/ZIP
  normalizado.
- Estrés, PAI, Body Battery, readiness, latencia/eficiencia de sueño, GPS.
- Detrás de un flag en Ajustes, con aviso de API privada y token de ~30 días.

---

## 7. Trampas técnicas del export de Health Connect

Documentadas por terceros que ya lo han implementado:

- El ZIP contiene **`health_connect_export.db`**, SQLite **sin cifrar**.
- Timestamps en **epoch en milisegundos** + columna `*_zone_offset` en **segundos**.
- `local_date` = **días desde epoch** (no una fecha ISO).
- **Peso en gramos** (`weight_record_table.weight`, 73150 → 73,15 kg).
- Fases de sueño codificadas: **1** ligero, **4** profundo, **5** despierto, **6** REM.
- La FC vive en **`heart_rate_record_series_table`**, no en la tabla padre.
- La fuente de cada fila está en `application_info_table.package_name`. **Varias apps escriben lo
  mismo** (Zepp, Google Fit, Samsung): sumar todo duplica pasos, distancia y sesiones. Filtrar por
  app y aplicar prioridad.
- La **primera exportación** puede salir vacía (bug conocido); la segunda ya trae datos.
- No hay export local: siempre pasa por un proveedor de nube.
- El export no está cifrado: borrarlo de la nube después de importarlo.

---

## 8. Riesgos

- **Dependencia de Google**: si la app Google Health deja de reenviar datos de un dispositivo no
  Fitbit, la vía cloud se queda a medias. El CSV de Zepp sigue siendo la fuente principal.
- **Scopes restringidos**: ampliar permisos exige reconsentimiento y, en modo Testing, los refresh
  tokens caducan a los 7 días.
- **API no oficial de Zepp**: endpoints privados, pueden cambiar sin aviso, token de ~30 días y
  condiciones de uso de Zepp. Debe ser opcional y de solo lectura.
- **Duplicados** en cuanto entren dos fuentes nuevas: sin prioridad de fuentes, los totales se
  inflan.
- **Cobertura parcial** de Google Health API: no hay paridad con Health Connect.

---

## 9. Decisiones pendientes (antes de implementar)

1. ¿Se reabre "el backup de Health Connect no se importará"? Es la vía con más valor y la única que
   trae sueño y presión.
2. ¿Se acepta un script local para la API de Zepp, aunque quede fuera de la PWA?
3. ¿Se amplían scopes (`nutrition`, `ecg`, `irn`) o se deja solo lo que ya está concedido?
4. ¿Se reabre "no hace falta exportación CSV/PDF"? El informe médico lo necesita.
5. ¿La prioridad de fuentes queda fija (Zepp > HC > Google) o configurable por métrica?

---

## 10. Fuentes

**Google Health API**

- Tipos de datos: https://developers.google.com/health/data-types
- Scopes: https://developers.google.com/health/scopes
- TCX y rutas: https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/exportExerciseTcx
- Entrenamientos: https://developers.google.com/health/data-types/workouts
- Webhooks: https://developers.google.com/health/webhooks

**Health Connect**

- Tipos de datos: https://developer.android.com/health-and-fitness/health-connect/data-types
- Exportar e importar: https://support.google.com/android/answer/15323271
- Qué trae el export (tablas y unidades): https://docs.healthlog.dev/guides/import-health-connect/
- Exportador alternativo (NDJSON): https://github.com/maksimaitov/health-connect-data-exporter
- Inspector del SQLite: https://github.com/maciej-fafula/ghc-db-manager

**Zepp**

- Zepp escribe 26 tipos en Health Connect: https://gadgetsandwearables.com/2025/01/24/zepp-health-connect/
- API no oficial (CLI): https://github.com/m4ary/zepp-health-cli
- Puente autocontenido: https://github.com/101mlevydev/pulsebridge
- Terra (agregador con Zepp): https://tryterra.co/integrations/zepp
