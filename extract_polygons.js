const fs = require('fs');
const path = require('path');

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

  return [
    Math.round(lon * 180.0 / Math.PI * 1e6) / 1e6, // lng
    Math.round(lat * 180.0 / Math.PI * 1e6) / 1e6  // lat
  ];
}

// Generate realistic cadastral parcel polygon around a centroid
function generateLotPolygon(lng, lat, radiusMeters = 16) {
  // 1 degree lat ~ 111,000 m; 1 degree lng at equator ~ 111,320 m
  const dLat = (radiusMeters / 111000);
  const dLng = (radiusMeters / (111320 * Math.cos(lat * Math.PI / 180)));
  
  // Approximate standard urban parcel (aspect ratio 1.5 : 1)
  const w = dLng * 0.9;
  const h = dLat * 1.3;
  
  return [
    [Math.round((lng - w) * 1e6) / 1e6, Math.round((lat - h) * 1e6) / 1e6],
    [Math.round((lng + w) * 1e6) / 1e6, Math.round((lat - h) * 1e6) / 1e6],
    [Math.round((lng + w) * 1e6) / 1e6, Math.round((lat + h) * 1e6) / 1e6],
    [Math.round((lng - w) * 1e6) / 1e6, Math.round((lat + h) * 1e6) / 1e6],
    [Math.round((lng - w) * 1e6) / 1e6, Math.round((lat - h) * 1e6) / 1e6]
  ];
}

function simplifyRing(ring, minDelta = 0.00003) {
  if (ring.length <= 16) return ring;
  const result = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = ring[i];
    const dlng = Math.abs(curr[0] - prev[0]);
    const dlat = Math.abs(curr[1] - prev[1]);
    if (dlng >= minDelta || dlat >= minDelta) {
      result.push(curr);
    }
  }
  result.push(ring[ring.length - 1]);
  return result;
}

const basePath = __dirname;
const jsonPath = path.join(basePath, 'public', 'data', 'licencias_data.json');
const jsPath = path.join(basePath, 'public', 'data', 'licencias_data.js');

console.log('1. Cargando datos de licencias...');
let raw = fs.readFileSync(jsonPath, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const projects = JSON.parse(raw);
console.log(`Total proyectos: ${projects.length}`);

const predioMap = new Map();
for (const p of projects) {
  if (p.predio) {
    const k = String(p.predio);
    if (!predioMap.has(k)) predioMap.set(k, []);
    predioMap.get(k).push(p);
  }
}
console.log(`Predios únicos en el dataset: ${predioMap.size}`);

// Open shapefile
const pathDbf = path.join(basePath, 'PREDIAL QUITO 2026.dbf');
const pathShx = path.join(basePath, 'PREDIAL QUITO 2026.shx');
const pathShp = path.join(basePath, 'PREDIAL QUITO 2026.shp');

console.log('2. Escaneando catálogo predial (PREDIAL QUITO 2026)...');
const fdDbf = fs.openSync(pathDbf, 'r');
const fdShx = fs.openSync(pathShx, 'r');
const fdShp = fs.openSync(pathShp, 'r');

const headerBuf = Buffer.alloc(32);
fs.readSync(fdDbf, headerBuf, 0, 32, 0);
const totalRecords = headerBuf.readUInt32LE(4);
const headerLen = headerBuf.readUInt16LE(8);
const recordLen = headerBuf.readUInt16LE(10);

const chunkSize = 25000;
const chunkBuf = Buffer.alloc(chunkSize * recordLen);
const shxBuf = Buffer.alloc(8);
const shpHeaderBuf = Buffer.alloc(52);

const predioGeometryMap = new Map();
let matchedCount = 0;

for (let batch = 0; batch < totalRecords; batch += chunkSize) {
  const count = Math.min(chunkSize, totalRecords - batch);
  const bytesToRead = count * recordLen;
  const filePos = headerLen + batch * recordLen;
  fs.readSync(fdDbf, chunkBuf, 0, bytesToRead, filePos);

  for (let k = 0; k < count; k++) {
    const recOffset = k * recordLen;
    const pStrRaw = chunkBuf.toString('ascii', recOffset + 45, recOffset + 45 + 24).trim();
    if (!pStrRaw) continue;
    const pNum = parseInt(pStrRaw, 10);
    if (isNaN(pNum)) continue;
    const pKey = String(pNum);

    if (predioMap.has(pKey) && !predioGeometryMap.has(pKey)) {
      // Seek SHX
      const shxPos = 100 + (batch + k) * 8;
      fs.readSync(fdShx, shxBuf, 0, 8, shxPos);
      const byteOffset = shxBuf.readInt32BE(0) * 2;
      const byteLength = shxBuf.readInt32BE(4) * 2;

      // Read SHP record header
      fs.readSync(fdShp, shpHeaderBuf, 0, 52, byteOffset);
      const shapeType = shpHeaderBuf.readInt32LE(8);

      if (shapeType === 5) { // Polygon
        const numParts = shpHeaderBuf.readInt32LE(44);
        const numPoints = shpHeaderBuf.readInt32LE(48);

        // Read parts and points
        const recData = Buffer.alloc(byteLength + 8);
        fs.readSync(fdShp, recData, 0, byteLength + 8, byteOffset);

        const parts = [];
        for (let p = 0; p < numParts; p++) {
          parts.push(recData.readInt32LE(52 + p * 4));
        }

        const ptsOffset = 52 + numParts * 4;
        const allRings = [];

        for (let p = 0; p < numParts; p++) {
          const startIdx = parts[p];
          const endIdx = (p === numParts - 1) ? numPoints : parts[p + 1];
          const ring = [];
          for (let i = startIdx; i < endIdx; i++) {
            const px = recData.readDoubleLE(ptsOffset + i * 16);
            const py = recData.readDoubleLE(ptsOffset + i * 16 + 8);
            ring.push(convertTMQToWGS84(px, py));
          }
          if (ring.length >= 3) {
            // Ensure closed ring
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              ring.push([first[0], first[1]]);
            }
            allRings.push(simplifyRing(ring));
          }
        }

        if (allRings.length > 0) {
          let geom;
          if (allRings.length === 1) {
            geom = { type: 'Polygon', coordinates: allRings };
          } else {
            geom = { type: 'MultiPolygon', coordinates: allRings.map(r => [r]) };
          }

          // Calculate centroid
          let sumLng = 0, sumLat = 0, ptCount = 0;
          for (const ring of allRings) {
            for (const pt of ring) {
              sumLng += pt[0];
              sumLat += pt[1];
              ptCount++;
            }
          }

          predioGeometryMap.set(pKey, {
            geom,
            centerLng: Math.round((sumLng / ptCount) * 1e6) / 1e6,
            centerLat: Math.round((sumLat / ptCount) * 1e6) / 1e6,
            isExactCadastre: true
          });
          matchedCount++;
        }
      }
    }
  }

  if (batch % 200000 === 0 && batch > 0) {
    console.log(`  ...procesados ${batch.toLocaleString()} de ${totalRecords.toLocaleString()} (Polígonos extraídos: ${matchedCount})`);
  }
}

fs.closeSync(fdDbf);
fs.closeSync(fdShx);
fs.closeSync(fdShp);
console.log(`✅ Polígonos exactos extraídos del Shapefile: ${matchedCount}`);

// 3. Update all projects with polygon geometries
let exactApplied = 0;
let fallbackApplied = 0;

for (const p of projects) {
  const pKey = String(p.predio);
  const matched = predioGeometryMap.get(pKey);

  if (matched) {
    p.geom = matched.geom;
    p.lng = matched.centerLng;
    p.lat = matched.centerLat;
    p.is_exact_lot = true;
    exactApplied++;
  } else {
    // Generate fallback lot polygon around existing lat/lng
    const fallbackRing = generateLotPolygon(p.lng || -78.485, p.lat || -0.182, 18);
    p.geom = {
      type: 'Polygon',
      coordinates: [fallbackRing]
    };
    p.is_exact_lot = false;
    fallbackApplied++;
  }
}

console.log(`3. Asignación completada:`);
console.log(`   - Predios con perímetro catastral real del SHP: ${exactApplied}`);
console.log(`   - Predios con lote geométrico estimado: ${fallbackApplied}`);

console.log('4. Guardando licencias_data.json y licencias_data.js...');
const updatedJsonStr = JSON.stringify(projects);
fs.writeFileSync(jsonPath, updatedJsonStr, 'utf8');

const updatedJsStr = 'window.LICENCIAS_DATA = ' + updatedJsonStr + ';\n';
fs.writeFileSync(jsPath, updatedJsStr, 'utf8');

const stats = fs.statSync(jsPath);
console.log(`✅ Archivos generados con éxito. Tamaño final: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
