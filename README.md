# Spendly

Spendly es una aplicación web progresiva e instalable (PWA) para gestionar tus finanzas personales y gastos mensuales: control de presupuesto, categorías visuales y coloridas, detección inteligente de gastos recurrentes, gráficos de evolución interactivos y exportación de datos a CSV y JSON.

No requiere servidor ni registro: todos tus datos se procesan y almacenan de forma 100% privada en tu propio dispositivo (`localStorage`).

---

## 📁 Estructura del Proyecto

El código está organizado de manera modular y limpia sin necesidad de compiladores ni herramientas pesadas de empaquetado (Node.js/Webpack):

```text
spendly/
├── index.html              # Estructura semántica con navegación por pestañas dinámicas
├── manifest.webmanifest    # Configuración PWA (nombre, tema, iconos e instalación)
├── sw.js                   # Service Worker para funcionamiento sin conexión (spendly-v4)
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
