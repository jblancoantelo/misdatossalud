// Sube la versión de package.json (y package-lock.json) y sugiere el commit.
// Uso: npm run bump [patch|minor|major]   (por defecto: patch)

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const kind = process.argv[2] ?? 'patch'
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Uso: npm run bump [patch|minor|major]')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version)
if (!match) {
  console.error(`Versión no válida en package.json: ${pkg.version}`)
  process.exit(1)
}

let [major, minor, patch] = match.slice(1).map(Number)
if (kind === 'major') {
  major += 1
  minor = 0
  patch = 0
} else if (kind === 'minor') {
  minor += 1
  patch = 0
} else {
  patch += 1
}
const next = `${major}.${minor}.${patch}`

pkg.version = next
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)

if (existsSync('package-lock.json')) {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  lock.version = next
  if (lock.packages?.['']) lock.packages[''].version = next
  writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`)
}

console.log(`Versión: ${match[0]} → ${next}`)
console.log(`Siguiente paso: git add -A && git commit -m "chore: versión ${next}" && git push`)
