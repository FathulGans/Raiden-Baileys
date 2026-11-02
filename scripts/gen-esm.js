// Membuat ulang lib/index.mjs dari daftar export CJS (lib/index.js).
// Jalankan: node scripts/gen-esm.js   (otomatis dijalankan lewat `npm run build:esm`)
const fs = require('fs')
const path = require('path')

const RESERVED = new Set(['default', '__esModule'])
const ID = /^[A-Za-z_$][\w$]*$/

// banner konsol di lib/index.js memanggil clearConsole(); simpan & kembalikan stdout
const write = process.stdout.write
process.stdout.write = () => true
const cjs = require('../lib/index.js')
process.stdout.write = write
const log = console.log

const keys = Object.keys(cjs).filter((k) => !RESERVED.has(k)).sort()
const bad = keys.filter((k) => !ID.test(k))
if (bad.length) {
    console.error('Nama export tidak valid sebagai identifier ESM:', bad)
    process.exit(1)
}

const out = `// Wrapper ESM untuk raiden-baileys (dual package CJS + ESM).
// File ini DIBUAT OTOMATIS oleh scripts/gen-esm.js - jangan diedit manual.
// Kode asli tetap CommonJS (lib/index.js); wrapper ini hanya memuatnya via
// createRequire sehingga hanya ada SATU instance modul (tidak ada dual-package hazard).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cjs = require('./index.js');

export default cjs.default;
export const {
${keys.map((k) => '    ' + k).join(',\n')}
} = cjs;
`
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'index.mjs'), out)
log(`lib/index.mjs dibuat (${keys.length} named export)`)
process.exit(0)
