const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, 'public', 'data', 'licencias_data.json');
const jsPath = path.join(__dirname, 'public', 'data', 'licencias_data.js');

console.log('Cargando licencias_data.json...');
let raw = fs.readFileSync(jsonPath, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
let projects = JSON.parse(raw);

function fixMojibake(str) {
  if (typeof str !== 'string' || !str) return str;
  // If string contains typical double-encoded UTF-8 characters like Ã³, Ã¡, etc.
  if (/[\u00C0-\u00C3]/.test(str)) {
    try {
      const decoded = Buffer.from(str, 'binary').toString('utf8');
      // If it successfully decoded into standard text without replacement chars
      if (!decoded.includes('')) {
        return decoded;
      }
    } catch (e) {}
  }
  return str
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã±/g, 'ñ')
    .replace(/Ã/g, 'Á')
    .replace(/Ã‰/g, 'É')
    .replace(/Ã/g, 'Í')
    .replace(/Ã“/g, 'Ó')
    .replace(/Ãš/g, 'Ú')
    .replace(/Ã‘/g, 'Ñ');
}

function cleanObjectStrings(obj) {
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'string') {
      obj[k] = fixMojibake(obj[k]);
    } else if (typeof obj[k] === 'object' && obj[k] !== null && k !== 'geom') {
      cleanObjectStrings(obj[k]);
    }
  }
}

console.log('Sanitizando codificación de texto en todos los proyectos...');
for (const p of projects) {
  cleanObjectStrings(p);
  // Standardize zonal name
  if (p.ad_zonal) {
    p.ad_zonal = p.ad_zonal.trim();
  }
}

// Validate unique zonales
const zonales = {};
for (const p of projects) {
  zonales[p.ad_zonal || 'Sin Zonal'] = (zonales[p.ad_zonal || 'Sin Zonal'] || 0) + 1;
}
console.log('Zonales saneadas:', zonales);

console.log('Guardando licencias_data.json...');
const updatedJsonStr = JSON.stringify(projects);
fs.writeFileSync(jsonPath, updatedJsonStr, 'utf8');

console.log('Guardando licencias_data.js...');
const updatedJsStr = 'window.LICENCIAS_DATA = ' + updatedJsonStr + ';\n';
fs.writeFileSync(jsPath, updatedJsStr, 'utf8');

console.log('✅ Codificación saneada exitosamente.');
