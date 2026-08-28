#!/usr/bin/env node
// Versiona los assets propios (./JS/*.js y ./CSS/*.css) en los HTML del sitio.
//
// GitHub Pages sirve todo con Cache-Control: max-age=600 y no deja definir
// cabeceras propias, asi que despues de un deploy el navegador podia seguir
// ejecutando el JS viejo hasta que se hiciera un refresco forzado. Al agregar
// ?v=<sello> a cada referencia, el HTML nuevo apunta a una URL distinta y el
// navegador baja el archivo actualizado sin intervencion del usuario.
//
// Uso:
//   node tools/stamp-assets.js            -> sella con la fecha/hora UTC actual
//   node tools/stamp-assets.js 20260828   -> sella con un valor fijo
//   node tools/stamp-assets.js --check    -> no escribe; falla si algo quedo sin sellar
//
// Correrlo antes de commitear cualquier cambio en JS/ o CSS/.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const explicitStamp = args.find((arg) => !arg.startsWith('--'));
const pad = (value) => String(value).padStart(2, '0');
const now = new Date();
const stamp = explicitStamp || [
  now.getUTCFullYear(),
  pad(now.getUTCMonth() + 1),
  pad(now.getUTCDate()),
  pad(now.getUTCHours()),
  pad(now.getUTCMinutes())
].join('');

const root = path.resolve(__dirname, '..');
const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith('.html'));

// src="./JS/app.js" | href="./CSS/style.css", con o sin ?v= previo.
const ASSET_REF = /(\s(?:src|href)=")(\.\/(?:JS|CSS)\/[^"?]+)(\?[^"]*)?(")/g;

let totalRefs = 0;
let changedFiles = 0;
const unstamped = [];

htmlFiles.forEach((name) => {
  const file = path.join(root, name);
  const original = fs.readFileSync(file, 'utf8');
  let refs = 0;
  const updated = original.replace(ASSET_REF, (match, prefix, assetPath, query, suffix) => {
    refs += 1;
    if (checkOnly && !/^\?v=/.test(query || '')) unstamped.push(`${name}: ${assetPath}`);
    return `${prefix}${assetPath}?v=${stamp}${suffix}`;
  });
  totalRefs += refs;
  if (checkOnly || updated === original) return;
  fs.writeFileSync(file, updated);
  changedFiles += 1;
  console.log(`  ${name}: ${refs} referencia(s)`);
});

if (checkOnly) {
  if (unstamped.length) {
    console.error(`Assets sin ?v= (${unstamped.length}):`);
    unstamped.forEach((item) => console.error(`  ${item}`));
    process.exit(1);
  }
  console.log(`OK: ${totalRefs} referencia(s) versionadas en ${htmlFiles.length} HTML.`);
  process.exit(0);
}

console.log(`Sello ?v=${stamp} aplicado a ${totalRefs} referencia(s) en ${changedFiles} de ${htmlFiles.length} HTML.`);
