import 'dotenv/config'

// Os segredos locais são carregados do .env localizado na raiz do projeto.

export const config = {
  port: Number(process.env.API_PORT ?? 3333),
  databasePath: process.env.DATABASE_PATH ?? './data/pizzaria',
  adminApiKey: process.env.ADMIN_API_KEY ?? 'dev-admin-key',
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  webPublicUrl: process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:5173',
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? 'Brasa & Massa <onboarding@resend.dev>',
  isProduction: process.env.NODE_ENV === 'production',
}
