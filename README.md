# 🏙️ Sistema de Monitoreo de Licencias Urbanas - DMQ

Plataforma interactiva de monitoreo, analítica espacial y seguimiento integral del ciclo de licenciamiento urbano (**LMU 10** y **LMU 20**) en el **Distrito Metropolitano de Quito (DMQ)**.

El sistema traza el flujo completo de los expedientes a través de las tres etapas institucionales:
1. **Entidades Colaboradoras (SLUM)**: Revisión técnica y emisión de actas de conformidad.
2. **Administraciones Zonales**: Emisión formal de la licencia municipal urbanística.
3. **Agencia Metropolitana de Control (AMC)**: Inspección, control posterior y emisión de certificados.

---

## 🚀 Características Principales

- **🗺️ Cartografía Dinámica Vectorial**: Visualización sobre Mapbox GL JS de predios georreferenciados con simbología por estado de transición institucional.
- **📊 Tablero de Control y Métricas**: Indicadores clave de desempeño (KPIs), tiempos promedio de transición entre dependencias y tasas de finalización.
- **🔍 Búsqueda Rápida e Inteligente**: Autocompletado y búsqueda instantánea por número de predio, nombre del proyecto, propietario o número de trámite.
- **📁 Explorador de Datos y Filtros**: Tabla interactiva con paginación, filtros por Administración Zonal, tipología de licencia (LMU 10 / LMU 20) y rangos de fechas.
- **⚡ Arquitectura Ligera y Portátil**: Los datos estructurados se encuentran empaquetados en `public/data/licencias_data.js`, permitiendo su despliegue inmediato en **GitHub Pages**, servidores estáticos o entornos locales sin dependencias pesadas.

---

## 🛠️ Tecnologías Empleadas

- **Frontend**: HTML5 Semántico, CSS3 Moderno (Glassmorphism, diseño responsivo, paleta temática oscura/clara), JavaScript Vanilla.
- **Librerías Visuales**:
  - [Mapbox GL JS](https://www.mapbox.com/) para representación cartográfica.
  - [Chart.js](https://www.chartjs.org/) para analítica gráfica y distribución zonal.
  - [Lucide Icons](https://lucide.dev/) para iconografía moderna.
- **Servidor Local (Opcional)**: Node.js HTTP server con soporte de compresión gzip.

---

## 📦 Estructura del Repositorio

```text
├── index.html            # Interfaz principal de la plataforma
├── index.css             # Estilos y diseño visual
├── app.js                # Lógica de la aplicación, mapas y gráficos
├── server.js             # Servidor HTTP local de apoyo (Node.js)
├── fix_coords.js         # Script de procesamiento y saneamiento espacial
├── public/
│   └── data/
│       ├── licencias_data.js       # Dataset estructurado para carga directa
│       ├── licencias_data.json     # Datos consolidados en JSON
│       └── metricas_resumen.json   # Resumen estadístico
└── README.md             # Documentación general
```

---

## 💻 Ejecución Local

### Opción 1: Abrir directamente en el navegador
Puedes abrir directamente el archivo `index.html` con cualquier navegador moderno (Google Chrome, Firefox, Edge, Safari).

### Opción 2: Con el servidor integrado de Node.js
```bash
# Iniciar el servidor local
node server.js
```
Luego abre tu navegador en [http://localhost:8085](http://localhost:8085).

---

## 🌐 Despliegue en GitHub Pages

Para publicar este visor automáticamente en la web con **GitHub Pages**:
1. En el repositorio de GitHub, dirígete a **Settings** > **Pages**.
2. En la sección **Build and deployment**, selecciona la fuente **Deploy from a branch**.
3. Selecciona la rama `main` (o `master`) y la carpeta `/ (root)`.
4. Haz clic en **Save**. En un par de minutos tu visor estará disponible públicamente en la URL asignada.
