# Spendly

Spendly es una app web instalable (PWA) para llevar tus gastos mensuales: categorías, presupuesto, gastos recurrentes con sugerencias, gráficos de evolución y exportación a CSV. No necesita servidor ni cuenta: todo se guarda en tu dispositivo.

## Publicarla con GitHub Pages (sin usar la terminal)

1. En github.com pulsa **New repository**. Ponle un nombre (por ejemplo `spendly`), márcalo como **Public** y créalo.
2. En la página del repositorio pulsa **uploading an existing file**, arrastra **los archivos** de esta carpeta (no la carpeta entera) y pulsa **Commit changes**.
3. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, rama **main**, carpeta **/ (root)** y guarda.
4. Espera uno o dos minutos. Tu app estará en `https://TU-USUARIO.github.io/spendly/`.

El repositorio es público, pero solo contiene el código: tus gastos nunca salen de tu dispositivo.

## Instalarla en el teléfono

- **iPhone:** abre el enlace en **Safari** → botón Compartir → **Añadir a pantalla de inicio**.
- **Android:** abre el enlace en **Chrome** → menú ⋮ → **Instalar aplicación** (o *Añadir a pantalla de inicio*).

Una vez instalada funciona también sin conexión.

## Tus datos

- Se guardan en el almacenamiento del navegador de **ese dispositivo**. No se sincronizan entre teléfono y computadora.
- Usa **Respaldo de tus datos → Descargar respaldo** de vez en cuando. Con **Restaurar respaldo** los recuperas o los pasas a otro dispositivo.
- Si borras los datos del navegador o desinstalas la app, se pierden. En iPhone, usar la app solo desde Safari (sin instalarla) puede hacer que el sistema borre los datos si no la abres en un tiempo: instálala.

## Probarla en tu computadora

```
python3 -m http.server 8000
```

y abre http://localhost:8000. (El service worker solo se activa en `localhost` o `https`.)

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Toda la app (HTML, CSS y JavaScript) |
| `manifest.webmanifest` | Nombre, icono y colores al instalarla |
| `sw.js` | Service worker: funcionamiento sin conexión |
| `icon-*.png` | Iconos |

## Ideas para más adelante

- Lectura automática de tickets con la API de Anthropic (necesita una función en servidor para no exponer la clave).
- Sincronización entre dispositivos (por ejemplo con Supabase o Firebase).
- Importar un CSV del banco.
