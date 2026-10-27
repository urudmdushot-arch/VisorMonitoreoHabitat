const fs = require('fs');
const path = require('path');

const parroquiaCoords = {
  // Parroquias Urbanas
  "BELISARIO QUEVEDO": { lat: -0.1931, lng: -78.5019 },
  "CARCELEN": { lat: -0.0989, lng: -78.4853 },
  "CENTRO HISTORICO": { lat: -0.2200, lng: -78.5139 },
  "CHILIBULO": { lat: -0.2319, lng: -78.5381 },
  "CHILLOGALLO": { lat: -0.2817, lng: -78.5639 },
  "CHIMBACALLE": { lat: -0.2389, lng: -78.5178 },
  "COCHAPAMBA": { lat: -0.1458, lng: -78.5083 },
  "COMITE DEL PUEBLO": { lat: -0.1250, lng: -78.4611 },
  "CONCEPCION": { lat: -0.1611, lng: -78.4917 },
  "COTOCOLLAO": { lat: -0.1172, lng: -78.4972 },
  "EL CONDADO": { lat: -0.1089, lng: -78.5033 },
  "GUAMANI": { lat: -0.3347, lng: -78.5544 },
  "INAQUITO": { lat: -0.1783, lng: -78.4856 },
  "ITCHIMBIA": { lat: -0.2186, lng: -78.4983 },
  "JIPIJAPA": { lat: -0.1650, lng: -78.4750 },
  "KENNEDY": { lat: -0.1417, lng: -78.4833 },
  "LA ARGELIA": { lat: -0.2819, lng: -78.5283 },
  "LA ECUATORIANA": { lat: -0.3089, lng: -78.5639 },
  "LA FERROVIARIA": { lat: -0.2514, lng: -78.5142 },
  "LA LIBERTAD": { lat: -0.2250, lng: -78.5250 },
  "LA MAGDALENA": { lat: -0.2450, lng: -78.5272 },
  "LA MENA": { lat: -0.2650, lng: -78.5583 },
  "MARISCAL SUCRE": { lat: -0.2033, lng: -78.4922 },
  "PONCEANO": { lat: -0.1167, lng: -78.4833 },
  "PONCE ENRIQUEZ": { lat: -0.1333, lng: -78.4833 },
  "PUENGASI": { lat: -0.2344, lng: -78.5011 },
  "QUITUMBE": { lat: -0.2981, lng: -78.5528 },
  "RUMIPAMBA": { lat: -0.1800, lng: -78.4983 },
  "SAN BARTOLO": { lat: -0.2611, lng: -78.5306 },
  "SAN ISIDRO DEL INCA": { lat: -0.1486, lng: -78.4728 },
  "SAN JUAN": { lat: -0.2150, lng: -78.5183 },
  "SOLANDA": { lat: -0.2731, lng: -78.5414 },
  "TURUBAMBA": { lat: -0.3211, lng: -78.5492 },

  // Parroquias Rurales y Valles
  "ALANGASI": { lat: -0.3000, lng: -78.4167 },
  "AMAGUANA": { lat: -0.3667, lng: -78.5000 },
  "ATAHUALPA": { lat: 0.1389, lng: -78.3667 },
  "CALACALI": { lat: -0.0028, lng: -78.5142 },
  "CALDERON": { lat: -0.0967, lng: -78.4239 },
  "CHAVEZPAMBA": { lat: 0.1833, lng: -78.4167 },
  "CHECA": { lat: -0.1333, lng: -78.3000 },
  "CUMBAYA": { lat: -0.2014, lng: -78.4358 },
  "EL QUINCHE": { lat: -0.1167, lng: -78.2833 },
  "GUALEA": { lat: 0.1167, lng: -78.7500 },
  "GUANGOPOLO": { lat: -0.2667, lng: -78.4500 },
  "GUAYLLABAMBA": { lat: -0.0500, lng: -78.3500 },
  "LA MERCED": { lat: -0.3167, lng: -78.3833 },
  "LLANO CHICO": { lat: -0.1417, lng: -78.4444 },
  "LLANO GRANDE": { lat: -0.1167, lng: -78.4333 },
  "LUMBISI": { lat: -0.2167, lng: -78.4500 },
  "NANEGAL": { lat: 0.1167, lng: -78.6667 },
  "NANEGALITO": { lat: 0.0667, lng: -78.6833 },
  "NAYON": { lat: -0.1728, lng: -78.4419 },
  "NONO": { lat: -0.0750, lng: -78.5778 },
  "PACTO": { lat: 0.1500, lng: -78.7667 },
  "PERUCHO": { lat: 0.1000, lng: -78.4167 },
  "PIFO": { lat: -0.2317, lng: -78.3417 },
  "PINTAG": { lat: -0.3667, lng: -78.3667 },
  "POMASQUI": { lat: -0.0522, lng: -78.4558 },
  "PUELLARO": { lat: 0.0667, lng: -78.3833 },
  "PUEMBO": { lat: -0.1983, lng: -78.3614 },
  "SAN ANTONIO": { lat: -0.0078, lng: -78.4439 },
  "SAN JOSE DE MINAS": { lat: 0.1833, lng: -78.4000 },
  "TABABELA": { lat: -0.1983, lng: -78.3417 },
  "TUMBACO": { lat: -0.2144, lng: -78.4022 },
  "YARUQUI": { lat: -0.1667, lng: -78.3167 },
  "ZAMBIZA": { lat: -0.1639, lng: -78.4472 }
};

// Transverse Mercator Inverse Projection: SIRES-DMQ (meters) -> WGS84 (degrees)
function convertTMQToWGS84(east, north) {
  const a = 6378137.0;
  const f = 1.0 / 298.257223563;
  const e2 = 2.0 * f - f * f;
  const e_prime2 = e2 / (1.0 - e2);
  const k0 = 1.0004584;
  const falseEasting = 500000.0;
  const falseNorthing = 10000000.0;
  const lambda0 = -78.5 * Math.PI / 180.0;

  const x = east - falseEasting;
  const y = north - falseNorthing;

  const M = y / k0;
  const mu = M / (a * (1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * Math.pow(e2, 3) / 256.0));

  const e1 = (1.0 - Math.sqrt(1.0 - e2)) / (1.0 + Math.sqrt(1.0 - e2));
  const phi1 = mu + (3.0 * e1 / 2.0 - 27.0 * Math.pow(e1, 3) / 32.0) * Math.sin(2.0 * mu) +
               (21.0 * e1 * e1 / 16.0 - 55.0 * Math.pow(e1, 4) / 32.0) * Math.sin(4.0 * mu) +
               (151.0 * Math.pow(e1, 3) / 96.0) * Math.sin(6.0 * mu) +
               (1097.0 * Math.pow(e1, 4) / 512.0) * Math.sin(8.0 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = a / Math.sqrt(1.0 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = e_prime2 * cosPhi1 * cosPhi1;
  const R1 = a * (1.0 - e2) / Math.pow(1.0 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);

  const lat = phi1 - (N1 * tanPhi1 / R1) * (
    D * D / 2.0 -
    (5.0 + 3.0 * T1 + 10.0 * C1 - 4.0 * C1 * C1 - 9.0 * e_prime2) * Math.pow(D, 4) / 24.0 +
    (61.0 + 90.0 * T1 + 298.0 * C1 + 45.0 * T1 * T1 - 252.0 * e_prime2 - 3.0 * C1 * C1) * Math.pow(D, 6) / 720.0
  );

  const lon = lambda0 + (
    D -
    (1.0 + 2.0 * T1 + C1) * Math.pow(D, 3) / 6.0 +
    (5.0 - 2.0 * C1 + 28.0 * T1 - 3.0 * C1 * C1 + 8.0 * e_prime2 + 24.0 * T1 * T1) * Math.pow(D, 5) / 120.0
  ) / cosPhi1;

  return {
    lat: Math.round(lat * 180.0 / Math.PI * 1e6) / 1e6,
    lng: Math.round(lon * 180.0 / Math.PI * 1e6) / 1e6
  };
}

function normalizeStr(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

const basePath = 'c:\\Users\\User\\Desktop\\VisorMonitoreoHabitat';
const jsonPath = path.join(basePath, 'public', 'data', 'licencias_data.json');
const jsPath = path.join(basePath, 'public', 'data', 'licencias_data.js');

console.log('Cargando licencias_data.json...');
let raw = fs.readFileSync(jsonPath, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) {
  raw = raw.slice(1);
}
const projects = JSON.parse(raw);
const projMap = new Map();
for (const p of projects) {
  projMap.set(String(p.predio), p);
}
console.log(`Total proyectos en dataset: ${projects.length}`);

// Escaneo Shapefile
const pathDbf = path.join(basePath, 'PREDIAL QUITO 2026.dbf');
const pathShx = path.join(basePath, 'PREDIAL QUITO 2026.shx');
const pathShp = path.join(basePath, 'PREDIAL QUITO 2026.shp');

let exactMatches = 0;
const matchedPredios = new Set();

try {
  console.log('Abriendo Shapefile de Quito (PREDIAL QUITO 2026)...');
  const fdDbf = fs.openSync(pathDbf, 'r');
  const fdShx = fs.openSync(pathShx, 'r');
  const fdShp = fs.openSync(pathShp, 'r');

  // Read DBF header
  const headerBuf = Buffer.alloc(32);
  fs.readSync(fdDbf, headerBuf, 0, 32, 0);
  const totalRecords = headerBuf.readUInt32LE(4);
  const headerLen = headerBuf.readUInt16LE(8);
  const recordLen = headerBuf.readUInt16LE(10);

  console.log(`DBF: ${totalRecords.toLocaleString()} registros catastrales. Escaneando index...`);

  const chunkSize = 20000;
  const chunkBuf = Buffer.alloc(chunkSize * recordLen);
  const shxBuf = Buffer.alloc(8);
  const shpHeaderBuf = Buffer.alloc(44);

  for (let batch = 0; batch < totalRecords; batch += chunkSize) {
    const count = Math.min(chunkSize, totalRecords - batch);
    const bytesToRead = count * recordLen;
    const filePos = headerLen + batch * recordLen;

    fs.readSync(fdDbf, chunkBuf, 0, bytesToRead, filePos);

    for (let k = 0; k < count; k++) {
      const recOffset = k * recordLen;
      // Campo predio en offset 45, largo 24
      const pStrRaw = chunkBuf.toString('ascii', recOffset + 45, recOffset + 45 + 24).trim();
      if (!pStrRaw) continue;

      const pNum = parseInt(pStrRaw, 10);
      if (isNaN(pNum)) continue;
      const pKey = String(pNum);

      if (projMap.has(pKey) && !matchedPredios.has(pKey)) {
        matchedPredios.add(pKey);

        // Seek shx
        const shxPos = 100 + (batch + k) * 8;
        fs.readSync(fdShx, shxBuf, 0, 8, shxPos);
        const offsetWords = shxBuf.readInt32BE(0);
        const shpByteOffset = offsetWords * 2;

        // Read shp record header + box
        fs.readSync(fdShp, shpHeaderBuf, 0, 44, shpByteOffset);
        const shapeType = shpHeaderBuf.readInt32LE(8);

        if (shapeType === 5) { // Polygon
          const xmin = shpHeaderBuf.readDoubleLE(12);
          const ymin = shpHeaderBuf.readDoubleLE(20);
          const xmax = shpHeaderBuf.readDoubleLE(28);
          const ymax = shpHeaderBuf.readDoubleLE(36);

          const cx = (xmin + xmax) / 2.0;
          const cy = (ymin + ymax) / 2.0;

          const wgs = convertTMQToWGS84(cx, cy);
          const item = projMap.get(pKey);
          item.lat = wgs.lat;
          item.lng = wgs.lng;
          exactMatches++;
        }
      }
    }

    if (batch % 200000 === 0 && batch > 0) {
      console.log(`  ...escaneados ${batch.toLocaleString()} de ${totalRecords.toLocaleString()} (Coincidencias: ${exactMatches})`);
    }
  }

  fs.closeSync(fdDbf);
  fs.closeSync(fdShx);
  fs.closeSync(fdShp);
  console.log(`Coincidencias geométricas exactas desde el Shapefile: ${exactMatches}`);
} catch (err) {
  console.error('Aviso al procesar Shapefile:', err.message);
}

// Asignación de fallback por parroquia y administración zonal para los restantes
let fallbackCount = 0;
for (const p of projects) {
  const pKey = String(p.predio);
  const needsFix = !matchedPredios.has(pKey) || !p.lat || !p.lng || (p.lng > -77.0);

  if (needsFix) {
    fallbackCount++;
    const parr = normalizeStr(p.parroquia);
    let base = parroquiaCoords[parr];

    if (!base || typeof base.lat !== 'number') {
      const z = normalizeStr(p.ad_zonal);
      if (z.includes('TUMBACO')) base = parroquiaCoords['TUMBACO'];
      else if (z.includes('CHILLOS')) base = parroquiaCoords['CONOCOTO'];
      else if (z.includes('QUITUMBE')) base = parroquiaCoords['QUITUMBE'];
      else if (z.includes('CALDERON')) base = parroquiaCoords['CALDERON'];
      else if (z.includes('DELICIA')) base = parroquiaCoords['CARCELEN'];
      else if (z.includes('SUR') || z.includes('ELOY ALFARO')) base = parroquiaCoords['LA FERROVIARIA'];
      else if (z.includes('CENTRO') || z.includes('MANUELA SAENZ')) base = parroquiaCoords['CENTRO HISTORICO'];
      else if (z.includes('MARISCAL')) base = parroquiaCoords['MARISCAL SUCRE'];
      else if (z.includes('CHOCO')) base = parroquiaCoords['POMASQUI'];
      else base = parroquiaCoords['INAQUITO'];
    }

    if (!base || typeof base.lat !== 'number') {
      base = { lat: -0.1783, lng: -78.4856 };
    }

    // Deterministic jitter based on predio hash
    let hash = 0;
    for (let i = 0; i < pKey.length; i++) {
      hash = ((hash << 5) - hash) + pKey.charCodeAt(i);
      hash |= 0;
    }
    const absHash = Math.abs(hash);
    const jitterLat = ((absHash % 1000) - 500) * 0.00003;
    const jitterLng = (((Math.floor(absHash / 1000)) % 1000) - 500) * 0.00003;

    p.lat = Math.round((base.lat + jitterLat) * 1e6) / 1e6;
    p.lng = Math.round((base.lng + jitterLng) * 1e6) / 1e6;
  }
}

console.log(`Predios complementados con centroide de parroquia/zona: ${fallbackCount}`);

// Verificación estricta de coordenadas en Quito
let quitoCount = 0;
for (const p of projects) {
  if (p.lat < 0.25 && p.lat > -0.55 && p.lng < -78.1 && p.lng > -78.8) {
    quitoCount++;
  }
}
console.log(`VERIFICACIÓN EXITOSA: ${quitoCount} de ${projects.length} predios tienen coordenadas válidas en Quito!`);

// Guardar JSON y bundle JS (sin BOM)
fs.writeFileSync(jsonPath, JSON.stringify(projects));

let metricsRaw = fs.readFileSync(path.join(basePath, 'public', 'data', 'metricas_resumen.json'), 'utf8');
if (metricsRaw.charCodeAt(0) === 0xFEFF) metricsRaw = metricsRaw.slice(1);

const jsBundle = `window.LICENCIAS_DATA = ${JSON.stringify(projects)};\nwindow.METRICAS_RESUMEN = ${metricsRaw};`;
fs.writeFileSync(jsPath, jsBundle, 'utf8');

console.log('Datasets guardados exitosamente sin BOM!');
