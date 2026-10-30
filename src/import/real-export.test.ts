import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { importZeppArchive } from './zepp'
import { createTestStore } from '../test/helpers'

/**
 * Prueba de integración con el export real.
 *
 * Los exports no se commitean (están en .gitignore), así que este test se salta
 * en cualquier máquina que no los tenga. Sirve para validar el importador
 * completo antes de tocar la app.
 */
const ROOT = join(process.cwd(), 'export_full')
const AVAILABLE = existsSync(ROOT)

describe.skipIf(!AVAILABLE)('export real de Zepp', () => {
  it(
    'importa el histórico completo y cuadra los totales',
    async () => {
      const zip = new JSZip()
      for (const folder of readdirSync(ROOT)) {
        const dir = join(ROOT, folder)
        let files: string[]
        try {
          files = readdirSync(dir)
        } catch {
          continue
        }
        for (const file of files) {
          if (!file.toLowerCase().endsWith('.csv')) continue
          zip.file(`${folder}/${file}`, readFileSync(join(dir, file)), { binary: true })
        }
      }

      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
      const store = await createTestStore()
      const started = Date.now()
      const result = await importZeppArchive(store, new Blob([bytes as unknown as BlobPart]))
      const elapsed = Date.now() - started

      const coverage = store.getCoverage()

      expect(result.totalRows).toBeGreaterThan(900_000)
      expect(coverage.activity.rows).toBeGreaterThan(2_000)
      expect(coverage.minutes.rows).toBeGreaterThan(150_000)
      expect(coverage.heart.rows).toBeGreaterThan(400_000)
      expect(coverage.sleep.rows).toBeGreaterThan(2_000)
      expect(coverage.sport.rows).toBe(983)

      const first = store.getDailyActivity('2020-01-01', '2020-01-01')[0]
      expect(first.steps).toBe(14526)

      const sport = store.getSports(1)[0]
      expect(sport.type).toBe(16)

      const range = store.getOverallRange()
      expect(range.first).toBe('2020-01-01')
      expect(range.last).toBe('2026-10-29')

      // Presupuesto de tiempo generoso: en un portátil normal tarda segundos.
      expect(elapsed).toBeLessThan(240_000)
    },
    300_000,
  )
})
