/**
 * ============================================================================
 * Monitoreo de la Aplicación de la Normativa Urbanística a través del Licenciamiento y la Dinámica Territorial en el Distrito Metropolitano de Quito
 * Lógica de la aplicación: Mapbox GL JS, Chart.js, Filtros Reactivos y Análisis
 * ============================================================================
 */

// User Mapbox Public Access Token (client-side map rendering)
const _mb = ['pk', 'eyJ1IjoidXJ1ZG1kdSIsImEiOiJjbXZyNXg4eTkwM2k1MzRzZzZ1MGNjem5vIn0', 'I7nN6ldy6MWGaMYODqbCfA'];
mapboxgl.accessToken = window.MAPBOX_ACCESS_TOKEN || _mb.join('.');

// Límites geográficos del Distrito Metropolitano de Quito (bounding box)
const QUITO_BOUNDS = {
  latMin: -0.58,
  latMax: 0.28,
  lngMin: -78.85,
  lngMax: -78.10
};

/**
 * Valida que una coordenada esté dentro del DMQ
 */
function isWithinQuitoBounds(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    isFinite(lat) && isFinite(lng) &&
    lat >= QUITO_BOUNDS.latMin && lat <= QUITO_BOUNDS.latMax &&
    lng >= QUITO_BOUNDS.lngMin && lng <= QUITO_BOUNDS.lngMax
  );
}

/**
 * Calcula el centroide de un GeoJSON Polygon geometry
 */
function polygonCentroid(geom) {
  if (!geom || !geom.coordinates || !geom.coordinates[0]) return null;
  const ring = geom.coordinates[0];
  let lngSum = 0, latSum = 0;
  for (const [lng, lat] of ring) { lngSum += lng; latSum += lat; }
  return { lng: lngSum / ring.length, lat: latSum / ring.length };
}

// State Management
const state = {
  rawProjects: [],
  filteredProjects: [],
  summaryMetrics: null,
  map: null,
  charts: {
    funnel: null,
    years: null,
    zonales: null,
    entidades: null,
    tiempos: null
  },
  indCharts: {},
  activeIndicatorTab: 1,
  filters: {
    licencia: 'LMU 20',
    fase: 'all',
    tipo: 'all',
    zonal: 'all',
    entidad: 'all',
    anio: 'all',
    query: ''
  },
  pagination: {
    page: 1,
    perPage: 50
  },
  selectedProject: null,
  mapLoaded: false
};

// Document Ready
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  setupEventListeners();
  initMap();
  await loadDatasets();
});

/**
 * Carga de datos JSON consolidado
 */
async function loadDatasets() {
  try {
    let allData = [];
    if (window.LICENCIAS_DATA && window.METRICAS_RESUMEN) {
      allData = window.LICENCIAS_DATA;
      state.summaryMetrics = window.METRICAS_RESUMEN;
    } else {
      const [resData, resMetrics] = await Promise.all([
        fetch('public/data/licencias_data.json'),
        fetch('public/data/metricas_resumen.json')
      ]);
      allData = await resData.json();
      state.summaryMetrics = await resMetrics.json();
    }

    // Preservar la muestra íntegra cargada
    state.allProjects = allData;

    // Alcance activo: por el momento filtrar estrictamente solo licencias y certificados LMU 20
    state.rawProjects = allData.filter(p => p.tipo_licencia === 'LMU 20');
    state.filteredProjects = [...state.rawProjects];

    // Hide loader
    const loader = document.getElementById('map-loader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 400);
    }

    // Update UI
    updateKpiCards();
    updateMapSource();
    initOrUpdateCharts();
    populateTable();

    document.getElementById('badge-total-count').textContent = `${state.rawProjects.length.toLocaleString()} Predios Rastreados (LMU 20)`;

  } catch (error) {
    console.error('Error cargando datasets:', error);
    const loader = document.getElementById('map-loader');
    if (loader) {
      loader.innerHTML = `
        <div style="text-align: center; color: #ef4444; padding: 20px;">
          <h3>Error al cargar los datos</h3>
          <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 8px;">No se pudo acceder a licencias_data.json. Verifique la conexión local.</p>
        </div>
      `;
    }
  }
}

/**
 * Inicialización de Mapbox GL JS
 */
function initMap() {
  state.map = new mapboxgl.Map({
    container: 'mapbox-container',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [-78.485, -0.185], // Quito
    zoom: 11.2,
    pitch: 25,
    attributionControl: false
  });

  state.map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  state.map.addControl(new mapboxgl.FullscreenControl(), 'bottom-right');

  state.map.on('load', () => {
    state.mapLoaded = true;
    setupMapLayers();
    if (state.filteredProjects.length > 0) {
      updateMapSource();
    }
  });
}

/**
 * Configurar capas de polígonos y geometría predial en Mapbox
 */
function setupMapLayers() {
  // ──────────────── CAPAS DE LÍMITES DE ADMINISTRACIONES ZONALES ────────────────
  // Se agregan PRIMERO para situarse como fondo de referencia territorial
  // sin interferir en los predios ya cargados.
  if (!state.map.getSource('zonas-source') && window.ZONAS_DATA) {
    state.map.addSource('zonas-source', {
      type: 'geojson',
      data: window.ZONAS_DATA
    });
  }

  // Capa para Rótulos / Labels usando los centroides de cada zona
  if (!state.map.getSource('zonas-centroids-source') && window.ZONAS_DATA && window.ZONAS_DATA.features) {
    const centroidFeatures = window.ZONAS_DATA.features.map(f => ({
      type: 'Feature',
      id: f.id + '_lbl',
      geometry: {
        type: 'Point',
        coordinates: f.properties.centroid
      },
      properties: f.properties
    }));
    state.map.addSource('zonas-centroids-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: centroidFeatures }
    });
  }

  // Sincronizar visibilidad con el botón toggle si ya existe en el DOM (desactivado por defecto)
  const toggleZonalesBtnInit = document.getElementById('toggle-zonales-btn');
  const initVisibility = (toggleZonalesBtnInit && toggleZonalesBtnInit.checked) ? 'visible' : 'none';

  // 1. Relleno zonal translúcido muy suave (fondo cartográfico)
  if (state.map.getSource('zonas-source') && !state.map.getLayer('zonas-fill')) {
    state.map.addLayer({
      id: 'zonas-fill',
      type: 'fill',
      source: 'zonas-source',
      layout: {
        'visibility': initVisibility
      },
      paint: {
        'fill-color': [
          'match', ['get', 'cod_adm_zo'],
          'AZCHA', '#10b981',
          'AZEE', '#0284c7',
          'AZCH', '#f59e0b',
          'AZQ', '#8b5cf6',
          'AZCA', '#ec4899',
          'AZMS', '#eab308',
          'AZT', '#06b6d4',
          'AZLM', '#14b8a6',
          'AZLD', '#6366f1',
          'AZEA', '#f97316',
          '#38bdf8'
        ],
        'fill-opacity': 0.08
      }
    });
  }

  // 2. Límites perimetrales de las Administraciones Zonales (línea sólida y visible)
  if (state.map.getSource('zonas-source') && !state.map.getLayer('zonas-border')) {
    state.map.addLayer({
      id: 'zonas-border',
      type: 'line',
      source: 'zonas-source',
      layout: {
        'visibility': initVisibility
      },
      paint: {
        'line-color': [
          'match', ['get', 'cod_adm_zo'],
          'AZCHA', '#34d399',
          'AZEE', '#38bdf8',
          'AZCH', '#fbbf24',
          'AZQ', '#a78bfa',
          'AZCA', '#f472b6',
          'AZMS', '#fde047',
          'AZT', '#22d3ee',
          'AZLM', '#2dd4bf',
          'AZLD', '#818cf8',
          'AZEA', '#fb923c',
          '#60a5fa'
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          8, 1.5,
          11, 2.2,
          14, 3.2
        ],
        'line-opacity': 0.85
      }
    });
  }

  // 3. Rótulos / Etiquetas tipográficas con el nombre de cada Administración Zonal
  if (state.map.getSource('zonas-centroids-source') && !state.map.getLayer('zonas-labels')) {
    state.map.addLayer({
      id: 'zonas-labels',
      type: 'symbol',
      source: 'zonas-centroids-source',
      layout: {
        'visibility': initVisibility,
        'text-field': ['concat', 'AZ ', ['get', 'adm_zonal']],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          8, 11,
          10, 13,
          12, 15,
          15, 18
        ],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {
        'text-color': '#f8fafc',
        'text-halo-color': 'rgba(15, 23, 42, 0.95)',
        'text-halo-width': 2.5,
        'text-halo-blur': 1.0,
        'text-opacity': 0.95
      }
    });
  }

  ['zonas-fill', 'zonas-border', 'zonas-labels'].forEach(layerId => {
    if (state.map.getLayer(layerId)) {
      state.map.setLayoutProperty(layerId, 'visibility', initVisibility);
    }
  });

  // Fuente A: predios con geometría exacta del catastro (polígonos reales)
  if (!state.map.getSource('predios-source')) {
    state.map.addSource('predios-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }

  // Fuente B: predios con ubicación aproximada (centroide de parroquia)
  if (!state.map.getSource('predios-approx-source')) {
    state.map.addSource('predios-approx-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }

  // ──────────────── CAPAS PARA PREDIOS EXACTOS (polígonos del shapefile) ────────────────
  // Se agregan DESPUÉS de las zonas para renderizarse encima con máxima prioridad

  // 1. Relleno del polígono
  if (!state.map.getLayer('predios-polygons')) {
    state.map.addLayer({
      id: 'predios-polygons',
      type: 'fill',
      source: 'predios-source',
      paint: {
        'fill-color': [
          'match', ['get', 'fase'],
          1, '#06b6d4',
          2, '#f59e0b',
          3, '#10b981',
          '#38bdf8'
        ],
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          9, 0.50,
          13, 0.65,
          16, 0.82
        ]
      }
    });
  }

  // 2. Contorno / borde sólido
  if (!state.map.getLayer('predios-outline')) {
    state.map.addLayer({
      id: 'predios-outline',
      type: 'line',
      source: 'predios-source',
      paint: {
        'line-color': [
          'match', ['get', 'fase'],
          1, '#67e8f9',
          2, '#fde047',
          3, '#6ee7b7',
          '#ffffff'
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          10, 1.0,
          13, 1.8,
          16, 2.8
        ],
        'line-opacity': 0.95
      }
    });
  }

  // 3. Resplandor exterior (glow)
  if (!state.map.getLayer('predios-glow')) {
    state.map.addLayer({
      id: 'predios-glow',
      type: 'line',
      source: 'predios-source',
      paint: {
        'line-color': [
          'match', ['get', 'fase'],
          1, '#06b6d4',
          2, '#f59e0b',
          3, '#10b981',
          '#38bdf8'
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          11, 2.0,
          15, 4.5,
          18, 7.0
        ],
        'line-opacity': 0.28,
        'line-blur': 2
      }
    });
  }

  // ──────────────── NOTA: PREDIOS APROXIMADOS ────────────────
  // Los predios sin geometría exacta del catastro NO se renderizan en el mapa
  // para evitar rectángulos placeholder solapados. Sí aparecen en la tabla
  // de datos y en los conteos de KPIs.

  // ──────────────── INTERACTIVIDAD ────────────────

  state.map.on('click', 'predios-polygons', (e) => {
    if (!e.features || !e.features.length) return;
    showPredioPopup(e.features[0].properties, [e.lngLat.lng, e.lngLat.lat]);
  });

  state.map.on('mouseenter', 'predios-polygons', () => { state.map.getCanvas().style.cursor = 'pointer'; });
  state.map.on('mouseleave', 'predios-polygons', () => { state.map.getCanvas().style.cursor = ''; });

  // Evento de clic en Zonas (solo si no se clicó un predio)
  state.map.on('click', 'zonas-fill', (e) => {
    const bbox = [[e.point.x - 3, e.point.y - 3], [e.point.x + 3, e.point.y + 3]];
    const predioHits = state.map.queryRenderedFeatures(bbox, { layers: ['predios-polygons'] });
    if (predioHits && predioHits.length > 0) return;

    if (!e.features || !e.features.length) return;
    showZonalPopup(e.features[0].properties, [e.lngLat.lng, e.lngLat.lat]);
  });

  state.map.on('mouseenter', 'zonas-fill', (e) => {
    const bbox = [[e.point.x - 3, e.point.y - 3], [e.point.x + 3, e.point.y + 3]];
    const predioHits = state.map.queryRenderedFeatures(bbox, { layers: ['predios-polygons'] });
    if (predioHits && predioHits.length > 0) {
      state.map.getCanvas().style.cursor = 'pointer';
    } else {
      state.map.getCanvas().style.cursor = 'default';
    }
  });
  state.map.on('mouseleave', 'zonas-fill', () => {
    state.map.getCanvas().style.cursor = '';
  });
}



/**
 * Convierte los proyectos filtrados a GeoJSON y actualiza el mapa.
 * Solo incluye predios con coordenadas válidas dentro del DMQ.
 */
function updateMapSource() {
  if (!state.mapLoaded) return;
  if (!state.map.getSource('predios-source') || !state.map.getSource('predios-approx-source')) return;

  const exactFeatures = [];
  const approxFeatures = [];
  let skippedCount = 0;

  for (const p of state.filteredProjects) {
    // Validar coordenadas dentro del DMQ
    if (!p.lat || !p.lng || !isWithinQuitoBounds(p.lat, p.lng)) { skippedCount++; continue; }

    // Construir propiedades comunes
    const props = {
      predio: p.predio,
      fase: p.fase,
      is_exact_lot: p.is_exact_lot ? 1 : 0,
      tipo_licencia: p.tipo_licencia,
      tipo_proyecto: p.tipo_proyecto || '',
      nombre_proyecto: p.nombre_proyecto || 'Sin nombre registrado',
      ad_zonal: p.ad_zonal || 'Sin zonal',
      parroquia: p.parroquia || 'Sin parroquia',
      entidad_colaboradora: p.entidad_colaboradora || 'No asignada',
      clave_catastral: p.clave_catastral || '',
      fecha_emision_ec: p.fecha_emision_ec || '',
      fecha_inicio_az: p.fecha_inicio_az || '',
      fecha_emision_az: p.fecha_emision_az || '',
      dias_transicion: p.dias_transicion || '',
      dias_ejecucion_az: p.dias_ejecucion_az || '',
      estado_tramite: p.estado_tramite || '',
      amc_registro: p.amc_registro || '',
      amc_resultado: p.amc_resultado || '',
      total_certificados_amc: p.total_certificados_amc || (p.certificados_amc ? p.certificados_amc.length : 0),
      total_certificados_ec: p.total_certificados_ec || (p.certificados_ec ? p.certificados_ec.length : 0),
      tiene_ph: p.tiene_ph ? 1 : 0,
      estado_ph: p.estado_ph || '',
      total_tramites_ph: p.total_tramites_ph || (p.tramites_ph ? p.tramites_ph.length : 0),
      area_bruta: p.area_bruta || 0,
      year: p.year || 2024,
      center_lng: p.lng,
      center_lat: p.lat
    };

    if (p.is_exact_lot === true && p.geom) {
      // Validar primer vértice del polígono
      const firstRing = p.geom.coordinates && p.geom.coordinates[0];
      if (firstRing && firstRing.length > 0) {
        const [fLng, fLat] = firstRing[0];
        if (!isWithinQuitoBounds(fLat, fLng)) { skippedCount++; continue; }
      }
      // Calcular centroide real para el flyTo
      const centroid = polygonCentroid(p.geom);
      if (centroid && isWithinQuitoBounds(centroid.lat, centroid.lng)) {
        props.center_lng = centroid.lng;
        props.center_lat = centroid.lat;
      }
      // Agregar como polígono exacto
      exactFeatures.push({ type: 'Feature', geometry: p.geom, properties: props });
    } else {
      // Polígono aproximado (placeholder rectangular) — oculto hasta zoom 14
      const geom = p.geom || {
        type: 'Polygon',
        coordinates: [[
          [p.lng - 0.00012, p.lat - 0.00012],
          [p.lng + 0.00012, p.lat - 0.00012],
          [p.lng + 0.00012, p.lat + 0.00012],
          [p.lng - 0.00012, p.lat + 0.00012],
          [p.lng - 0.00012, p.lat - 0.00012]
        ]]
      };
      approxFeatures.push({ type: 'Feature', geometry: geom, properties: props });
    }
  }

  state.map.getSource('predios-source').setData({
    type: 'FeatureCollection', features: exactFeatures
  });
  state.map.getSource('predios-approx-source').setData({
    type: 'FeatureCollection', features: approxFeatures
  });

  const countLabel = document.getElementById('legend-count-label');
  if (countLabel) {
    const total = state.filteredProjects.length;
    countLabel.textContent = `${total.toLocaleString()} predios | ${exactFeatures.length.toLocaleString()} con polígono en mapa`;
  }

  if (skippedCount > 0) {
    console.warn(`[Coords] ${skippedCount} predios omitidos por coordenadas fuera del DMQ o inválidas.`);
  }
}

/**
 * Mostrar popup al hacer clic en un predio
 */
function showPredioPopup(props, coordinates) {
  const faseNum = parseInt(props.fase);
  const phase1Active = faseNum >= 1;
  const phase2Active = faseNum >= 2;
  const phase3Active = faseNum >= 3;

  const isExact = parseInt(props.is_exact_lot) === 1;
  const coordBadge = isExact
    ? `<span class="popup-coord-badge exact" title="Ubicación exacta desde catastro DMQ">📍 Ubicación exacta</span>`
    : `<span class="popup-coord-badge approx" title="Ubicación aproximada por parroquia">📌 Ubicación aproximada</span>`;

  // Tipo de proyecto badge
  const tipoBadgeColor = {
    'NUEVO': '#10b981',
    'AMPLIATORIO': '#f59e0b',
    'MODIFICATORIO': '#8b5cf6',
    'MOD / AMP': '#06b6d4',
    'MOD/AMP': '#06b6d4'
  };
  const tipoProyecto = props.tipo_proyecto || null;
  const tipoBadge = tipoProyecto
    ? `<span class="popup-tipo-badge" style="background:${tipoBadgeColor[tipoProyecto] || '#64748b'}20; color:${tipoBadgeColor[tipoProyecto] || '#94a3b8'}; border:1px solid ${tipoBadgeColor[tipoProyecto] || '#64748b'}50; border-radius:4px; font-size:0.70rem; font-weight:700; padding:2px 7px; letter-spacing:0.04em;">${tipoProyecto}</span>`
    : '';

  // Detectar múltiples licencias / expedientes del mismo predio
  const pObj = (state.rawProjects || []).find(p => String(p.predio) === String(props.predio)) || props;
  const numLic = pObj.total_licencias_az || (pObj.licencias_az ? pObj.licencias_az.length : 1);
  const numExp = pObj.total_expedientes || (pObj.trazabilidad ? pObj.trazabilidad.length : 1);
  const multiLicencia = (numLic > 1 || numExp > 1)
    ? `<div class="pm-item" style="grid-column:1/-1; background:rgba(6,182,212,0.12); border:1px solid rgba(6,182,212,0.3); border-radius:6px; padding:6px 10px;">
        <span class="pm-lbl" style="color:#38bdf8; font-weight:700;">📑 Trazabilidad Constructiva:</span>
        <span class="pm-val" style="color:#7dd3fc; font-weight:600;">${numExp} expedientes trazados (${numLic} licencias AZ emitidas)</span>
       </div>`
    : '';

  const html = `
    <div class="popup-card">
      <div class="popup-header">
        <span class="popup-predio-badge">Predio N° ${props.predio}</span>
        <span class="popup-type-tag">${props.tipo_licencia}</span>
      </div>
      <div class="popup-body">
        <div style="display:flex; align-items:flex-start; gap:8px; flex-wrap:wrap; margin-bottom:4px;">
          <h4 class="popup-project-title" style="margin:0; flex:1;">${props.nombre_proyecto}</h4>
          ${tipoBadge}
        </div>
        ${coordBadge}

        <!-- Stepper -->
        <div class="popup-stepper">
          <div class="step-node ${phase1Active ? 'completed' : ''}">
            <div class="step-circle">1</div>
            <span class="step-label">Entidad C.</span>
          </div>
          <div class="step-node ${phase2Active ? 'completed' : ''}">
            <div class="step-circle">2</div>
            <span class="step-label">Adm. Zonal</span>
          </div>
          <div class="step-node ${phase3Active ? 'completed green' : ''}">
            <div class="step-circle">3</div>
            <span class="step-label">AMC Cert.</span>
          </div>
        </div>

        <div class="popup-meta-grid">
          ${multiLicencia}
          <div class="pm-item">
            <span class="pm-lbl">Adm. Zonal:</span>
            <span class="pm-val">${props.ad_zonal || 'N/A'}</span>
          </div>
          <div class="pm-item">
            <span class="pm-lbl">Parroquia:</span>
            <span class="pm-val">${props.parroquia || 'N/A'}</span>
          </div>
          <div class="pm-item">
            <span class="pm-lbl">Entidad Colab:</span>
            <span class="pm-val">${props.entidad_colaboradora || 'N/A'}</span>
          </div>
          <div class="pm-item">
            <span class="pm-lbl">Estado Trámite:</span>
            <span class="pm-val" style="color: #38bdf8;">${props.estado_tramite || 'En proceso'}</span>
          </div>
          ${props.dias_transicion ? `
          <div class="pm-item">
            <span class="pm-lbl">Días Transición (EC&rarr;AZ):</span>
            <span class="pm-val" style="color: #f59e0b;">${props.dias_transicion} días</span>
          </div>` : ''}
          ${props.total_certificados_ec > 1 ? `
          <div class="pm-item" style="grid-column:1/-1; background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.25); border-radius:6px; padding:6px 10px;">
            <span class="pm-lbl" style="color:#38bdf8; font-weight:700;">Trámites / Certificados EC:</span>
            <span class="pm-val" style="color:#7dd3fc; font-weight:600;">${props.total_certificados_ec} trámites registrados en Fase 1</span>
          </div>` : ''}
          ${props.amc_registro ? `
          <div class="pm-item" style="${props.total_certificados_amc > 1 ? 'grid-column:1/-1; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); border-radius:6px; padding:6px 10px;' : ''}">
            <span class="pm-lbl" style="${props.total_certificados_amc > 1 ? 'color:#10b981; font-weight:700;' : ''}">Certificados AMC:</span>
            <span class="pm-val" style="color: #10b981; font-weight:600;">${props.total_certificados_amc > 1 ? `${props.total_certificados_amc} certificados emitidos (ver ficha técnica)` : `${props.amc_registro} (${props.amc_resultado})`}</span>
          </div>` : ''}
          ${parseInt(props.tiene_ph) === 1 ? `
          <div class="pm-item" style="grid-column:1/-1; background:rgba(139,92,246,0.12); border:1px solid rgba(139,92,246,0.35); border-radius:6px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center;">
            <span class="pm-lbl" style="color:#c4b5fd; font-weight:700;">🏢 Propiedad Horizontal:</span>
            <span style="background:${props.estado_ph === 'PENDIENTE' ? '#f59e0b' : props.estado_ph === 'TRAMITE ANULADO' ? '#ef4444' : '#8b5cf6'}25; color:${props.estado_ph === 'PENDIENTE' ? '#fbbf24' : props.estado_ph === 'TRAMITE ANULADO' ? '#f87171' : '#a78bfa'}; border:1px solid ${props.estado_ph === 'PENDIENTE' ? '#f59e0b' : props.estado_ph === 'TRAMITE ANULADO' ? '#ef4444' : '#8b5cf6'}50; border-radius:4px; font-size:0.72rem; font-weight:700; padding:2px 8px; letter-spacing:0.02em;">
              ${props.estado_ph || 'En trámite'}${props.total_tramites_ph > 1 ? ` (${props.total_tramites_ph} trámites)` : ''}
            </span>
          </div>` : ''}
        </div>
      </div>
      <div class="popup-footer">
        <button class="popup-detail-btn" onclick="openPredioModal('${props.predio}')">
          Ver Ficha Completa <i data-lucide="arrow-right"></i>
        </button>
      </div>
    </div>
  `;

  new mapboxgl.Popup({ offset: 12, maxWidth: '340px' })
    .setLngLat(coordinates)
    .setHTML(html)
    .addTo(state.map);

  if (window.lucide) lucide.createIcons();
}

/**
 * Mostrar popup de información territorial de la Administración Zonal
 */
function showZonalPopup(props, coordinates) {
  if (state.activePopup) {
    state.activePopup.remove();
  }

  const countInZone = state.filteredProjects.filter(p => {
    const pZ = (p.ad_zonal || '').toLowerCase();
    const zN = (props.adm_zonal || '').toLowerCase();
    return pZ.includes(zN) || (props.alias && pZ.includes(props.alias.toLowerCase()));
  }).length;

  const html = `
    <div class="custom-popup-card zonal-popup-card">
      <div class="popup-top" style="border-left: 4px solid ${props.color || '#38bdf8'}; padding-left: 10px;">
        <span class="popup-phase-pill" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">
          ${props.cod_adm_zo || 'AZ'}
        </span>
        <span class="popup-type-pill">Jurisdicción DMQ</span>
      </div>
      <div class="popup-body">
        <h4 class="popup-project-title" style="margin-top: 6px;">${props.nombre_completo || ('Administración Zonal ' + props.adm_zonal)}</h4>
        <div class="popup-meta-grid" style="margin-top: 10px;">
          <div class="pm-item">
            <span class="pm-lbl">Predios en Muestra:</span>
            <span class="pm-val" style="color: #38bdf8; font-weight: 700;">${countInZone.toLocaleString('es-EC')}</span>
          </div>
          <div class="pm-item">
            <span class="pm-lbl">Superficie Zonal:</span>
            <span class="pm-val">${props.area_km2 ? props.area_km2.toLocaleString('es-EC') + ' km²' : 'N/A'}</span>
          </div>
          <div class="pm-item">
            <span class="pm-lbl">Perímetro Territorial:</span>
            <span class="pm-val">${props.perimetro_km ? props.perimetro_km.toLocaleString('es-EC') + ' km' : 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  state.activePopup = new mapboxgl.Popup({ offset: 10, maxWidth: '320px' })
    .setLngLat(coordinates)
    .setHTML(html)
    .addTo(state.map);

  if (window.lucide) lucide.createIcons();
}

/**
 * Cambiar de pestaña activa dentro del modal de predio
 */
window.switchPredioTab = function (targetId, btn) {
  const card = btn.closest('.detail-modal-card');
  if (!card) return;
  card.querySelectorAll('.dmc-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  card.querySelectorAll('.dmc-tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = card.querySelector(`#${targetId}`);
  if (targetPane) {
    targetPane.classList.add('active');
  }
  if (window.lucide) lucide.createIcons();
};

/**
 * Formatear área en m² con notación ecuatoriana (decimales con coma)
 */
function formatArea(val) {
  if (val === null || val === undefined || isNaN(val) || Number(val) <= 0) return '0 m²';
  const num = Number(val);
  return num.toLocaleString('es-EC', {
    minimumFractionDigits: (num % 1 !== 0 ? 2 : 0),
    maximumFractionDigits: 2
  }) + ' m²';
}

/**
 * Abrir Modal de Ficha Técnica Completa
 */
window.openPredioModal = function (predioNum) {
  const p = state.rawProjects.find(item => item.predio == predioNum);
  if (!p) return;

  const modal = document.getElementById('detail-modal-overlay');
  const card = document.getElementById('detail-modal-card');

  // Trámites de Propiedad Horizontal
  const tramitesPh = p.tramites_ph || [];
  const phColor = p.estado_ph === 'PENDIENTE' ? '#f59e0b' : p.estado_ph === 'TRAMITE ANULADO' ? '#ef4444' : '#8b5cf6';

  // Items de trazabilidad (cada uno representa una licencia, expediente o certificado independiente)
  const trazabilidad = (p.trazabilidad && p.trazabilidad.length > 0) ? p.trazabilidad : [{
    expediente: p.predio ? `Predio ${p.predio}` : 'S/N',
    nombre_proyecto: p.nombre_proyecto || '',
    tipo_proyecto: p.tipo_proyecto || '',
    fase_actual: p.fase || 1,
    estado_ciclo: p.estado_tramite || (p.in_amc ? 'Fase 3: Control Posterior' : (p.in_az ? 'Fase 2: Licencia Emitida' : 'Fase 1: EC')),
    fase1_ec: p.in_ec ? { tiene: true, expediente: p.predio, entidad: p.entidad_colaboradora, fecha_emision: p.fecha_emision_ec, estado: 'EMITIDO', area_bruta: p.area_bruta } : null,
    fase2_az: p.in_az ? { tiene: true, licencia: p.tipo_licencia, ad_zonal: p.ad_zonal, fecha_emision: p.fecha_emision_az, fecha_inicio: p.fecha_inicio_az, estado_tramite: p.estado_tramite, profesional: '', area_bruta: p.area_bruta } : null,
    fase3_amc: p.in_amc ? { tiene: true, registro: p.amc_registro, certificado: p.amc_registro, resultado: p.amc_resultado || 'FAVORABLE', etapa: '0', area_declarada: p.area_bruta } : null
  }];

  const tipoBadgeColor = {
    'NUEVO': '#10b981',
    'AMPLIATORIO': '#f59e0b',
    'MODIFICATORIO': '#8b5cf6',
    'MOD / AMP': '#06b6d4',
    'MOD/AMP': '#06b6d4'
  };

  const hasMultipleTabs = (trazabilidad.length > 1) || (trazabilidad.length >= 1 && p.tiene_ph);

  // Barra de pestañas (solo cuando hay más de una licencia/trámite o PH)
  const tabsNavHtml = hasMultipleTabs ? `
    <div class="dmc-tabs-header">
      ${trazabilidad.map((t, idx) => {
    let label = `Trámite #${idx + 1}`;
    let icon = 'file-text';
    if (t.fase2_az?.licencia) {
      label = `Lic. ${t.fase2_az.licencia}`;
      icon = 'file-badge';
    } else if (t.fase1_ec?.expediente) {
      label = `Cert. EC #${idx + 1}`;
      icon = 'clipboard-check';
    } else if (t.fase3_amc?.registro) {
      label = `AMC: ${t.fase3_amc.registro}`;
      icon = 'shield-check';
    }

    const pillClass = t.fase_actual === 3 ? 'pill-f3' : (t.fase_actual === 2 ? 'pill-f2' : 'pill-f1');
    const pillText = t.fase_actual === 3 ? 'Fase 3' : (t.fase_actual === 2 ? 'Fase 2' : 'Fase 1');

    return `
          <button class="dmc-tab-btn ${idx === 0 ? 'active' : ''}" onclick="switchPredioTab('dmc-pane-trace-${idx}', this)">
            <i data-lucide="${icon}" style="width:16px; height:16px;"></i>
            <span>${label}</span>
            <span class="dmc-tab-pill ${pillClass}">${pillText}</span>
          </button>
        `;
  }).join('')}
      ${p.tiene_ph ? `
        <button class="dmc-tab-btn tab-ph ${trazabilidad.length === 0 ? 'active' : ''}" onclick="switchPredioTab('dmc-pane-ph', this)">
          <i data-lucide="building-2" style="width:16px; height:16px;"></i>
          <span>Prop. Horizontal</span>
          <span class="dmc-tab-pill pill-ph">${tramitesPh.length}</span>
        </button>
      ` : ''}
    </div>
  ` : '';

  // Contenido de cada pestaña
  const panesHtml = `
    <div class="dmc-tabs-body">
      ${trazabilidad.map((t, idx) => {
    let badgeBg = 'rgba(56,189,248,0.15)';
    let badgeColor = '#38bdf8';
    let badgeBorder = 'rgba(56,189,248,0.3)';
    if (t.fase_actual === 3) {
      badgeBg = 'rgba(16,185,129,0.15)';
      badgeColor = '#34d399';
      badgeBorder = 'rgba(16,185,129,0.35)';
    } else if (t.fase_actual === 1) {
      badgeBg = 'rgba(245,158,11,0.15)';
      badgeColor = '#fbbf24';
      badgeBorder = 'rgba(245,158,11,0.35)';
    }

    const tColor = tipoBadgeColor[t.tipo_proyecto] || '#64748b';
    const isFirst = idx === 0;

    // Fase 1: Entidad Colaboradora
    const isF1Active = !!(t.fase1_ec && t.fase1_ec.tiene);
    const f1Fecha = isF1Active
      ? (t.fase1_ec.fecha_emision ? `Emisión: ${t.fase1_ec.fecha_emision}` : 'Sin fecha de emisión')
      : 'Sin fecha de emisión';
    const f1Area = t.fase1_ec?.area_bruta ? ` &bull; Área: ${formatArea(t.fase1_ec.area_bruta)}` : '';
    const f1Entidad = isF1Active
      ? `Entidad: ${t.fase1_ec.entidad || 'No especificada'}${t.fase1_ec.estado ? ' (' + t.fase1_ec.estado + ')' : ''}`
      : 'Entidad: No especificada';

    // Fase 2: Administración Zonal
    const isF2Active = !!(t.fase2_az && t.fase2_az.tiene);
    let f2Fechas = [];
    if (t.fase2_az?.fecha_inicio) f2Fechas.push(`Ingreso: ${t.fase2_az.fecha_inicio}`);
    if (t.fase2_az?.fecha_emision) f2Fechas.push(`Emisión: ${t.fase2_az.fecha_emision}`);
    const f2Area = t.fase2_az?.area_bruta ? ` &bull; Área: ${formatArea(t.fase2_az.area_bruta)}` : '';
    const f2FechasStr = (f2Fechas.length > 0
      ? f2Fechas.join(' &bull; ')
      : (isF2Active ? 'Sin fecha de emisión' : 'Pendiente de emisión en Administración Zonal')) + f2Area;

    // Cálculo de días en ejecución
    let diasTexto = '';
    let dias = null;
    if (t.fase2_az?.fecha_inicio && t.fase2_az?.fecha_emision) {
      const d1 = new Date(t.fase2_az.fecha_inicio);
      const d2 = new Date(t.fase2_az.fecha_emision);
      if (!isNaN(d1) && !isNaN(d2)) {
        dias = Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
      }
    }
    if (dias === null && p.dias_ejecucion_az !== undefined && p.dias_ejecucion_az !== null && p.dias_ejecucion_az !== '') {
      dias = p.dias_ejecucion_az;
    }
    if (dias !== null && dias !== undefined && dias !== '') {
      diasTexto = ` (${dias} días en ejecución)`;
    }
    const f2Zonal = isF2Active
      ? `${t.fase2_az.ad_zonal || p.ad_zonal || 'Administración Zonal'}${diasTexto}${t.fase2_az.profesional ? '<br>Profesional: ' + t.fase2_az.profesional : ''}`
      : 'Administración Zonal: No registrada';

    // Fase 3: Agencia Metropolitana de Control (AMC)
    const isF3Active = !!(t.fase3_amc && t.fase3_amc.tiene);
    const f3Cert = isF3Active
      ? `Certificado: ${t.fase3_amc.certificado || t.fase3_amc.registro || 'CCF Registrado'}`
      : 'Pendiente de emisión en AMC';
    const f3Resultado = isF3Active
      ? `Resultado: <strong style="color:${t.fase3_amc.resultado === 'FAVORABLE' ? '#34d399' : '#f59e0b'};">${t.fase3_amc.resultado || 'FAVORABLE'}</strong>${t.fase3_amc.area_declarada ? ` &bull; Área: ${formatArea(t.fase3_amc.area_declarada)}` : ''}`
      : 'Resultado: No registrado / En obra';

    return `
          <div class="dmc-tab-pane ${isFirst ? 'active' : ''}" id="dmc-pane-trace-${idx}">
            <!-- Encabezado de la Licencia / Trámite -->
            <div style="background:rgba(15,23,42,0.65); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px 14px; margin-bottom:14px;">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                <div style="flex:1; min-width:200px;">
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span style="font-size:0.86rem; font-weight:700; color:#38bdf8;">
                      ${t.fase2_az?.licencia ? `No. Licencia: ${t.fase2_az.licencia}` : (t.fase1_ec?.expediente ? `No. Expediente: ${t.fase1_ec.expediente}` : (t.fase3_amc?.registro ? `No. Registro AMC: ${t.fase3_amc.registro}` : 'Trámite Técnico'))}
                    </span>
                    ${t.tipo_proyecto ? `<span style="font-size:0.68rem; font-weight:700; padding:1px 7px; border-radius:3px; background:${tColor}20; color:${tColor}; border:1px solid ${tColor}50;">${t.tipo_proyecto}</span>` : ''}
                  </div>
                  ${t.nombre_proyecto ? `<div style="font-size:0.8rem; color:#cbd5e1; margin-top:3px; font-weight:500;">${t.nombre_proyecto}</div>` : ''}
                  ${t.expediente && (!t.fase2_az?.licencia || t.expediente !== t.fase2_az?.licencia) ? `<div style="font-size:0.72rem; color:#94a3b8; margin-top:2px;">No. Expediente: <code style="color:#7dd3fc;">${t.expediente}</code></div>` : ''}
                </div>
                <span style="font-size:0.72rem; font-weight:700; padding:3px 10px; border-radius:12px; background:${badgeBg}; color:${badgeColor}; border:1px solid ${badgeBorder}; white-space:nowrap;">
                  ${(t.estado_ciclo || '').replace(/Licencia LMU [Ee]mitida/g, 'LMU Emitida')}
                </span>
              </div>
            </div>

            <!-- Línea de Tiempo del Trámite (Fase 1 -> Fase 2 -> Fase 3) -->
            <div class="dmc-section-title" style="margin-bottom:12px; margin-top:4px;">
              LÍNEA DE TIEMPO DEL TRÁMITE
            </div>

            <div class="dmc-timeline" style="margin-bottom:16px;">
              <!-- Fase 1: Entidad Colaboradora -->
              <div class="dmc-tl-step ${isF1Active ? 'active' : ''}">
                <span class="dmc-tl-title">Fase 1: Entidad Colaboradora</span>
                <span class="dmc-tl-date">${f1Fecha}${f1Area}</span>
                <span class="dmc-tl-meta">${f1Entidad}</span>
              </div>

              <!-- Fase 2: Administración Zonal -->
              <div class="dmc-tl-step ${isF2Active ? 'active' : ''}">
                <span class="dmc-tl-title">Fase 2: Administración Zonal</span>
                <span class="dmc-tl-date">${f2FechasStr}</span>
                <span class="dmc-tl-meta">${f2Zonal}</span>
              </div>

              <!-- Fase 3: Agencia Metropolitana de Control (AMC) -->
              <div class="dmc-tl-step ${isF3Active ? 'active' : ''}">
                <span class="dmc-tl-title">Fase 3: Agencia Metropolitana de Control (AMC)</span>
                <span class="dmc-tl-date">${f3Cert}</span>
                <span class="dmc-tl-meta">${f3Resultado}</span>
              </div>
            </div>
          </div>
        `;
  }).join('')}

      <!-- Pestaña de Propiedad Horizontal (si aplica) -->
      ${p.tiene_ph ? `
        <div class="dmc-tab-pane ${trazabilidad.length === 0 ? 'active' : ''}" id="dmc-pane-ph">
          <div class="dmc-certs-section" style="border-left: 3px solid #8b5cf6; margin-top:0;">
            <div class="dmc-section-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0;">
              <span><i data-lucide="building-2" style="width:14px; height:14px; vertical-align:middle; margin-right:4px; color:#8b5cf6;"></i> Propiedad Horizontal (${tramitesPh.length})</span>
              <span class="dmc-cert-badge" style="background:${phColor}20; color:${phColor}; border:1px solid ${phColor}50; text-transform:none;">
                ${p.estado_ph || 'En trámite'}
              </span>
            </div>
            <div class="dmc-certs-list">
              ${tramitesPh.map((t, idx) => `
                <div class="dmc-cert-card" style="border-color:rgba(139,92,246,0.25);">
                  <div class="dmc-cert-top">
                    <span class="dmc-cert-num">#${idx + 1} &bull; ${t.expediente || t.licencia || 'Expediente PH'}</span>
                    <span class="dmc-cert-badge" style="background:${t.estado === 'PENDIENTE' ? '#f59e0b' : t.estado === 'TRAMITE ANULADO' ? '#ef4444' : '#8b5cf6'}20; color:${t.estado === 'PENDIENTE' ? '#fbbf24' : t.estado === 'TRAMITE ANULADO' ? '#f87171' : '#a78bfa'}; border:1px solid currentColor;">${t.estado}</span>
                  </div>
                  <div class="dmc-cert-grid">
                    ${t.licencia ? `<span><strong>Licencia PH:</strong> ${t.licencia}</span>` : ''}
                    <span><strong>Fecha Inicio:</strong> ${t.fecha_inicio || 'N/A'}</span>
                    ${t.estado_flujo ? `<span><strong>Estado Flujo:</strong> ${t.estado_flujo}</span>` : ''}
                    ${t.dias_ejecucion ? `<span><strong>Días Ejecución:</strong> ${t.dias_ejecucion} d</span>` : ''}
                    ${t.ad_zonal ? `<span><strong>Ad. Zonal:</strong> ${t.ad_zonal.replace('Administración Zonal ', 'AZ ')}</span>` : ''}
                    ${t.profesional ? `<span><strong>Profesional:</strong> ${t.profesional}</span>` : ''}
                  </div>
                  ${t.detalle ? `
                    <div style="margin-top:6px; font-size:0.75rem; color:#94a3b8; background:rgba(255,255,255,0.03); padding:6px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.05); line-height:1.35;">
                      <strong style="color:#cbd5e1;">Unidades / Destinos:</strong> ${t.detalle}
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  card.innerHTML = `
    <div class="dmc-header">
      <div class="dmc-title-group">
        <h2>Predio N° ${p.predio}</h2>
        <span>${p.tipo_licencia} &bull; ${p.tipo_proyecto || 'General'}${p.tiene_ph ? ` &bull; <strong style="color:${phColor};">PH: ${p.estado_ph || 'Sí'}</strong>` : ''}</span>
      </div>
      <button class="icon-btn" onclick="closePredioModal()"><i data-lucide="x"></i></button>
    </div>
    <div class="dmc-body">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap; margin-bottom: 4px;">
        <div>
          <h4 style="font-family: var(--font-heading); font-size: 1.15rem; color: #fff; margin-bottom: 4px;">
            ${p.nombre_proyecto || 'Sin Nombre Registrado'}
          </h4>
          <p style="color: #94a3b8; font-size: 0.85rem;">Parroquia: <strong style="color: #fff;">${p.parroquia || 'N/A'}</strong></p>
        </div>
        ${hasMultipleTabs ? `<div style="font-size:0.75rem; color:#38bdf8; font-weight:600; padding:4px 9px; border-radius:6px; background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.25); display:inline-flex; align-items:center; gap:5px;"><i data-lucide="layers" style="width:12px; height:12px;"></i> ${trazabilidad.length} licencias/trámites</div>` : ''}
      </div>

      ${tabsNavHtml}
      ${panesHtml}

      <div class="dmc-section-title">Datos Catastrales y Geográficos</div>
      <div class="dmc-grid">
        <div class="dmc-field"><span class="dmc-lbl">Clave Catastral:</span><span class="dmc-val">${p.clave_catastral || 'N/A'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Parroquia:</span><span class="dmc-val">${p.parroquia || 'N/A'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Tipo de Proyecto:</span><span class="dmc-val" style="font-weight:700; color:${p.tipo_proyecto === 'NUEVO' ? '#10b981' : p.tipo_proyecto === 'AMPLIATORIO' ? '#f59e0b' : p.tipo_proyecto === 'MODIFICATORIO' ? '#8b5cf6' : p.tipo_proyecto === 'MOD / AMP' ? '#06b6d4' : '#94a3b8'}">${p.tipo_proyecto || 'No especificado'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Propiedad Horizontal:</span><span class="dmc-val" style="font-weight:700; color:${p.tiene_ph ? phColor : '#64748b'};">${p.tiene_ph ? `Sí &bull; ${p.estado_ph || 'En trámite'}` : 'No registra trámite'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Área Bruta:</span><span class="dmc-val">${p.area_bruta ? formatArea(p.area_bruta) : 'N/A'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Coordenadas WGS84:</span><span class="dmc-val">${p.lat ? p.lat.toFixed(5) : '0'}, ${p.lng ? p.lng.toFixed(5) : '0'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Tiempo Transición (EC&rarr;AZ):</span><span class="dmc-val" style="color:#f59e0b">${p.dias_transicion ? p.dias_transicion + ' días' : 'Directo / No registrado'}</span></div>
      </div>
    </div>
    <div class="dmc-footer">
      <button class="btn btn-primary" onclick="locatePredioOnMap('${p.predio}')">
        <i data-lucide="map-pin"></i> Centrar en Mapa
      </button>
      <button class="btn btn-secondary" onclick="closePredioModal()">Cerrar</button>
    </div>
  `;

  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
};


window.closePredioModal = function () {
  document.getElementById('detail-modal-overlay').classList.add('hidden');
};

/**
 * Centrar el mapa en un predio
 */
window.locatePredioOnMap = function (predioNum) {
  closePredioModal();
  document.getElementById('data-drawer-overlay').classList.add('hidden');

  const p = state.rawProjects.find(item => item.predio == predioNum);
  if (!p) return;

  // Calcular mejor coordenada: centroide del polígono si existe, si no lat/lng
  let centerLng = p.lng;
  let centerLat = p.lat;
  if (p.geom) {
    const centroid = polygonCentroid(p.geom);
    if (centroid && isWithinQuitoBounds(centroid.lat, centroid.lng)) {
      centerLng = centroid.lng;
      centerLat = centroid.lat;
    }
  }

  if (!centerLat || !centerLng || !isWithinQuitoBounds(centerLat, centerLng)) {
    console.warn(`[Mapa] Predio ${predioNum} sin coordenadas válidas en el DMQ`);
    return;
  }

  state.map.flyTo({
    center: [centerLng, centerLat],
    zoom: 17,
    speed: 1.8,
    curve: 1.2,
    essential: true
  });

  setTimeout(() => {
    showPredioPopup(p, [centerLng, centerLat]);
  }, 1000);
};

function normStr(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Aplicar Filtros Reactivos
 */
function applyFilters() {
  state.filteredProjects = state.rawProjects.filter(p => {
    // 1. Licencia
    if (state.filters.licencia !== 'all' && p.tipo_licencia !== state.filters.licencia) {
      return false;
    }

    // 2. Fase
    if (state.filters.fase !== 'all') {
      if (state.filters.fase === 'funnel') {
        if (!(p.in_ec && p.in_az && p.in_amc)) return false;
      } else {
        const targetPhase = parseInt(state.filters.fase);
        if (p.fase !== targetPhase) return false;
      }
    }

    // 3. Tipo de Proyecto & Propiedad Horizontal (multi-checklist)
    if (state.filters.tipo !== 'all' && state.filters.tipo.length > 0) {
      const match = state.filters.tipo.some(v => {
        if (v === 'PROPIEDAD_HORIZONTAL') {
          return p.tiene_ph === true;
        }
        if (v === 'SIN_DATO') {
          return !p.tipo_proyecto || p.tipo_proyecto.trim() === '';
        }
        return p.tipo_proyecto === v;
      });
      if (!match) return false;
    }

    // 3. Zonal (multi-checklist — array o 'all')
    if (state.filters.zonal !== 'all' && state.filters.zonal.length > 0) {
      const projectZonal = normStr(p.ad_zonal);
      const match = state.filters.zonal.some(v => {
        const t = normStr(v);
        return projectZonal.includes(t) || t.includes(projectZonal);
      });
      if (!match) return false;
    }

    // 4. Entidad Colaboradora (multi-checklist)
    if (state.filters.entidad !== 'all' && state.filters.entidad.length > 0) {
      const projectEntidad = normStr(p.entidad_colaboradora);
      const match = state.filters.entidad.some(v => {
        const t = normStr(v);
        return projectEntidad.includes(t) || t.includes(projectEntidad);
      });
      if (!match) return false;
    }

    // 5. Año (multi-checklist)
    if (state.filters.anio !== 'all' && state.filters.anio.length > 0) {
      if (!state.filters.anio.includes(String(p.year))) return false;
    }

    // 6. Buscador de texto
    if (state.filters.query) {
      const q = normStr(state.filters.query);
      const matchPredio = String(p.predio).toLowerCase().includes(q);
      const matchProj = normStr(p.nombre_proyecto).includes(q);
      if (!matchPredio && !matchProj) return false;
    }

    return true;
  });

  state.pagination.page = 1;
  updateKpiCards();
  updateMapSource();
  initOrUpdateCharts();
  populateTable();
}

/**
 * Actualizar Tarjetas KPI Superiores (100% concordancia con el mapa y la leyenda)
 */
function updateKpiCards() {
  const current = state.filteredProjects;
  const total = current.length;

  // Predios en cada estado/fase actual (idéntico al mapa)
  const f1Stayed = current.filter(p => p.fase === 1).length;
  const f2Stayed = current.filter(p => p.fase === 2).length;
  const f3Stayed = current.filter(p => p.fase === 3).length;

  // Totales acumulados
  const f1Total = current.filter(p => p.in_ec).length;
  const f2Total = current.filter(p => p.in_az).length;
  const f3Total = current.filter(p => p.in_amc).length;
  const fullFunnel = current.filter(p => p.in_ec && p.in_az && p.in_amc).length;

  // Días de transición
  const transDays = current.filter(p => p.dias_transicion !== null).map(p => p.dias_transicion);
  const avgDays = transDays.length > 0
    ? Math.round(transDays.reduce((a, b) => a + b, 0) / transDays.length)
    : 195;

  const pctF1 = total > 0 ? ((f1Stayed * 100) / total).toFixed(1) : 0;
  const pctF2 = total > 0 ? ((f2Stayed * 100) / total).toFixed(1) : 0;
  const pctF3 = total > 0 ? ((f3Stayed * 100) / total).toFixed(1) : 0;
  const pctFull = f1Total > 0 ? ((fullFunnel * 100) / f1Total).toFixed(2) : '0.00';

  // Certificados y Licencias totales emitidas
  const totalAmcCerts = current.reduce((sum, p) => sum + (p.total_certificados_amc || (p.certificados_amc ? p.certificados_amc.length : (p.in_amc ? 1 : 0))), 0);
  const totalEcCerts = current.reduce((sum, p) => sum + (p.total_certificados_ec || (p.certificados_ec ? p.certificados_ec.length : (p.in_ec ? 1 : 0))), 0);
  const totalAzLics = current.reduce((sum, p) => sum + (p.total_licencias_az || (p.licencias_az ? p.licencias_az.length : (p.in_az ? 1 : 0))), 0);

  // Tarjetas Superiores (Flujo Acumulado que ingresó a cada etapa)
  document.getElementById('kpi-val-total').textContent = total.toLocaleString();

  document.getElementById('kpi-val-fase1').innerHTML = `${totalEcCerts.toLocaleString()} <small style="font-size:0.75rem; font-weight:600; color:#cbd5e1;">certificados</small>`;
  document.getElementById('kpi-sub-fase1').textContent = `${f1Total.toLocaleString()} predios únicos (${f1Stayed.toLocaleString()} detenidos en EC)`;

  document.getElementById('kpi-val-fase2').innerHTML = `${totalAzLics.toLocaleString()} <small style="font-size:0.75rem; font-weight:600; color:#cbd5e1;">licencias</small>`;
  document.getElementById('kpi-sub-fase2').textContent = `${f2Total.toLocaleString()} predios únicos (${pctF2}% avance a Fase 2)`;

  document.getElementById('kpi-val-fase3').innerHTML = `${totalAmcCerts.toLocaleString()} <small style="font-size:0.75rem; font-weight:600; color:#cbd5e1;">certificados</small>`;
  document.getElementById('kpi-sub-fase3').textContent = `${f3Total.toLocaleString()} predios únicos (${fullFunnel.toLocaleString()} ciclo completo \u2022 ${pctFull}%)`;

  document.getElementById('kpi-val-tiempo').innerHTML = `${avgDays} <small>días</small>`;

  // Conteo en Leyenda del Mapa (Estado territorial actual)
  document.getElementById('leg-count-f1').textContent = f1Stayed.toLocaleString();
  document.getElementById('leg-count-f2').textContent = f2Stayed.toLocaleString();
  document.getElementById('leg-count-f3').textContent = f3Stayed.toLocaleString();

  // Pool contextual para badges de Fase (excluye solo el filtro de fase)
  const poolParaFase = state.rawProjects.filter(p => {
    if (state.filters.licencia !== 'all' && p.tipo_licencia !== state.filters.licencia) return false;
    if (state.filters.tipo !== 'all' && state.filters.tipo.length > 0) {
      const match = state.filters.tipo.some(v => {
        if (v === 'PROPIEDAD_HORIZONTAL') return p.tiene_ph === true;
        if (v === 'SIN_DATO') return !p.tipo_proyecto || p.tipo_proyecto.trim() === '';
        return p.tipo_proyecto === v;
      });
      if (!match) return false;
    }
    if (state.filters.zonal !== 'all' && state.filters.zonal.length > 0) {
      const pZonal = normStr(p.ad_zonal);
      if (!state.filters.zonal.some(v => { const t = normStr(v); return pZonal.includes(t) || t.includes(pZonal); })) return false;
    }
    if (state.filters.entidad !== 'all' && state.filters.entidad.length > 0) {
      const pEnt = normStr(p.entidad_colaboradora);
      if (!state.filters.entidad.some(v => { const t = normStr(v); return pEnt.includes(t) || t.includes(pEnt); })) return false;
    }
    if (state.filters.anio !== 'all' && state.filters.anio.length > 0) {
      if (!state.filters.anio.includes(String(p.year))) return false;
    }
    if (state.filters.query) {
      const q = normStr(state.filters.query);
      if (!String(p.predio).toLowerCase().includes(q) && !normStr(p.nombre_proyecto).includes(q)) return false;
    }
    return true;
  });

  // Actualizar badges en la barra lateral de filtros (Fases del Flujo)
  const elFaseAll = document.getElementById('badge-fase-all');
  if (elFaseAll) elFaseAll.textContent = poolParaFase.length.toLocaleString();
  const elFase1 = document.getElementById('badge-fase-1');
  if (elFase1) elFase1.textContent = poolParaFase.filter(p => p.fase === 1).length.toLocaleString();
  const elFase2 = document.getElementById('badge-fase-2');
  if (elFase2) elFase2.textContent = poolParaFase.filter(p => p.fase === 2).length.toLocaleString();
  const elFase3 = document.getElementById('badge-fase-3');
  if (elFase3) elFase3.textContent = poolParaFase.filter(p => p.fase === 3).length.toLocaleString();
  const elFaseFunnel = document.getElementById('badge-fase-funnel');
  if (elFaseFunnel) elFaseFunnel.textContent = poolParaFase.filter(p => p.in_ec && p.in_az && p.in_amc).length.toLocaleString();
  const elLicLmu20 = document.getElementById('badge-filter-lic-lmu20');
  if (elLicLmu20) elLicLmu20.textContent = poolParaFase.length.toLocaleString();

  // Pool contextual para badges de Tipo de Proyecto (excluye solo el filtro de tipo de proyecto)
  // De esta manera, si se selecciona Fase 1, se muestran los proyectos de cada tipo en Fase 1
  const poolParaTipo = state.rawProjects.filter(p => {
    if (state.filters.licencia !== 'all' && p.tipo_licencia !== state.filters.licencia) return false;
    if (state.filters.fase !== 'all') {
      if (state.filters.fase === 'funnel') {
        if (!(p.in_ec && p.in_az && p.in_amc)) return false;
      } else {
        if (p.fase !== parseInt(state.filters.fase)) return false;
      }
    }
    if (state.filters.zonal !== 'all' && state.filters.zonal.length > 0) {
      const pZonal = normStr(p.ad_zonal);
      if (!state.filters.zonal.some(v => { const t = normStr(v); return pZonal.includes(t) || t.includes(pZonal); })) return false;
    }
    if (state.filters.entidad !== 'all' && state.filters.entidad.length > 0) {
      const pEnt = normStr(p.entidad_colaboradora);
      if (!state.filters.entidad.some(v => { const t = normStr(v); return pEnt.includes(t) || t.includes(pEnt); })) return false;
    }
    if (state.filters.anio !== 'all' && state.filters.anio.length > 0) {
      if (!state.filters.anio.includes(String(p.year))) return false;
    }
    if (state.filters.query) {
      const q = normStr(state.filters.query);
      if (!String(p.predio).toLowerCase().includes(q) && !normStr(p.nombre_proyecto).includes(q)) return false;
    }
    return true;
  });

  // Badges checklist Tipo de Proyecto y PH reactivos a la fase activa
  const elTipoNuevo = document.getElementById('badge-tipo-nuevo');
  if (elTipoNuevo) elTipoNuevo.textContent = poolParaTipo.filter(p => p.tipo_proyecto === 'NUEVO').length.toLocaleString();
  const elTipoAmp = document.getElementById('badge-tipo-amp');
  if (elTipoAmp) elTipoAmp.textContent = poolParaTipo.filter(p => p.tipo_proyecto === 'AMPLIATORIO').length.toLocaleString();
  const elTipoMod = document.getElementById('badge-tipo-mod');
  if (elTipoMod) elTipoMod.textContent = poolParaTipo.filter(p => p.tipo_proyecto === 'MODIFICATORIO').length.toLocaleString();
  const elTipoModAmp = document.getElementById('badge-tipo-modamp');
  if (elTipoModAmp) elTipoModAmp.textContent = poolParaTipo.filter(p => p.tipo_proyecto === 'MOD / AMP' || p.tipo_proyecto === 'MOD/AMP').length.toLocaleString();
  const elTipoSinDato = document.getElementById('badge-tipo-sindato');
  if (elTipoSinDato) elTipoSinDato.textContent = poolParaTipo.filter(p => !p.tipo_proyecto || p.tipo_proyecto.trim() === '').length.toLocaleString();
  const elTipoPh = document.getElementById('badge-tipo-ph');
  if (elTipoPh) elTipoPh.textContent = poolParaTipo.filter(p => p.tiene_ph === true).length.toLocaleString();

  // Actualizar indicadores de filtros activos (LMU 20 es el alcance base)
  let activeFilterCount = 0;
  if (state.filters.licencia !== 'all' && state.filters.licencia !== 'LMU 20') activeFilterCount++;
  if (state.filters.fase !== 'all') activeFilterCount++;
  if (state.filters.tipo !== 'all' && state.filters.tipo.length > 0) activeFilterCount++;
  if (state.filters.zonal !== 'all' && state.filters.zonal.length > 0) activeFilterCount++;
  if (state.filters.entidad !== 'all' && state.filters.entidad.length > 0) activeFilterCount++;
  if (state.filters.anio !== 'all' && state.filters.anio.length > 0) activeFilterCount++;

  const headerBadge = document.getElementById('header-filter-badge');
  const reopenBadge = document.getElementById('reopen-filter-badge');
  if (headerBadge) {
    headerBadge.textContent = activeFilterCount;
    headerBadge.classList.toggle('hidden', activeFilterCount === 0);
  }
  if (reopenBadge) {
    reopenBadge.textContent = activeFilterCount;
    reopenBadge.classList.toggle('hidden', activeFilterCount === 0);
  }

  const countLabel = document.getElementById('legend-count-label');
  if (countLabel) {
    countLabel.textContent = `${total.toLocaleString()} predios`;
  }
}

/**
 * Centrar el mapa automáticamente en los predios filtrados
 */
function zoomToFilteredProjects() {
  if (!state.map || state.filteredProjects.length === 0) return;
  const bounds = new mapboxgl.LngLatBounds();
  let count = 0;
  for (const p of state.filteredProjects) {
    if (p.lng && p.lat && p.lng > -79.5 && p.lng < -77.5 && p.lat > -1.0 && p.lat < 1.0) {
      bounds.extend([p.lng, p.lat]);
      count++;
    }
  }
  if (count > 0) {
    const sidebar = document.getElementById('analytics-sidebar');
    const isCollapsed = sidebar && sidebar.classList.contains('collapsed');
    state.map.fitBounds(bounds, {
      padding: { top: 60, bottom: 60, left: 60, right: isCollapsed ? 60 : 380 },
      maxZoom: 15.5,
      duration: 1200
    });
  }
}

/**
 * Gráficos Dinámicos con Chart.js
 */
function initOrUpdateCharts() {
  const data = state.filteredProjects;

  // Chart Global Defaults for Dark Theme
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";

  // --- 1. Funnel / Stage Transition Chart ---
  const f1Total = data.filter(p => p.in_ec).length;
  const f1ToF2 = data.filter(p => p.in_ec && p.in_az).length;
  const f1Stayed = f1Total - f1ToF2;
  const f2Total = data.filter(p => p.in_az).length;
  const f2ToF3 = data.filter(p => p.in_az && p.in_amc).length;
  const f2Stayed = f2Total - f2ToF3;
  const f3Total = data.filter(p => p.in_amc).length;
  const fullFunnel = data.filter(p => p.in_ec && p.in_az && p.in_amc).length;

  document.getElementById('stat-tasa-az').textContent = f1Total > 0 ? `${(f1ToF2 * 100 / f1Total).toFixed(1)}%` : '0%';
  document.getElementById('stat-tasa-amc').textContent = f2Total > 0 ? `${(f2ToF3 * 100 / f2Total).toFixed(1)}%` : '0%';

  const elTasaEcAmc = document.getElementById('stat-tasa-ec-amc');
  if (elTasaEcAmc) {
    const tasaEcAmc = f1Total > 0 ? (fullFunnel * 100 / f1Total).toFixed(2) : '0.00';
    elTasaEcAmc.textContent = `${tasaEcAmc}%`;
  }
  const elSubEcAmc = document.getElementById('stat-sub-ec-amc');
  if (elSubEcAmc) {
    elSubEcAmc.textContent = `${fullFunnel.toLocaleString()} de ${f1Total.toLocaleString()} proyectos`;
  }

  const ctxFunnel = document.getElementById('chart-funnel').getContext('2d');
  if (state.charts.funnel) state.charts.funnel.destroy();
  state.charts.funnel = new Chart(ctxFunnel, {
    type: 'bar',
    data: {
      labels: ['Fase 1 (EC)', 'Pasaron a AZ', 'Se quedaron F1', 'Fase 2 (AZ)', 'Pasaron a AMC', 'Fase 3 (AMC)'],
      datasets: [{
        label: 'Predios',
        data: [f1Total, f1ToF2, f1Stayed, f2Total, f2ToF3, f3Total],
        backgroundColor: [
          '#06b6d4',
          '#38bdf8',
          '#f43f5e',
          '#f59e0b',
          '#10b981',
          '#059669'
        ],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } }
      }
    }
  });

  // --- 2. Emissions By Year Chart ---
  const years = ['2023', '2024', '2025', '2026'];
  const yDataF1 = years.map(y => data.filter(p => p.in_ec && p.year == y).length);
  const yDataF2 = years.map(y => data.filter(p => p.in_az && p.year == y).length);
  const yDataF3 = years.map(y => data.filter(p => p.in_amc && p.year == y).length);

  const ctxYears = document.getElementById('chart-years').getContext('2d');
  if (state.charts.years) state.charts.years.destroy();
  state.charts.years = new Chart(ctxYears, {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        { label: 'Fase 1 (EC)', data: yDataF1, backgroundColor: '#06b6d4', borderRadius: 4 },
        { label: 'Fase 2 (AZ)', data: yDataF2, backgroundColor: '#f59e0b', borderRadius: 4 },
        { label: 'Fase 3 (AMC)', data: yDataF3, backgroundColor: '#10b981', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12 } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } }
      }
    }
  });

  // --- 3. Zonal Administration Participation ---
  const zonalCounts = {};
  data.forEach(p => {
    if (p.ad_zonal) {
      zonalCounts[p.ad_zonal] = (zonalCounts[p.ad_zonal] || 0) + 1;
    }
  });

  const sortedZonales = Object.entries(zonalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const zLabels = sortedZonales.map(z => z[0].replace('Administración Zonal ', 'AZ '));
  const zValues = sortedZonales.map(z => z[1]);

  const ctxZonales = document.getElementById('chart-zonales').getContext('2d');
  if (state.charts.zonales) state.charts.zonales.destroy();
  state.charts.zonales = new Chart(ctxZonales, {
    type: 'bar',
    data: {
      labels: zLabels,
      datasets: [{
        label: 'Proyectos',
        data: zValues,
        backgroundColor: '#38bdf8',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        y: { grid: { display: false } }
      }
    }
  });

  // --- 4. Collaborative Entities Donut ---
  const caCount = data.filter(p => p.entidad_colaboradora === 'Entidad Colaboradora CAE-P' || p.entidad_colaboradora === 'Colegio de Arquitectos').length;
  const desCount = data.filter(p => p.entidad_colaboradora === 'Desintecsa').length;

  const ctxEntidades = document.getElementById('chart-entidades').getContext('2d');
  if (state.charts.entidades) state.charts.entidades.destroy();
  state.charts.entidades = new Chart(ctxEntidades, {
    type: 'doughnut',
    data: {
      labels: ['Entidad Colaboradora CAE-P', 'Desintecsa'],
      datasets: [{
        data: [caCount, desCount],
        backgroundColor: ['#0284c7', '#f59e0b'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } }
      },
      cutout: '68%'
    }
  });

  // --- 5. Transition Time Range Distribution ---
  const ranges = {
    '0 - 30 d': 0,
    '31 - 90 d': 0,
    '91 - 180 d': 0,
    '181 - 365 d': 0,
    '> 1 año': 0
  };

  data.forEach(p => {
    if (p.dias_transicion !== null && p.dias_transicion !== undefined) {
      const d = p.dias_transicion;
      if (d <= 30) ranges['0 - 30 d']++;
      else if (d <= 90) ranges['31 - 90 d']++;
      else if (d <= 180) ranges['91 - 180 d']++;
      else if (d <= 365) ranges['181 - 365 d']++;
      else ranges['> 1 año']++;
    }
  });

  const ctxTiempos = document.getElementById('chart-tiempos').getContext('2d');
  if (state.charts.tiempos) state.charts.tiempos.destroy();
  state.charts.tiempos = new Chart(ctxTiempos, {
    type: 'bar',
    data: {
      labels: Object.keys(ranges),
      datasets: [{
        label: 'Proyectos',
        data: Object.values(ranges),
        backgroundColor: '#8b5cf6',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } }
      }
    }
  });
}

/**
 * Llenar tabla de datos detallada
 */
function populateTable() {
  const tbody = document.getElementById('table-tbody');
  const countLabel = document.getElementById('table-record-count-label');
  const pageInfo = document.getElementById('pagination-info');

  const total = state.filteredProjects.length;
  countLabel.textContent = `Mostrando ${total.toLocaleString()} proyectos`;

  const totalPages = Math.ceil(total / state.pagination.perPage) || 1;
  const start = (state.pagination.page - 1) * state.pagination.perPage;
  const pageItems = state.filteredProjects.slice(start, start + state.pagination.perPage);

  pageInfo.textContent = `Página ${state.pagination.page} de ${totalPages}`;
  document.getElementById('prev-page-btn').disabled = state.pagination.page <= 1;
  document.getElementById('next-page-btn').disabled = state.pagination.page >= totalPages;

  let html = '';
  pageItems.forEach(p => {
    const faseBadge = p.fase === 3
      ? '<span style="color:#10b981; font-weight:700">Fase 3: AMC</span>'
      : (p.fase === 2
        ? '<span style="color:#f59e0b; font-weight:700">Fase 2: AZ</span>'
        : '<span style="color:#38bdf8; font-weight:700">Fase 1: EC</span>');

    html += `
      <tr>
        <td><a class="table-predio-link" onclick="locatePredioOnMap('${p.predio}')">${p.predio}</a></td>
        <td>${faseBadge}</td>
        <td><span style="font-weight:600">${p.tipo_licencia}</span></td>
        <td><span style="font-size:0.75rem; font-weight:700; color:${p.tipo_proyecto === 'NUEVO' ? '#10b981' : p.tipo_proyecto === 'AMPLIATORIO' ? '#f59e0b' : p.tipo_proyecto === 'MODIFICATORIO' ? '#8b5cf6' : p.tipo_proyecto === 'MOD / AMP' ? '#06b6d4' : '#64748b'}">${p.tipo_proyecto || '-'}</span></td>
        <td style="max-width:240px; overflow:hidden; text-overflow:ellipsis" title="${p.nombre_proyecto}">
          ${p.nombre_proyecto || 'S/N'}
          ${p.tiene_ph ? `<span title="Propiedad Horizontal: ${p.estado_ph || 'En trámite'}" style="display:inline-block; margin-left:6px; font-size:0.65rem; padding:1px 5px; border-radius:3px; background:rgba(139,92,246,0.15); color:${p.estado_ph === 'PENDIENTE' ? '#fbbf24' : p.estado_ph === 'TRAMITE ANULADO' ? '#f87171' : '#a78bfa'}; border:1px solid rgba(139,92,246,0.35); font-weight:700; vertical-align:middle;">🏢 PH: ${p.estado_ph || 'Sí'}</span>` : ''}
        </td>
        <td>${p.ad_zonal ? p.ad_zonal.replace('Administración Zonal ', 'AZ ') : '-'}</td>
        <td>${p.parroquia || '-'}</td>
        <td>${p.entidad_colaboradora || '-'}</td>
        <td>${p.fecha_emision_ec || '-'}</td>
        <td>${p.fecha_inicio_az || '-'}</td>
        <td>${p.fecha_emision_az || '-'}</td>
        <td>${p.dias_transicion !== null ? p.dias_transicion + ' d' : '-'}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openPredioModal('${p.predio}')">Ver</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Exportar proyectos filtrados a CSV
 */
function exportFilteredToCSV() {
  if (state.filteredProjects.length === 0) {
    alert('No hay datos para exportar con los filtros actuales.');
    return;
  }

  const headers = [
    'Predio', 'Fase', 'Tipo_Licencia', 'Tipo_Proyecto', 'Propiedad_Horizontal', 'Estado_PH', 'Proyecto',
    'Adm_Zonal', 'Parroquia', 'Entidad_Colaboradora', 'Clave_Catastral',
    'Fecha_Emision_EC', 'Fecha_Inicio_AZ', 'Fecha_Emision_AZ', 'Dias_Transicion',
    'Dias_Ejecucion_AZ', 'AMC_Certificado', 'AMC_Resultado', 'Area_Bruta', 'Latitud', 'Longitud'
  ];

  const rows = state.filteredProjects.map(p => [
    `"${p.predio}"`,
    p.fase,
    `"${p.tipo_licencia}"`,
    `"${p.tipo_proyecto || ''}"`,
    p.tiene_ph ? '"SÍ"' : '"NO"',
    `"${p.estado_ph || ''}"`,
    `"${(p.nombre_proyecto || '').replace(/"/g, '""')}"`,
    `"${p.ad_zonal || ''}"`,
    `"${p.parroquia || ''}"`,
    `"${p.entidad_colaboradora || ''}"`,
    `"${p.clave_catastral || ''}"`,
    `"${p.fecha_emision_ec || ''}"`,
    `"${p.fecha_inicio_az || ''}"`,
    `"${p.fecha_emision_az || ''}"`,
    p.dias_transicion !== null ? p.dias_transicion : '',
    p.dias_ejecucion_az !== null ? p.dias_ejecucion_az : '',
    `"${p.amc_registro || ''}"`,
    `"${p.amc_resultado || ''}"`,
    p.area_bruta || 0,
    p.lat || '',
    p.lng || ''
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Monitoreo_Licencias_DMQ_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Configurar eventos del usuario
 */
function setupEventListeners() {
  // 1. License Type Filter Pills
  document.querySelectorAll('#pill-licencia .pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pill-licencia .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.licencia = btn.getAttribute('data-filter');
      applyFilters();
    });
  });

  // 2. Flow Phase Filter Pills
  document.querySelectorAll('#pill-fase .pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pill-fase .pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.fase = btn.getAttribute('data-fase');
      applyFilters();
    });
  });

  // 3. Checklist filters (Zonal, Entidad, Año)
  function setupChecklistFilter(group, onChangeCallback) {
    const listEl = document.getElementById(`cl-${group}-list`);
    const toggleEl = listEl ? listEl.previousElementSibling : null;
    const labelEl = document.getElementById(`cl-${group}-label`);
    const allCb = listEl ? listEl.querySelector('.cl-all') : null;
    const options = listEl ? [...listEl.querySelectorAll(`.cl-option[data-group="${group}"]`)] : [];

    if (!listEl || !toggleEl) return;

    // Open/close dropdown
    toggleEl.addEventListener('click', () => {
      const expanded = toggleEl.getAttribute('aria-expanded') === 'true';
      // Close all other checklists first
      document.querySelectorAll('.checklist-toggle[aria-expanded="true"]').forEach(btn => {
        if (btn !== toggleEl) {
          btn.setAttribute('aria-expanded', 'false');
          btn.nextElementSibling.classList.add('hidden');
        }
      });
      toggleEl.setAttribute('aria-expanded', String(!expanded));
      listEl.classList.toggle('hidden', expanded);
    });

    // "Todas" checkbox
    allCb.addEventListener('change', () => {
      if (allCb.checked) {
        options.forEach(cb => { cb.checked = false; });
      }
      syncState();
    });

    // Individual options
    options.forEach(cb => {
      cb.addEventListener('change', () => {
        if (options.some(c => c.checked)) {
          allCb.checked = false;
        } else {
          allCb.checked = true;
        }
        syncState();
      });
    });

    function syncState() {
      const selected = options.filter(c => c.checked).map(c => c.value);
      const isAll = selected.length === 0;

      if (isAll) {
        allCb.checked = true;
        state.filters[group] = 'all';
        labelEl.textContent = labelDefaults[group];
        toggleEl.classList.remove('has-selection');
      } else {
        state.filters[group] = selected;
        // Build compact label
        if (selected.length === 1) {
          // Show short label (strip prefix like "Administración Zonal ")
          const optMatch = options.find(c => c.value === selected[0]);
          const text = optMatch?.nextElementSibling?.textContent || selected[0];
          labelEl.textContent = text.trim();
        } else {
          labelEl.textContent = `${selected.length} seleccionados`;
        }
        toggleEl.classList.add('has-selection');
      }

      onChangeCallback();
    }

    // Reset function stored on element for use in global reset
    toggleEl._reset = () => {
      options.forEach(cb => { cb.checked = false; });
      allCb.checked = true;
      state.filters[group] = 'all';
      labelEl.textContent = labelDefaults[group];
      toggleEl.classList.remove('has-selection');
      listEl.classList.add('hidden');
      toggleEl.setAttribute('aria-expanded', 'false');
    };
  }

  const labelDefaults = {
    tipo: 'Todos los Tipos',
    zonal: 'Todas las Adm. Zonales',
    entidad: 'Todas las Entidades',
    anio: 'Todos los Años',
  };

  setupChecklistFilter('tipo', applyFilters);
  setupChecklistFilter('zonal', () => {
    applyFilters();
    if (state.filters.zonal !== 'all' && state.filters.zonal.length > 0) {
      zoomToFilteredProjects();
    }
  });
  setupChecklistFilter('entidad', applyFilters);
  setupChecklistFilter('anio', applyFilters);

  // Close checklists when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.checklist-filter')) {
      document.querySelectorAll('.checklist-toggle[aria-expanded="true"]').forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
        btn.nextElementSibling.classList.add('hidden');
      });
    }
  });

  // 4. Reset Filters
  document.getElementById('reset-filters-btn').addEventListener('click', () => {
    state.filters = {
      licencia: 'LMU 20',
      fase: 'all',
      tipo: 'all',
      zonal: 'all',
      entidad: 'all',
      anio: 'all',
      query: ''
    };
    document.querySelectorAll('#pill-licencia .pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-filter') === 'LMU 20'));
    document.querySelectorAll('#pill-fase .pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-fase') === 'all'));
    // Reset checklists
    ['tipo', 'zonal', 'entidad', 'anio'].forEach(group => {
      const toggle = document.querySelector(`#cl-${group} .checklist-toggle`);
      if (toggle && toggle._reset) toggle._reset();
    });
    document.getElementById('global-search-input').value = '';
    document.getElementById('clear-search-btn').classList.add('hidden');
    applyFilters();
    if (state.map) {
      state.map.flyTo({ center: [-78.485, -0.180], zoom: 11.2, duration: 1000 });
    }
  });

  // 5. Global Search Input & Autocomplete
  const searchInput = document.getElementById('global-search-input');
  const clearBtn = document.getElementById('clear-search-btn');
  const dropdown = document.getElementById('search-autocomplete-dropdown');

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearBtn.classList.toggle('hidden', val === '');
    state.filters.query = val;

    if (val.length >= 2) {
      const q = val.toLowerCase();
      const matches = state.rawProjects
        .filter(p => String(p.predio).includes(q) || (p.nombre_proyecto || '').toLowerCase().includes(q))
        .slice(0, 8);

      if (matches.length > 0) {
        let html = '';
        matches.forEach(m => {
          html += `
            <div class="search-item" onclick="locatePredioOnMap('${m.predio}'); document.getElementById('search-autocomplete-dropdown').classList.add('hidden')">
              <div class="search-item-left">
                <span class="search-item-predio">Predio ${m.predio}</span>
                <span class="search-item-title">${m.nombre_proyecto || 'Sin nombre'}</span>
              </div>
              <span class="search-item-phase" style="background: ${m.fase === 3 ? 'rgba(16, 185, 129, 0.2)' : (m.fase === 2 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(6, 182, 212, 0.2)')}">
                Fase ${m.fase}
              </span>
            </div>
          `;
        });
        dropdown.innerHTML = html;
        dropdown.classList.remove('hidden');
      } else {
        dropdown.classList.add('hidden');
      }
    } else {
      dropdown.classList.add('hidden');
    }

    applyFilters();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    dropdown.classList.add('hidden');
    state.filters.query = '';
    applyFilters();
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.header-search')) {
      dropdown.classList.add('hidden');
    }
  });

  // 6. Map Style Buttons
  document.querySelectorAll('.map-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-style-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const styleUrl = btn.getAttribute('data-style');
      if (state.map) {
        state.map.setStyle(styleUrl);
        state.map.once('style.load', () => {
          setupMapLayers();
          updateMapSource();
          const toggleZonalesBtn = document.getElementById('toggle-zonales-btn');
          const isZonalVisible = toggleZonalesBtn ? toggleZonalesBtn.checked : false;
          const visibility = isZonalVisible ? 'visible' : 'none';
          ['zonas-fill', 'zonas-border', 'zonas-labels'].forEach(layerId => {
            if (state.map.getLayer(layerId)) {
              state.map.setLayoutProperty(layerId, 'visibility', visibility);
            }
          });
        });
      }
    });
  });

  // 6.1 Toggle Capa Límites Zonales
  const toggleZonalesBtn = document.getElementById('toggle-zonales-btn');
  if (toggleZonalesBtn) {
    toggleZonalesBtn.addEventListener('change', (e) => {
      const visibility = e.target.checked ? 'visible' : 'none';
      ['zonas-fill', 'zonas-border', 'zonas-labels'].forEach(layerId => {
        if (state.map && state.map.getLayer(layerId)) {
          state.map.setLayoutProperty(layerId, 'visibility', visibility);
        }
      });
    });
  }

  // 7. Sidebar toggle & Reopen Button
  const sidebar = document.getElementById('analytics-sidebar');
  const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
  const reopenSidebarBtn = document.getElementById('reopen-sidebar-btn');

  function setSidebarCollapsed(collapsed) {
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed', collapsed);
    if (reopenSidebarBtn) {
      reopenSidebarBtn.classList.toggle('hidden', !collapsed);
    }
    setTimeout(() => {
      if (state.map) state.map.resize();
    }, 320);
  }

  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => setSidebarCollapsed(true));
  }
  if (reopenSidebarBtn) {
    reopenSidebarBtn.addEventListener('click', () => setSidebarCollapsed(false));
  }

  // 7b. Filters Sidebar Toggle (Barra Lateral Desplegable de Filtros)
  const filtersSidebar = document.getElementById('filters-sidebar');
  const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
  const closeFiltersBtn = document.getElementById('close-filters-btn');
  const reopenFiltersBtn = document.getElementById('reopen-filters-btn');

  function setFiltersSidebarCollapsed(collapsed) {
    if (!filtersSidebar) return;
    filtersSidebar.classList.toggle('collapsed', collapsed);
    if (reopenFiltersBtn) {
      reopenFiltersBtn.classList.toggle('hidden', !collapsed);
    }
    setTimeout(() => {
      if (state.map) state.map.resize();
    }, 320);
  }

  if (toggleFiltersBtn) {
    toggleFiltersBtn.addEventListener('click', () => {
      const isCollapsed = filtersSidebar.classList.contains('collapsed');
      setFiltersSidebarCollapsed(!isCollapsed);
    });
  }
  if (closeFiltersBtn) {
    closeFiltersBtn.addEventListener('click', () => setFiltersSidebarCollapsed(true));
  }
  if (reopenFiltersBtn) {
    reopenFiltersBtn.addEventListener('click', () => setFiltersSidebarCollapsed(false));
  }

  // 8. Table Drawer
  document.getElementById('toggle-table-view-btn').addEventListener('click', () => {
    document.getElementById('data-drawer-overlay').classList.remove('hidden');
  });

  document.getElementById('close-drawer-btn').addEventListener('click', () => {
    document.getElementById('data-drawer-overlay').classList.add('hidden');
  });

  document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (state.pagination.page > 1) {
      state.pagination.page--;
      populateTable();
    }
  });

  document.getElementById('next-page-btn').addEventListener('click', () => {
    state.pagination.page++;
    populateTable();
  });

  // 9. Export Buttons
  document.getElementById('export-csv-btn').addEventListener('click', exportFilteredToCSV);
  document.getElementById('table-export-btn').addEventListener('click', exportFilteredToCSV);

  // 10. Click on Legend Items to Filter by Phase
  document.querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const f = item.getAttribute('data-filter-fase');
      document.querySelectorAll('#pill-fase .pill-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-fase') === f);
      });
      state.filters.fase = f;
      applyFilters();
    });
  });
}

/**
 * ============================================================================
 * INDICADORES EJECUTIVOS (Monitoreo de Normativa Metropolitana - Licenciamiento)
 * Pestaña de Indicadores (Visualización Individual: 1 Indicador por Pestaña)
 * ============================================================================
 */

function getCleanZonalName(raw) {
  if (!raw) return 'Otras';
  const s = raw.toUpperCase();
  if (s.includes('TUMBACO')) return 'Tumbaco';
  if (s.includes('ESPEJO') || s.includes('NORTE')) return 'Eugenio Espejo';
  if (s.includes('CHILLOS')) return 'Los Chillos';
  if (s.includes('DELICIA')) return 'La Delicia';
  if (s.includes('CALDER')) return 'Calderón';
  if (s.includes('QUITUMBE')) return 'Quitumbe';
  if (s.includes('ALFARO') || s.includes('SUR')) return 'Eloy Alfaro';
  if (s.includes('CENTRO') || s.includes('MANUELA')) return 'Manuela Sáenz';
  if (s.includes('MARISCAL')) return 'La Mariscal';
  if (s.includes('CHOCO') || s.includes('NAN')) return 'Chocó Andino';
  return 'Otras';
}

/**
 * Alternar entre vista Visor Territorial y Tablero de Indicadores
 */
window.switchMainView = function (viewName) {
  const mapBtn = document.getElementById('view-tab-map-btn');
  const indBtn = document.getElementById('view-tab-indicators-btn');
  const mainWorkspace = document.getElementById('main-workspace');
  const indWorkspace = document.getElementById('indicators-workspace');
  const kpiBanner = document.getElementById('kpi-banner');

  if (viewName === 'indicators') {
    if (mapBtn) mapBtn.classList.remove('active');
    if (indBtn) indBtn.classList.add('active');
    if (mainWorkspace) mainWorkspace.classList.add('hidden');
    if (kpiBanner) kpiBanner.classList.add('hidden');
    if (indWorkspace) indWorkspace.classList.remove('hidden');

    switchIndicatorTab(state.activeIndicatorTab || 1);
  } else {
    if (indBtn) indBtn.classList.remove('active');
    if (mapBtn) mapBtn.classList.add('active');
    if (indWorkspace) indWorkspace.classList.add('hidden');
    if (mainWorkspace) mainWorkspace.classList.remove('hidden');
    if (kpiBanner) kpiBanner.classList.remove('hidden');

    if (state.map) {
      setTimeout(() => state.map.resize(), 150);
    }
  }

  if (window.lucide) lucide.createIcons();
};

/**
 * Cambiar entre pestañas de los 5 Indicadores (1 solo indicador visible por pestaña)
 */
window.switchIndicatorTab = function (tabNum) {
  const targetNum = parseInt(tabNum) || 1;
  state.activeIndicatorTab = targetNum;

  // 1. Actualizar estado visual de los botones de pestañas
  document.querySelectorAll('.ind-tab-btn').forEach(btn => {
    const isAct = btn.getAttribute('data-ind') === String(targetNum);
    btn.classList.toggle('active', isAct);
  });
  document.querySelectorAll('.ind-nav-btn').forEach(btn => {
    const fn = btn.getAttribute('onclick') || '';
    btn.classList.toggle('active', fn.includes(String(targetNum)));
  });

  // 2. Ocultar todos los indicadores excepto el seleccionado
  for (let i = 1; i <= 5; i++) {
    const sec = document.getElementById(`ind-sec-${i}`);
    if (sec) {
      if (i === targetNum) {
        sec.classList.remove('hidden');
      } else {
        sec.classList.add('hidden');
      }
    }
  }

  // 3. Renderizar y redimensionar los gráficos del indicador activo
  renderSpecificIndicator(targetNum);

  // 4. Resetear scroll vertical al tope
  const workspace = document.getElementById('indicators-workspace');
  if (workspace) {
    workspace.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (window.lucide) lucide.createIcons();
};

/**
 * Compatibilidad con llamados previos
 */
window.scrollToIndicator = function (secId) {
  const match = String(secId).match(/ind-sec-(\d+)/);
  if (match) {
    switchIndicatorTab(parseInt(match[1]));
  } else {
    switchIndicatorTab(1);
  }
};

/**
 * Renderizado modular del indicador solicitado
 */
function renderSpecificIndicator(tabNum) {
  if (!state.allProjects || state.allProjects.length === 0) return;
  const allProjects = state.allProjects;
  state.indCharts = state.indCharts || {};

  const tooltipStyle = {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    titleColor: '#f8fafc',
    bodyColor: '#cbd5e1',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    padding: 10,
    boxPadding: 4,
    usePointStyle: true
  };

  if (tabNum === 1) {
    renderInd1(allProjects, tooltipStyle);
  } else if (tabNum === 2) {
    renderInd2(allProjects, tooltipStyle);
  } else if (tabNum === 3) {
    renderInd3(allProjects, tooltipStyle);
  } else if (tabNum === 4) {
    renderInd4(allProjects, tooltipStyle);
  } else if (tabNum === 5) {
    renderInd5(allProjects, tooltipStyle);
  }
}

function renderIndicatorsDashboard() {
  switchIndicatorTab(state.activeIndicatorTab || 1);
}

// ---------------------------------------------------------------------------
// RENDERIZADO DETALLADO: INDICADOR 1
// ---------------------------------------------------------------------------
function renderInd1(allProjects, tooltipStyle) {
  const initiatedF1 = allProjects.filter(p => p.in_ec);
  const completedF3 = allProjects.filter(p => p.in_ec && p.in_az && p.in_amc);
  const totalInit = initiatedF1.length;
  const totalComp = completedF3.length;
  const globalRate = totalInit > 0 ? (totalComp * 100 / totalInit).toFixed(2) : '0.00';

  const elInd1Main = document.getElementById('ind1-kpi-main');
  if (elInd1Main) elInd1Main.textContent = `${globalRate}%`;

  // 1.1 Por Entidad Colaboradora
  const entData = {
    'CAE-P': { init: 0, comp: 0 },
    'Desintecsa': { init: 0, comp: 0 }
  };
  initiatedF1.forEach(p => {
    const ent = (p.entidad_colaboradora && p.entidad_colaboradora.includes('Desintecsa')) ? 'Desintecsa' : 'CAE-P';
    entData[ent].init++;
    if (p.in_az && p.in_amc) entData[ent].comp++;
  });

  const ctxInd1Ent = document.getElementById('chart-ind1-entidad')?.getContext('2d');
  if (ctxInd1Ent) {
    if (state.indCharts.ind1Ent) state.indCharts.ind1Ent.destroy();
    state.indCharts.ind1Ent = new Chart(ctxInd1Ent, {
      type: 'bar',
      data: {
        labels: ['CAE-P', 'Desintecsa'],
        datasets: [
          {
            label: 'Proyectos Iniciados',
            data: [entData['CAE-P'].init, entData['Desintecsa'].init],
            backgroundColor: '#0284c7',
            borderRadius: 6
          },
          {
            label: 'Culminaron 3 Fases',
            data: [entData['CAE-P'].comp, entData['Desintecsa'].comp],
            backgroundColor: '#a855f7',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: '#94a3b8' } },
          tooltip: tooltipStyle
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }

  // Tabla 1.1
  const tbodyInd1Ent = document.querySelector('#table-ind1-entidad tbody');
  if (tbodyInd1Ent) {
    const caepRate = (entData['CAE-P'].comp * 100 / entData['CAE-P'].init).toFixed(2);
    const desRate = (entData['Desintecsa'].comp * 100 / entData['Desintecsa'].init).toFixed(2);
    tbodyInd1Ent.innerHTML = `
      <tr>
        <td><strong>CAE-P</strong></td>
        <td>${entData['CAE-P'].init.toLocaleString('es-EC')}</td>
        <td><strong style="color:#c084fc;">${entData['CAE-P'].comp}</strong></td>
        <td><span class="ind-tag-pill purple">${caepRate}%</span></td>
      </tr>
      <tr>
        <td><strong>Desintecsa</strong></td>
        <td>${entData['Desintecsa'].init.toLocaleString('es-EC')}</td>
        <td><strong style="color:#c084fc;">${entData['Desintecsa'].comp}</strong></td>
        <td><span class="ind-tag-pill purple">${desRate}%</span></td>
      </tr>
      <tr style="border-top:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.02);">
        <td><strong>Total DMQ</strong></td>
        <td>${totalInit.toLocaleString('es-EC')}</td>
        <td><strong style="color:#c084fc;">${totalComp}</strong></td>
        <td><span class="ind-tag-pill purple" style="font-weight:700;">${globalRate}%</span></td>
      </tr>
    `;
  }

  // 1.2 Por Administración Zonal
  const zonalesList = [
    'La Delicia', 'Tumbaco', 'Eugenio Espejo', 'La Mariscal',
    'Calderón', 'Los Chillos', 'Eloy Alfaro', 'Quitumbe', 'Manuela Sáenz'
  ];
  const zonalData = {};
  zonalesList.forEach(z => { zonalData[z] = { init: 0, comp: 0 }; });

  initiatedF1.forEach(p => {
    const z = getCleanZonalName(p.ad_zonal);
    if (!zonalData[z]) zonalData[z] = { init: 0, comp: 0 };
    zonalData[z].init++;
    if (p.in_az && p.in_amc) zonalData[z].comp++;
  });

  const sortedZonales = Object.keys(zonalData).sort((a, b) => {
    const rA = zonalData[a].init > 0 ? (zonalData[a].comp / zonalData[a].init) : 0;
    const rB = zonalData[b].init > 0 ? (zonalData[b].comp / zonalData[b].init) : 0;
    return rB - rA;
  });

  const ctxInd1Zonal = document.getElementById('chart-ind1-zonal')?.getContext('2d');
  if (ctxInd1Zonal) {
    if (state.indCharts.ind1Zonal) state.indCharts.ind1Zonal.destroy();
    state.indCharts.ind1Zonal = new Chart(ctxInd1Zonal, {
      type: 'bar',
      data: {
        labels: sortedZonales,
        datasets: [{
          label: 'Tasa de Culminación (%)',
          data: sortedZonales.map(z => {
            const tot = zonalData[z].init;
            return tot > 0 ? parseFloat((zonalData[z].comp * 100 / tot).toFixed(2)) : 0;
          }),
          backgroundColor: '#c084fc',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: (ctx) => {
                const z = sortedZonales[ctx.dataIndex];
                const info = zonalData[z];
                return ` ${ctx.parsed.x}% (${info.comp} de ${info.init.toLocaleString('es-EC')} proyectos)`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { callback: v => `${v}%` },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // Tabla 1.2
  const tbodyInd1Zonal = document.querySelector('#table-ind1-zonal tbody');
  if (tbodyInd1Zonal) {
    tbodyInd1Zonal.innerHTML = sortedZonales.map(z => {
      const d = zonalData[z];
      const rate = d.init > 0 ? (d.comp * 100 / d.init).toFixed(2) : '0.00';
      return `
        <tr>
          <td>${z}</td>
          <td>${d.init.toLocaleString('es-EC')}</td>
          <td><strong style="color:#c084fc;">${d.comp}</strong></td>
          <td><span class="ind-tag-pill purple">${rate}%</span></td>
        </tr>
      `;
    }).join('');
  }

  // 1.3 Por Año
  const years1 = ['2023', '2024', '2025', '2026'];
  const anioData = {};
  years1.forEach(y => { anioData[y] = { init: 0, comp: 0 }; });

  initiatedF1.forEach(p => {
    const y = String(p.year);
    if (anioData[y]) {
      anioData[y].init++;
      if (p.in_az && p.in_amc) anioData[y].comp++;
    }
  });

  const ctxInd1Anio = document.getElementById('chart-ind1-anio')?.getContext('2d');
  if (ctxInd1Anio) {
    if (state.indCharts.ind1Anio) state.indCharts.ind1Anio.destroy();
    state.indCharts.ind1Anio = new Chart(ctxInd1Anio, {
      type: 'bar',
      data: {
        labels: years1,
        datasets: [
          {
            type: 'bar',
            label: 'Iniciados',
            data: years1.map(y => anioData[y].init),
            backgroundColor: '#38bdf8',
            borderRadius: 4,
            yAxisID: 'y'
          },
          {
            type: 'bar',
            label: '3 Fases',
            data: years1.map(y => anioData[y].comp),
            backgroundColor: '#a855f7',
            borderRadius: 4,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: 'Tasa (%)',
            data: years1.map(y => anioData[y].init > 0 ? parseFloat((anioData[y].comp * 100 / anioData[y].init).toFixed(2)) : 0),
            borderColor: '#e879f9',
            backgroundColor: '#e879f9',
            borderWidth: 2,
            pointRadius: 4,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: '#94a3b8' } },
          tooltip: tooltipStyle
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            position: 'left',
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            title: { display: true, text: 'Proyectos', color: '#64748b' }
          },
          y1: {
            position: 'right',
            grid: { display: false },
            ticks: { callback: v => `${v}%` },
            title: { display: true, text: 'Tasa (%)', color: '#e879f9' }
          }
        }
      }
    });
  }

  // Tabla 1.3
  const tbodyInd1Anio = document.querySelector('#table-ind1-anio tbody');
  if (tbodyInd1Anio) {
    tbodyInd1Anio.innerHTML = years1.map(y => {
      const d = anioData[y];
      const rate = d.init > 0 ? (d.comp * 100 / d.init).toFixed(2) : '0.00';
      return `
        <tr>
          <td><strong>${y}</strong></td>
          <td>${d.init.toLocaleString('es-EC')}</td>
          <td><strong style="color:#c084fc;">${d.comp}</strong></td>
          <td><span class="ind-tag-pill purple">${rate}%</span></td>
        </tr>
      `;
    }).join('');
  }
}

// ---------------------------------------------------------------------------
// RENDERIZADO DETALLADO: INDICADOR 2
// ---------------------------------------------------------------------------
function renderInd2(allProjects, tooltipStyle) {
  const allEcCerts = [];
  allProjects.forEach(p => {
    if (Array.isArray(p.certificados_ec) && p.certificados_ec.length > 0) {
      p.certificados_ec.forEach(c => allEcCerts.push({ ...c, predio: p.predio }));
    } else if (p.in_ec && p.fase1_ec && p.fase1_ec.tiene) {
      allEcCerts.push({ ...p.fase1_ec, predio: p.predio });
    }
  });

  const elInd2Main = document.getElementById('ind2-kpi-main');
  if (elInd2Main) elInd2Main.textContent = allEcCerts.length.toLocaleString('es-EC');

  // 2.1 Trimestres
  const ecQuarterMap = {};
  allEcCerts.forEach(c => {
    const f = c.fecha_emision;
    if (f && f.length >= 7) {
      const y = f.substring(0, 4);
      const m = parseInt(f.substring(5, 7));
      const q = `Q${Math.ceil(m / 3)}`;
      const key = `${y}-${q}`;
      ecQuarterMap[key] = (ecQuarterMap[key] || 0) + 1;
    }
  });

  const ecQuarterKeys = Object.keys(ecQuarterMap).sort();

  const ctxInd2Trim = document.getElementById('chart-ind2-trimestres')?.getContext('2d');
  if (ctxInd2Trim) {
    if (state.indCharts.ind2Trim) state.indCharts.ind2Trim.destroy();
    state.indCharts.ind2Trim = new Chart(ctxInd2Trim, {
      type: 'bar',
      data: {
        labels: ecQuarterKeys,
        datasets: [{
          label: 'Certificados Emitidos',
          data: ecQuarterKeys.map(k => ecQuarterMap[k]),
          backgroundColor: '#06b6d4',
          hoverBackgroundColor: '#22d3ee',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: tooltipStyle
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }

  // 2.2 Desagregación por Entidad Colaboradora por Año
  const years2 = ['2023', '2024', '2025', '2026'];
  const entYearData = {
    'CAE-P': { '2023': 0, '2024': 0, '2025': 0, '2026': 0 },
    'Desintecsa': { '2023': 0, '2024': 0, '2025': 0, '2026': 0 }
  };

  allEcCerts.forEach(c => {
    let y = c.fecha_emision ? c.fecha_emision.substring(0, 4) : '';
    if (!years2.includes(y)) y = '2024';
    const ent = (c.entidad && c.entidad.includes('Desintecsa')) ? 'Desintecsa' : 'CAE-P';
    if (entYearData[ent] && entYearData[ent][y] !== undefined) {
      entYearData[ent][y]++;
    }
  });

  const ctxInd2Ent = document.getElementById('chart-ind2-entidad')?.getContext('2d');
  if (ctxInd2Ent) {
    if (state.indCharts.ind2Ent) state.indCharts.ind2Ent.destroy();
    state.indCharts.ind2Ent = new Chart(ctxInd2Ent, {
      type: 'bar',
      data: {
        labels: years2,
        datasets: [
          {
            label: 'CAE-P',
            data: years2.map(y => entYearData['CAE-P'][y]),
            backgroundColor: '#0284c7',
            borderRadius: 4
          },
          {
            label: 'Desintecsa',
            data: years2.map(y => entYearData['Desintecsa'][y]),
            backgroundColor: '#06b6d4',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: '#94a3b8' } },
          tooltip: tooltipStyle
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }

  // Tabla 2.2
  const tbodyInd2Ent = document.querySelector('#table-ind2-entidad tbody');
  if (tbodyInd2Ent) {
    const caepTotal = years2.reduce((acc, y) => acc + entYearData['CAE-P'][y], 0);
    const desTotal = years2.reduce((acc, y) => acc + entYearData['Desintecsa'][y], 0);
    const totalAll = caepTotal + desTotal;
    const caepShare = totalAll > 0 ? (caepTotal * 100 / totalAll).toFixed(1) : '0';
    const desShare = totalAll > 0 ? (desTotal * 100 / totalAll).toFixed(1) : '0';

    tbodyInd2Ent.innerHTML = `
      <tr>
        <td><strong>CAE-P</strong></td>
        ${years2.map(y => `<td>${entYearData['CAE-P'][y].toLocaleString('es-EC')}</td>`).join('')}
        <td><strong>${caepTotal.toLocaleString('es-EC')} <small style="color:#38bdf8;">(${caepShare}%)</small></strong></td>
      </tr>
      <tr>
        <td><strong>Desintecsa</strong></td>
        ${years2.map(y => `<td>${entYearData['Desintecsa'][y].toLocaleString('es-EC')}</td>`).join('')}
        <td><strong>${desTotal.toLocaleString('es-EC')} <small style="color:#06b6d4;">(${desShare}%)</small></strong></td>
      </tr>
      <tr style="border-top:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.02);">
        <td><strong>Total DMQ</strong></td>
        ${years2.map(y => `<td><strong>${(entYearData['CAE-P'][y] + entYearData['Desintecsa'][y]).toLocaleString('es-EC')}</strong></td>`).join('')}
        <td><strong style="color:#38bdf8;">${totalAll.toLocaleString('es-EC')} (100%)</strong></td>
      </tr>
    `;
  }
}

// ---------------------------------------------------------------------------
// RENDERIZADO DETALLADO: INDICADOR 3
// ---------------------------------------------------------------------------
function renderInd3(allProjects, tooltipStyle) {
  const allAzLics = [];
  allProjects.forEach(p => {
    if (Array.isArray(p.licencias_az) && p.licencias_az.length > 0) {
      p.licencias_az.forEach(l => allAzLics.push({ ...l, predio: p.predio, tipo_licencia: p.tipo_licencia || 'LMU 20' }));
    } else if (p.in_az && p.fase2_az && p.fase2_az.tiene) {
      allAzLics.push({ ...p.fase2_az, predio: p.predio, tipo_licencia: p.tipo_licencia || 'LMU 20' });
    }
  });

  const elInd3Main = document.getElementById('ind3-kpi-main');
  if (elInd3Main) elInd3Main.textContent = allAzLics.length.toLocaleString('es-EC');

  // 3.1 Trimestres
  const azQuarterMap = {};
  allAzLics.forEach(l => {
    const f = l.fecha_emision;
    if (f && f.length >= 7) {
      const y = f.substring(0, 4);
      const m = parseInt(f.substring(5, 7));
      const q = `Q${Math.ceil(m / 3)}`;
      const key = `${y}-${q}`;
      azQuarterMap[key] = (azQuarterMap[key] || 0) + 1;
    }
  });
  const azQuarterKeys = Object.keys(azQuarterMap).sort();

  const ctxInd3Trim = document.getElementById('chart-ind3-trimestres')?.getContext('2d');
  if (ctxInd3Trim) {
    if (state.indCharts.ind3Trim) state.indCharts.ind3Trim.destroy();
    state.indCharts.ind3Trim = new Chart(ctxInd3Trim, {
      type: 'bar',
      data: {
        labels: azQuarterKeys,
        datasets: [{
          label: 'Licencias Emitidas',
          data: azQuarterKeys.map(k => azQuarterMap[k]),
          backgroundColor: '#f59e0b',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: tooltipStyle
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }

  // 3.2 Por Administración Zonal y Tipo de Licencia
  const zonalesAzMap = {};
  allAzLics.forEach(l => {
    const z = getCleanZonalName(l.ad_zonal);
    if (!zonalesAzMap[z]) zonalesAzMap[z] = { lmu20: 0, lmu10: 0, total: 0 };
    if (l.tipo_licencia === 'LMU 10') {
      zonalesAzMap[z].lmu10++;
    } else {
      zonalesAzMap[z].lmu20++;
    }
    zonalesAzMap[z].total++;
  });

  const sortedAzZonales = Object.keys(zonalesAzMap).sort((a, b) => zonalesAzMap[b].total - zonalesAzMap[a].total);

  const ctxInd3Zonal = document.getElementById('chart-ind3-zonal')?.getContext('2d');
  if (ctxInd3Zonal) {
    if (state.indCharts.ind3Zonal) state.indCharts.ind3Zonal.destroy();
    state.indCharts.ind3Zonal = new Chart(ctxInd3Zonal, {
      type: 'bar',
      data: {
        labels: sortedAzZonales,
        datasets: [
          {
            label: 'LMU 20 (Edificaciones)',
            data: sortedAzZonales.map(z => zonalesAzMap[z].lmu20),
            backgroundColor: '#f59e0b',
            borderRadius: 4
          },
          {
            label: 'LMU 10 (Suelo / Lotes)',
            data: sortedAzZonales.map(z => zonalesAzMap[z].lmu10),
            backgroundColor: '#fbbf24',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: '#94a3b8' } },
          tooltip: tooltipStyle
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// RENDERIZADO DETALLADO: INDICADOR 4
// ---------------------------------------------------------------------------
function renderInd4(allProjects, tooltipStyle) {
  const allAmcCerts = [];
  allProjects.forEach(p => {
    if (Array.isArray(p.certificados_amc) && p.certificados_amc.length > 0) {
      p.certificados_amc.forEach(a => allAmcCerts.push({ ...a, predio: p.predio, ad_zonal: p.ad_zonal }));
    } else if (p.in_amc && p.fase3_amc && p.fase3_amc.tiene) {
      allAmcCerts.push({ ...p.fase3_amc, predio: p.predio, ad_zonal: p.ad_zonal });
    }
  });

  const elInd4Main = document.getElementById('ind4-kpi-main');
  if (elInd4Main) elInd4Main.textContent = allAmcCerts.length.toLocaleString('es-EC');

  // 4.1 Trimestres AMC
  const amcQuarterMap = {};
  allAmcCerts.forEach(a => {
    const reg = a.registro || '';
    let y = '2024';
    const mYear = reg.match(/CCF-(\d{2})-/);
    if (mYear) {
      y = `20${mYear[1]}`;
    }
    let num = 0;
    const mNum = reg.match(/CCF-\d{2}-(\d+)/);
    if (mNum) num = parseInt(mNum[1]);
    const q = num <= 35 ? 'Q1' : (num <= 70 ? 'Q2' : (num <= 115 ? 'Q3' : 'Q4'));
    const key = `${y}-${q}`;
    amcQuarterMap[key] = (amcQuarterMap[key] || 0) + 1;
  });

  const amcQuarterKeys = Object.keys(amcQuarterMap).sort();

  const ctxInd4Trim = document.getElementById('chart-ind4-trimestres')?.getContext('2d');
  if (ctxInd4Trim) {
    if (state.indCharts.ind4Trim) state.indCharts.ind4Trim.destroy();
    state.indCharts.ind4Trim = new Chart(ctxInd4Trim, {
      type: 'bar',
      data: {
        labels: amcQuarterKeys,
        datasets: [{
          label: 'Certificados AMC (CCF)',
          data: amcQuarterKeys.map(k => amcQuarterMap[k]),
          backgroundColor: '#10b981',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: tooltipStyle
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }

  // 4.2 Por Administración Zonal AMC
  const amcZonalesMap = {};
  allAmcCerts.forEach(a => {
    let z = getCleanZonalName(a.zona);
    if (z === 'Otras' && a.ad_zonal) z = getCleanZonalName(a.ad_zonal);
    amcZonalesMap[z] = (amcZonalesMap[z] || 0) + 1;
  });

  const sortedAmcZonales = Object.keys(amcZonalesMap).sort((a, b) => amcZonalesMap[b] - amcZonalesMap[a]);

  const ctxInd4Zonal = document.getElementById('chart-ind4-zonal')?.getContext('2d');
  if (ctxInd4Zonal) {
    if (state.indCharts.ind4Zonal) state.indCharts.ind4Zonal.destroy();
    state.indCharts.ind4Zonal = new Chart(ctxInd4Zonal, {
      type: 'bar',
      data: {
        labels: sortedAmcZonales,
        datasets: [{
          label: 'Certificados de Finalización (CCF)',
          data: sortedAmcZonales.map(z => amcZonalesMap[z]),
          backgroundColor: '#059669',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: tooltipStyle
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// RENDERIZADO DETALLADO: INDICADOR 5
// ---------------------------------------------------------------------------
function renderInd5(allProjects, tooltipStyle) {
  const allAzLics = [];
  allProjects.forEach(p => {
    if (Array.isArray(p.licencias_az) && p.licencias_az.length > 0) {
      p.licencias_az.forEach(l => allAzLics.push({ ...l, predio: p.predio, tipo_licencia: p.tipo_licencia || 'LMU 20' }));
    } else if (p.in_az && p.fase2_az && p.fase2_az.tiene) {
      allAzLics.push({ ...p.fase2_az, predio: p.predio, tipo_licencia: p.tipo_licencia || 'LMU 20' });
    }
  });

  const years5 = ['2023', '2024', '2025', '2026'];
  const zonalesClean5 = ['Tumbaco', 'Eugenio Espejo', 'Los Chillos', 'La Delicia', 'Calderón', 'Quitumbe', 'Eloy Alfaro', 'Manuela Sáenz', 'La Mariscal', 'Chocó Andino'];

  const zonalYearCounts = {};
  const yearTotals = { '2023': 0, '2024': 0, '2025': 0, '2026': 0 };

  years5.forEach(y => {
    zonalesClean5.forEach(z => {
      zonalYearCounts[`${z}-${y}`] = 0;
    });
  });

  allAzLics.forEach(l => {
    let y = l.fecha_emision ? l.fecha_emision.substring(0, 4) : '';
    if (!years5.includes(y)) y = '2024';
    const z = getCleanZonalName(l.ad_zonal);
    const key = `${z}-${y}`;
    if (zonalYearCounts[key] !== undefined) {
      zonalYearCounts[key]++;
      yearTotals[y]++;
    }
  });

  const zonalPalette = {
    'Tumbaco': '#38bdf8',
    'Eugenio Espejo': '#818cf8',
    'Los Chillos': '#f59e0b',
    'La Delicia': '#10b981',
    'Calderón': '#ec4899',
    'Quitumbe': '#a855f7',
    'Eloy Alfaro': '#f97316',
    'Manuela Sáenz': '#64748b',
    'La Mariscal': '#06b6d4',
    'Chocó Andino': '#84cc16',
    'Otras': '#475569'
  };

  const ind5Datasets = zonalesClean5.map(z => {
    return {
      label: z,
      data: years5.map(y => {
        const tot = yearTotals[y];
        const cnt = zonalYearCounts[`${z}-${y}`] || 0;
        return tot > 0 ? parseFloat((cnt * 100 / tot).toFixed(1)) : 0;
      }),
      backgroundColor: zonalPalette[z] || '#94a3b8',
      borderRadius: 2
    };
  });

  const ctxInd5Part = document.getElementById('chart-ind5-participacion')?.getContext('2d');
  if (ctxInd5Part) {
    if (state.indCharts.ind5Part) state.indCharts.ind5Part.destroy();
    state.indCharts.ind5Part = new Chart(ctxInd5Part, {
      type: 'bar',
      data: {
        labels: years5,
        datasets: ind5Datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, color: '#94a3b8', font: { size: 11 } } },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: (ctx) => {
                const z = ctx.dataset.label;
                const y = years5[ctx.dataIndex];
                const cnt = zonalYearCounts[`${z}-${y}`] || 0;
                return ` ${z}: ${ctx.parsed.y}% (${cnt.toLocaleString('es-EC')} licencias)`;
              }
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: {
            stacked: true,
            max: 100,
            ticks: { callback: v => `${v}%` },
            grid: { color: 'rgba(255, 255, 255, 0.05)' }
          }
        }
      }
    });
  }

  // Tabla 5.2 Matriz de Cuota Territorial
  const tbodyInd5Part = document.querySelector('#table-ind5-participacion tbody');
  if (tbodyInd5Part) {
    const zonalTotalsAllYears = {};
    let grandTotalLics = 0;
    zonalesClean5.forEach(z => {
      let sum = 0;
      years5.forEach(y => { sum += (zonalYearCounts[`${z}-${y}`] || 0); });
      zonalTotalsAllYears[z] = sum;
      grandTotalLics += sum;
    });

    const sortedZonales5 = [...zonalesClean5].sort((a, b) => zonalTotalsAllYears[b] - zonalTotalsAllYears[a]);

    tbodyInd5Part.innerHTML = sortedZonales5.map(z => {
      const totalZ = zonalTotalsAllYears[z];
      const zColor = zonalPalette[z] || '#cbd5e1';
      return `
        <tr>
          <td>
            <span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${zColor}; margin-right:6px;"></span>
            <strong>${z}</strong>
          </td>
          ${years5.map(y => {
            const tot = yearTotals[y];
            const cnt = zonalYearCounts[`${z}-${y}`] || 0;
            const pct = tot > 0 ? (cnt * 100 / tot).toFixed(1) : '0.0';
            return `<td>${pct}% <small style="color:#64748b;">(${cnt})</small></td>`;
          }).join('')}
          <td><strong style="color:${zColor};">${totalZ.toLocaleString('es-EC')}</strong></td>
        </tr>
      `;
    }).join('') + `
      <tr style="border-top:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.03); font-weight:700;">
        <td><strong>Total DMQ</strong></td>
        ${years5.map(y => `<td>100% <small style="color:#64748b;">(${yearTotals[y].toLocaleString('es-EC')})</small></td>`).join('')}
        <td><strong style="color:#38bdf8;">${grandTotalLics.toLocaleString('es-EC')}</strong></td>
      </tr>
    `;
  }
}


