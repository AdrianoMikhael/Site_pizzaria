import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { createDatabase } from './db/database.js'

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  vi.restoreAllMocks()
})

async function testApp(options: { resendApiKey?: string } = {}) {
  const database = await createDatabase()
  await database.query("UPDATE store_settings SET value = jsonb_set(value, '{status}', '\"open\"'::jsonb) WHERE key = 'operation'")
  const app = await buildApp({
    database, adminApiKey: 'test-admin-key',
    webPublicUrl: 'http://127.0.0.1:5173', resendApiKey: options.resendApiKey ?? '',
  })
  apps.push(app)
  return app
}

async function confirmRegistration(app: FastifyInstance, registrationBody: Record<string, unknown>) {
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: registrationBody })
  const verificationUrl = new URL(registered.json().developmentVerificationUrl)
  const confirmed = await app.inject({
    method: 'POST', url: '/api/auth/verify-email',
    payload: { token: verificationUrl.searchParams.get('token') },
  })
  const cookie = String(confirmed.headers['set-cookie']).split(';')[0]
  return { registered, confirmed, cookie }
}

describe('API da pizzaria', () => {
  it('oferece contas locais de demonstração sem confirmação de e-mail', async () => {
    const app = await testApp()
    const customer = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'cliente@pizzaria.local', password: 'PizzaCliente123' },
    })
    expect(customer.statusCode).toBe(200)
    expect(customer.json().user).toMatchObject({ role: 'customer', email: 'cliente@pizzaria.local', emailVerified: true })

    const admin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@pizzaria.local', password: 'PizzaAdmin123' },
    })
    expect(admin.statusCode).toBe(200)
    expect(admin.json().user).toMatchObject({ role: 'admin', email: 'admin@pizzaria.local', emailVerified: true })
    const adminCookie = String(admin.headers['set-cookie']).split(';')[0]
    const protectedRoute = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie: adminCookie } })
    expect(protectedRoute.statusCode).toBe(200)
  })

  it('inicia com banco conectado e catálogo populado', async () => {
    const app = await testApp()
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    const products = await app.inject({ method: 'GET', url: '/api/products?category=pizzas' })

    expect(health.statusCode).toBe(200)
    expect(health.json()).toMatchObject({ status: 'ok', database: 'connected' })
    expect(products.statusCode).toBe(200)
    expect(products.json().products).toHaveLength(4)
  })

  it('cadastra cliente, mantém sessão segura e salva preferências do pedido', async () => {
    const app = await testApp()
    const { registered, confirmed, cookie } = await confirmRegistration(app, {
      role: 'customer', name: 'Ana Cliente', email: 'ANA@EXEMPLO.COM',
      phone: '(11) 98888-7777', password: 'Pizza1234', returnTo: '/#cardapio',
    })
    expect(registered.statusCode).toBe(201)
    expect(registered.json()).toMatchObject({ requiresEmailVerification: true, email: 'ana@exemplo.com' })
    expect(registered.headers['set-cookie']).toBeUndefined()
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().redirectTo).toBe('/?email_confirmed=1#cardapio')
    expect(confirmed.headers['set-cookie']).toContain('HttpOnly')

    const created = await app.inject({
      method: 'POST', url: '/api/orders', headers: { cookie },
      payload: {
        customer: { name: 'Ana Cliente', phone: '11988887777', email: 'ana@exemplo.com' },
        fulfillmentType: 'delivery', paymentMethod: 'pix',
        address: {
          street: 'Rua Preferida', number: '45', neighborhood: 'Centro',
          city: 'São Paulo', state: 'SP', postalCode: '01001-000',
        },
        items: [{ productId: 'pizza-margherita', quantity: 1 }],
      },
    })
    expect(created.statusCode).toBe(201)

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(me.json().user.preferences).toMatchObject({
      fulfillmentType: 'delivery', paymentMethod: 'pix',
      address: { street: 'Rua Preferida', number: '45' },
    })
    const orders = await app.inject({ method: 'GET', url: '/api/auth/orders', headers: { cookie } })
    expect(orders.json().orders).toHaveLength(1)

    const wrongPassword = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email: 'ana@exemplo.com', password: 'SenhaErrada1' },
    })
    expect(wrongPassword.statusCode).toBe(401)

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    expect(logout.statusCode).toBe(204)
    const afterLogout = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(afterLogout.statusCode).toBe(401)
  })

  it('mantém o cadastro utilizável quando o serviço de e-mail recusa o envio local', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ message: 'O remetente de teste não pode enviar para este destinatário.' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ))
    const app = await testApp({ resendApiKey: 're_chave_de_teste' })
    const registered = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        role: 'customer', name: 'Cliente sem e-mail', email: 'sem-entrega@exemplo.com',
        phone: '82977776666', password: 'Pizza1234',
      },
    })
    expect(registered.statusCode).toBe(201)
    expect(registered.json()).toMatchObject({
      requiresEmailVerification: true,
      emailDelivery: 'failed',
      developmentVerificationUrl: expect.stringContaining('/confirmar-email.html?token='),
    })
  })

  it('recupera a senha por link de uso único e encerra sessões anteriores', async () => {
    const app = await testApp()
    await confirmRegistration(app, {
      role: 'customer', name: 'Cliente Recuperação', email: 'recuperacao@exemplo.com',
      phone: '82955554444', password: 'SenhaAntiga1',
    })
    const forgot = await app.inject({
      method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'recuperacao@exemplo.com' },
    })
    expect(forgot.statusCode).toBe(202)
    expect(forgot.json().developmentResetUrl).toContain('/redefinir-senha.html?token=')
    const token = new URL(forgot.json().developmentResetUrl).searchParams.get('token')

    const reset = await app.inject({
      method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'SenhaNova123' },
    })
    expect(reset.statusCode).toBe(200)
    expect(reset.headers['set-cookie']).toContain('HttpOnly')
    expect(reset.json()).toMatchObject({ redirectTo: '/', message: 'Senha atualizada com segurança.' })

    const oldPassword = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'recuperacao@exemplo.com', password: 'SenhaAntiga1' },
    })
    expect(oldPassword.statusCode).toBe(401)
    const newPassword = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'recuperacao@exemplo.com', password: 'SenhaNova123' },
    })
    expect(newPassword.statusCode).toBe(200)

    const reused = await app.inject({
      method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'OutraSenha123' },
    })
    expect(reused.statusCode).toBe(400)
    const unknown = await app.inject({
      method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'nao-existe@exemplo.com' },
    })
    expect(unknown.statusCode).toBe(202)
    expect(unknown.json().developmentResetUrl).toBeUndefined()
  })

  it('exige confirmação de e-mail antes do primeiro login e permite reenviar o link', async () => {
    const app = await testApp()
    const registered = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        role: 'customer', name: 'Cliente Pendente', email: 'pendente@exemplo.com',
        phone: '11977776666', password: 'Pizza1234',
      },
    })
    const blockedLogin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'pendente@exemplo.com', password: 'Pizza1234' },
    })
    expect(blockedLogin.statusCode).toBe(403)

    const resent = await app.inject({
      method: 'POST', url: '/api/auth/resend-verification',
      payload: { email: 'pendente@exemplo.com' },
    })
    expect(resent.statusCode).toBe(202)
    expect(resent.json().developmentVerificationUrl).toContain('/confirmar-email.html?token=')

    const firstLink = new URL(registered.json().developmentVerificationUrl)
    const invalidated = await app.inject({
      method: 'POST', url: '/api/auth/verify-email',
      payload: { token: firstLink.searchParams.get('token') },
    })
    expect(invalidated.statusCode).toBe(400)

    const newLink = new URL(resent.json().developmentVerificationUrl)
    const confirmed = await app.inject({
      method: 'POST', url: '/api/auth/verify-email',
      payload: { token: newLink.searchParams.get('token') },
    })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().redirectTo).toContain('email_confirmed=1')
  })

  it('libera o primeiro administrador sem código e bloqueia novos cadastros públicos', async () => {
    const app = await testApp()
    const { registered, cookie } = await confirmRegistration(app, {
      role: 'admin', name: 'Admin', email: 'admin@exemplo.com', password: 'Admin1234',
    })
    expect(registered.statusCode).toBe(201)
    const orders = await app.inject({ method: 'GET', url: '/api/admin/orders', headers: { cookie } })
    expect(orders.statusCode).toBe(200)

    const denied = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        role: 'admin', name: 'Outro Admin', email: 'outro-admin@exemplo.com', password: 'Admin1234',
      },
    })
    expect(denied.statusCode).toBe(403)
  })

  it('cria, acompanha e atualiza um pedido sem confiar no preço do cliente', async () => {
    const app = await testApp()
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        customer: { name: 'Maria Silva', phone: '(11) 99999-8888' },
        fulfillmentType: 'delivery',
        address: {
          street: 'Rua das Flores', number: '123', neighborhood: 'Centro',
          city: 'Maceió', state: 'AL', postalCode: '57000-000',
        },
        paymentMethod: 'pix',
        items: [{ productId: 'pizza-margherita', quantity: 2 }],
      },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ orderStatus: 'received', paymentStatus: 'pending', total: 93.8 })

    const tracking = await app.inject({
      method: 'GET',
      url: `/api/orders/track/${created.json().trackingCode}?phone=11999998888`,
    })
    expect(tracking.statusCode).toBe(200)
    expect(tracking.json().items[0]).toMatchObject({ product_name: 'Margherita da Casa', quantity: 2 })

    const denied = await app.inject({ method: 'GET', url: '/api/admin/orders' })
    expect(denied.statusCode).toBe(401)

    const invalidJump = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/status`,
      headers: { 'x-admin-key': 'test-admin-key' }, payload: { status: 'ready' },
    })
    expect(invalidJump.statusCode).toBe(409)

    const confirmed = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/status`,
      headers: { 'x-admin-key': 'test-admin-key' }, payload: { status: 'confirmed' },
    })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json()).toMatchObject({ order_status: 'confirmed', estimated_minutes: 40 })
    expect(confirmed.json().accepted_at).toBeTruthy()

    const adminDetails = await app.inject({
      method: 'GET', url: `/api/admin/orders/${created.json().id}`,
      headers: { 'x-admin-key': 'test-admin-key' },
    })
    expect(adminDetails.statusCode).toBe(200)
    expect(adminDetails.json()).toMatchObject({
      customer_name: 'Maria Silva', street: 'Rua das Flores', number: '123',
    })
    expect(adminDetails.json().status_history).toHaveLength(2)
  })

  it('aceita com prazo individual, filtra pedidos e exige motivo para cancelar', async () => {
    const app = await testApp()
    const headers = { 'x-admin-key': 'test-admin-key' }
    const store = await app.inject({ method: 'GET', url: '/api/store' })
    expect(store.json().profile.address).toMatchObject({ street: 'Rua Lordleens', city: 'Maceió', state: 'AL' })

    const created = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: {
        customer: { name: 'Cliente Operação', phone: '11912121212' },
        fulfillmentType: 'pickup', paymentMethod: 'debit_card',
        items: [{ productId: 'pizza-calabresa', quantity: 1 }],
      },
    })
    const accepted = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/status`, headers,
      payload: { status: 'confirmed', estimatedMinutes: 25 },
    })
    expect(accepted.json()).toMatchObject({ order_status: 'confirmed', estimated_minutes: 25 })

    const filtered = await app.inject({
      method: 'GET', url: '/api/admin/orders?fulfillmentType=pickup&paymentMethod=debit_card&status=confirmed', headers,
    })
    expect(filtered.statusCode).toBe(200)
    expect(filtered.json().orders).toHaveLength(1)
    expect(filtered.json().orders[0]).toMatchObject({ id: created.json().id, estimated_minutes: 25, is_delayed: false })

    const missingReason = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/status`, headers,
      payload: { status: 'cancelled' },
    })
    expect(missingReason.statusCode).toBe(400)
    const cancelled = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/status`, headers,
      payload: { status: 'cancelled', note: 'Cliente solicitou o cancelamento.' },
    })
    expect(cancelled.json().order_status).toBe('cancelled')
    expect(cancelled.json().status_history.at(-1)).toMatchObject({ status: 'cancelled', note: 'Cliente solicitou o cancelamento.' })
  })

  it('confirma pagamento manual e reflete o valor no dashboard', async () => {
    const app = await testApp()
    const created = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: {
        customer: { name: 'João Souza', phone: '11911112222' },
        fulfillmentType: 'pickup', paymentMethod: 'cash',
        items: [{ productId: 'pizza-calabresa', quantity: 1 }],
      },
    })

    await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/payment`,
      headers: { 'x-admin-key': 'test-admin-key' }, payload: { status: 'paid' },
    })
    const dashboard = await app.inject({
      method: 'GET', url: '/api/admin/dashboard?period=day',
      headers: { 'x-admin-key': 'test-admin-key' },
    })

    expect(dashboard.statusCode).toBe(200)
    expect(dashboard.json()).toMatchObject({ period: 'day', revenue: 46.9, paidOrders: 1, averageTicket: 46.9 })
  })

  it('filtra o faturamento por um intervalo livre de datas', async () => {
    const app = await testApp()
    const created = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: {
        customer: { name: 'Cliente Calendário', phone: '11922223333' },
        fulfillmentType: 'pickup', paymentMethod: 'pix',
        items: [{ productId: 'pizza-margherita', quantity: 1 }],
      },
    })
    await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/payment`,
      headers: { 'x-admin-key': 'test-admin-key' }, payload: { status: 'paid' },
    })

    const custom = await app.inject({
      method: 'GET', url: '/api/admin/dashboard?from=2020-01-01&to=2099-12-31',
      headers: { 'x-admin-key': 'test-admin-key' },
    })
    expect(custom.statusCode).toBe(200)
    expect(custom.json()).toMatchObject({
      period: 'custom', from: '2020-01-01', to: '2099-12-31',
      revenue: 42.9, paidOrders: 1, averageTicket: 42.9,
    })

    const invalid = await app.inject({
      method: 'GET', url: '/api/admin/dashboard?from=2026-12-20&to=2026-12-01',
      headers: { 'x-admin-key': 'test-admin-key' },
    })
    expect(invalid.statusCode).toBe(400)
  })

  it('administra categorias, produtos, preços e disponibilidade', async () => {
    const app = await testApp()
    const headers = { 'x-admin-key': 'test-admin-key' }
    const category = await app.inject({
      method: 'POST', url: '/api/admin/categories', headers,
      payload: { name: 'Combos', sortOrder: 4 },
    })
    expect(category.statusCode).toBe(201)
    expect(category.json()).toMatchObject({ name: 'Combos', slug: 'combos', active: true })

    const product = await app.inject({
      method: 'POST', url: '/api/admin/products', headers,
      payload: {
        categoryId: category.json().id, name: 'Combo Família',
        description: 'Duas pizzas e um refrigerante.', basePrice: 89.9,
      },
    })
    expect(product.statusCode).toBe(201)
    expect(product.json()).toMatchObject({ name: 'Combo Família', base_price: '89.90', active: true })

    const priceChanged = await app.inject({
      method: 'PATCH', url: `/api/admin/products/${product.json().id}`, headers,
      payload: { basePrice: 94.9 },
    })
    expect(priceChanged.statusCode).toBe(200)
    expect(priceChanged.json()).toMatchObject({ base_price: '94.90', description: 'Duas pizzas e um refrigerante.' })

    const paused = await app.inject({
      method: 'PATCH', url: `/api/admin/products/${product.json().id}`, headers,
      payload: { active: false },
    })
    expect(paused.json().active).toBe(false)

    const publicCatalog = await app.inject({ method: 'GET', url: '/api/products?category=combos' })
    expect(publicCatalog.json().products).toHaveLength(0)
  })

  it('separa pizzas doces e calcula personalizações somente no servidor', async () => {
    const app = await testApp()
    const categories = await app.inject({ method: 'GET', url: '/api/categories' })
    const options = await app.inject({ method: 'GET', url: '/api/customizations' })

    expect(categories.json().categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'pizzas-doces', name: 'Pizzas doces' }),
    ]))
    expect(options.json()).toMatchObject({
      sizes: expect.arrayContaining([expect.objectContaining({ id: 'size-large', name: 'Grande' })]),
      crusts: expect.arrayContaining([expect.objectContaining({ id: 'crust-catupiry' })]),
      addons: expect.arrayContaining([expect.objectContaining({ id: 'addon-cheese' })]),
    })

    const created = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: {
        customer: { name: 'Cliente Personalização', phone: '11955556666' },
        fulfillmentType: 'pickup', paymentMethod: 'pix',
        items: [{
          productId: 'pizza-margherita', secondFlavorId: 'pizza-calabresa', quantity: 1,
          sizeId: 'size-large', crustId: 'crust-catupiry', addonIds: ['addon-cheese'],
        }],
      },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json().total).toBe(77.9)
    const details = await app.inject({
      method: 'GET', url: `/api/admin/orders/${created.json().id}`,
      headers: { 'x-admin-key': 'test-admin-key' },
    })
    expect(details.json().items[0]).toMatchObject({
      product_name: 'Margherita da Casa / Calabresa Defumada', unit_price: '77.90',
      customizations: {
        size: { name: 'Grande' }, crust: { name: 'Borda de catupiry' },
        addons: [expect.objectContaining({ name: 'Muçarela extra' })],
      },
    })
  })

  it('configura a loja, calcula taxa por bairro e envia endereço desconhecido para análise', async () => {
    const app = await testApp()
    const headers = { 'x-admin-key': 'test-admin-key' }
    const settings = await app.inject({
      method: 'PATCH', url: '/api/admin/settings', headers,
      payload: {
        profile: {
          name: 'Pizzaria Teste', phone: '11999990000',
          address: { street: 'Rua da Pizza', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01001-000' },
        },
        operation: { status: 'open', opensAt: '18:00', closesAt: '22:30', etaMin: 35, etaMax: 40, deliveryRadiusKm: 5 },
      },
    })
    expect(settings.statusCode).toBe(200)
    expect(settings.json()).toMatchObject({ profile: { name: 'Pizzaria Teste' }, isAcceptingOrders: true })

    const zone = await app.inject({
      method: 'POST', url: '/api/admin/delivery-zones', headers,
      payload: { neighborhood: 'Bela Vista', city: 'São Paulo', fee: 12.5 },
    })
    expect(zone.statusCode).toBe(201)
    const quote = await app.inject({
      method: 'POST', url: '/api/delivery/quote',
      payload: { neighborhood: 'Bela Vista', city: 'Sao Paulo', postalCode: '01310-000' },
    })
    expect(quote.json()).toMatchObject({ serviceStatus: 'available', deliveryFee: 12.5 })

    const outside = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: {
        customer: { name: 'Cliente Distante', phone: '11933334444' }, fulfillmentType: 'delivery', paymentMethod: 'cash',
        address: { street: 'Estrada Distante', number: '900', neighborhood: 'Muito Longe', city: 'Outra Cidade', state: 'SP', postalCode: '09999-000' },
        items: [{ productId: 'pizza-margherita', quantity: 1 }],
      },
    })
    expect(outside.statusCode).toBe(201)
    expect(outside.json()).toMatchObject({ deliveryReviewStatus: 'pending', deliveryFee: 0, total: 42.9 })
    const reviewed = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${outside.json().id}/delivery-review`, headers,
      payload: { status: 'approved', deliveryFee: 20, note: 'Entrega especial aprovada.' },
    })
    expect(reviewed.json()).toMatchObject({ delivery_review_status: 'approved', delivery_fee: '20.00', total: '62.90' })
  })

  it('mantém um chat protegido entre cliente e administrador', async () => {
    const app = await testApp()
    const anonymousCustomerEvents = await app.inject({ method: 'GET', url: '/api/chat/events' })
    const anonymousAdminEvents = await app.inject({ method: 'GET', url: '/api/admin/chat-events' })
    expect(anonymousCustomerEvents.statusCode).toBe(401)
    expect(anonymousAdminEvents.statusCode).toBe(401)
    const customer = await confirmRegistration(app, {
      role: 'customer', name: 'Cliente Chat', email: 'cliente-chat@exemplo.com', phone: '11944445555', password: 'Pizza1234',
    })
    const admin = await confirmRegistration(app, {
      role: 'admin', name: 'Admin Chat', email: 'admin-chat@exemplo.com', password: 'Admin1234',
    })
    const conversation = await app.inject({
      method: 'POST', url: '/api/chat/conversations', headers: { cookie: customer.cookie },
      payload: { category: 'question', subject: 'Dúvida sobre o pedido', message: 'Vocês entregam hoje?' },
    })
    expect(conversation.statusCode).toBe(201)
    const inbox = await app.inject({ method: 'GET', url: '/api/admin/chats', headers: { cookie: admin.cookie } })
    expect(inbox.json().conversations[0]).toMatchObject({ customer_name: 'Cliente Chat', status: 'open', unread: true })
    await app.inject({
      method: 'GET', url: `/api/admin/chats/${conversation.json().id}/messages`, headers: { cookie: admin.cookie },
    })
    const adminReadInbox = await app.inject({ method: 'GET', url: '/api/admin/chats', headers: { cookie: admin.cookie } })
    expect(adminReadInbox.json().conversations[0]).toMatchObject({ unread: false })
    const reply = await app.inject({
      method: 'POST', url: `/api/admin/chats/${conversation.json().id}/messages`, headers: { cookie: admin.cookie },
      payload: { message: 'Sim, estamos atendendo.' },
    })
    expect(reply.statusCode).toBe(201)
    const customerUnreadInbox = await app.inject({ method: 'GET', url: '/api/chat/conversations', headers: { cookie: customer.cookie } })
    expect(customerUnreadInbox.json().conversations[0]).toMatchObject({ unread: true })
    const thread = await app.inject({
      method: 'GET', url: `/api/chat/conversations/${conversation.json().id}/messages`, headers: { cookie: customer.cookie },
    })
    expect(thread.json().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ sender_role: 'admin', message: 'Sim, estamos atendendo.' }),
    ]))
    const customerReadInbox = await app.inject({ method: 'GET', url: '/api/chat/conversations', headers: { cookie: customer.cookie } })
    expect(customerReadInbox.json().conversations[0]).toMatchObject({ unread: false })
  })

  it('cria pedido pelo atendimento e permite editar itens com recálculo e histórico', async () => {
    const app = await testApp()
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@pizzaria.local', password: 'PizzaAdmin123' },
    })
    const cookie = String(login.headers['set-cookie']).split(';')[0]
    const headers = { cookie }
    const created = await app.inject({
      method: 'POST', url: '/api/orders', headers,
      payload: {
        customer: { name: 'Cliente do WhatsApp', phone: '82999998888' },
        fulfillmentType: 'pickup', paymentMethod: 'cash',
        items: [{ productId: 'pizza-margherita', quantity: 1 }],
      },
    })
    expect(created.statusCode).toBe(201)
    const details = await app.inject({ method: 'GET', url: `/api/admin/orders/${created.json().id}`, headers })
    expect(details.json()).toMatchObject({ source: 'admin_whatsapp', created_by_admin_id: expect.any(String) })

    const edited = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/edit`, headers,
      payload: {
        customerName: 'Cliente Corrigido', phone: '82988887777', notes: 'Sem guardanapos.',
        items: [
          { existingItemId: details.json().items[0].id, quantity: 1 },
          { productId: 'sobremesa-brownie', quantity: 1 },
        ],
      },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json()).toMatchObject({ customer_name: 'Cliente Corrigido', customer_phone: '82988887777', total: '59.80', notes: 'Sem guardanapos.' })
    expect(edited.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ product_name: 'Brownie de Chocolate' })]))
    expect(edited.json().status_history.at(-1).note).toContain('Total alterado de R$ 42.90 para R$ 59.80')

    await app.inject({ method: 'PATCH', url: `/api/admin/orders/${created.json().id}/status`, headers, payload: { status: 'confirmed' } })
    await app.inject({ method: 'PATCH', url: `/api/admin/orders/${created.json().id}/status`, headers, payload: { status: 'preparing' } })
    const tooLate = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/edit`, headers,
      payload: { customerName: 'Cliente Corrigido', phone: '82988887777', items: [{ productId: 'pizza-calabresa', quantity: 1 }] },
    })
    expect(tooLate.statusCode).toBe(409)
  })

  it('controla estoque, pausa personalizações e esconde produtos com ingrediente esgotado', async () => {
    const app = await testApp()
    const headers = { 'x-admin-key': 'test-admin-key' }
    const limited = await app.inject({
      method: 'PATCH', url: '/api/admin/products/bebida-refrigerante', headers,
      payload: { stockQuantity: 1 },
    })
    expect(limited.json().stock_quantity).toBe(1)
    const first = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: {
        customer: { name: 'Cliente Estoque', phone: '82911112222' }, fulfillmentType: 'pickup', paymentMethod: 'pix',
        items: [{ productId: 'bebida-refrigerante', quantity: 1 }],
      },
    })
    expect(first.statusCode).toBe(201)
    const catalogAfterSale = await app.inject({ method: 'GET', url: '/api/products?category=bebidas' })
    expect(catalogAfterSale.json().products).toHaveLength(0)

    const pausedOption = await app.inject({
      method: 'PATCH', url: '/api/admin/customizations/addon-cheese', headers,
      payload: { type: 'addon', active: false },
    })
    expect(pausedOption.json().active).toBe(false)
    const publicOptions = await app.inject({ method: 'GET', url: '/api/customizations' })
    expect(publicOptions.json().addons).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'addon-cheese' })]))

    const ingredient = await app.inject({
      method: 'POST', url: '/api/admin/ingredients', headers,
      payload: { name: 'Manjericão do teste', productIds: ['pizza-margherita'] },
    })
    expect(ingredient.statusCode).toBe(201)
    await app.inject({
      method: 'PATCH', url: `/api/admin/ingredients/${ingredient.json().id}`, headers,
      payload: { active: false },
    })
    const pizzas = await app.inject({ method: 'GET', url: '/api/products?category=pizzas' })
    expect(pizzas.json().products).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'pizza-margherita' })]))
  })

  it('aplica datas especiais e permite ao admin registrar pedido mesmo com a loja fechada', async () => {
    const app = await testApp()
    const apiKeyHeaders = { 'x-admin-key': 'test-admin-key' }
    const publicStore = await app.inject({ method: 'GET', url: '/api/store' })
    const date = publicStore.json().effectiveHours.date
    const settings = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: apiKeyHeaders })
    const changed = await app.inject({
      method: 'PATCH', url: '/api/admin/settings', headers: apiKeyHeaders,
      payload: {
        profile: settings.json().profile,
        operation: {
          ...settings.json().operation, status: 'automatic',
          specialDates: [{ date, label: 'Fechamento programado', closed: true }],
        },
      },
    })
    expect(changed.statusCode).toBe(200)
    expect(changed.json()).toMatchObject({ isAcceptingOrders: false, effectiveHours: { date, enabled: false, label: 'Fechamento programado' } })
    const blocked = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: {
        customer: { name: 'Cliente Bloqueado', phone: '82922223333' }, fulfillmentType: 'pickup', paymentMethod: 'pix',
        items: [{ productId: 'pizza-calabresa', quantity: 1 }],
      },
    })
    expect(blocked.statusCode).toBe(409)

    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@pizzaria.local', password: 'PizzaAdmin123' },
    })
    const cookie = String(login.headers['set-cookie']).split(';')[0]
    const assisted = await app.inject({
      method: 'POST', url: '/api/orders', headers: { cookie },
      payload: {
        customer: { name: 'Cliente Assistido', phone: '82933334444' }, fulfillmentType: 'pickup', paymentMethod: 'cash',
        items: [{ productId: 'pizza-calabresa', quantity: 1 }],
      },
    })
    expect(assisted.statusCode).toBe(201)
  })

  it('devolve estoque cancelado antes do preparo e registra reposições e movimentações', async () => {
    const app = await testApp()
    const headers = { 'x-admin-key': 'test-admin-key' }
    await app.inject({ method: 'PATCH', url: '/api/admin/products/bebida-refrigerante', headers, payload: { stockQuantity: 2 } })
    const created = await app.inject({
      method: 'POST', url: '/api/orders',
      payload: {
        customer: { name: 'Cliente Estoque Cancelado', phone: '82955556666' }, fulfillmentType: 'pickup', paymentMethod: 'cash',
        items: [{ productId: 'bebida-refrigerante', quantity: 1 }],
      },
    })
    let inventory = await app.inject({ method: 'GET', url: '/api/admin/inventory', headers })
    expect(inventory.json().items.find((item: { id: string }) => item.id === 'bebida-refrigerante')).toMatchObject({ stock_quantity: 1, is_low: true })
    expect(inventory.json().movements[0]).toMatchObject({ item_id: 'bebida-refrigerante', quantity_delta: -1, order_id: created.json().id })

    const cancelled = await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${created.json().id}/status`, headers,
      payload: { status: 'cancelled', note: 'Cliente desistiu antes do preparo.' },
    })
    expect(cancelled.json().inventory_restored_at).toBeTruthy()
    inventory = await app.inject({ method: 'GET', url: '/api/admin/inventory', headers })
    expect(inventory.json().items.find((item: { id: string }) => item.id === 'bebida-refrigerante').stock_quantity).toBe(2)
    expect(inventory.json().movements[0]).toMatchObject({ quantity_delta: 1, reason: 'Devolução por cancelamento antes do preparo' })

    await app.inject({
      method: 'POST', url: '/api/admin/inventory/restock', headers,
      payload: { itemType: 'product', itemId: 'bebida-refrigerante', quantity: 3, note: 'Chegada do fornecedor' },
    })
    inventory = await app.inject({ method: 'GET', url: '/api/admin/inventory', headers })
    expect(inventory.json().items.find((item: { id: string }) => item.id === 'bebida-refrigerante').stock_quantity).toBe(5)
    expect(inventory.json().movements[0]).toMatchObject({ quantity_delta: 3, reason: 'Reposição manual: Chegada do fornecedor' })
  })

  it('salva vários endereços, favoritos, observações e histórico completo do cliente', async () => {
    const app = await testApp()
    const customer = await confirmRegistration(app, {
      role: 'customer', name: 'Cliente Preferências', email: 'preferencias@exemplo.com', phone: '82966667777', password: 'Pizza1234',
    })
    const headers = { cookie: customer.cookie }
    const addressPayload = {
      street: 'Rua das Massas', number: '20', neighborhood: 'Centro', city: 'Maceió', state: 'AL', postalCode: '57000-000',
    }
    await app.inject({ method: 'POST', url: '/api/auth/addresses', headers, payload: { ...addressPayload, label: 'Casa' } })
    await app.inject({ method: 'POST', url: '/api/auth/addresses', headers, payload: { ...addressPayload, street: 'Rua do Trabalho', number: '99', label: 'Trabalho' } })
    const addresses = await app.inject({ method: 'GET', url: '/api/auth/addresses', headers })
    expect(addresses.json().addresses).toHaveLength(2)
    expect(addresses.json().addresses[0].is_default).toBe(true)

    await app.inject({ method: 'POST', url: '/api/auth/favorites/pizza-margherita', headers })
    const favorites = await app.inject({ method: 'GET', url: '/api/auth/favorites', headers })
    expect(favorites.json().products[0]).toMatchObject({ id: 'pizza-margherita', name: 'Margherita da Casa' })

    const created = await app.inject({
      method: 'POST', url: '/api/orders', headers,
      payload: {
        customer: { name: 'Cliente Preferências', phone: '82966667777' }, fulfillmentType: 'delivery', paymentMethod: 'pix',
        address: addressPayload, saveAddressLabel: 'Casa nova', notes: 'Sem cebola', saveNote: true,
        items: [{ productId: 'pizza-calabresa', quantity: 1 }],
      },
    })
    expect(created.statusCode).toBe(201)
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers })
    expect(me.json().user.preferences.savedOrderNotes).toContain('Sem cebola')
    const history = await app.inject({ method: 'GET', url: '/api/auth/orders?limit=100', headers })
    expect(history.json()).toMatchObject({ total: 1, page: 1 })
    const details = await app.inject({ method: 'GET', url: `/api/auth/orders/${created.json().id}`, headers })
    expect(details.json().items[0]).toMatchObject({ product_name: 'Calabresa Defumada', quantity: 1 })
  })

  it('registra avisos simples por e-mail ao aceitar, preparar entrega e cancelar', async () => {
    const app = await testApp()
    const customer = await confirmRegistration(app, {
      role: 'customer', name: 'Cliente Avisos', email: 'avisos@exemplo.com', phone: '82977778888', password: 'Pizza1234',
    })
    const customerHeaders = { cookie: customer.cookie }
    const adminHeaders = { 'x-admin-key': 'test-admin-key' }
    const deliveryOrder = await app.inject({
      method: 'POST', url: '/api/orders', headers: customerHeaders,
      payload: {
        customer: { name: 'Cliente Avisos', phone: '82977778888' }, fulfillmentType: 'delivery', paymentMethod: 'pix',
        address: { street: 'Rua Avisos', number: '10', neighborhood: 'Centro', city: 'Maceió', state: 'AL', postalCode: '57000-000' },
        items: [{ productId: 'pizza-margherita', quantity: 1 }],
      },
    })
    for (const status of ['confirmed', 'preparing', 'ready', 'out_for_delivery']) {
      await app.inject({ method: 'PATCH', url: `/api/admin/orders/${deliveryOrder.json().id}/status`, headers: adminHeaders, payload: { status } })
    }
    const deliveredDetails = await app.inject({ method: 'GET', url: `/api/admin/orders/${deliveryOrder.json().id}`, headers: adminHeaders })
    expect(deliveredDetails.json().email_notifications.map((item: { status: string }) => item.status)).toEqual(['confirmed', 'ready', 'out_for_delivery'])
    expect(deliveredDetails.json().email_notifications.every((item: { delivery: string }) => item.delivery === 'development')).toBe(true)

    const cancelledOrder = await app.inject({
      method: 'POST', url: '/api/orders', headers: customerHeaders,
      payload: {
        customer: { name: 'Cliente Avisos', phone: '82977778888' }, fulfillmentType: 'pickup', paymentMethod: 'cash',
        items: [{ productId: 'sobremesa-brownie', quantity: 1 }],
      },
    })
    await app.inject({
      method: 'PATCH', url: `/api/admin/orders/${cancelledOrder.json().id}/status`, headers: adminHeaders,
      payload: { status: 'cancelled', note: 'Produto indisponível.' },
    })
    const cancelledDetails = await app.inject({ method: 'GET', url: `/api/admin/orders/${cancelledOrder.json().id}`, headers: adminHeaders })
    expect(cancelledDetails.json().email_notifications[0]).toMatchObject({ status: 'cancelled', recipient: 'avisos@exemplo.com', delivery: 'development' })
  })
})
