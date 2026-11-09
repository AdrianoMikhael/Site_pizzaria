import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const migrationUrls = [
  new URL('./migrations/001_initial.sql', import.meta.url),
  new URL('./migrations/002_pizza_customization.sql', import.meta.url),
  new URL('./migrations/003_authentication.sql', import.meta.url),
  new URL('./migrations/004_email_verification.sql', import.meta.url),
  new URL('./migrations/005_store_delivery_chat.sql', import.meta.url),
  new URL('./migrations/006_order_operations.sql', import.meta.url),
  new URL('./migrations/007_admin_orders_inventory_schedule.sql', import.meta.url),
  new URL('./migrations/008_customer_inventory_notifications.sql', import.meta.url),
  new URL('./migrations/009_chat_unread.sql', import.meta.url),
]

export async function createDatabase(path?: string) {
  const resolvedPath = path ? resolve(path) : undefined
  if (resolvedPath) await mkdir(dirname(resolvedPath), { recursive: true })
  const database = resolvedPath ? new PGlite(resolvedPath) : new PGlite()
  for (const migrationUrl of migrationUrls) {
    const migration = await readFile(fileURLToPath(migrationUrl), 'utf8')
    await database.exec(migration)
  }
  return database
}

export type Database = Awaited<ReturnType<typeof createDatabase>>
