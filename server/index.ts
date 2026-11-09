import { buildApp } from './app.js'
import { config } from './config.js'

if (config.isProduction && (!config.resendApiKey || !process.env.WEB_PUBLIC_URL)) {
  throw new Error('Defina RESEND_API_KEY e WEB_PUBLIC_URL antes de iniciar a API em produção.')
}

const app = await buildApp()
let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Encerrando a API com segurança (${signal})...`)
  try {
    await app.close()
    process.exit(0)
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port: config.port, host: '127.0.0.1' })
  console.log(`API da pizzaria disponível em http://127.0.0.1:${config.port}`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
