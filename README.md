# misdatossalud

PWA local-first para consultar tus datos de salud de Amazfit/Zepp y Health Connect, sin backend propio.

> **Estado:** en diseño. Todavía no hay código de aplicación; este repositorio contiene la documentación y la base legal del proyecto.

## Qué hará

- Importar el ZIP de exportación de Zepp (CSV).
- Sincronizar datos de Health Connect a través de la app Google Health y la Google Health API.
- Guardar todo en el navegador, cifrado con contraseña.
- Mostrar pasos, sueño, frecuencia cardíaca, HRV, SpO2, respiración, entrenamientos, peso y composición corporal.
- Filtrar por fecha, origen y métrica, y comparar fuentes.
- Funcionar offline tras la primera carga.
- Resumen semanal.

## Privacidad

- Sin backend propio: los datos no salen de tu dispositivo salvo las llamadas a las APIs que tú autorices.
- La base local se cifra con AES-GCM y una clave derivada de tu contraseña.
- No se suben datos de salud al repositorio.

## Stack previsto

React + TypeScript + Vite, ECharts y SQLite WASM sobre OPFS.

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
