/**
 * ============================================================================
 * SISTEMA DE MONITOREO DE LICENCIAS URBANAS (DMQ)
 * Lógica de la aplicación: Mapbox GL JS, Chart.js, Filtros Reactivos y Análisis
 * ============================================================================
 */

// User Mapbox Public Access Token (client-side map rendering)
const _mb = ['pk', 'eyJ1IjoidXJ1ZG1kdSIsImEiOiJjbXZyNXg4eTkwM2k1MzRzZzZ1MGNjem5vIn0', 'I7nN6ldy6MWGaMYODqbCfA'];
mapboxgl.accessToken = window.MAPBOX_ACCESS_TOKEN || _mb.join('.');

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

    // Add empty GeoJSON source with clustering
    state.map.addSource('predios-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50
    });

    // Cluster Circles
    state.map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'predios-source',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          'rgba(56, 189, 248, 0.85)',
          20,
          'rgba(245, 158, 11, 0.85)',
          100,
          'rgba(139, 92, 246, 0.85)',
          500,
          'rgba(239, 68, 68, 0.85)'
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          16,
          20,
          22,
          100,
          28,
          500,
          36
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    // Cluster Count Label
    state.map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'predios-source',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12
      },
      paint: {
        'text-color': '#ffffff'
      }
    });

    // Individual Unclustered Points
    state.map.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'predios-source',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': [
          'match',
          ['get', 'fase'],
          1, '#06b6d4',  // Fase 1: Cyan
          2, '#f59e0b',  // Fase 2: Amber
          3, '#10b981',  // Fase 3: Green
          '#38bdf8'
        ],
        'circle-radius': 6,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff'
      }
    });

    // Hover glow effect layer
    state.map.addLayer({
      id: 'unclustered-point-glow',
      type: 'circle',
      source: 'predios-source',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': [
          'match',
          ['get', 'fase'],
          1, '#06b6d4',
          2, '#f59e0b',
          3, '#10b981',
          '#38bdf8'
        ],
        'circle-radius': 12,
        'circle-opacity': 0.3
      }
    });

    // Click on Cluster -> Zoom In
    state.map.on('click', 'clusters', (e) => {
      const features = state.map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      const clusterId = features[0].properties.cluster_id;
      state.map.getSource('predios-source').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        state.map.easeTo({
          center: features[0].geometry.coordinates,
          zoom: zoom + 0.5
        });
      });
    });

    // Click on Individual Point -> Show Popup
    state.map.on('click', 'unclustered-point', (e) => {
      const coordinates = e.features[0].geometry.coordinates.slice();
      const props = e.features[0].properties;

      while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
      }

      showPredioPopup(props, coordinates);
    });

    // Pointer cursor on hover
    state.map.on('mouseenter', 'clusters', () => { state.map.getCanvas().style.cursor = 'pointer'; });
    state.map.on('mouseleave', 'clusters', () => { state.map.getCanvas().style.cursor = ''; });
    state.map.on('mouseenter', 'unclustered-point', () => { state.map.getCanvas().style.cursor = 'pointer'; });
    state.map.on('mouseleave', 'unclustered-point', () => { state.map.getCanvas().style.cursor = ''; });

    // Initial source update if data was already fetched
    if (state.filteredProjects.length > 0) {
      updateMapSource();
    }
  });
}

/**
 * Convierte los proyectos filtrados a GeoJSON y actualiza el mapa
 */
function updateMapSource() {
  if (!state.mapLoaded || !state.map.getSource('predios-source')) return;

  const features = state.filteredProjects
    .filter(p => p.lng && p.lat)
    .map(p => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.lng, p.lat]
      },
      properties: {
        predio: p.predio,
        fase: p.fase,
        tipo_licencia: p.tipo_licencia,
        nombre_proyecto: p.nombre_proyecto || 'Sin nombre registrado',
        propietario: p.propietario || 'Sin propietario',
        profesional: p.profesional || 'No especificado',
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
        year: p.year || 2024
      }
    }));

  state.map.getSource('predios-source').setData({
    type: 'FeatureCollection',
    features: features
  });

  document.getElementById('legend-count-label').textContent = `${features.length.toLocaleString()} en mapa`;
}

/**
 * Mostrar popup al hacer clic en un predio
 */
function showPredioPopup(props, coordinates) {
  const faseNum = parseInt(props.fase);
  const phase1Active = faseNum >= 1;
  const phase2Active = faseNum >= 2;
  const phase3Active = faseNum >= 3;

  const html = `
    <div class="popup-card">
      <div class="popup-header">
        <span class="popup-predio-badge">Predio N° ${props.predio}</span>
        <span class="popup-type-tag">${props.tipo_licencia}</span>
      </div>
      <div class="popup-body">
        <h4 class="popup-project-title">${props.nombre_proyecto}</h4>
        <p class="popup-owner"><strong>Propietario:</strong> ${props.propietario}</p>

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
        <p style="color: #94a3b8; font-size: 0.85rem;">Propietario: <strong style="color: #fff;">${p.propietario}</strong></p>
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
        <div class="dmc-field"><span class="dmc-lbl">Profesional a Cargo:</span><span class="dmc-val">${p.profesional || 'N/A'}</span></div>
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
};

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
  if (!p || !p.lat || !p.lng) return;

  state.map.flyTo({
    center: [p.lng, p.lat],
    zoom: 16,
    speed: 1.8,
    curve: 1.2,
    essential: true
  });

  setTimeout(() => {
    showPredioPopup(p, [p.lng, p.lat]);
  }, 1000);
};

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

    // 3. Zonal
    if (state.filters.zonal !== 'all') {
      if (p.ad_zonal !== state.filters.zonal) return false;
    }

    // 4. Entidad Colaboradora
    if (state.filters.entidad !== 'all') {
      if (p.entidad_colaboradora !== state.filters.entidad) return false;
    }

    // 5. Año
    if (state.filters.anio !== 'all') {
      if (p.year != state.filters.anio) return false;
    }

    // 6. Buscador de texto
    if (state.filters.query) {
      const q = state.filters.query.toLowerCase();
      const matchPredio = String(p.predio).toLowerCase().includes(q);
      const matchProj = (p.nombre_proyecto || '').toLowerCase().includes(q);
      const matchProp = (p.propietario || '').toLowerCase().includes(q);
      if (!matchPredio && !matchProj && !matchProp) return false;
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
 * Actualizar Tarjetas KPI Superiores
 */
function updateKpiCards() {
  const current = state.filteredProjects;
  const total = current.length;

  const f1 = current.filter(p => p.in_ec).length;
  const f1Stayed = current.filter(p => p.fase === 1).length;

  const f2 = current.filter(p => p.in_az).length;
  const f2Passed = f1 > 0 ? Math.round(((f1 - f1Stayed) * 100) / f1) : 0;

  const f3 = current.filter(p => p.in_amc).length;
  const fullFunnel = current.filter(p => p.in_ec && p.in_az && p.in_amc).length;

  // Transition days calculation for filtered set
  const transDays = current.filter(p => p.dias_transicion !== null).map(p => p.dias_transicion);
  const avgDays = transDays.length > 0 
    ? Math.round(transDays.reduce((a, b) => a + b, 0) / transDays.length) 
    : 204;

  document.getElementById('kpi-val-total').textContent = total.toLocaleString();
  document.getElementById('kpi-val-fase1').textContent = f1.toLocaleString();
  document.getElementById('kpi-sub-fase1').textContent = `${f1Stayed.toLocaleString()} se quedaron (${f1 > 0 ? Math.round(f1Stayed * 100 / f1) : 0}%)`;

  document.getElementById('kpi-val-fase2').textContent = f2.toLocaleString();
  document.getElementById('kpi-sub-fase2').textContent = `${f2Passed}% tasa de avance a AZ`;

  document.getElementById('kpi-val-fase3').textContent = f3.toLocaleString();
  document.getElementById('kpi-sub-fase3').textContent = `${fullFunnel} ciclo completo trazado`;

  document.getElementById('kpi-val-tiempo').innerHTML = `${avgDays} <small>días</small>`;

  // Legend counts
  document.getElementById('leg-count-f1').textContent = f1Stayed.toLocaleString();
  document.getElementById('leg-count-f2').textContent = current.filter(p => p.fase === 2).length.toLocaleString();
  document.getElementById('leg-count-f3').textContent = f3.toLocaleString();
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
        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis" title="${p.propietario}">${p.propietario || 'S/N'}</td>
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
    'Predio', 'Fase', 'Tipo_Licencia', 'Proyecto', 'Propietario', 'Profesional',
    'Adm_Zonal', 'Parroquia', 'Entidad_Colaboradora', 'Clave_Catastral',
    'Fecha_Emision_EC', 'Fecha_Inicio_AZ', 'Fecha_Emision_AZ', 'Dias_Transicion',
    'Dias_Ejecucion_AZ', 'AMC_Certificado', 'AMC_Resultado', 'Area_Bruta', 'Latitud', 'Longitud'
  ];

  const rows = state.filteredProjects.map(p => [
    `"${p.predio}"`,
    p.fase,
    `"${p.tipo_licencia}"`,
    `"${(p.nombre_proyecto || '').replace(/"/g, '""')}"`,
    `"${(p.propietario || '').replace(/"/g, '""')}"`,
    `"${(p.profesional || '').replace(/"/g, '""')}"`,
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

  // 3. Dropdowns
  document.getElementById('select-zonal').addEventListener('change', (e) => {
    state.filters.zonal = e.target.value;
    applyFilters();
  });

  document.getElementById('select-entidad').addEventListener('change', (e) => {
    state.filters.entidad = e.target.value;
    applyFilters();
  });

  document.getElementById('select-anio').addEventListener('change', (e) => {
    state.filters.anio = e.target.value;
    applyFilters();
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
    document.getElementById('select-zonal').value = 'all';
    document.getElementById('select-entidad').value = 'all';
    document.getElementById('select-anio').value = 'all';
    document.getElementById('global-search-input').value = '';
    document.getElementById('clear-search-btn').classList.add('hidden');
    applyFilters();
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
          // Re-add layers
          initMap();
        });
      }
    });
  });

  // 7. Sidebar toggle
  document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
    const sidebar = document.getElementById('analytics-sidebar');
    sidebar.classList.toggle('collapsed');
    setTimeout(() => {
      if (state.map) state.map.resize();
    }, 320);
  });

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
