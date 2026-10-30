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
  latMax:  0.28,
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
  filters: {
    licencia: 'all',
    fase: 'all',
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
    if (window.LICENCIAS_DATA && window.METRICAS_RESUMEN) {
      state.rawProjects = window.LICENCIAS_DATA;
      state.summaryMetrics = window.METRICAS_RESUMEN;
    } else {
      const [resData, resMetrics] = await Promise.all([
        fetch('public/data/licencias_data.json'),
        fetch('public/data/metricas_resumen.json')
      ]);
      state.rawProjects = await resData.json();
      state.summaryMetrics = await resMetrics.json();
    }
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

    document.getElementById('badge-total-count').textContent = `${state.rawProjects.length.toLocaleString()} Predios Rastreados`;

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

  // 1. Relleno zonal translúcido muy suave (fondo cartográfico)
  if (state.map.getSource('zonas-source') && !state.map.getLayer('zonas-fill')) {
    state.map.addLayer({
      id: 'zonas-fill',
      type: 'fill',
      source: 'zonas-source',
      paint: {
        'fill-color': [
          'match', ['get', 'cod_adm_zo'],
          'AZCHA', '#10b981',
          'AZEE',  '#0284c7',
          'AZCH',  '#f59e0b',
          'AZQ',   '#8b5cf6',
          'AZCA',  '#ec4899',
          'AZMS',  '#eab308',
          'AZT',   '#06b6d4',
          'AZLM',  '#14b8a6',
          'AZLD',  '#6366f1',
          'AZEA',  '#f97316',
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
      paint: {
        'line-color': [
          'match', ['get', 'cod_adm_zo'],
          'AZCHA', '#34d399',
          'AZEE',  '#38bdf8',
          'AZCH',  '#fbbf24',
          'AZQ',   '#a78bfa',
          'AZCA',  '#f472b6',
          'AZMS',  '#fde047',
          'AZT',   '#22d3ee',
          'AZLM',  '#2dd4bf',
          'AZLD',  '#818cf8',
          'AZEA',  '#fb923c',
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

  // Sincronizar visibilidad con el botón toggle si ya existe en el DOM
  const toggleZonalesBtnInit = document.getElementById('toggle-zonales-btn');
  const initVisibility = (toggleZonalesBtnInit && !toggleZonalesBtnInit.checked) ? 'none' : 'visible';
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
          9,  0.50,
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

  const html = `
    <div class="popup-card">
      <div class="popup-header">
        <span class="popup-predio-badge">Predio N° ${props.predio}</span>
        <span class="popup-type-tag">${props.tipo_licencia}</span>
      </div>
      <div class="popup-body">
        <h4 class="popup-project-title">${props.nombre_proyecto}</h4>
        <p class="popup-owner"><strong>Proyecto:</strong> ${props.nombre_proyecto}</p>
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
          ${props.amc_registro ? `
          <div class="pm-item">
            <span class="pm-lbl">Certificado AMC:</span>
            <span class="pm-val" style="color: #10b981;">${props.amc_registro} (${props.amc_resultado})</span>
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
 * Abrir Modal de Ficha Técnica Completa
 */
window.openPredioModal = function(predioNum) {
  const p = state.rawProjects.find(item => item.predio == predioNum);
  if (!p) return;

  const modal = document.getElementById('detail-modal-overlay');
  const card = document.getElementById('detail-modal-card');

  card.innerHTML = `
    <div class="dmc-header">
      <div class="dmc-title-group">
        <h2>Predio N° ${p.predio}</h2>
        <span>${p.tipo_licencia} &bull; ${p.tipo_proyecto || 'General'}</span>
      </div>
      <button class="icon-btn" onclick="closePredioModal()"><i data-lucide="x"></i></button>
    </div>
    <div class="dmc-body">
      <div>
        <h4 style="font-family: var(--font-heading); font-size: 1.1rem; color: #fff; margin-bottom: 4px;">
          ${p.nombre_proyecto || 'Sin Nombre Registrado'}
        </h4>
        <p style="color: #94a3b8; font-size: 0.85rem;">Parroquia: <strong style="color: #fff;">${p.parroquia || 'N/A'}</strong></p>
      </div>

      <div class="dmc-section-title">Línea de Tiempo del Trámite</div>
      <div class="dmc-timeline">
        <div class="dmc-tl-step ${p.in_ec ? 'active' : ''}">
          <span class="dmc-tl-title">Fase 1: Entidad Colaboradora</span>
          <span class="dmc-tl-date">${p.fecha_emision_ec ? `Emitido el: ${p.fecha_emision_ec}` : 'Sin fecha de emisión'}</span>
          <span class="dmc-tl-meta">Entidad: ${p.entidad_colaboradora || 'No especificada'}</span>
        </div>
        <div class="dmc-tl-step ${p.in_az ? 'active' : ''}">
          <span class="dmc-tl-title">Fase 2: Administración Zonal</span>
          <span class="dmc-tl-date">
            ${p.fecha_inicio_az ? `Ingreso: ${p.fecha_inicio_az}` : ''} 
            ${p.fecha_emision_az ? ` &bull; Emisión: ${p.fecha_emision_az}` : ''}
          </span>
          <span class="dmc-tl-meta">
            ${p.ad_zonal || 'Sin Zonal'} ${p.dias_ejecucion_az ? `(${p.dias_ejecucion_az} días en ejecución)` : ''}
          </span>
        </div>
        <div class="dmc-tl-step ${p.in_amc ? 'active' : ''}">
          <span class="dmc-tl-title">Fase 3: Agencia Metropolitana de Control (AMC)</span>
          <span class="dmc-tl-date">${p.amc_registro ? `Certificado: ${p.amc_registro}` : 'Pendiente de emisión en AMC'}</span>
          <span class="dmc-tl-meta">${p.amc_resultado ? `Resultado: ${p.amc_resultado}` : ''}</span>
        </div>
      </div>

      <div class="dmc-section-title">Datos Catastrales y Geográficos</div>
      <div class="dmc-grid">
        <div class="dmc-field"><span class="dmc-lbl">Clave Catastral:</span><span class="dmc-val">${p.clave_catastral || 'N/A'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Parroquia:</span><span class="dmc-val">${p.parroquia || 'N/A'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Área Bruta:</span><span class="dmc-val">${p.area_bruta ? p.area_bruta.toLocaleString() + ' m²' : 'N/A'}</span></div>
        <div class="dmc-field"><span class="dmc-lbl">Coordenadas WGS84:</span><span class="dmc-val">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span></div>
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
}

window.closePredioModal = function() {
  document.getElementById('detail-modal-overlay').classList.add('hidden');
};

/**
 * Centrar el mapa en un predio
 */
window.locatePredioOnMap = function(predioNum) {
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

  // Tarjetas Superiores (Flujo Acumulado que ingresó a cada etapa)
  document.getElementById('kpi-val-total').textContent = total.toLocaleString();
  
  document.getElementById('kpi-val-fase1').textContent = f1Total.toLocaleString();
  document.getElementById('kpi-sub-fase1').textContent = `${f1Stayed.toLocaleString()} detenidos en EC (${pctF1}%)`;

  document.getElementById('kpi-val-fase2').textContent = f2Total.toLocaleString();
  document.getElementById('kpi-sub-fase2').textContent = `${f2Stayed.toLocaleString()} con Licencia Emitida (${pctF2}%)`;

  document.getElementById('kpi-val-fase3').textContent = f3Total.toLocaleString();
  document.getElementById('kpi-sub-fase3').textContent = `${fullFunnel} trazabilidad ciclo completo`;

  document.getElementById('kpi-val-tiempo').innerHTML = `${avgDays} <small>días</small>`;

  // Conteo en Leyenda del Mapa (Estado territorial actual)
  document.getElementById('leg-count-f1').textContent = f1Stayed.toLocaleString();
  document.getElementById('leg-count-f2').textContent = f2Stayed.toLocaleString();
  document.getElementById('leg-count-f3').textContent = f3Stayed.toLocaleString();

  // Actualizar indicadores de filtros activos
  let activeFilterCount = 0;
  if (state.filters.licencia !== 'all') activeFilterCount++;
  if (state.filters.fase !== 'all') activeFilterCount++;
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

  document.getElementById('stat-tasa-az').textContent = f1Total > 0 ? `${Math.round(f1ToF2 * 100 / f1Total)}%` : '0%';
  document.getElementById('stat-tasa-amc').textContent = f2Total > 0 ? `${(f2ToF3 * 100 / f2Total).toFixed(1)}%` : '0%';

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
  const caCount = data.filter(p => p.entidad_colaboradora === 'Colegio de Arquitectos').length;
  const desCount = data.filter(p => p.entidad_colaboradora === 'Desintecsa').length;

  const ctxEntidades = document.getElementById('chart-entidades').getContext('2d');
  if (state.charts.entidades) state.charts.entidades.destroy();
  state.charts.entidades = new Chart(ctxEntidades, {
    type: 'doughnut',
    data: {
      labels: ['Colegio de Arquitectos', 'Desintecsa'],
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
        <td style="max-width:240px; overflow:hidden; text-overflow:ellipsis" title="${p.nombre_proyecto}">${p.nombre_proyecto || 'S/N'}</td>
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
    'Predio', 'Fase', 'Tipo_Licencia', 'Proyecto',
    'Adm_Zonal', 'Parroquia', 'Entidad_Colaboradora', 'Clave_Catastral',
    'Fecha_Emision_EC', 'Fecha_Inicio_AZ', 'Fecha_Emision_AZ', 'Dias_Transicion',
    'Dias_Ejecucion_AZ', 'AMC_Certificado', 'AMC_Resultado', 'Area_Bruta', 'Latitud', 'Longitud'
  ];

  const rows = state.filteredProjects.map(p => [
    `"${p.predio}"`,
    p.fase,
    `"${p.tipo_licencia}"`,
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
    const listEl   = document.getElementById(`cl-${group}-list`);
    const toggleEl = listEl ? listEl.previousElementSibling : null;
    const labelEl  = document.getElementById(`cl-${group}-label`);
    const allCb    = listEl ? listEl.querySelector('.cl-all') : null;
    const options  = listEl ? [...listEl.querySelectorAll(`.cl-option[data-group="${group}"]`)] : [];

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
          labelEl.textContent = options.find(c => c.value === selected[0])
            ?.nextElementSibling?.textContent || selected[0];
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
    zonal:   'Todas las Adm. Zonales',
    entidad: 'Todas las Entidades',
    anio:    'Todos los Años',
  };

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
      licencia: 'all',
      fase: 'all',
      zonal: 'all',
      entidad: 'all',
      anio: 'all',
      query: ''
    };
    document.querySelectorAll('#pill-licencia .pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-filter') === 'all'));
    document.querySelectorAll('#pill-fase .pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-fase') === 'all'));
    // Reset checklists
    ['zonal', 'entidad', 'anio'].forEach(group => {
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
          const isZonalVisible = toggleZonalesBtn ? toggleZonalesBtn.checked : true;
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
