# Contribuir

Gracias por tu interés. Este proyecto es local-first y trata datos de salud, así que hay dos reglas que no se negocian: nada de datos reales en el repositorio y firma del CLA antes de fusionar.

## CLA

Antes de aceptar tu primera contribución necesitamos que firmes el [CLA](CLA.md). El bot de CLA lo pedirá automáticamente en tu primer pull request.

Para firmar, responde al pull request con exactamente:

> I have read the CLA Document and I hereby sign the CLA

Si ya firmaste en otro pull request, responde `recheck` para que el bot lo compruebe.

El CLA te permite conservar tu copyright y nos concede los derechos necesarios para distribuir el proyecto bajo AGPL-3.0-only y, si hace falta, bajo una licencia comercial.

## Datos de salud

- No incluyas exports reales de Zepp, Health Connect o Google Health.
- No incluyas capturas con datos personales.
- Para tests y ejemplos, usa datos sintéticos o anonimizados.
- Si encuentras un problema de privacidad, no abras un issue público; escribe a jblancoantelo@gmail.com.

## Desarrollo

El scaffold de la aplicación se añadirá en la siguiente fase. Cuando exista, aquí irán los comandos de instalación, desarrollo, test y build.

## Estilo

- TypeScript estricto.
- Componentes pequeños y con nombres claros.
- Comentarios en español.
- Commits en imperativo y con alcance: `feat: ...`, `fix: ...`, `docs: ...`.
- No mezcles refactors grandes con cambios funcionales.

## Pull requests

- Un cambio por pull request.
- Añade o actualiza tests cuando toque.
- Actualiza la documentación si cambias el comportamiento.
- Asegúrate de que el check del CLA está en verde.
