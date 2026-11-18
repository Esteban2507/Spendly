# Spendly

Spendly es una aplicación web progresiva e instalable (PWA) para gestionar tus finanzas personales y gastos mensuales: control de presupuesto, categorías visuales y coloridas, detección inteligente de gastos recurrentes, gráficos de evolución interactivos y exportación de datos a CSV y JSON.

Funciona sin registro y guarda los gastos de invitado en tu navegador. Si el proyecto tiene Firebase configurado, podés iniciar sesión con Google y sincronizar los gastos de tu cuenta. La lectura de comprobantes se hace en el dispositivo.

## Cuenta y sincronización

- Spendly mantiene separados los datos de invitado y los de cada cuenta. Para trasladar gastos existentes, descargá un respaldo como invitado y restauralo en la cuenta elegida. Restaurar reemplaza los datos de ese perfil y pide confirmación.
- El guardado local y la sincronización tienen estados independientes. Podés cerrar sesión con cambios pendientes. Quedan guardados en el navegador y se reintentan al volver a iniciar sesión con esa cuenta.
- Si dos dispositivos cambian el mismo historial desde distintas versiones, Spendly conserva los datos de ambos sin sobrescribirlos automáticamente. Descargá un respaldo local antes de elegir **Usar datos de la nube**. Esa acción reemplaza la copia local de la cuenta.
- Sin conexión, el sitio instalado conserva su interfaz. Google y las consultas a Firestore requieren conexión. El lector de PDF e imágenes puede necesitar descargar sus componentes cuando se usa por primera vez.

Para habilitar la sincronización, copiá la configuración pública de la aplicación web de Firebase a `firebase-config.json` usando `firebase-config.example.json` como referencia. Agregá el proveedor Google en Authentication y autorizá el dominio `esteban2507.github.io` (solo el nombre del host). Para pruebas en un servidor local, autorizá también `localhost`. Conservá el `authDomain` que proporciona Firebase. Usá únicamente la configuración web pública, sin credenciales de administrador.

En Cloud Firestore, aplicá las reglas de `firestore.rules` al proyecto de Spendly. Permiten a cada cuenta leer y escribir únicamente su documento `users/{uid}/state/data`. Si el proyecto usa otras colecciones, incorporá la regla de Spendly a las reglas existentes y revisá que ninguna regla más amplia permita acceder a esa ruta. Con el archivo de configuración vacío, Spendly funciona en modo local.

---

## 📁 Estructura del Proyecto

El código está organizado de manera modular y limpia sin necesidad de compiladores ni herramientas pesadas de empaquetado (Node.js/Webpack):

```text
spendly/
├── index.html              # Estructura semántica con navegación por pestañas dinámicas
├── manifest.webmanifest    # Configuración PWA (nombre, tema, iconos e instalación)
├── sw.js                   # Service Worker para funcionamiento sin conexión
├── README.md               # Documentación y guía del proyecto
├── css/
│   └── styles.css          # Estilos modernos, paleta cromática viva, componentes y modo oscuro
├── js/
│   ├── state.js            # Estado central, categorías con iconos, localStorage y respaldos
│   ├── recurring.js        # Algoritmo de detección inteligente y automatización mensual
│   ├── chart.js            # Gráficos SVG interactivos con leyendas de color y estadísticas
│   └── app.js              # Controlador principal, pestañas, toasts dinámicos y eventos
└── assets/
    └── icons/              # Iconos oficiales para Android, iOS y navegadores
        ├── icon-180.png
        ├── icon-192.png
        └── icon-512.png
```

---

## 🎨 Entorno Dinámico y Mejoras Visuales

1. **Paleta Cromática Viva y Moderna:**
   - Categorías con emojis y colores vibrantes (🍔 Comida en naranja cálido, 🚗 Transporte en azul royal, 🏠 Vivienda en violeta, 🎮 Ocio en rosa magenta, 💊 Salud en esmeralda, 🛍️ Compras en ámbar, 📺 Suscripciones en cian y 📦 Otros en pizarra).
   - Tarjeta *Hero* con gradiente esmeralda, tipografía destacada y métricas clave en tiempo real (gasto total, ritmo diario promedio, presupuesto restante y categoría top).
2. **Navegación por Pestañas Fluida (Tabs):**
   - **📊 Resumen:** Dashboard interactivo, gráfico de evolución SVG con navegación por meses al tocar barras y desglose visual.
   - **💳 Movimientos:** Formulario de registro rápido con selector visual de chips de categoría, buscador en vivo y lista de transacciones estilo tarjeta.
   - **🔄 Recurrentes:** Detector de suscripciones con sugerencias automáticas y gestión de gastos fijos.
   - **⚙️ Ajustes:** Modificación del presupuesto base, selección de divisa internacional y copias de seguridad.
3. **Selector Visual de Categorías (Chips):**
   - En el formulario de registro de gasto puedes seleccionar la categoría directamente haciendo clic en su botón interactivo con icono y color activo.
4. **Sistema de Notificaciones Toast Dinámicas:**
   - Avisos flotantes elegantes y animados ante cada acción (gasto añadido, eliminado, respaldo descargado, cambio de mes o cambio de tema).
5. **Selector de Tema Dinámico (Claro / Oscuro / Sistema):**
   - Soporte nativo para modo oscuro profundo (Midnight Blue) y modo claro limpio con persistencia en el dispositivo.

---

## 🌐 Publicarla con GitHub Pages (sin usar la terminal)

1. En [github.com](https://github.com) pulsa **New repository**. Nómbralo (por ejemplo `spendly`), márcalo como **Public** y créalo.
2. En la pantalla del repositorio pulsa **uploading an existing file** y arrastra todos los archivos y carpetas de este proyecto (`index.html`, `css/`, `js/`, `assets/`, `manifest.webmanifest`, `sw.js`).
3. Pulsa **Commit changes**.
4. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, rama **main**, carpeta **/ (root)** y guarda.
5. En 1 o 2 minutos tu aplicación estará disponible en `https://esteban2507.github.io/Spendly/` (o tu usuario correspondiente).

---

## 📱 Instalarla en el Teléfono (PWA)

- **iPhone / iPad:** Abre el enlace en **Safari** → pulsa el botón Compartir → selecciona **Añadir a pantalla de inicio**.
- **Android:** Abre el enlace en **Chrome** → pulsa el menú de tres puntos (⋮) → selecciona **Instalar aplicación** (o *Añadir a pantalla de inicio*).

---

## 💻 Probarla en tu Computadora Localmente

Puedes iniciar un servidor web local rápido con Python:

```bash
python -m http.server 8000
```

Y abre en tu navegador: [http://localhost:8000](http://localhost:8000).

Tras publicar una actualización, cerrá todas las pestañas y ventanas de Spendly y volvé a abrir la app para activar la nueva versión sin conexión.
