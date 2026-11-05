import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

let sqlPromise: Promise<SqlJsStatic> | null = null

/** Carga sql.js una sola vez y sirve el wasm desde el propio bundle (offline). */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file: string) => (file.endsWith('.wasm') ? wasmUrl : file),
    })
  }
  return sqlPromise
}
