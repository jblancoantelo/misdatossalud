import initSqlJs from 'sql.js'
import { HealthStore } from '../db/store'

/** Crea un store en memoria con sql.js para los tests. */
export async function createTestStore(): Promise<HealthStore> {
  const SQL = await initSqlJs()
  return new HealthStore(new SQL.Database())
}
