# Spendly

Aplicación web instalable para registrar gastos personales, definir presupuestos por mes y categoría, revisar comprobantes y seguir cargos recurrentes. Se publica como sitio estático: HTML, CSS y JavaScript, sin servidor de aplicación ni registro de usuario.

## Uso diario

- **Resumen:** gasto del mes, categorías, comparación con el período anterior, proyección de cierre, recurrentes pendientes y disponible diario.
- **Movimientos:** alta, edición, búsqueda, filtros y exportación CSV.
- **Recurrentes:** reglas mensuales y sugerencias basadas en al menos tres meses consecutivos con importes y fechas similares.
- **Ajustes:** presupuesto del mes seleccionado, límites por categoría, moneda del conjunto de datos, respaldos y preparación del lector sin conexión.

El selector superior cambia el mes sobre el que se consulta o configura el presupuesto. Guardar un presupuesto de un mes no cambia los anteriores. Al importar un respaldo antiguo, el presupuesto global existente se conserva en los meses con movimientos y en el mes actual; los meses nuevos se configuran por separado.

Spendly trabaja con **una sola moneda por conjunto de datos**, sin conversión de divisas. La moneda se elige antes de crear movimientos, reglas o presupuestos; después queda fija para evitar que un cambio de etiqueta altere el significado del historial.

## Definiciones de los indicadores

| Indicador | Cálculo |
| --- | --- |
| Gastado del mes | Suma de los movimientos registrados en ese mes, incluidos los que tengan fecha futura. |
| Comparación del mes actual | Gasto registrado hasta hoy frente al gasto hasta el mismo día del mes anterior; si el mes anterior tiene menos días, se usa su último día. Los meses cerrados se comparan completos. |
| Ritmo diario | Gasto registrado hasta hoy dividido por los días transcurridos, incluido hoy. Para meses cerrados se usan todos los días del mes. |
| Proyección de cierre | Ritmo diario del mes actual multiplicado por sus días totales. Es una estimación basada en lo registrado, no una predicción de cargos futuros. |
| Recurrentes pendientes | Reglas del mes que todavía no tienen un cargo registrado o una coincidencia válida. |
| Disponible por día | (Presupuesto mensual − movimientos del mes − recurrentes pendientes) / días restantes, incluido hoy. Puede ser negativo; sin presupuesto o en un mes cerrado no se muestra una cifra. |

Los límites por categoría son independientes del límite total. Los gráficos muestran los datos registrados; un mes sin movimientos no permite saber si no hubo gastos o si faltó registrarlos.

## Comprobantes PDF e imágenes

El lector extrae texto de PDF y utiliza OCR en español para imágenes y páginas escaneadas. Conserva las líneas del PDF y prioriza el total final, evitando usar efectivo entregado, vuelto, impuestos, fechas y números fiscales como importe del gasto.

- Se admiten archivos de hasta **20 MB** y PDF de hasta **10 páginas**.
- Siempre se revisan descripción, fecha, categoría e importe antes de guardar.
- Cuando el importe o la fecha no son fiables, el formulario los deja pendientes e informa el motivo.
- Se advierte si el archivo ya fue registrado o si coincide comercio, fecha e importe con otro comprobante. La persona decide si corresponde añadirlo.
- Se guardan el movimiento y sus identificadores de duplicidad. **El archivo y el texto completo del comprobante no se guardan en el historial ni se envían a un servidor.**

PDF.js y Tesseract se descargan desde CDN mediante conexiones HTTPS con versiones fijadas en el código. Esas descargas son solicitudes a terceros para obtener el programa y el idioma de OCR; los comprobantes se procesan localmente. La precisión depende de la calidad y el formato del documento, por lo que la revisión previa sigue siendo necesaria.

## Funcionamiento sin conexión y actualizaciones

Después de la primera carga correcta, el Service Worker conserva la interfaz y el código de Spendly para utilizarlos sin conexión.

Para leer comprobantes sin red, ir a **Ajustes → Preparar lector sin conexión**, esperar a que termine la descarga de todos sus componentes y comprobar que se indique que está listo. Esta preparación descarga también el idioma español de OCR y puede requerir varios MB. Si falla la red o falta espacio, se puede reintentar; no se informa disponibilidad completa hasta verificar cada componente.

El navegador puede eliminar datos de sitios para liberar espacio. El estado del lector comprueba su caché actual; si falta algún componente, hay que prepararlo nuevamente. La preparación cubre el lector, el OCR y su idioma; no incluye recursos adicionales para todos los formatos de PDF. Documentos con CMaps, fuentes especiales o imágenes no compatibles pueden requerir registrar el gasto manualmente.

Las nuevas versiones se activan al cerrar todas las pestañas y ventanas de Spendly y volver a abrir la app. Esto evita combinar una interfaz anterior con módulos nuevos. La limpieza elimina únicamente cachés propios de Spendly, conservando los de otras aplicaciones del mismo dominio.

## Guardado, conflictos y respaldos

Los datos se guardan en el navegador mediante localStorage. El programa confirma los cambios solo si pudo persistirlos; si ocurre un fallo, muestra el error y conserva el estado anterior. Los datos ya registrados se pueden descargar como respaldo.

En navegadores con **Web Locks**, las escrituras se serializan entre pestañas: la lectura, la integración y el guardado ocurren dentro del mismo bloqueo. Además, se compara el estado guardado para integrar cambios independientes y detectar ediciones incompatibles del mismo dato.

Si Web Locks no está disponible, se conserva la detección de conflictos, pero localStorage no permite garantizar atomicidad ante escrituras exactamente simultáneas en procesos distintos. En ese caso, conviene trabajar en una sola pestaña. Los conflictos detectados se informan en pantalla; evitar editar el mismo movimiento a la vez sigue siendo la opción más sencilla.

En **Ajustes** se puede descargar un respaldo JSON o restaurar uno. Restaurar reemplaza el conjunto de datos y requiere confirmación. Se validan fechas, importes e identificadores al cargar. Los respaldos antiguos se migran al formato actual.

Descargar respaldos permite transferir el historial a otro navegador o dispositivo y recuperarlo si se borran los datos del sitio. La app no sincroniza cuentas o dispositivos. El tema de color se guarda por separado.

## Estructura

- index.html: interfaz y formularios.
- css/styles.css: estilos y diseño adaptable.
- js/state.js: validación, almacenamiento, migraciones, presupuestos y exportación.
- js/recurring.js: reglas mensuales y detección de patrones.
- js/metrics.js: cálculos del resumen y agregaciones.
- js/chart.js: evolución y estadísticas SVG.
- js/scanner.js: extracción de comprobantes y revisión.
- js/app.js: navegación, eventos y renderizado.
- sw.js y manifest.webmanifest: instalación y uso sin conexión.
- tests/: pruebas de regresión ejecutables con Node.js.

## Ejecutar y verificar

Para servir la app localmente:

~~~bash
python -m http.server 8000
~~~

Abrir [http://localhost:8000](http://localhost:8000). El Service Worker requiere HTTPS o localhost. Abrir index.html directamente como archivo no reproduce la instalación ni el uso sin conexión.

Para verificar el código, usar **Node.js 24 o superior**. Las pruebas unitarias no requieren paquetes adicionales a Node.js:

~~~bash
npm run check
npm test
~~~

Las mismas comprobaciones se ejecutan en GitHub Actions para los pushes y pull requests. Incluyen persistencia y conflictos, presupuestos, recurrentes, métricas, comprobantes y comportamiento del Service Worker. Las pruebas unitarias no sustituyen la comprobación del OCR, instalación y almacenamiento en los navegadores y dispositivos de destino.

Las pruebas de navegador usan Playwright con Chromium. Para instalar sus herramientas de desarrollo y ejecutarlas:

~~~bash
npm ci
npx playwright install chromium
npm run test:browser
~~~

Chromium necesita un entorno que permita iniciar sus procesos. En Linux, si faltan bibliotecas del sistema, usar `npx playwright install --with-deps chromium`; este es el comando utilizado en CI. Las pruebas de navegador cubren la interfaz, concurrencia entre pestañas, fallos de guardado, migración de datos y lectura real de PDF e imagen sin conexión tras preparar el lector. Esta preparación requiere acceso inicial a los CDN de PDF.js y Tesseract.

Playwright es una dependencia de desarrollo. La aplicación publicada no tiene dependencias npm en tiempo de ejecución ni necesita Node.js o Playwright en el dispositivo del usuario.

### Comprobación manual en navegador

1. Servir la app en localhost o HTTPS y abrir una ventana nueva. Registrar un gasto y recargar para comprobar que se conserva.
2. Abrir una segunda pestaña, crear movimientos distintos en ambas y comprobar que se conservan los dos. Revisar que una edición incompatible del mismo movimiento se advierta.
3. Definir presupuestos distintos en dos meses y comprobar que cada mes conserve el suyo. Revisar el disponible diario frente a los recurrentes pendientes.
4. Subir un PDF con texto y una imagen de comprobante. Revisar especialmente los totales con miles, efectivo y vuelto. Repetir un archivo y cancelar el aviso de duplicado para comprobar que no se añade otro gasto.
5. Preparar el lector sin conexión en Ajustes. Esperar la confirmación, activar el modo sin conexión del navegador, recargar y repetir ambas lecturas. Comprobar también un error de preparación y su reintento.
6. Instalar la PWA en el dispositivo de destino y revisar navegación con teclado, foco del modal, temas y visualización en una pantalla estrecha. Para probar una actualización, cerrar todas las ventanas y volver a abrirla.

## Publicación e instalación

En GitHub Pages, publicar la rama deseada desde la carpeta raíz del repositorio. La URL de este proyecto es [https://esteban2507.github.io/Spendly/](https://esteban2507.github.io/Spendly/).

En Android, abrir la app en un navegador compatible y elegir **Instalar aplicación**. En iPhone/iPad, abrirla en Safari y usar **Compartir → Añadir a pantalla de inicio**.
