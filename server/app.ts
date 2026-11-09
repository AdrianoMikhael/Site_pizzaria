import { randomBytes, randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import cors from '@fastify/cors'
import Fastify, { type FastifyRequest } from 'fastify'
import { ZodError, z } from 'zod'
import {
  createSession, deleteCurrentSession, expiredSessionCookie, getSessionUser, hashPassword,
  hashToken, normalizeEmail, publicUser, requireUser, sessionCookie, verifyPassword, type AuthUser,
} from './auth.js'
import { config } from './config.js'
import { createDatabase, type Database } from './db/database.js'
import { sendOrderStatusEmail, sendVerificationEmail } from './email.js'
import { ApiError } from './errors.js'
import {
  categoryInputSchema, categoryUpdateSchema, createOrderSchema, orderStatusSchema,
  chatConversationSchema, chatMessageSchema, chatStatusSchema, deliveryQuoteSchema,
  deliveryReviewSchema, deliveryZoneInputSchema, deliveryZoneUpdateSchema,
  customizationAvailabilitySchema, ingredientInputSchema, ingredientUpdateSchema,
  loginSchema, paymentStatusSchema, productInputSchema, productUpdateSchema, profileUpdateSchema,
  registerSchema, resendVerificationSchema, savedAddressSchema, storeSettingsSchema, verifyEmailSchema,
} from './schemas.js'

type BuildAppOptions = {
  database?: Database
  databasePath?: string
  adminApiKey?: string
  sessionDays?: number
  webPublicUrl?: string
  resendApiKey?: string
  emailFrom?: string
}

type ProductRow = {
  id: string
  category_id: string
  category_slug: string
  category_name: string
  name: string
  description: string
  base_price: string | number
  image_url: string | null
  stock_quantity: number | null
}

type PizzaOptionRow = { id: string; name: string; price_delta: string | number; stock_quantity: number | null }

const demoAccounts = {
  'cliente@pizzaria.local': { role: 'customer' as const, name: 'Cliente de Teste', phone: '11999990001', password: 'PizzaCliente123' },
  'admin@pizzaria.local': { role: 'admin' as const, name: 'Administrador de Teste', phone: null, password: 'PizzaAdmin123' },
}

const statusTransitions: Record<string, string[]> = {
  received: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'completed', 'cancelled'],
  out_for_delivery: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

const normalizePhone = (phone: string) => phone.replace(/\D/g, '')
const money = (cents: number) => Number((cents / 100).toFixed(2))
const trackingCode = () => `PZ-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`
const slugify = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const normalizeLocation = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
const safeReturnPath = (value: string | undefined, fallback = '/') => {
  if (!value || !/^\/(?![/\\])/.test(value) || /[\r\n]/.test(value)) return fallback
  try {
    const parsed = new URL(value, 'http://local.invalid')
    if (parsed.origin !== 'http://local.invalid') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

async function requireAdmin(request: FastifyRequest, database: Database, adminApiKey: string) {
  if (!config.isProduction && request.headers['x-admin-key'] === adminApiKey) return
  const user = await getSessionUser(request, database)
  if (!user || user.role !== 'admin') throw new ApiError(401, 'Acesso administrativo não autorizado.')
}

async function getOrderDetails(database: Database, orderId: string) {
  const orderResult = await database.query(
    `SELECT
       o.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
       a.street, a.number, a.complement, a.neighborhood, a.city, a.state, a.postal_code, a.reference
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN addresses a ON a.id = o.address_id
     WHERE o.id = $1`,
    [orderId],
  )

  const order = orderResult.rows[0] as Record<string, unknown> | undefined
  if (!order) throw new ApiError(404, 'Pedido não encontrado.')

  const [itemsResult, historyResult, notificationsResult] = await Promise.all([
    database.query('SELECT id, product_id, product_name, unit_price, quantity, notes, customizations FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]),
    database.query('SELECT status, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at', [orderId]),
    database.query('SELECT status, recipient, delivery, error, created_at FROM order_email_notifications WHERE order_id = $1 ORDER BY created_at', [orderId]),
  ])

  return { ...order, items: itemsResult.rows, status_history: historyResult.rows, email_notifications: notificationsResult.rows }
}

type StoreOperation = {
  status: 'automatic' | 'open' | 'closed' | 'paused'
  opensAt: string
  closesAt: string
  etaMin: number
  etaMax: number
  deliveryRadiusKm: number
  weeklyHours?: Record<string, { enabled: boolean; opensAt: string; closesAt: string }>
  specialDates?: Array<{ date: string; label: string; closed: boolean; opensAt?: string; closesAt?: string }>
}

const defaultOperation: StoreOperation = {
  status: 'automatic', opensAt: '18:00', closesAt: '22:30', etaMin: 35, etaMax: 40, deliveryRadiusKm: 5,
  weeklyHours: {
    monday: { enabled: false, opensAt: '18:00', closesAt: '22:30' },
    tuesday: { enabled: true, opensAt: '18:00', closesAt: '22:30' },
    wednesday: { enabled: true, opensAt: '18:00', closesAt: '22:30' },
    thursday: { enabled: true, opensAt: '18:00', closesAt: '22:30' },
    friday: { enabled: true, opensAt: '18:00', closesAt: '23:00' },
    saturday: { enabled: true, opensAt: '18:00', closesAt: '23:00' },
    sunday: { enabled: true, opensAt: '18:00', closesAt: '22:30' },
  }, specialDates: [],
}

async function getSettings(database: Database) {
  const result = await database.query('SELECT key, value FROM store_settings ORDER BY key')
  return Object.fromEntries(result.rows.map((row) => [String((row as { key: string }).key), (row as { value: unknown }).value])) as Record<string, unknown>
}

function computedStoreState(operationValue: unknown) {
  const supplied = operationValue as Partial<StoreOperation> ?? {}
  const operation = { ...defaultOperation, ...supplied, weeklyHours: { ...defaultOperation.weeklyHours, ...supplied.weeklyHours }, specialDates: supplied.specialDates ?? [] }
  const now = new Date()
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]))
  const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(now).toLowerCase()
  const special = operation.specialDates?.find((item) => item.date === date)
  const regular = operation.weeklyHours?.[weekday]
  const enabled = special ? !special.closed : (regular?.enabled ?? true)
  const opensAt = special?.opensAt ?? regular?.opensAt ?? operation.opensAt
  const closesAt = special?.closesAt ?? regular?.closesAt ?? operation.closesAt
  const automaticOpen = enabled && (opensAt <= closesAt ? time >= opensAt && time < closesAt : time >= opensAt || time < closesAt)
  const currentStatus = operation.status === 'automatic' ? (automaticOpen ? 'open' : 'closed') : operation.status
  return {
    operation,
    effectiveHours: { date, weekday, enabled, opensAt, closesAt, label: special?.label ?? null },
    currentStatus,
    isAcceptingOrders: currentStatus === 'open',
    statusLabel: currentStatus === 'open' ? 'Aberta agora' : currentStatus === 'paused' ? 'Pausada temporariamente' : 'Fechada agora',
  }
}

async function findDeliveryZone(database: Database, neighborhood: string, city: string) {
  const result = await database.query('SELECT id, neighborhood, city, fee, active FROM delivery_zones WHERE active = TRUE')
  return (result.rows as Array<{ id: string; neighborhood: string; city: string; fee: string | number; active: boolean }>).find(
    (zone) => normalizeLocation(zone.neighborhood) === normalizeLocation(neighborhood)
      && normalizeLocation(zone.city) === normalizeLocation(city),
  )
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false })
  const database = options.database ?? (await createDatabase(options.databasePath ?? config.databasePath))
  const adminApiKey = options.adminApiKey ?? config.adminApiKey
  const sessionDays = options.sessionDays ?? config.sessionDays
  const webPublicUrl = options.webPublicUrl ?? config.webPublicUrl
  const resendApiKey = options.resendApiKey ?? config.resendApiKey
  const emailFrom = options.emailFrom ?? config.emailFrom
  const loginAttempts = new Map<string, { count: number; resetAt: number }>()
  const customerChatStreams = new Map<string, Set<ServerResponse>>()
  const adminChatStreams = new Set<ServerResponse>()

  function writeChatEvent(streams: Iterable<ServerResponse>, payload: Record<string, string>) {
    const message = `event: chat\ndata: ${JSON.stringify(payload)}\n\n`
    for (const stream of streams) {
      if (stream.destroyed || stream.writableEnded) continue
      try { stream.write(message) } catch { /* A desconexão remove o stream pelo evento close. */ }
    }
  }

  function notifyCustomerChat(userId: string, payload: Record<string, string>) {
    writeChatEvent(customerChatStreams.get(userId) ?? [], payload)
  }

  function notifyAdminChat(payload: Record<string, string>) {
    writeChatEvent(adminChatStreams, payload)
  }

  const chatHeartbeat = setInterval(() => {
    const keepAlive = ': keep-alive\n\n'
    for (const streams of customerChatStreams.values()) {
      for (const stream of streams) if (!stream.destroyed && !stream.writableEnded) stream.write(keepAlive)
    }
    for (const stream of adminChatStreams) if (!stream.destroyed && !stream.writableEnded) stream.write(keepAlive)
  }, 20_000)

  async function issueEmailVerification(user: { id: string; name: string; email: string; role: 'customer' | 'admin' }, requestedReturnPath?: string) {
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const returnPath = user.role === 'admin' ? '/admin.html' : safeReturnPath(requestedReturnPath)
    await database.transaction(async (transaction) => {
      await transaction.query('DELETE FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL', [user.id])
      await transaction.query(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, return_path)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), user.id, hashToken(token), expiresAt.toISOString(), returnPath],
      )
    })
    const verificationUrl = `${webPublicUrl.replace(/\/$/, '')}/confirmar-email.html?token=${encodeURIComponent(token)}`
    const result = await sendVerificationEmail({
      to: user.email, name: user.name, role: user.role, verificationUrl,
      apiKey: resendApiKey, from: emailFrom,
    })
    return { verificationUrl, delivery: result.delivery }
  }

  async function consumeEmailVerification(token: string) {
    const result = await database.query(
      `SELECT t.id AS token_id, t.user_id, t.return_path, u.role
       FROM email_verification_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > CURRENT_TIMESTAMP
         AND u.active = TRUE`,
      [hashToken(token)],
    )
    const row = result.rows[0] as { token_id: string; user_id: string; return_path: string; role: 'customer' | 'admin' } | undefined
    if (!row) throw new ApiError(400, 'Este link de confirmação é inválido, já foi usado ou expirou.')
    await database.transaction(async (transaction) => {
      await transaction.query('UPDATE users SET email_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [row.user_id])
      await transaction.query('UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1', [row.token_id])
    })
    const destination = new URL(row.role === 'admin' ? '/admin.html' : safeReturnPath(row.return_path), webPublicUrl)
    destination.searchParams.set('email_confirmed', '1')
    return {
      userId: row.user_id,
      redirectTo: `${destination.pathname}${destination.search}${destination.hash}`,
      absoluteRedirectTo: destination.toString(),
    }
  }

  async function recordInventoryMovement(executor: Pick<Database, 'query'>, input: {
    itemType: 'product' | 'size' | 'crust' | 'addon'; itemId: string; itemName: string
    quantityDelta: number; reason: string; orderId?: string | null; adminUserId?: string | null
  }) {
    await executor.query(
      `INSERT INTO inventory_movements
         (id, item_type, item_id, item_name, quantity_delta, reason, order_id, admin_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), input.itemType, input.itemId, input.itemName, input.quantityDelta, input.reason, input.orderId ?? null, input.adminUserId ?? null],
    )
  }

  async function restoreStockForOrder(executor: Pick<Database, 'query'>, orderId: string, reason: string, adminUserId?: string | null) {
    const orderResult = await executor.query('SELECT inventory_restored_at FROM orders WHERE id = $1', [orderId])
    const order = orderResult.rows[0] as { inventory_restored_at: string | null } | undefined
    if (!order || order.inventory_restored_at) return false
    const itemsResult = await executor.query(
      'SELECT product_id, product_name, quantity, customizations FROM order_items WHERE order_id = $1', [orderId],
    )
    for (const row of itemsResult.rows as Array<{ product_id: string | null; product_name: string; quantity: number; customizations: unknown }>) {
      const custom = (row.customizations ?? {}) as {
        flavors?: string[]; secondFlavorId?: string | null
        size?: { id: string; name: string } | null; crust?: { id: string; name: string } | null
        addons?: Array<{ id: string; name: string }>
      }
      const entries: Array<{ type: 'product' | 'size' | 'crust' | 'addon'; id: string; name: string; table: string }> = []
      if (row.product_id) entries.push({ type: 'product', id: row.product_id, name: custom.flavors?.[0] ?? row.product_name, table: 'products' })
      if (custom.secondFlavorId) entries.push({ type: 'product', id: custom.secondFlavorId, name: custom.flavors?.[1] ?? 'Segundo sabor', table: 'products' })
      if (custom.size?.id) entries.push({ type: 'size', id: custom.size.id, name: custom.size.name, table: 'pizza_sizes' })
      if (custom.crust?.id) entries.push({ type: 'crust', id: custom.crust.id, name: custom.crust.name, table: 'pizza_crusts' })
      for (const addon of custom.addons ?? []) entries.push({ type: 'addon', id: addon.id, name: addon.name, table: 'pizza_addons' })
      for (const entry of entries) {
        const restored = await executor.query(`UPDATE ${entry.table} SET stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE stock_quantity + $2 END WHERE id = $1 RETURNING stock_quantity`, [entry.id, row.quantity])
        const restoredRow = restored.rows[0] as { stock_quantity: number | null } | undefined
        if (restoredRow && restoredRow.stock_quantity !== null) {
          await recordInventoryMovement(executor, { itemType: entry.type, itemId: entry.id, itemName: entry.name, quantityDelta: row.quantity, reason, orderId, adminUserId })
        }
      }
    }
    await executor.query('UPDATE orders SET inventory_restored_at = CURRENT_TIMESTAMP WHERE id = $1 AND inventory_restored_at IS NULL', [orderId])
    return true
  }

  async function notifyOrderStatus(orderId: string, status: 'confirmed' | 'ready' | 'out_for_delivery' | 'cancelled', cancellationReason?: string | null) {
    const result = await database.query(
      `SELECT o.tracking_code, c.name, c.email, c.phone
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [orderId],
    )
    const order = result.rows[0] as { tracking_code: string; name: string; email: string | null; phone: string } | undefined
    if (!order?.email) return
    const trackingUrl = `${webPublicUrl.replace(/\/$/, '')}/acompanhar.html?code=${encodeURIComponent(order.tracking_code)}&phone=${encodeURIComponent(order.phone)}`
    try {
      const sent = await sendOrderStatusEmail({
        to: order.email, name: order.name, trackingCode: order.tracking_code, status, trackingUrl,
        cancellationReason, apiKey: resendApiKey, from: emailFrom,
      })
      await database.query(
        'INSERT INTO order_email_notifications (id, order_id, status, recipient, delivery) VALUES ($1,$2,$3,$4,$5)',
        [randomUUID(), orderId, status, order.email, sent.delivery],
      )
    } catch (error) {
      await database.query(
        'INSERT INTO order_email_notifications (id, order_id, status, recipient, delivery, error) VALUES ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), orderId, status, order.email, 'failed', error instanceof Error ? error.message.slice(0, 500) : 'Falha desconhecida'],
      )
    }
  }

  await app.register(cors, { origin: config.isProduction ? false : true, credentials: true })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'Dados inválidos.', details: error.flatten() })
    }
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: error.message })
    }
    if (!config.isProduction) console.error('[API] Erro não tratado:', error)
    app.log.error(error)
    return reply.status(500).send({ error: 'Erro interno do servidor.' })
  })

  app.addHook('onClose', async () => {
    clearInterval(chatHeartbeat)
    for (const streams of customerChatStreams.values()) for (const stream of streams) stream.end()
    for (const stream of adminChatStreams) stream.end()
    customerChatStreams.clear()
    adminChatStreams.clear()
    await database.close()
  })

  app.get('/api/health', async () => {
    await database.query('SELECT 1')
    return { status: 'ok', database: 'connected', timestamp: new Date().toISOString() }
  })

  app.get('/api/store', async () => {
    const settings = await getSettings(database)
    return { ...settings, ...computedStoreState(settings.operation) }
  })

  app.get('/api/delivery/cep/:cep', async (request) => {
    const { cep } = z.object({ cep: z.string() }).parse(request.params)
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) throw new ApiError(400, 'Informe um CEP com 8 números.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: controller.signal })
      if (!response.ok) throw new Error('CEP indisponível')
      const data = await response.json() as Record<string, unknown>
      if (data.erro) throw new ApiError(404, 'CEP não encontrado.')
      return {
        postalCode: data.cep, street: data.logradouro, complement: data.complement,
        neighborhood: data.bairro, city: data.localidade, state: data.uf,
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(503, 'Não foi possível consultar o CEP agora. Você ainda pode preencher o endereço manualmente.')
    } finally { clearTimeout(timeout) }
  })

  app.post('/api/delivery/quote', async (request) => {
    const input = deliveryQuoteSchema.parse(request.body)
    const zone = await findDeliveryZone(database, input.neighborhood, input.city)
    const settings = await getSettings(database)
    const radius = computedStoreState(settings.operation).operation.deliveryRadiusKm
    if (!zone) return {
      serviceStatus: 'review', deliveryFee: null, zoneId: null, radiusKm: radius,
      message: `Este endereço não está em um bairro cadastrado no raio padrão de ${radius} km. O pedido poderá ser enviado para análise da pizzaria.`,
    }
    return {
      serviceStatus: 'available', deliveryFee: Number(zone.fee), zoneId: zone.id, radiusKm: radius,
      message: `Entrega disponível para ${zone.neighborhood}.`,
    }
  })

  app.get('/api/admin/settings', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async () => {
    const settings = await getSettings(database)
    return { profile: settings.profile, operation: computedStoreState(settings.operation).operation }
  })

  app.patch('/api/admin/settings', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const input = storeSettingsSchema.parse(request.body)
    await database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO store_settings (key, value) VALUES ('profile', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(input.profile)],
      )
      await transaction.query(
        `INSERT INTO store_settings (key, value) VALUES ('operation', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(input.operation)],
      )
    })
    return { ...input, ...computedStoreState(input.operation) }
  })

  app.get('/api/admin/delivery-zones', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async () => {
    const result = await database.query('SELECT id, neighborhood, city, fee, active, updated_at FROM delivery_zones ORDER BY city, neighborhood')
    return { zones: result.rows }
  })

  app.post('/api/admin/delivery-zones', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request, reply) => {
    const input = deliveryZoneInputSchema.parse(request.body)
    const allZones = await database.query('SELECT id, neighborhood, city FROM delivery_zones')
    const duplicate = (allZones.rows as Array<{ id: string; neighborhood: string; city: string }>).find(
      (zone) => normalizeLocation(zone.neighborhood) === normalizeLocation(input.neighborhood)
        && normalizeLocation(zone.city) === normalizeLocation(input.city),
    )
    if (duplicate) throw new ApiError(409, 'Este bairro já está cadastrado para a cidade informada.')
    const result = await database.query(
      `INSERT INTO delivery_zones (id, neighborhood, city, fee, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, neighborhood, city, fee, active, updated_at`,
      [randomUUID(), input.neighborhood, input.city, input.fee, input.active],
    )
    return reply.status(201).send(result.rows[0])
  })

  app.patch('/api/admin/delivery-zones/:id', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = deliveryZoneUpdateSchema.parse(request.body)
    const currentResult = await database.query('SELECT * FROM delivery_zones WHERE id = $1', [id])
    const current = currentResult.rows[0] as { neighborhood: string; city: string; fee: string; active: boolean } | undefined
    if (!current) throw new ApiError(404, 'Bairro de entrega não encontrado.')
    const result = await database.query(
      `UPDATE delivery_zones SET neighborhood = $2, city = $3, fee = $4, active = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING id, neighborhood, city, fee, active, updated_at`,
      [id, input.neighborhood ?? current.neighborhood, input.city ?? current.city,
        input.fee ?? Number(current.fee), input.active ?? current.active],
    )
    return result.rows[0]
  })

  app.post('/api/auth/register', async (request, reply) => {
    const input = registerSchema.parse(request.body)
    if (input.role === 'admin') {
      const admins = await database.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin' AND active = TRUE")
      if (Number((admins.rows[0] as { total: number }).total) > 0) {
        throw new ApiError(403, 'O primeiro administrador já foi cadastrado. Entre com a conta administrativa existente.')
      }
    }
    const email = normalizeEmail(input.email)
    const existing = await database.query('SELECT id FROM users WHERE LOWER(email) = $1', [email])
    if (existing.rows[0]) throw new ApiError(409, 'Já existe uma conta com este e-mail.')
    const userId = randomUUID()
    const password = await hashPassword(input.password)
    const phone = input.phone ? normalizePhone(input.phone) : null
    await database.query(
      `INSERT INTO users (id, role, name, email, phone, password_hash, password_salt, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
      [userId, input.role, input.name, email, phone, password.hash, password.salt],
    )
    const verification = await issueEmailVerification({ id: userId, role: input.role, name: input.name, email }, input.returnTo)
    return reply.status(201).send({
      requiresEmailVerification: true,
      email,
      message: 'Cadastro criado. Abra o link enviado ao seu e-mail para ativar a conta.',
      ...(!config.isProduction && verification.delivery === 'development'
        ? { developmentVerificationUrl: verification.verificationUrl }
        : {}),
    })
  })

  app.post('/api/auth/resend-verification', async (request, reply) => {
    const input = resendVerificationSchema.parse(request.body)
    const email = normalizeEmail(input.email)
    const result = await database.query(
      `SELECT u.id, u.role, u.name, u.email,
              (SELECT t.return_path FROM email_verification_tokens t
               WHERE t.user_id = u.id ORDER BY t.created_at DESC LIMIT 1) AS return_path
       FROM users u
       WHERE LOWER(email) = $1 AND active = TRUE AND email_verified_at IS NULL`,
      [email],
    )
    const user = result.rows[0] as { id: string; role: 'customer' | 'admin'; name: string; email: string; return_path: string | null } | undefined
    let developmentVerificationUrl: string | undefined
    if (user) {
      const verification = await issueEmailVerification(user, user.return_path ?? undefined)
      if (!config.isProduction && verification.delivery === 'development') developmentVerificationUrl = verification.verificationUrl
    }
    return reply.status(202).send({
      message: 'Se houver uma conta pendente com este e-mail, um novo link foi gerado.',
      ...(developmentVerificationUrl ? { developmentVerificationUrl } : {}),
    })
  })

  app.post('/api/auth/verify-email', async (request, reply) => {
    const { token } = verifyEmailSchema.parse(request.body)
    const verified = await consumeEmailVerification(token)
    const sessionToken = await createSession(database, verified.userId, sessionDays)
    reply.header('set-cookie', sessionCookie(sessionToken, sessionDays, config.isProduction))
    return { redirectTo: verified.redirectTo }
  })

  app.get('/api/auth/verify-email', async (request, reply) => {
    const { token } = verifyEmailSchema.parse(request.query)
    try {
      const verified = await consumeEmailVerification(token)
      const sessionToken = await createSession(database, verified.userId, sessionDays)
      reply.header('set-cookie', sessionCookie(sessionToken, sessionDays, config.isProduction))
      return reply.redirect(verified.absoluteRedirectTo)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      const invalidUrl = new URL('/', webPublicUrl)
      invalidUrl.searchParams.set('email_error', 'invalid_or_expired')
      return reply.redirect(invalidUrl.toString())
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body)
    const email = normalizeEmail(input.email)
    const demo = demoAccounts[email as keyof typeof demoAccounts]
    if (config.isProduction && demo) throw new ApiError(401, 'Esta conta de demonstração só funciona no ambiente local.')
    if (!config.isProduction && demo && input.password === demo.password) {
      const password = await hashPassword(demo.password)
      await database.query(
        `INSERT INTO users (id, role, name, email, phone, password_hash, password_salt, email_verified_at, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, TRUE)
         ON CONFLICT (email) DO UPDATE SET
           role = EXCLUDED.role, name = EXCLUDED.name, phone = EXCLUDED.phone,
           password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt,
           email_verified_at = CURRENT_TIMESTAMP, active = TRUE, updated_at = CURRENT_TIMESTAMP`,
        [randomUUID(), demo.role, demo.name, email, demo.phone, password.hash, password.salt],
      )
    }
    const attemptKey = `${request.ip}:${email}`
    const attempt = loginAttempts.get(attemptKey)
    if (attempt && attempt.resetAt > Date.now() && attempt.count >= 10) {
      throw new ApiError(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.')
    }
    const result = await database.query(
      `SELECT id, role, name, email, phone, preferences, email_verified_at, password_hash, password_salt
       FROM users WHERE LOWER(email) = $1 AND active = TRUE`,
      [email],
    )
    const row = result.rows[0] as (AuthUser & { password_hash: string; password_salt: string }) | undefined
    const valid = row ? await verifyPassword(input.password, row.password_salt, row.password_hash) : false
    if (!row || !valid) {
      const current = attempt && attempt.resetAt > Date.now() ? attempt : { count: 0, resetAt: Date.now() + 15 * 60 * 1000 }
      loginAttempts.set(attemptKey, { ...current, count: current.count + 1 })
      throw new ApiError(401, 'E-mail ou senha inválidos.')
    }
    if (!row.email_verified_at) {
      throw new ApiError(403, 'Confirme seu e-mail antes de entrar. Use o link enviado no cadastro.')
    }
    loginAttempts.delete(attemptKey)
    await database.query('DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP')
    const token = await createSession(database, row.id, sessionDays)
    reply.header('set-cookie', sessionCookie(token, sessionDays, config.isProduction))
    return { user: publicUser(row) }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    await deleteCurrentSession(request, database)
    reply.header('set-cookie', expiredSessionCookie(config.isProduction))
    return reply.status(204).send()
  })

  app.get('/api/auth/me', async (request) => {
    const user = await requireUser(request, database)
    return { user: publicUser(user) }
  })

  app.patch('/api/auth/profile', async (request) => {
    const user = await requireUser(request, database)
    const input = profileUpdateSchema.parse(request.body)
    const preferences = input.preferences ? { ...user.preferences, ...input.preferences } : user.preferences
    await database.query(
      `UPDATE users SET name = $2, phone = $3, preferences = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [user.id, input.name ?? user.name, input.phone === undefined ? user.phone : (input.phone ? normalizePhone(input.phone) : null), JSON.stringify(preferences)],
    )
    const updated = await database.query('SELECT id, role, name, email, phone, preferences, email_verified_at FROM users WHERE id = $1', [user.id])
    return { user: publicUser(updated.rows[0] as AuthUser) }
  })

  app.get('/api/auth/orders', async (request) => {
    const user = await requireUser(request, database)
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query)
    const [result, count] = await Promise.all([database.query(
      `SELECT o.id, o.tracking_code, o.fulfillment_type, o.payment_method, o.payment_status,
              o.order_status, o.total, o.created_at
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE c.user_id = $1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [user.id, query.limit, (query.page - 1) * query.limit],
    ), database.query('SELECT COUNT(*)::int AS total FROM orders o JOIN customers c ON c.id=o.customer_id WHERE c.user_id=$1', [user.id])])
    return { orders: result.rows, total: Number((count.rows[0] as { total: number }).total), page: query.page }
  })

  app.get('/api/auth/orders/:id', async (request) => {
    const user = await requireUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const owned = await database.query('SELECT o.id FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=$1 AND c.user_id=$2', [id, user.id])
    if (!owned.rows[0]) throw new ApiError(404, 'Pedido não encontrado na sua conta.')
    return getOrderDetails(database, id)
  })

  app.get('/api/auth/addresses', async (request) => {
    const user = await requireUser(request, database)
    const result = await database.query(
      `SELECT id, label, street, number, complement, neighborhood, city, state,
              postal_code AS "postalCode", reference, is_default, created_at
       FROM user_saved_addresses WHERE user_id=$1 ORDER BY is_default DESC, created_at`, [user.id],
    )
    return { addresses: result.rows }
  })

  app.post('/api/auth/addresses', async (request, reply) => {
    const user = await requireUser(request, database)
    const input = savedAddressSchema.extend({ label: z.string().trim().min(2).max(40), isDefault: z.boolean().default(false) }).parse(request.body)
    const id = randomUUID()
    await database.transaction(async (transaction) => {
      const count = await transaction.query('SELECT COUNT(*)::int AS total FROM user_saved_addresses WHERE user_id=$1', [user.id])
      const makeDefault = input.isDefault || Number((count.rows[0] as { total: number }).total) === 0
      if (makeDefault) await transaction.query('UPDATE user_saved_addresses SET is_default=FALSE WHERE user_id=$1', [user.id])
      await transaction.query(
        `INSERT INTO user_saved_addresses
           (id,user_id,label,street,number,complement,neighborhood,city,state,postal_code,reference,is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, user.id, input.label, input.street, input.number, input.complement ?? null, input.neighborhood, input.city, input.state, input.postalCode, input.reference ?? null, makeDefault],
      )
    })
    return reply.status(201).send({ id })
  })

  app.patch('/api/auth/addresses/:id', async (request) => {
    const user = await requireUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = savedAddressSchema.extend({ label: z.string().trim().min(2).max(40), isDefault: z.boolean().default(false) }).parse(request.body)
    await database.transaction(async (transaction) => {
      if (input.isDefault) await transaction.query('UPDATE user_saved_addresses SET is_default=FALSE WHERE user_id=$1', [user.id])
      const updated = await transaction.query(
        `UPDATE user_saved_addresses SET label=$3,street=$4,number=$5,complement=$6,neighborhood=$7,city=$8,state=$9,postal_code=$10,reference=$11,is_default=$12,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND user_id=$2 RETURNING id`,
        [id, user.id, input.label, input.street, input.number, input.complement ?? null, input.neighborhood, input.city, input.state, input.postalCode, input.reference ?? null, input.isDefault],
      )
      if (!updated.rows[0]) throw new ApiError(404, 'Endereço não encontrado.')
    })
    return { id }
  })

  app.delete('/api/auth/addresses/:id', async (request, reply) => {
    const user = await requireUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const removed = await database.query('DELETE FROM user_saved_addresses WHERE id=$1 AND user_id=$2 RETURNING is_default', [id, user.id])
    if (!removed.rows[0]) throw new ApiError(404, 'Endereço não encontrado.')
    if ((removed.rows[0] as { is_default: boolean }).is_default) await database.query(
      'UPDATE user_saved_addresses SET is_default=TRUE WHERE id=(SELECT id FROM user_saved_addresses WHERE user_id=$1 ORDER BY created_at LIMIT 1)', [user.id],
    )
    return reply.status(204).send()
  })

  app.get('/api/auth/favorites', async (request) => {
    const user = await requireUser(request, database)
    const result = await database.query(
      `SELECT p.id,p.category_id,c.slug AS category_slug,c.name AS category_name,p.name,p.description,p.base_price,p.image_url,p.stock_quantity,f.created_at AS favorited_at
       FROM user_favorite_products f JOIN products p ON p.id=f.product_id JOIN categories c ON c.id=p.category_id
       WHERE f.user_id=$1 ORDER BY f.created_at DESC`, [user.id],
    )
    return { products: result.rows }
  })

  app.post('/api/auth/favorites/:productId', async (request, reply) => {
    const user = await requireUser(request, database)
    const { productId } = z.object({ productId: z.string() }).parse(request.params)
    const product = await database.query('SELECT id FROM products WHERE id=$1', [productId])
    if (!product.rows[0]) throw new ApiError(404, 'Produto não encontrado.')
    await database.query('INSERT INTO user_favorite_products (user_id,product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, productId])
    return reply.status(201).send({ productId })
  })

  app.delete('/api/auth/favorites/:productId', async (request, reply) => {
    const user = await requireUser(request, database)
    const { productId } = z.object({ productId: z.string() }).parse(request.params)
    await database.query('DELETE FROM user_favorite_products WHERE user_id=$1 AND product_id=$2', [user.id, productId])
    return reply.status(204).send()
  })

  app.get('/api/categories', async () => {
    const result = await database.query('SELECT id, slug, name, sort_order FROM categories WHERE active = TRUE ORDER BY sort_order, name')
    return { categories: result.rows }
  })

  app.get('/api/customizations', async () => {
    const [sizes, crusts, addons] = await Promise.all([
      database.query('SELECT id, name, slices, price_delta FROM pizza_sizes WHERE active = TRUE AND (stock_quantity IS NULL OR stock_quantity > 0) ORDER BY sort_order'),
      database.query('SELECT id, name, price_delta FROM pizza_crusts WHERE active = TRUE AND (stock_quantity IS NULL OR stock_quantity > 0) ORDER BY sort_order'),
      database.query('SELECT id, name, price_delta FROM pizza_addons WHERE active = TRUE AND (stock_quantity IS NULL OR stock_quantity > 0) ORDER BY sort_order'),
    ])
    return { sizes: sizes.rows, crusts: crusts.rows, addons: addons.rows }
  })

  app.get('/api/products', async (request) => {
    const query = z.object({ category: z.string().optional(), search: z.string().max(100).optional() }).parse(request.query)
    const values: string[] = []
    const clauses = [
      'p.active = TRUE', 'c.active = TRUE', '(p.stock_quantity IS NULL OR p.stock_quantity > 0)',
      `NOT EXISTS (SELECT 1 FROM product_ingredients pi JOIN ingredients i ON i.id = pi.ingredient_id
                   WHERE pi.product_id = p.id AND i.active = FALSE)`,
    ]

    if (query.category) {
      values.push(query.category)
      clauses.push(`c.slug = $${values.length}`)
    }
    if (query.search) {
      values.push(`%${query.search}%`)
      clauses.push(`(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length})`)
    }

    const result = await database.query(
      `SELECT p.id, p.category_id, c.slug AS category_slug, c.name AS category_name,
              p.name, p.description, p.base_price, p.image_url, p.stock_quantity
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY c.sort_order, p.name`,
      values,
    )
    return { products: result.rows }
  })

  app.get('/api/products/:id', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const result = await database.query(
      `SELECT p.id, p.category_id, c.slug AS category_slug, c.name AS category_name,
              p.name, p.description, p.base_price, p.image_url, p.stock_quantity
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1 AND p.active = TRUE AND (p.stock_quantity IS NULL OR p.stock_quantity > 0)
         AND NOT EXISTS (SELECT 1 FROM product_ingredients pi JOIN ingredients i ON i.id = pi.ingredient_id
                         WHERE pi.product_id = p.id AND i.active = FALSE)`,
      [id],
    )
    if (!result.rows[0]) throw new ApiError(404, 'Produto não encontrado.')
    return result.rows[0]
  })

  app.post('/api/orders', async (request, reply) => {
    const input = createOrderSchema.parse(request.body)
    const sessionUser = await getSessionUser(request, database)
    const settings = await getSettings(database)
    const storeState = computedStoreState(settings.operation)
    const assistedByAdmin = sessionUser?.role === 'admin'
    if (!assistedByAdmin && !storeState.isAcceptingOrders) {
      throw new ApiError(409, storeState.currentStatus === 'paused'
        ? 'A pizzaria pausou os pedidos temporariamente.'
        : storeState.effectiveHours.enabled
          ? `A pizzaria está fechada. O horário de hoje é das ${storeState.effectiveHours.opensAt} às ${storeState.effectiveHours.closesAt}.`
          : 'A pizzaria não abre hoje.')
    }
    const uniqueProductIds = [...new Set(input.items.flatMap((item) => [item.productId, item.secondFlavorId].filter(Boolean) as string[]))]
    const products = new Map<string, ProductRow>()

    for (const productId of uniqueProductIds) {
      const result = await database.query(
        `SELECT p.id, p.category_id, c.slug AS category_slug, c.name AS category_name,
                p.name, p.description, p.base_price, p.image_url, p.stock_quantity
         FROM products p JOIN categories c ON c.id = p.category_id
         WHERE p.id = $1 AND p.active = TRUE AND (p.stock_quantity IS NULL OR p.stock_quantity > 0)
           AND NOT EXISTS (SELECT 1 FROM product_ingredients pi JOIN ingredients i ON i.id = pi.ingredient_id
                           WHERE pi.product_id = p.id AND i.active = FALSE)`,
        [productId],
      )
      const product = result.rows[0] as ProductRow | undefined
      if (!product) throw new ApiError(400, `Produto indisponível: ${productId}`)
      products.set(productId, product)
    }

    const sizes = new Map<string, PizzaOptionRow>()
    const crusts = new Map<string, PizzaOptionRow>()
    const addons = new Map<string, PizzaOptionRow>()
    for (const id of [...new Set(input.items.map((item) => item.sizeId).filter(Boolean) as string[])]) {
      const result = await database.query('SELECT id, name, price_delta, stock_quantity FROM pizza_sizes WHERE id = $1 AND active = TRUE AND (stock_quantity IS NULL OR stock_quantity > 0)', [id])
      const option = result.rows[0] as PizzaOptionRow | undefined
      if (!option) throw new ApiError(400, `Tamanho indisponível: ${id}`)
      sizes.set(id, option)
    }
    for (const id of [...new Set(input.items.map((item) => item.crustId).filter(Boolean) as string[])]) {
      const result = await database.query('SELECT id, name, price_delta, stock_quantity FROM pizza_crusts WHERE id = $1 AND active = TRUE AND (stock_quantity IS NULL OR stock_quantity > 0)', [id])
      const option = result.rows[0] as PizzaOptionRow | undefined
      if (!option) throw new ApiError(400, `Borda indisponível: ${id}`)
      crusts.set(id, option)
    }
    for (const id of [...new Set(input.items.flatMap((item) => item.addonIds))]) {
      const result = await database.query('SELECT id, name, price_delta, stock_quantity FROM pizza_addons WHERE id = $1 AND active = TRUE AND (stock_quantity IS NULL OR stock_quantity > 0)', [id])
      const option = result.rows[0] as PizzaOptionRow | undefined
      if (!option) throw new ApiError(400, `Adicional indisponível: ${id}`)
      addons.set(id, option)
    }

    const pricedItems = input.items.map((item) => {
      const product = products.get(item.productId)!
      const isPizza = ['pizzas', 'pizzas-doces'].includes(product.category_slug)
      const hasCustomization = Boolean(item.secondFlavorId || item.sizeId || item.crustId || item.addonIds.length)
      if (hasCustomization && !isPizza) throw new ApiError(400, 'Somente pizzas aceitam personalizações.')
      const secondFlavor = item.secondFlavorId ? products.get(item.secondFlavorId) : undefined
      if (secondFlavor && secondFlavor.category_slug !== product.category_slug) {
        throw new ApiError(400, 'O segundo sabor deve pertencer à mesma categoria da pizza.')
      }
      const size = item.sizeId ? sizes.get(item.sizeId) : undefined
      const crust = item.crustId ? crusts.get(item.crustId) : undefined
      const selectedAddons = item.addonIds.map((id) => addons.get(id)!)
      const baseCents = Math.max(
        Math.round(Number(product.base_price) * 100),
        secondFlavor ? Math.round(Number(secondFlavor.base_price) * 100) : 0,
      )
      const extrasCents = [size, crust, ...selectedAddons].reduce(
        (total, option) => total + (option ? Math.round(Number(option.price_delta) * 100) : 0), 0,
      )
      return {
        input: item,
        product,
        productName: secondFlavor ? `${product.name} / ${secondFlavor.name}` : product.name,
        unitCents: baseCents + extrasCents,
        customizations: hasCustomization ? {
          flavors: [product.name, ...(secondFlavor ? [secondFlavor.name] : [])],
          secondFlavorId: secondFlavor?.id ?? null,
          size: size ? { id: size.id, name: size.name, priceDelta: Number(size.price_delta) } : null,
          crust: crust ? { id: crust.id, name: crust.name, priceDelta: Number(crust.price_delta) } : null,
          addons: selectedAddons.map((option) => ({ id: option.id, name: option.name, priceDelta: Number(option.price_delta) })),
        } : {},
      }
    })
    const subtotalCents = pricedItems.reduce((total, item) => total + item.unitCents * item.input.quantity, 0)
    const deliveryZone = input.fulfillmentType === 'delivery' && input.address
      ? await findDeliveryZone(database, input.address.neighborhood, input.address.city)
      : undefined
    const deliveryReviewStatus = input.fulfillmentType === 'delivery' && !deliveryZone ? 'pending' : 'not_required'
    const deliveryFeeCents = deliveryZone ? Math.round(Number(deliveryZone.fee) * 100) : 0
    const totalCents = subtotalCents + deliveryFeeCents

    if (input.changeFor !== undefined && Math.round(input.changeFor * 100) < totalCents) {
      throw new ApiError(400, 'O valor para troco não pode ser menor que o total do pedido.')
    }

    const orderId = randomUUID()
    const customerId = randomUUID()
    const addressId = input.address ? randomUUID() : null
    const code = trackingCode()

    await database.transaction(async (transaction) => {
      await transaction.query(
        'INSERT INTO customers (id, user_id, name, phone, email) VALUES ($1, $2, $3, $4, $5)',
        [customerId, sessionUser?.role === 'customer' ? sessionUser.id : null, input.customer.name, normalizePhone(input.customer.phone), input.customer.email ?? (sessionUser?.role === 'customer' ? sessionUser.email : null)],
      )

      if (sessionUser?.role === 'customer') {
        const savedOrderNotes = input.saveNote && input.notes
          ? [...new Set([...(sessionUser.preferences.savedOrderNotes ?? []), input.notes])].slice(-10)
          : sessionUser.preferences.savedOrderNotes
        const preferences = {
          ...sessionUser.preferences,
          fulfillmentType: input.fulfillmentType,
          paymentMethod: input.paymentMethod,
          ...(input.address ? { address: input.address } : {}),
          ...(savedOrderNotes ? { savedOrderNotes } : {}),
        }
        await transaction.query(
          `UPDATE users SET name = $2, phone = $3, preferences = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [sessionUser.id, input.customer.name, normalizePhone(input.customer.phone), JSON.stringify(preferences)],
        )
      }

      if (input.address && addressId) {
        await transaction.query(
          `INSERT INTO addresses
             (id, customer_id, street, number, complement, neighborhood, city, state, postal_code, reference)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            addressId, customerId, input.address.street, input.address.number,
            input.address.complement ?? null, input.address.neighborhood, input.address.city,
            input.address.state, input.address.postalCode, input.address.reference ?? null,
          ],
        )
        if (sessionUser?.role === 'customer' && input.saveAddressLabel) {
          const duplicate = await transaction.query(
            `SELECT id FROM user_saved_addresses WHERE user_id=$1 AND street=$2 AND number=$3 AND postal_code=$4`,
            [sessionUser.id, input.address.street, input.address.number, input.address.postalCode],
          )
          if (!duplicate.rows[0]) {
            const savedCount = await transaction.query('SELECT COUNT(*)::int AS total FROM user_saved_addresses WHERE user_id=$1', [sessionUser.id])
            await transaction.query(
              `INSERT INTO user_saved_addresses
                 (id,user_id,label,street,number,complement,neighborhood,city,state,postal_code,reference,is_default)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [randomUUID(), sessionUser.id, input.saveAddressLabel, input.address.street, input.address.number, input.address.complement ?? null,
                input.address.neighborhood, input.address.city, input.address.state, input.address.postalCode, input.address.reference ?? null,
                Number((savedCount.rows[0] as { total: number }).total) === 0],
            )
          }
        }
      }

      await transaction.query(
        `INSERT INTO orders
           (id, tracking_code, customer_id, address_id, fulfillment_type, payment_method,
            subtotal, delivery_fee, discount, total, change_for, notes, delivery_review_status, delivery_zone_id,
            source, created_by_admin_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, $12, $13, $14, $15)`,
        [
          orderId, code, customerId, addressId, input.fulfillmentType, input.paymentMethod,
          money(subtotalCents), money(deliveryFeeCents), money(totalCents), input.changeFor ?? null, input.notes ?? null,
          deliveryReviewStatus, deliveryZone?.id ?? null, assistedByAdmin ? 'admin_whatsapp' : 'site', assistedByAdmin ? sessionUser.id : null,
        ],
      )

      for (const priced of pricedItems) {
        const productIds = [priced.input.productId, priced.input.secondFlavorId].filter(Boolean) as string[]
        for (const productId of productIds) {
          const stock = await transaction.query(
            `UPDATE products SET stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE stock_quantity - $2 END
             WHERE id = $1 AND (stock_quantity IS NULL OR stock_quantity >= $2) RETURNING id`,
            [productId, priced.input.quantity],
          )
          if (!stock.rows[0]) throw new ApiError(409, `Estoque insuficiente para ${priced.productName}.`)
          if (products.get(productId)?.stock_quantity !== null) await recordInventoryMovement(transaction, {
            itemType: 'product', itemId: productId, itemName: products.get(productId)?.name ?? priced.productName,
            quantityDelta: -priced.input.quantity, reason: 'Saída por novo pedido', orderId,
          })
        }
        for (const [table, optionIds] of [
          ['pizza_sizes', priced.input.sizeId ? [priced.input.sizeId] : []],
          ['pizza_crusts', priced.input.crustId ? [priced.input.crustId] : []],
          ['pizza_addons', priced.input.addonIds],
        ] as const) {
          for (const optionId of optionIds) {
            const stock = await transaction.query(
              `UPDATE ${table} SET stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE stock_quantity - $2 END
               WHERE id = $1 AND (stock_quantity IS NULL OR stock_quantity >= $2) RETURNING id`,
              [optionId, priced.input.quantity],
            )
            if (!stock.rows[0]) throw new ApiError(409, 'Um adicional ou opção ficou sem estoque. Atualize o pedido.')
            const option = table === 'pizza_sizes' ? sizes.get(optionId) : table === 'pizza_crusts' ? crusts.get(optionId) : addons.get(optionId)
            if (option?.stock_quantity !== null) await recordInventoryMovement(transaction, {
              itemType: table === 'pizza_sizes' ? 'size' : table === 'pizza_crusts' ? 'crust' : 'addon',
              itemId: optionId, itemName: option?.name ?? optionId, quantityDelta: -priced.input.quantity,
              reason: 'Saída por novo pedido', orderId,
            })
          }
        }
        await transaction.query(
          `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, notes, customizations)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), orderId, priced.product.id, priced.productName, money(priced.unitCents), priced.input.quantity,
            priced.input.notes ?? null, JSON.stringify(priced.customizations)],
        )
      }

      await transaction.query(
        'INSERT INTO order_status_history (id, order_id, status, note) VALUES ($1, $2, $3, $4)',
        [randomUUID(), orderId, 'received', assistedByAdmin
          ? 'Pedido criado manualmente pelo atendimento (WhatsApp/telefone).'
          : deliveryReviewStatus === 'pending'
            ? 'Pedido recebido e aguardando análise do endereço de entrega.'
            : 'Pedido recebido pelo sistema.'],
      )
    })

    return reply.status(201).send({
      id: orderId,
      trackingCode: code,
      customerPhone: normalizePhone(input.customer.phone),
      orderStatus: 'received',
      paymentStatus: 'pending',
      total: money(totalCents),
      deliveryReviewStatus,
      deliveryFee: money(deliveryFeeCents),
      message: deliveryReviewStatus === 'pending'
        ? 'Pedido enviado para análise da área de entrega. A taxa e o total podem ser ajustados pelo atendimento.'
        : 'Pedido criado. O pagamento permanece pendente até a confirmação manual.',
    })
  })

  app.get('/api/orders/track/:trackingCode', async (request) => {
    const { trackingCode: code } = z.object({ trackingCode: z.string() }).parse(request.params)
    const { phone } = z.object({ phone: z.string().min(10) }).parse(request.query)
    const result = await database.query(
      `SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.tracking_code = $1 AND c.phone = $2`,
      [code.toUpperCase(), normalizePhone(phone)],
    )
    const order = result.rows[0] as { id: string } | undefined
    if (!order) throw new ApiError(404, 'Pedido não encontrado para este telefone.')
    return getOrderDetails(database, order.id)
  })

  app.get('/api/chat/conversations', async (request) => {
    const user = await requireUser(request, database)
    if (user.role !== 'customer') throw new ApiError(403, 'Use o atendimento administrativo no painel.')
    const result = await database.query(
      `SELECT c.id, c.category, c.subject, c.status, c.created_at, c.updated_at,
              c.unread_for_customer AS unread,
              (SELECT m.message FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
       FROM chat_conversations c WHERE c.user_id = $1 ORDER BY c.updated_at DESC`, [user.id],
    )
    return { conversations: result.rows }
  })

  app.get('/api/chat/events', async (request, reply) => {
    const user = await requireUser(request, database)
    if (user.role !== 'customer') throw new ApiError(403, 'Este canal em tempo real é exclusivo do cliente.')
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    reply.raw.write('event: connected\ndata: {}\n\n')
    let streams = customerChatStreams.get(user.id)
    if (!streams) {
      streams = new Set<ServerResponse>()
      customerChatStreams.set(user.id, streams)
    }
    streams.add(reply.raw)
    reply.raw.on('close', () => {
      streams?.delete(reply.raw)
      if (streams?.size === 0) customerChatStreams.delete(user.id)
    })
  })

  app.get('/api/admin/chat-events', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (_request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    reply.raw.write('event: connected\ndata: {}\n\n')
    adminChatStreams.add(reply.raw)
    reply.raw.on('close', () => adminChatStreams.delete(reply.raw))
  })

  app.post('/api/chat/conversations', async (request, reply) => {
    const user = await requireUser(request, database)
    if (user.role !== 'customer') throw new ApiError(403, 'Somente clientes podem iniciar este atendimento.')
    const input = chatConversationSchema.parse(request.body)
    const conversationId = randomUUID()
    await database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO chat_conversations (id, user_id, category, subject, unread_for_admin)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [conversationId, user.id, input.category, input.subject],
      )
      await transaction.query(
        `INSERT INTO chat_messages (id, conversation_id, sender_user_id, sender_role, message)
         VALUES ($1, $2, $3, 'customer', $4)`,
        [randomUUID(), conversationId, user.id, input.message],
      )
    })
    notifyAdminChat({ conversationId, action: 'created' })
    return reply.status(201).send({ id: conversationId })
  })

  app.get('/api/chat/conversations/:id/messages', async (request) => {
    const user = await requireUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const conversation = await database.query(
      `UPDATE chat_conversations SET unread_for_customer = FALSE
       WHERE id = $1 AND user_id = $2
       RETURNING id, category, subject, status, created_at, updated_at, unread_for_customer AS unread`,
      [id, user.id],
    )
    if (!conversation.rows[0]) throw new ApiError(404, 'Atendimento não encontrado.')
    const messages = await database.query(
      'SELECT id, sender_role, message, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at', [id],
    )
    return { conversation: conversation.rows[0], messages: messages.rows }
  })

  app.post('/api/chat/conversations/:id/messages', async (request, reply) => {
    const user = await requireUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = chatMessageSchema.parse(request.body)
    const conversation = await database.query('SELECT status FROM chat_conversations WHERE id = $1 AND user_id = $2', [id, user.id])
    const row = conversation.rows[0] as { status: string } | undefined
    if (!row) throw new ApiError(404, 'Atendimento não encontrado.')
    if (row.status === 'closed') throw new ApiError(409, 'Este atendimento foi encerrado.')
    await database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO chat_messages (id, conversation_id, sender_user_id, sender_role, message)
         VALUES ($1, $2, $3, 'customer', $4)`, [randomUUID(), id, user.id, input.message],
      )
      await transaction.query(
        'UPDATE chat_conversations SET updated_at = CURRENT_TIMESTAMP, unread_for_customer = FALSE, unread_for_admin = TRUE WHERE id = $1', [id],
      )
    })
    notifyCustomerChat(user.id, { conversationId: id, action: 'message' })
    notifyAdminChat({ conversationId: id, action: 'message' })
    return reply.status(201).send({ message: 'Mensagem enviada.' })
  })

  app.get('/api/admin/chats', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async () => {
    const result = await database.query(
      `SELECT c.id, c.category, c.subject, c.status, c.created_at, c.updated_at,
              c.unread_for_admin AS unread,
              u.name AS customer_name, u.email AS customer_email,
              (SELECT m.message FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
       FROM chat_conversations c JOIN users u ON u.id = c.user_id
       ORDER BY CASE WHEN c.status = 'open' THEN 0 ELSE 1 END, c.updated_at DESC`,
    )
    return { conversations: result.rows }
  })

  app.get('/api/admin/chats/:id/messages', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    await database.query('UPDATE chat_conversations SET unread_for_admin = FALSE WHERE id = $1', [id])
    const conversation = await database.query(
      `SELECT c.id, c.category, c.subject, c.status, c.created_at, c.updated_at,
              c.unread_for_admin AS unread,
              u.name AS customer_name, u.email AS customer_email
       FROM chat_conversations c JOIN users u ON u.id = c.user_id WHERE c.id = $1`, [id],
    )
    if (!conversation.rows[0]) throw new ApiError(404, 'Atendimento não encontrado.')
    const messages = await database.query(
      'SELECT id, sender_role, message, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at', [id],
    )
    return { conversation: conversation.rows[0], messages: messages.rows }
  })

  app.post('/api/admin/chats/:id/messages', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request, reply) => {
    const admin = await requireUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = chatMessageSchema.parse(request.body)
    const conversation = await database.query('SELECT status, user_id FROM chat_conversations WHERE id = $1', [id])
    const chat = conversation.rows[0] as { status: string; user_id: string } | undefined
    if (!chat) throw new ApiError(404, 'Atendimento não encontrado.')
    await database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO chat_messages (id, conversation_id, sender_user_id, sender_role, message)
         VALUES ($1, $2, $3, 'admin', $4)`, [randomUUID(), id, admin.id, input.message],
      )
      await transaction.query(
        "UPDATE chat_conversations SET status = 'open', updated_at = CURRENT_TIMESTAMP, unread_for_admin = FALSE, unread_for_customer = TRUE WHERE id = $1", [id],
      )
    })
    notifyCustomerChat(chat.user_id, { conversationId: id, action: 'message' })
    notifyAdminChat({ conversationId: id, action: 'message' })
    return reply.status(201).send({ message: 'Resposta enviada.' })
  })

  app.patch('/api/admin/chats/:id', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = chatStatusSchema.parse(request.body)
    const result = await database.query(
      'UPDATE chat_conversations SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, status, user_id', [id, input.status],
    )
    const chat = result.rows[0] as { id: string; status: string; user_id: string } | undefined
    if (!chat) throw new ApiError(404, 'Atendimento não encontrado.')
    notifyCustomerChat(chat.user_id, { conversationId: id, action: 'status' })
    notifyAdminChat({ conversationId: id, action: 'status' })
    return { id: chat.id, status: chat.status }
  })

  app.get('/api/admin/orders', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const query = z.object({
      status: orderStatusSchema.optional(),
      fulfillmentType: z.enum(['delivery', 'pickup']).optional(),
      paymentMethod: z.enum(['pix', 'cash', 'credit_card', 'debit_card']).optional(),
      paymentStatus: paymentStatusSchema.optional(),
    }).parse(request.query)
    const values: string[] = []
    const clauses: string[] = []
    if (query.status) { values.push(query.status); clauses.push(`o.order_status = $${values.length}`) }
    if (query.fulfillmentType) { values.push(query.fulfillmentType); clauses.push(`o.fulfillment_type = $${values.length}`) }
    if (query.paymentMethod) { values.push(query.paymentMethod); clauses.push(`o.payment_method = $${values.length}`) }
    if (query.paymentStatus) { values.push(query.paymentStatus); clauses.push(`o.payment_status = $${values.length}`) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const result = await database.query(
      `SELECT o.id, o.tracking_code, o.fulfillment_type, o.payment_method, o.payment_status,
              o.order_status, o.total, o.delivery_fee, o.delivery_review_status, o.delivery_review_note,
              o.estimated_minutes, o.accepted_at,
              (o.accepted_at IS NOT NULL AND o.estimated_minutes IS NOT NULL
               AND CURRENT_TIMESTAMP > o.accepted_at + o.estimated_minutes * INTERVAL '1 minute'
               AND o.order_status NOT IN ('completed', 'cancelled')) AS is_delayed,
              o.created_at, c.name AS customer_name, c.phone AS customer_phone,
              a.neighborhood, a.city
       FROM orders o JOIN customers c ON c.id = o.customer_id
       LEFT JOIN addresses a ON a.id = o.address_id
       ${where} ORDER BY o.created_at DESC LIMIT 100`,
      values,
    )
    return { orders: result.rows }
  })

  app.get('/api/admin/categories', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async () => {
    const result = await database.query('SELECT id, slug, name, sort_order, active FROM categories ORDER BY sort_order, name')
    return { categories: result.rows }
  })

  app.post('/api/admin/categories', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request, reply) => {
    const input = categoryInputSchema.parse(request.body)
    const id = randomUUID()
    const slug = input.slug ?? slugify(input.name)
    const duplicate = await database.query('SELECT id FROM categories WHERE slug = $1', [slug])
    if (duplicate.rows[0]) throw new ApiError(409, 'Já existe uma categoria com este identificador.')
    const result = await database.query(
      `INSERT INTO categories (id, slug, name, sort_order, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, slug, name, sort_order, active`,
      [id, slug, input.name, input.sortOrder, input.active],
    )
    return reply.status(201).send(result.rows[0])
  })

  app.patch('/api/admin/categories/:id', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = categoryUpdateSchema.parse(request.body)
    const currentResult = await database.query('SELECT * FROM categories WHERE id = $1', [id])
    const current = currentResult.rows[0] as { slug: string; name: string; sort_order: number; active: boolean } | undefined
    if (!current) throw new ApiError(404, 'Categoria não encontrada.')
    const slug = input.slug ?? current.slug
    const duplicate = await database.query('SELECT id FROM categories WHERE slug = $1 AND id <> $2', [slug, id])
    if (duplicate.rows[0]) throw new ApiError(409, 'Já existe uma categoria com este identificador.')
    const result = await database.query(
      `UPDATE categories SET slug = $2, name = $3, sort_order = $4, active = $5
       WHERE id = $1 RETURNING id, slug, name, sort_order, active`,
      [id, slug, input.name ?? current.name, input.sortOrder ?? current.sort_order, input.active ?? current.active],
    )
    return result.rows[0]
  })

  app.get('/api/admin/products', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async () => {
    const result = await database.query(
      `SELECT p.id, p.category_id, c.slug AS category_slug, c.name AS category_name,
              p.name, p.description, p.base_price, p.image_url, p.active, p.stock_quantity, p.updated_at
       FROM products p JOIN categories c ON c.id = p.category_id
       ORDER BY c.sort_order, p.name`,
    )
    return { products: result.rows }
  })

  app.post('/api/admin/products', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request, reply) => {
    const input = productInputSchema.parse(request.body)
    const category = await database.query('SELECT id FROM categories WHERE id = $1', [input.categoryId])
    if (!category.rows[0]) throw new ApiError(400, 'Categoria inválida.')
    const result = await database.query(
      `INSERT INTO products (id, category_id, name, description, base_price, image_url, active, stock_quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [randomUUID(), input.categoryId, input.name, input.description, input.basePrice, input.imageUrl ?? null, input.active, input.stockQuantity ?? null],
    )
    const created = result.rows[0] as { id: string }
    const full = await database.query(
      `SELECT p.id, p.category_id, c.slug AS category_slug, c.name AS category_name,
              p.name, p.description, p.base_price, p.image_url, p.active, p.stock_quantity, p.updated_at
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
      [created.id],
    )
    return reply.status(201).send(full.rows[0])
  })

  app.patch('/api/admin/products/:id', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = productUpdateSchema.parse(request.body)
    const currentResult = await database.query('SELECT * FROM products WHERE id = $1', [id])
    const current = currentResult.rows[0] as {
      category_id: string; name: string; description: string; base_price: string;
      image_url: string | null; active: boolean; stock_quantity: number | null
    } | undefined
    if (!current) throw new ApiError(404, 'Produto não encontrado.')
    const categoryId = input.categoryId ?? current.category_id
    const category = await database.query('SELECT id FROM categories WHERE id = $1', [categoryId])
    if (!category.rows[0]) throw new ApiError(400, 'Categoria inválida.')
    await database.query(
      `UPDATE products SET category_id = $2, name = $3, description = $4, base_price = $5,
              image_url = $6, active = $7, stock_quantity = $8, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id, categoryId, input.name ?? current.name, input.description ?? current.description,
        input.basePrice ?? Number(current.base_price), input.imageUrl === undefined ? current.image_url : input.imageUrl,
        input.active ?? current.active, input.stockQuantity === undefined ? current.stock_quantity : input.stockQuantity],
    )
    const result = await database.query(
      `SELECT p.id, p.category_id, c.slug AS category_slug, c.name AS category_name,
              p.name, p.description, p.base_price, p.image_url, p.active, p.stock_quantity, p.updated_at
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
      [id],
    )
    return result.rows[0]
  })

  app.get('/api/admin/customizations', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async () => {
    const [sizes, crusts, addons] = await Promise.all([
      database.query("SELECT id, name, price_delta, active, stock_quantity, 'size' AS type FROM pizza_sizes ORDER BY sort_order"),
      database.query("SELECT id, name, price_delta, active, stock_quantity, 'crust' AS type FROM pizza_crusts ORDER BY sort_order"),
      database.query("SELECT id, name, price_delta, active, stock_quantity, 'addon' AS type FROM pizza_addons ORDER BY sort_order"),
    ])
    return { options: [...sizes.rows, ...crusts.rows, ...addons.rows] }
  })

  app.patch('/api/admin/customizations/:id', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = customizationAvailabilitySchema.parse(request.body)
    const table = { size: 'pizza_sizes', crust: 'pizza_crusts', addon: 'pizza_addons' }[input.type]
    const current = await database.query(`SELECT active, stock_quantity FROM ${table} WHERE id = $1`, [id])
    const row = current.rows[0] as { active: boolean; stock_quantity: number | null } | undefined
    if (!row) throw new ApiError(404, 'Opção não encontrada.')
    const result = await database.query(
      `UPDATE ${table} SET active = $2, stock_quantity = $3 WHERE id = $1
       RETURNING id, name, price_delta, active, stock_quantity, $4::text AS type`,
      [id, input.active ?? row.active, input.stockQuantity === undefined ? row.stock_quantity : input.stockQuantity, input.type],
    )
    return result.rows[0]
  })

  app.get('/api/admin/ingredients', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async () => {
    const result = await database.query(
      `SELECT i.id, i.name, i.active, i.updated_at,
              COALESCE(json_agg(pi.product_id) FILTER (WHERE pi.product_id IS NOT NULL), '[]'::json) AS product_ids
       FROM ingredients i LEFT JOIN product_ingredients pi ON pi.ingredient_id = i.id
       GROUP BY i.id ORDER BY i.name`,
    )
    return { ingredients: result.rows }
  })

  app.post('/api/admin/ingredients', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request, reply) => {
    const input = ingredientInputSchema.parse(request.body)
    const id = randomUUID()
    await database.transaction(async (transaction) => {
      await transaction.query('INSERT INTO ingredients (id, name, active) VALUES ($1, $2, $3)', [id, input.name, input.active])
      for (const productId of input.productIds) await transaction.query('INSERT INTO product_ingredients (product_id, ingredient_id) VALUES ($1, $2)', [productId, id])
    })
    return reply.status(201).send({ id })
  })

  app.patch('/api/admin/ingredients/:id', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = ingredientUpdateSchema.parse(request.body)
    const current = await database.query('SELECT name, active FROM ingredients WHERE id = $1', [id])
    const row = current.rows[0] as { name: string; active: boolean } | undefined
    if (!row) throw new ApiError(404, 'Ingrediente não encontrado.')
    await database.transaction(async (transaction) => {
      await transaction.query('UPDATE ingredients SET name = $2, active = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id, input.name ?? row.name, input.active ?? row.active])
      if (input.productIds) {
        await transaction.query('DELETE FROM product_ingredients WHERE ingredient_id = $1', [id])
        for (const productId of input.productIds) await transaction.query('INSERT INTO product_ingredients (product_id, ingredient_id) VALUES ($1, $2)', [productId, id])
      }
    })
    return { id, name: input.name ?? row.name, active: input.active ?? row.active, product_ids: input.productIds }
  })

  app.get('/api/admin/inventory', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async () => {
    const [items, movements] = await Promise.all([
      database.query(
        `SELECT 'product' AS item_type,id,name,stock_quantity,low_stock_threshold,active FROM products
         UNION ALL SELECT 'size',id,name,stock_quantity,low_stock_threshold,active FROM pizza_sizes
         UNION ALL SELECT 'crust',id,name,stock_quantity,low_stock_threshold,active FROM pizza_crusts
         UNION ALL SELECT 'addon',id,name,stock_quantity,low_stock_threshold,active FROM pizza_addons
         ORDER BY item_type,name`,
      ),
      database.query(
        `SELECT id,item_type,item_id,item_name,quantity_delta,reason,order_id,created_at
         FROM inventory_movements ORDER BY created_at DESC LIMIT 100`,
      ),
    ])
    const mapped = (items.rows as Array<Record<string, unknown>>).map((item) => ({
      ...item,
      is_low: item.stock_quantity !== null && Number(item.stock_quantity) <= Number(item.low_stock_threshold),
    }))
    return { items: mapped, movements: movements.rows, lowStockCount: mapped.filter((item) => item.is_low).length }
  })

  app.post('/api/admin/inventory/restock', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const admin = await getSessionUser(request, database)
    const input = z.object({
      itemType: z.enum(['product', 'size', 'crust', 'addon']),
      itemId: z.string().min(1), quantity: z.number().int().min(1).max(99999),
      note: z.string().trim().max(160).optional(),
    }).parse(request.body)
    const table = { product: 'products', size: 'pizza_sizes', crust: 'pizza_crusts', addon: 'pizza_addons' }[input.itemType]
    let updated: unknown
    await database.transaction(async (transaction) => {
      const result = await transaction.query(
        `UPDATE ${table} SET stock_quantity=COALESCE(stock_quantity,0)+$2 WHERE id=$1 RETURNING id,name,stock_quantity,low_stock_threshold`,
        [input.itemId, input.quantity],
      )
      const row = result.rows[0] as { id: string; name: string; stock_quantity: number; low_stock_threshold: number } | undefined
      if (!row) throw new ApiError(404, 'Item de estoque não encontrado.')
      await recordInventoryMovement(transaction, {
        itemType: input.itemType, itemId: input.itemId, itemName: row.name, quantityDelta: input.quantity,
        reason: input.note ? `Reposição manual: ${input.note}` : 'Reposição manual', adminUserId: admin?.id,
      })
      updated = row
    })
    return updated
  })

  app.get('/api/admin/orders/:id', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    return getOrderDetails(database, id)
  })

  app.patch('/api/admin/orders/:id/edit', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const admin = await requireUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = z.object({
      customerName: z.string().trim().min(2).max(100),
      phone: z.string().trim().min(10).max(20),
      notes: z.string().trim().max(500).optional(),
      address: z.object({
        street: z.string().trim().min(2).max(160), number: z.string().trim().min(1).max(20),
        complement: z.string().trim().max(100).optional(), neighborhood: z.string().trim().min(2).max(100),
        city: z.string().trim().min(2).max(100), state: z.string().trim().length(2),
        postalCode: z.string().trim().min(8).max(10), reference: z.string().trim().max(160).optional(),
      }).optional(),
      items: z.array(z.object({
        existingItemId: z.string().optional(), productId: z.string().optional(),
        quantity: z.number().int().min(1).max(20), notes: z.string().trim().max(200).optional(),
      }).refine((item) => Boolean(item.existingItemId || item.productId), 'Informe um item existente ou produto.')).min(1).max(30),
    }).parse(request.body)
    const orderResult = await database.query(
      `SELECT o.*, c.id AS current_customer_id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`, [id],
    )
    const order = orderResult.rows[0] as Record<string, unknown> | undefined
    if (!order) throw new ApiError(404, 'Pedido não encontrado.')
    if (!['received', 'confirmed'].includes(String(order.order_status))) throw new ApiError(409, 'O pedido só pode ser editado antes do preparo.')
    const existingResult = await database.query('SELECT * FROM order_items WHERE order_id = $1', [id])
    const existing = new Map((existingResult.rows as Array<Record<string, unknown>>).map((item) => [String(item.id), item]))
    const nextItems: Array<{ productId: string | null; name: string; unitPrice: number; quantity: number; notes: string | null; customizations: unknown }> = []
    for (const item of input.items) {
      if (item.existingItemId) {
        const current = existing.get(item.existingItemId)
        if (!current) throw new ApiError(400, 'Um item informado não pertence a este pedido.')
        nextItems.push({ productId: current.product_id ? String(current.product_id) : null, name: String(current.product_name), unitPrice: Number(current.unit_price), quantity: item.quantity, notes: item.notes ?? (current.notes ? String(current.notes) : null), customizations: current.customizations ?? {} })
      } else {
        const product = await database.query(
          `SELECT p.id, p.name, p.base_price FROM products p
           WHERE p.id = $1 AND p.active = TRUE AND (p.stock_quantity IS NULL OR p.stock_quantity >= $2)
             AND NOT EXISTS (SELECT 1 FROM product_ingredients pi JOIN ingredients i ON i.id = pi.ingredient_id WHERE pi.product_id = p.id AND i.active = FALSE)`,
          [item.productId!, item.quantity],
        )
        const row = product.rows[0] as { id: string; name: string; base_price: string } | undefined
        if (!row) throw new ApiError(409, 'Produto novo indisponível ou sem estoque.')
        nextItems.push({ productId: row.id, name: row.name, unitPrice: Number(row.base_price), quantity: item.quantity, notes: item.notes ?? null, customizations: {} })
      }
    }
    const subtotal = nextItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    let deliveryFee = Number(order.delivery_fee)
    let deliveryReviewStatus = String(order.delivery_review_status)
    let deliveryZoneId = order.delivery_zone_id ? String(order.delivery_zone_id) : null
    if (order.fulfillment_type === 'delivery' && input.address) {
      const zone = await findDeliveryZone(database, input.address.neighborhood, input.address.city)
      deliveryFee = zone ? Number(zone.fee) : 0; deliveryReviewStatus = zone ? 'not_required' : 'pending'; deliveryZoneId = zone?.id ?? null
    }
    const total = subtotal - Number(order.discount) + deliveryFee
    const stockReferences = (item: Record<string, unknown>) => {
      const customizations = (item.customizations ?? {}) as {
        secondFlavorId?: string | null
        size?: { id?: string } | null
        crust?: { id?: string } | null
        addons?: Array<{ id?: string }>
      }
      return {
        productIds: [item.product_id ?? item.productId, customizations.secondFlavorId].filter(Boolean) as string[],
        sizeIds: customizations.size?.id ? [customizations.size.id] : [],
        crustIds: customizations.crust?.id ? [customizations.crust.id] : [],
        addonIds: (customizations.addons ?? []).flatMap((addon) => addon.id ? [addon.id] : []),
      }
    }
    await database.transaction(async (transaction) => {
      await transaction.query('UPDATE customers SET name = $2, phone = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [order.current_customer_id, input.customerName, normalizePhone(input.phone)])
      if (order.address_id && input.address) await transaction.query(
        `UPDATE addresses SET street=$2, number=$3, complement=$4, neighborhood=$5, city=$6, state=$7, postal_code=$8, reference=$9 WHERE id=$1`,
        [order.address_id, input.address.street, input.address.number, input.address.complement ?? null, input.address.neighborhood, input.address.city, input.address.state.toUpperCase(), input.address.postalCode, input.address.reference ?? null],
      )
      for (const current of existing.values()) {
        const refs = stockReferences(current)
        for (const productId of refs.productIds) {
          const restored = await transaction.query(
            'UPDATE products SET stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE stock_quantity + $2 END WHERE id = $1 RETURNING name,stock_quantity',
            [productId, Number(current.quantity)],
          )
          const row = restored.rows[0] as { name: string; stock_quantity: number | null } | undefined
          if (row && row.stock_quantity !== null) await recordInventoryMovement(transaction, {
            itemType: 'product', itemId: productId, itemName: row.name, quantityDelta: Number(current.quantity),
            reason: 'Estorno temporário para edição do pedido', orderId: id, adminUserId: admin.id,
          })
        }
        for (const [table, ids] of [['pizza_sizes', refs.sizeIds], ['pizza_crusts', refs.crustIds], ['pizza_addons', refs.addonIds]] as const) {
          for (const optionId of ids) {
            const restored = await transaction.query(
              `UPDATE ${table} SET stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE stock_quantity + $2 END WHERE id = $1 RETURNING name,stock_quantity`,
              [optionId, Number(current.quantity)],
            )
            const row = restored.rows[0] as { name: string; stock_quantity: number | null } | undefined
            if (row && row.stock_quantity !== null) await recordInventoryMovement(transaction, {
              itemType: table === 'pizza_sizes' ? 'size' : table === 'pizza_crusts' ? 'crust' : 'addon', itemId: optionId,
              itemName: row.name, quantityDelta: Number(current.quantity), reason: 'Estorno temporário para edição do pedido', orderId: id, adminUserId: admin.id,
            })
          }
        }
      }
      for (const item of nextItems) {
        const refs = stockReferences({ productId: item.productId, customizations: item.customizations })
        for (const productId of refs.productIds) {
          const stock = await transaction.query(
            `UPDATE products SET stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE stock_quantity - $2 END
             WHERE id = $1 AND (stock_quantity IS NULL OR stock_quantity >= $2) RETURNING id,name,stock_quantity`, [productId, item.quantity],
          )
          if (!stock.rows[0]) throw new ApiError(409, `Estoque insuficiente para ${item.name}.`)
          const stockRow = stock.rows[0] as { name: string; stock_quantity: number | null }
          if (stockRow.stock_quantity !== null) await recordInventoryMovement(transaction, {
            itemType: 'product', itemId: productId, itemName: stockRow.name, quantityDelta: -item.quantity,
            reason: 'Aplicação da edição do pedido', orderId: id, adminUserId: admin.id,
          })
        }
        for (const [table, ids] of [['pizza_sizes', refs.sizeIds], ['pizza_crusts', refs.crustIds], ['pizza_addons', refs.addonIds]] as const) {
          for (const optionId of ids) {
            const stock = await transaction.query(
              `UPDATE ${table} SET stock_quantity = CASE WHEN stock_quantity IS NULL THEN NULL ELSE stock_quantity - $2 END
               WHERE id = $1 AND (stock_quantity IS NULL OR stock_quantity >= $2) RETURNING id,name,stock_quantity`, [optionId, item.quantity],
            )
            if (!stock.rows[0]) throw new ApiError(409, 'Uma opção personalizada ficou sem estoque.')
            const stockRow = stock.rows[0] as { name: string; stock_quantity: number | null }
            if (stockRow.stock_quantity !== null) await recordInventoryMovement(transaction, {
              itemType: table === 'pizza_sizes' ? 'size' : table === 'pizza_crusts' ? 'crust' : 'addon', itemId: optionId,
              itemName: stockRow.name, quantityDelta: -item.quantity, reason: 'Aplicação da edição do pedido', orderId: id, adminUserId: admin.id,
            })
          }
        }
      }
      await transaction.query('DELETE FROM order_items WHERE order_id = $1', [id])
      for (const item of nextItems) await transaction.query(
        `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, notes, customizations)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), id, item.productId, item.name, item.unitPrice, item.quantity, item.notes, JSON.stringify(item.customizations)],
      )
      await transaction.query(
        `UPDATE orders SET subtotal=$2, delivery_fee=$3, total=$4, notes=$5, delivery_review_status=$6,
                delivery_zone_id=$7, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
        [id, subtotal, deliveryFee, total, input.notes ?? null, deliveryReviewStatus, deliveryZoneId],
      )
      await transaction.query(
        'INSERT INTO order_status_history (id, order_id, status, note) VALUES ($1,$2,$3,$4)',
        [randomUUID(), id, order.order_status, `Pedido editado por ${admin.name}. Total alterado de R$ ${Number(order.total).toFixed(2)} para R$ ${total.toFixed(2)}.`],
      )
    })
    return getOrderDetails(database, id)
  })

  app.patch('/api/admin/orders/:id/delivery-review', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const admin = await getSessionUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const input = deliveryReviewSchema.parse(request.body)
    const currentResult = await database.query(
      'SELECT subtotal, discount, fulfillment_type, delivery_review_status, order_status FROM orders WHERE id = $1', [id],
    )
    const current = currentResult.rows[0] as {
      subtotal: string; discount: string; fulfillment_type: string; delivery_review_status: string; order_status: string
    } | undefined
    if (!current) throw new ApiError(404, 'Pedido não encontrado.')
    if (current.fulfillment_type !== 'delivery') throw new ApiError(409, 'Este pedido não é de entrega.')
    if (current.delivery_review_status !== 'pending') throw new ApiError(409, 'A análise desta entrega já foi concluída.')

    const deliveryFee = input.status === 'approved' ? input.deliveryFee! : 0
    const total = Number(current.subtotal) - Number(current.discount) + deliveryFee
    await database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE orders SET delivery_review_status = $2, delivery_review_note = $3,
                delivery_fee = $4, total = $5,
                order_status = CASE WHEN $2 = 'rejected' THEN 'cancelled' ELSE order_status END,
                updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, input.status, input.note ?? null, deliveryFee, total],
      )
      await transaction.query(
        'INSERT INTO order_status_history (id, order_id, status, note) VALUES ($1, $2, $3, $4)',
        [randomUUID(), id, input.status === 'approved' ? current.order_status : 'cancelled',
          input.status === 'approved'
            ? `Entrega fora da área aprovada. Taxa definida em R$ ${deliveryFee.toFixed(2).replace('.', ',')}.${input.note ? ` ${input.note}` : ''}`
            : `Entrega recusada após análise.${input.note ? ` ${input.note}` : ''}`],
      )
      if (input.status === 'rejected' && current.order_status === 'received') {
        await restoreStockForOrder(transaction, id, 'Devolução por entrega recusada', admin?.id)
      }
    })
    if (input.status === 'rejected') await notifyOrderStatus(id, 'cancelled', input.note)
    return getOrderDetails(database, id)
  })

  app.patch('/api/admin/orders/:id/status', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const admin = await getSessionUser(request, database)
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const body = z.object({
      status: orderStatusSchema,
      note: z.string().trim().max(300).optional(),
      estimatedMinutes: z.number().int().min(5).max(240).optional(),
    }).superRefine((value, context) => {
      if (value.status === 'cancelled' && (!value.note || value.note.length < 3)) {
        context.addIssue({ code: 'custom', path: ['note'], message: 'Informe o motivo do cancelamento.' })
      }
    }).parse(request.body)
    const currentResult = await database.query('SELECT order_status, delivery_review_status FROM orders WHERE id = $1', [id])
    const current = currentResult.rows[0] as { order_status: string; delivery_review_status: string } | undefined
    if (!current) throw new ApiError(404, 'Pedido não encontrado.')
    if (current.delivery_review_status === 'pending' && body.status !== 'cancelled') {
      throw new ApiError(409, 'Analise primeiro o endereço que está fora da área de entrega.')
    }
    if (!statusTransitions[current.order_status].includes(body.status)) {
      throw new ApiError(409, `Não é possível mudar o pedido de ${current.order_status} para ${body.status}.`)
    }

    const settings = await getSettings(database)
    const estimatedMinutes = body.status === 'confirmed'
      ? (body.estimatedMinutes ?? computedStoreState(settings.operation).operation.etaMax)
      : null
    await database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE orders SET order_status = $2,
                estimated_minutes = CASE WHEN $2 = 'confirmed' THEN $3 ELSE estimated_minutes END,
                accepted_at = CASE WHEN $2 = 'confirmed' THEN CURRENT_TIMESTAMP ELSE accepted_at END,
                updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [id, body.status, estimatedMinutes],
      )
      await transaction.query(
        'INSERT INTO order_status_history (id, order_id, status, note) VALUES ($1, $2, $3, $4)',
        [randomUUID(), id, body.status, body.status === 'confirmed'
          ? `Pedido aceito. Previsão individual: ${estimatedMinutes} minutos.${body.note ? ` ${body.note}` : ''}`
          : body.note ?? null],
      )
      if (body.status === 'cancelled' && ['received', 'confirmed'].includes(current.order_status)) {
        await restoreStockForOrder(transaction, id, 'Devolução por cancelamento antes do preparo', admin?.id)
      }
    })
    if (['confirmed', 'ready', 'out_for_delivery', 'cancelled'].includes(body.status)) {
      await notifyOrderStatus(id, body.status as 'confirmed' | 'ready' | 'out_for_delivery' | 'cancelled', body.note)
    }
    return getOrderDetails(database, id)
  })

  app.patch('/api/admin/orders/:id/payment', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params)
    const { status } = z.object({ status: paymentStatusSchema }).parse(request.body)
    const result = await database.query(
      `UPDATE orders SET payment_status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING id`,
      [id, status],
    )
    if (!result.rows[0]) throw new ApiError(404, 'Pedido não encontrado.')
    return getOrderDetails(database, id)
  })

  app.get('/api/admin/dashboard', { preHandler: (request) => requireAdmin(request, database, adminApiKey) }, async (request) => {
    const query = z.object({
      period: z.enum(['day', 'week', 'month']).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).superRefine((value, context) => {
      if (Boolean(value.from) !== Boolean(value.to)) {
        context.addIssue({ code: 'custom', message: 'Informe as datas inicial e final.', path: ['from'] })
      }
      if (value.from && value.to && value.from > value.to) {
        context.addIssue({ code: 'custom', message: 'A data inicial não pode ser posterior à data final.', path: ['from'] })
      }
    }).parse(request.query)
    const period = query.from ? 'custom' : (query.period ?? 'day')
    const startExpression = {
      day: "date_trunc('day', CURRENT_TIMESTAMP)",
      week: "date_trunc('week', CURRENT_TIMESTAMP)",
      month: "date_trunc('month', CURRENT_TIMESTAMP)",
    }[period as 'day' | 'week' | 'month']
    const rangeClause = period === 'custom'
      ? `created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
         AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`
      : `created_at >= ${startExpression}`
    const rangeValues = period === 'custom' ? [query.from!, query.to!] : []

    const [summary, statuses, recent] = await Promise.all([
      database.query(
        `SELECT COALESCE(SUM(total), 0) AS revenue,
                COUNT(*) AS paid_orders,
                COALESCE(AVG(total), 0) AS average_ticket
         FROM orders
         WHERE payment_status = 'paid' AND order_status <> 'cancelled' AND ${rangeClause}`,
        rangeValues,
      ),
      database.query(
        `SELECT order_status AS status, COUNT(*) AS total
         FROM orders WHERE ${rangeClause}
         GROUP BY order_status ORDER BY order_status`,
        rangeValues,
      ),
      database.query(
        `SELECT o.id, o.tracking_code, o.order_status, o.payment_status, o.total, o.created_at,
                c.name AS customer_name
         FROM orders o JOIN customers c ON c.id = o.customer_id
         ORDER BY o.created_at DESC LIMIT 5`,
      ),
    ])
    const data = summary.rows[0] as { revenue: string; paid_orders: number | string; average_ticket: string }
    return {
      period,
      from: query.from ?? null,
      to: query.to ?? null,
      revenue: Number(data.revenue),
      paidOrders: Number(data.paid_orders),
      averageTicket: Number(data.average_ticket),
      ordersByStatus: statuses.rows,
      recentOrders: recent.rows,
    }
  })

  return app
}
