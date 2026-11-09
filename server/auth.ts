import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyRequest } from 'fastify'
import type { Database } from './db/database.js'
import { ApiError } from './errors.js'

const scryptAsync = promisify(scrypt)
export const sessionCookieName = 'pizzeria_session'

export type UserRole = 'customer' | 'admin'

export type UserPreferences = {
  fulfillmentType?: 'delivery' | 'pickup'
  paymentMethod?: 'pix' | 'cash' | 'credit_card' | 'debit_card'
  address?: {
    street: string
    number: string
    complement?: string
    neighborhood: string
    city: string
    state: string
    postalCode: string
    reference?: string
  }
  savedOrderNotes?: string[]
}

export type AuthUser = {
  id: string
  role: UserRole
  name: string
  email: string
  phone: string | null
  preferences: UserPreferences
  email_verified_at: string | null
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const derived = await scryptAsync(password, salt, 64) as Buffer
  return { hash: derived.toString('hex'), salt }
}

export async function verifyPassword(password: string, salt: string, storedHash: string) {
  const derived = await scryptAsync(password, salt, 64) as Buffer
  const stored = Buffer.from(storedHash, 'hex')
  return stored.length === derived.length && timingSafeEqual(stored, derived)
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

function readCookie(request: FastifyRequest, name: string) {
  const cookies = request.headers.cookie?.split(';') ?? []
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=')
    if (key === name) return decodeURIComponent(parts.join('='))
  }
  return undefined
}

export async function createSession(database: Database, userId: string, sessionDays: number) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000)
  await database.query(
    'INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
    [randomUUID(), userId, hashToken(token), expiresAt.toISOString()],
  )
  return token
}

export function sessionCookie(token: string, sessionDays: number, secure: boolean) {
  const maxAge = Math.max(1, Math.round(sessionDays * 24 * 60 * 60))
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function expiredSessionCookie(secure: boolean) {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

export async function deleteCurrentSession(request: FastifyRequest, database: Database) {
  const token = readCookie(request, sessionCookieName)
  if (token) await database.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)])
}

export async function getSessionUser(request: FastifyRequest, database: Database): Promise<AuthUser | null> {
  const token = readCookie(request, sessionCookieName)
  if (!token) return null
  const tokenHash = hashToken(token)
  const result = await database.query(
    `SELECT u.id, u.role, u.name, u.email, u.phone, u.preferences, u.email_verified_at
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP
       AND u.active = TRUE AND u.email_verified_at IS NOT NULL`,
    [tokenHash],
  )
  const user = result.rows[0] as AuthUser | undefined
  if (!user) {
    await database.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash])
    return null
  }
  await database.query('UPDATE auth_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = $1', [tokenHash])
  return user
}

export async function requireUser(request: FastifyRequest, database: Database) {
  const user = await getSessionUser(request, database)
  if (!user) throw new ApiError(401, 'Faça login para continuar.')
  return user
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    phone: user.phone,
    preferences: user.preferences ?? {},
    emailVerified: Boolean(user.email_verified_at),
  }
}
