/**
 * enrich_tipo_proyecto.js
 * Lee las columnas "Tipo Proyecto" de ambos Excels AZ y las mapea al JSON,
 * normalizando los valores a: NUEVO, AMPLIATORIO, MODIFICATORIO, OTRO
 */
const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const BASE = 'c:\\Users\\User\\Desktop\\VisorMonitoreoHabitat';

// Normalizar valores a las 3 categorías limpias
function normTipo(raw) {
  if (!raw) return null;
  const v = String(raw).toUpperCase().trim();
  if (v.includes('AMP')) return 'AMPLIATORIO';
  if (v.includes('MOD')) return 'MODIFICATORIO';
  if (v === 'NUEVO' || v.includes('NUEV')) return 'NUEVO';
  if (v.includes('SUB') || v.includes('REEST') || v.includes('ORD')) return 'NUEVO'; // subdivisiones = nuevo trámite
  return 'OTRO';
}

// Leer predios desde un Excel AZ
function readAZPredios(filename) {
  const wb = XLSX.readFile(path.join(BASE, filename));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const keys = Object.keys(rows[0] || {});

  const predioCol = keys.find(k => /número de predio|numero de predio|num.*predio/i.test(k) && !/^número de predio$/i.test(k) === false || /^número de predio$/i.test(k) || /^numero de predio$/i.test(k));
  const tipoCol   = keys.find(k => /tipo.*proyecto/i.test(k));

  console.log(`  ${filename}`);
  console.log(`    predio col: "${predioCol}", tipo col: "${tipoCol}"`);

  const map = new Map(); // predio -> tipo normalizado
  for (const row of rows) {
    const rawP = String(row[predioCol] || '').trim().replace(/\.0$/, '');
    const num  = parseInt(rawP, 10);
    if (isNaN(num)) continue;
    const tipo = normTipo(row[tipoCol]);
    if (tipo) map.set(String(num), tipo);
  }
  return map;
}

console.log('Leyendo Excels AZ...');
const mapLMU10 = readAZPredios('ADMINISTRACIONES ZONALES LMU10_PURGADO.xlsx');
const mapLMU20 = readAZPredios('ADMINISTRACIONES ZONALES LMU20_PURGADO.xlsx');

// Merge maps (LMU20 tiene prioridad si ambos tienen el predio)
const tipoMap = new Map([...mapLMU10, ...mapLMU20]);
console.log(`Total predios con Tipo Proyecto desde AZ Excels: ${tipoMap.size}`);

// Actualizar JSON
const jsonPath = path.join(BASE, 'public', 'data', 'licencias_data.json');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

let updated = 0, kept = 0, missing = 0;
for (const p of data) {
  const fromExcel = tipoMap.get(String(p.predio));
  if (fromExcel) {
    p.tipo_proyecto = fromExcel;
    updated++;
  } else {
    // Normalize existing value if any
    const norm = normTipo(p.tipo_proyecto);
    if (norm && norm !== 'OTRO') {
      p.tipo_proyecto = norm;
      kept++;
    } else {
      p.tipo_proyecto = null;
      missing++;
    }
  }
}

console.log(`\nActualizados desde Excel: ${updated}`);
console.log(`Mantenidos (normalizados): ${kept}`);
console.log(`Sin tipo_proyecto: ${missing}`);

// Verificar distribución final
const dist = {};
data.forEach(p => {
  const t = p.tipo_proyecto || 'SIN DATO';
  dist[t] = (dist[t] || 0) + 1;
});
console.log('\nDistribución final:');
Object.entries(dist).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

// Guardar JSON
const jsonStr = JSON.stringify(data);
fs.writeFileSync(jsonPath, jsonStr, 'utf8');

// Regenerar bundle
const metricsRaw = fs.readFileSync(path.join(BASE, 'public', 'data', 'metricas_resumen.json'), 'utf8');
const bundle = 'window.LICENCIAS_DATA = ' + jsonStr + ';\nwindow.METRICAS_RESUMEN = ' + metricsRaw + ';';
fs.writeFileSync(path.join(BASE, 'public', 'data', 'licencias_data.js'), bundle, 'utf8');
console.log('\n✅ JSON y bundle actualizados');

