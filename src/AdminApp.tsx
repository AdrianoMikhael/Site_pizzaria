import { type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Banknote, BellRing, CalendarDays, CheckCircle2, ChefHat, Clock3, Filter, LoaderCircle, LockKeyhole, LogOut, MapPin, MessageCircle, Pencil, Plus, Power, Printer, RefreshCw, Save, Send, Settings, ShoppingBag, Tags, TrendingUp, Truck, Volume2, X } from 'lucide-react'
import { api, customizationSummary, type AdminCategory, type AdminCustomizationOption, type AdminIngredient, type AdminOrder, type AdminOrderFilters, type AdminProduct, type AuthUser, type ChatConversation, type ChatThread, type Dashboard, type DashboardFilter, type DeliveryZone, type InventoryItem, type InventoryOverview, type OrderDetails, type StoreOperation, type StoreProfile } from './api'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
const labels: Record<string, string> = {
  received: 'Recebido', confirmed: 'Confirmado', preparing: 'Em preparo', ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega', completed: 'Concluído', cancelled: 'Cancelado',
  pending: 'Pendente', paid: 'Pago', refunded: 'Estornado',
  pix: 'Pix', cash: 'Dinheiro', credit_card: 'Crédito', debit_card: 'Débito',
  delivery: 'Entrega', pickup: 'Retirada',
}

function submitMessageOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, busy: boolean) {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  if (!busy && event.currentTarget.value.trim()) event.currentTarget.form?.requestSubmit()
}

function dateInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function moveDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function startOfWeek(isoDate: string) {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay()
  return moveDate(isoDate, -((day + 6) % 7))
}

const today = dateInSaoPaulo()
const formatInputDate = (value: string) => shortDate.format(new Date(`${value}T12:00:00Z`))
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
type SimpleOrderLine = { existingItemId?: string; productId?: string; name: string; quantity: number; notes?: string }
const weekDays = [
  ['monday', 'Segunda'], ['tuesday', 'Terça'], ['wednesday', 'Quarta'], ['thursday', 'Quinta'],
  ['friday', 'Sexta'], ['saturday', 'Sábado'], ['sunday', 'Domingo'],
] as const

function nextStatus(order: AdminOrder) {
  const normal: Record<string, string | undefined> = {
    received: 'confirmed', confirmed: 'preparing', preparing: 'ready',
    ready: order.fulfillment_type === 'delivery' ? 'out_for_delivery' : 'completed',
    out_for_delivery: 'completed',
  }
  return normal[order.order_status]
}

function AdminAuth({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [developmentResetUrl, setDevelopmentResetUrl] = useState<string | null>(null)
  const [pendingVerification, setPendingVerification] = useState<{ email: string; developmentVerificationUrl?: string } | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSending(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      if (mode === 'login') {
        const result = await api.login({ email: data.get('email'), password: data.get('password') })
        if (result.user.role !== 'admin') { await api.logout(); throw new Error('Esta conta não possui permissão administrativa.') }
        onAuthenticated(result.user)
      } else if (mode === 'register') {
        const result = await api.register({
          role: 'admin', name: data.get('name'), email: data.get('email'), password: data.get('password'),
          returnTo: '/admin.html',
        })
        setPendingVerification({ email: result.email, developmentVerificationUrl: result.developmentVerificationUrl })
      } else {
        const result = await api.forgotPassword(String(data.get('email')))
        setMessage(result.message)
        setDevelopmentResetUrl(result.developmentResetUrl ?? null)
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível autenticar.') }
    finally { setSending(false) }
  }

  async function resendVerification() {
    if (!pendingVerification) return
    setSending(true); setError(''); setMessage('')
    try {
      const result = await api.resendVerification(pendingVerification.email)
      setPendingVerification({ email: pendingVerification.email, developmentVerificationUrl: result.developmentVerificationUrl })
      setMessage('Novo link de confirmação gerado.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível reenviar o link.') }
    finally { setSending(false) }
  }

  async function enterDemoAdmin() {
    setSending(true); setError('')
    try {
      const result = await api.login({ email: 'admin@pizzaria.local', password: 'PizzaAdmin123' })
      onAuthenticated(result.user)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível entrar na conta de teste.') }
    finally { setSending(false) }
  }

  return <main className="admin-auth-page">
    <section className="admin-auth-card">
      <a className="admin-auth-brand" href="/"><span>B</span><div><strong>Brasa & Massa</strong><small>Painel administrativo</small></div></a>
      <span className="admin-auth-icon"><LockKeyhole size={27} /></span><small>Área protegida</small>
      {pendingVerification ? <div className="admin-verification">
        <h1>Confirme seu e-mail</h1><p>Enviamos o link de ativação para <strong>{pendingVerification.email}</strong>.</p>
        {pendingVerification.developmentVerificationUrl && <a href={pendingVerification.developmentVerificationUrl}>Abrir confirmação local</a>}
        {message && <p className="admin-auth-success">{message}</p>}{error && <p className="admin-auth-error">{error}</p>}
        <button onClick={() => void resendVerification()} disabled={sending}>{sending ? <LoaderCircle className="spin" size={17} /> : null}Reenviar confirmação</button>
        <button className="admin-text-button" onClick={() => { setPendingVerification(null); setMode('login') }}>Voltar ao login</button>
      </div> : <>
        <h1>{mode === 'login' ? 'Acessar o painel' : mode === 'register' ? 'Primeiro administrador' : 'Recuperar senha'}</h1>
        <p>{mode === 'login'
          ? 'Entre com uma conta que tenha permissão administrativa.'
          : mode === 'register'
            ? 'O primeiro cadastro é liberado sem código. Depois dele, novos cadastros administrativos ficam bloqueados.'
            : 'Informe seu e-mail. Se a conta existir, enviaremos um link de uso único para criar uma nova senha.'}</p>
        {import.meta.env.DEV && mode === 'login' && <div className="demo-login-box"><strong>Conta temporária de administrador</strong><code>admin@pizzaria.local</code><code>PizzaAdmin123</code><button onClick={() => void enterDemoAdmin()} disabled={sending}>Entrar como admin de teste</button></div>}
        {mode !== 'forgot' && <div className="admin-auth-tabs">
          <button className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(''); setMessage('') }}>Entrar</button>
          <button className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(''); setMessage('') }}>Primeiro cadastro</button>
        </div>}
        <form onSubmit={submit}>
          {mode === 'register' && <label>Nome<input name="name" required minLength={2} /></label>}
          <label>E-mail<input name="email" type="email" required /></label>
          {mode !== 'forgot' && <label>Senha<input name="password" type="password" required minLength={8} placeholder="Letra e número, mínimo 8 caracteres" /></label>}
          {message && <p className="admin-auth-success">{message}</p>}
          {developmentResetUrl && <a className="admin-local-reset" href={developmentResetUrl}>Abrir recuperação local</a>}
          {error && <p className="admin-auth-error">{error}</p>}
          <button disabled={sending}>{sending ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}{mode === 'login' ? 'Entrar com segurança' : mode === 'register' ? 'Criar primeiro administrador' : 'Enviar link de recuperação'}</button>
          {mode === 'login' && <button type="button" className="admin-forgot-button" onClick={() => { setMode('forgot'); setError(''); setMessage(''); setDevelopmentResetUrl(null) }}>Esqueci minha senha</button>}
          {mode === 'forgot' && <button type="button" className="admin-forgot-button" onClick={() => { setMode('login'); setError(''); setMessage(''); setDevelopmentResetUrl(null) }}>Voltar ao login</button>}
        </form>
      </>}
      <a className="admin-auth-back" href="/"><ArrowLeft size={15} />Voltar à loja</a>
    </section>
  </main>
}

export default function AdminApp() {
  const adminKey: string | undefined = undefined
  const [adminUser, setAdminUser] = useState<AuthUser | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [dashboardFilter, setDashboardFilter] = useState<DashboardFilter>({ from: today, to: today })
  const [activePreset, setActivePreset] = useState('day')
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [allOrders, setAllOrders] = useState<AdminOrder[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workingOrder, setWorkingOrder] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<OrderDetails | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [menuProducts, setMenuProducts] = useState<AdminProduct[]>([])
  const [menuCategories, setMenuCategories] = useState<AdminCategory[]>([])
  const [adminOptions, setAdminOptions] = useState<AdminCustomizationOption[]>([])
  const [ingredients, setIngredients] = useState<AdminIngredient[]>([])
  const [inventory, setInventory] = useState<InventoryOverview>({ items: [], movements: [], lowStockCount: 0 })
  const [productFormOpen, setProductFormOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null)
  const [menuSaving, setMenuSaving] = useState(false)
  const [storeProfile, setStoreProfile] = useState<StoreProfile | null>(null)
  const [storeOperation, setStoreOperation] = useState<StoreOperation | null>(null)
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([])
  const [chats, setChats] = useState<ChatConversation[]>([])
  const [selectedChat, setSelectedChat] = useState<ChatThread | null>(null)
  const [chatLive, setChatLive] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [orderFilters, setOrderFilters] = useState<AdminOrderFilters>({})
  const [alertsEnabled, setAlertsEnabled] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const alertsEnabledRef = useRef(false)
  const seenOrderIdsRef = useRef<Set<string> | null>(null)
  const [assistedOrderOpen, setAssistedOrderOpen] = useState(false)
  const [assistedLines, setAssistedLines] = useState<SimpleOrderLine[]>([])
  const [assistedFulfillment, setAssistedFulfillment] = useState<'delivery' | 'pickup'>('delivery')
  const [editingOrder, setEditingOrder] = useState<OrderDetails | null>(null)
  const [editLines, setEditLines] = useState<SimpleOrderLine[]>([])

  const load = useCallback(async (key: string | undefined = adminKey, selectedFilter = dashboardFilter, selectedOrderFilters = orderFilters) => {
    setLoading(true); setError('')
    try {
      const [ordersData, allOrdersData, dashboardData, productsData, categoriesData, settingsData, zonesData, chatsData, optionsData, ingredientsData, inventoryData] = await Promise.all([
        api.adminOrders(key, selectedOrderFilters), api.adminOrders(key), api.dashboard(key, selectedFilter), api.adminProducts(key), api.adminCategories(key),
        api.adminSettings(key), api.adminDeliveryZones(key), api.adminChats(key), api.adminCustomizations(key), api.adminIngredients(key), api.adminInventory(key),
      ])
      const receivedIds = allOrdersData.orders.filter((order) => order.order_status === 'received').map((order) => order.id)
      if (seenOrderIdsRef.current) {
        const newIds = receivedIds.filter((id) => !seenOrderIdsRef.current!.has(id))
        if (newIds.length && alertsEnabledRef.current) playOrderSound()
        receivedIds.forEach((id) => seenOrderIdsRef.current!.add(id))
      } else { seenOrderIdsRef.current = new Set(receivedIds) }
      setOrders(ordersData.orders); setAllOrders(allOrdersData.orders); setDashboard(dashboardData); setMenuProducts(productsData.products)
      setMenuCategories(categoriesData.categories); setStoreProfile(settingsData.profile); setStoreOperation(settingsData.operation)
      setDeliveryZones(zonesData.zones); setChats(chatsData.conversations); setAdminOptions(optionsData.options); setIngredients(ingredientsData.ingredients); setInventory(inventoryData)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar o painel.')
    } finally { setLoading(false) }
  }, [adminKey, dashboardFilter, orderFilters])

  useEffect(() => {
    api.me().then((result) => { if (result.user.role === 'admin') setAdminUser(result.user) }).catch(() => undefined).finally(() => setAuthChecking(false))
  }, [])
  useEffect(() => { if (adminUser) void load() }, [adminUser, load])
  useEffect(() => { if (!adminUser) return; const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer) }, [adminUser, load])
  useEffect(() => {
    if (!adminUser || !selectedChat) return
    const timer = window.setInterval(() => {
      void api.adminChatThread(adminKey, selectedChat.conversation.id).then(async (result) => {
        setSelectedChat(result)
        setChats((await api.adminChats(adminKey)).conversations)
      }).catch(() => undefined)
    }, 8000)
    return () => window.clearInterval(timer)
  }, [adminUser, selectedChat?.conversation.id])
  useEffect(() => {
    if (!adminUser) return
    const threadId = selectedChat?.conversation.id
    const events = new EventSource('/api/admin/chat-events')
    const refresh = async () => {
      if (threadId) await api.adminChatThread(adminKey, threadId).then(setSelectedChat).catch(() => undefined)
      await api.adminChats(adminKey).then((result) => setChats(result.conversations)).catch(() => undefined)
    }
    events.addEventListener('open', () => setChatLive(true))
    events.addEventListener('chat', refresh)
    events.onerror = () => setChatLive(false)
    return () => { events.removeEventListener('chat', refresh); events.close() }
  }, [adminUser?.id, adminKey, selectedChat?.conversation.id])

  const activeOrders = useMemo(() => orders.filter((order) => !['completed', 'cancelled'].includes(order.order_status)), [orders])
  const displayedOrders = orderFilters.status ? orders : activeOrders
  const newOrderCount = useMemo(() => allOrders.filter((order) => order.order_status === 'received').length, [allOrders])
  const delayedCount = useMemo(() => allOrders.filter((order) => order.is_delayed).length, [allOrders])

  useEffect(() => {
    document.title = newOrderCount ? `(${newOrderCount}) Novos pedidos · Brasa & Massa` : 'Painel administrativo · Brasa & Massa'
    return () => { document.title = 'Painel administrativo · Brasa & Massa' }
  }, [newOrderCount])

  function playOrderSound() {
    const context = audioContextRef.current
    if (!context) return
    const now = context.currentTime
    ;[0, 0.18].forEach((delay, index) => {
      const oscillator = context.createOscillator(); const gain = context.createGain()
      oscillator.type = 'sine'; oscillator.frequency.value = index ? 880 : 660
      gain.gain.setValueAtTime(0.0001, now + delay); gain.gain.exponentialRampToValueAtTime(0.18, now + delay + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.16)
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now + delay); oscillator.stop(now + delay + 0.18)
    })
  }

  async function enableAlerts() {
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    if (context.state === 'suspended') await context.resume()
    alertsEnabledRef.current = true; setAlertsEnabled(true); playOrderSound()
  }

  function updateOrderFilter(key: keyof AdminOrderFilters, value: string) {
    const next = { ...orderFilters, [key]: value || undefined }
    setOrderFilters(next); void load(adminKey, dashboardFilter, next)
  }

  function applyRange(from: string, to: string, preset: string) {
    const nextFilter: DashboardFilter = { from, to }
    setDateFrom(from); setDateTo(to); setActivePreset(preset); setDashboardFilter(nextFilter)
    void load(adminKey, nextFilter)
  }

  function applyPreset(preset: string) {
    const from = preset === 'day' ? today
      : preset === 'week' ? startOfWeek(today)
        : preset === 'month' ? `${today.slice(0, 7)}-01`
          : moveDate(today, -(Number(preset) - 1))
    applyRange(from, today, preset)
  }

  function submitRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    if (dateFrom > dateTo) { setError('A data inicial não pode ser posterior à data final.'); return }
    applyRange(dateFrom, dateTo, 'custom')
  }

  const rangeLabel = dateFrom === dateTo
    ? `Vendas de ${formatInputDate(dateFrom)}`
    : `Vendas de ${formatInputDate(dateFrom)} até ${formatInputDate(dateTo)}`

  async function changeStatus(order: AdminOrder) {
    const status = nextStatus(order); if (!status) return
    let estimatedMinutes: number | undefined
    if (status === 'confirmed') {
      const answer = window.prompt('Tempo estimado para este pedido, em minutos:', String(storeOperation?.etaMax ?? 40))
      if (answer === null) return
      estimatedMinutes = Number(answer)
      if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 5 || estimatedMinutes > 240) { setError('Informe um tempo entre 5 e 240 minutos.'); return }
    }
    setWorkingOrder(order.id); setError('')
    try { await api.updateStatus(adminKey, order.id, { status, estimatedMinutes }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao atualizar pedido.') }
    finally { setWorkingOrder('') }
  }

  async function rejectOrder(order: AdminOrder) {
    const note = window.prompt('Informe o motivo do cancelamento para o cliente:')?.trim()
    if (!note) { setError('O motivo do cancelamento é obrigatório.'); return }
    setWorkingOrder(order.id); setError('')
    try { await api.updateStatus(adminKey, order.id, { status: 'cancelled', note }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao rejeitar pedido.') }
    finally { setWorkingOrder('') }
  }

  async function printOrder(orderId: string) {
    const printWindow = window.open('', '_blank', 'width=900,height=800')
    if (!printWindow) { setError('O navegador bloqueou a janela de impressão. Libere pop-ups e tente novamente.'); return }
    printWindow.document.write('<p style="font-family:sans-serif;padding:20px">Preparando duas comandas...</p>')
    try {
      const order = await api.adminOrder(adminKey, orderId)
      const items = order.items.map((item) => `<div class="item"><b>${item.quantity}× ${escapeHtml(item.product_name)}</b><span>${escapeHtml(customizationSummary(item))}</span>${item.notes ? `<em>Obs.: ${escapeHtml(item.notes)}</em>` : ''}</div>`).join('')
      const address = order.fulfillment_type === 'delivery'
        ? `${escapeHtml(order.street)}, ${escapeHtml(order.number)}${order.complement ? ` — ${escapeHtml(order.complement)}` : ''}<br>${escapeHtml(order.neighborhood)} · ${escapeHtml(order.city)}/${escapeHtml(order.state)}`
        : `RETIRADA — ${escapeHtml(storeProfile?.address.street || 'Rua Lordleens')}, ${escapeHtml(storeProfile?.address.number)}`
      const ticket = (copy: string) => `<section class="ticket"><header><b>${escapeHtml(storeProfile?.name || 'Brasa & Massa')}</b><span>${copy}</span></header><h1>${escapeHtml(order.tracking_code)}</h1><div class="meta"><b>${escapeHtml(order.customer_name)}</b> · ${escapeHtml(order.customer_phone)}<br>${dateTime.format(new Date(order.created_at))} · ${labels[order.fulfillment_type]} · ${labels[order.payment_method]}<br>${address}</div><hr><h2>ITENS</h2>${items}<hr><div class="totals"><span>Total</span><b>${currency.format(Number(order.total))}</b></div>${order.estimated_minutes ? `<p class="eta">PREVISÃO: ${order.estimated_minutes} MINUTOS</p>` : ''}${order.notes ? `<p class="notes"><b>OBSERVAÇÕES:</b> ${escapeHtml(order.notes)}</p>` : ''}</section>`
      printWindow.document.open()
      printWindow.document.write(`<!doctype html><html><head><title>Comandas ${escapeHtml(order.tracking_code)}</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#000}.sheet{height:100vh;position:relative}.ticket{height:50vh;padding:10mm 12mm;overflow:hidden}.ticket:first-child{border-bottom:2px dashed #000}.cut{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;padding:0 8px;font-size:9px}.ticket header{display:flex;justify-content:space-between;font-size:13px}.ticket h1{font-size:20px;margin:8px 0}.ticket h2{font-size:11px;margin:6px 0}.meta{font-size:10px;line-height:1.45}.item{display:grid;grid-template-columns:1fr;gap:2px;padding:4px 0;border-bottom:1px dotted #777;font-size:10px}.item span,.item em{font-size:9px}.totals{display:flex;justify-content:space-between;font-size:13px;margin-top:5px}.eta{font-size:11px;font-weight:bold;border:1px solid #000;padding:5px}.notes{font-size:9px}.ticket hr{border:0;border-top:1px solid #000;margin:6px 0}@media print{body{print-color-adjust:exact}.sheet{break-after:page}}</style></head><body><main class="sheet">${ticket('VIA DO PIZZAIOLO')}<div class="cut">✂ CORTAR AQUI</div>${ticket('VIA DO ATENDENTE')}</main><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`)
      printWindow.document.close()
    } catch (caught) { printWindow.close(); setError(caught instanceof Error ? caught.message : 'Erro ao preparar comandas.') }
  }

  async function markPaid(order: AdminOrder) {
    setWorkingOrder(order.id); setError('')
    try { await api.updatePayment(adminKey, order.id, 'paid'); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao confirmar pagamento.') }
    finally { setWorkingOrder('') }
  }

  async function openDetails(orderId: string) {
    setDetailLoading(true); setError('')
    try { setSelectedOrder(await api.adminOrder(adminKey, orderId)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao abrir o pedido.') }
    finally { setDetailLoading(false) }
  }

  async function openOrderEdit(orderId: string) {
    setDetailLoading(true); setError('')
    try { beginOrderEdit(await api.adminOrder(adminKey, orderId)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao abrir edição.') }
    finally { setDetailLoading(false) }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMenuSaving(true); setError('')
    const data = new FormData(event.currentTarget)
    const stockValue = String(data.get('stockQuantity') ?? '').trim()
    const payload = {
      categoryId: data.get('categoryId'), name: data.get('name'),
      description: data.get('description'), basePrice: Number(data.get('basePrice')), active: editingProduct?.active ?? true,
      stockQuantity: stockValue ? Number(stockValue) : null,
    }
    try {
      if (editingProduct) await api.updateProduct(adminKey, editingProduct.id, payload)
      else await api.createProduct(adminKey, payload)
      setProductFormOpen(false); setEditingProduct(null); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao salvar produto.') }
    finally { setMenuSaving(false) }
  }

  async function toggleProduct(product: AdminProduct) {
    setMenuSaving(true); setError('')
    try { await api.updateProduct(adminKey, product.id, { active: !product.active }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao alterar disponibilidade.') }
    finally { setMenuSaving(false) }
  }

  async function updateOptionAvailability(option: AdminCustomizationOption, change: 'active' | 'stock') {
    let payload: Record<string, unknown> = { type: option.type }
    if (change === 'active') payload.active = !option.active
    else {
      const value = window.prompt(`Estoque de ${option.name}. Deixe vazio para ilimitado:`, option.stock_quantity === null ? '' : String(option.stock_quantity))
      if (value === null) return
      payload.stockQuantity = value.trim() === '' ? null : Number(value)
      if (payload.stockQuantity !== null && (!Number.isInteger(payload.stockQuantity) || Number(payload.stockQuantity) < 0)) { setError('Informe um estoque inteiro válido.'); return }
    }
    setMenuSaving(true); setError('')
    try { await api.updateAdminCustomization(adminKey, option.id, payload); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao alterar opção.') }
    finally { setMenuSaving(false) }
  }

  async function createIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setMenuSaving(true); setError('')
    try { await api.createIngredient(adminKey, { name: data.get('name'), productIds: data.getAll('productIds') }); form.reset(); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao cadastrar ingrediente.') }
    finally { setMenuSaving(false) }
  }

  async function toggleIngredient(ingredient: AdminIngredient) {
    setMenuSaving(true); setError('')
    try { await api.updateIngredient(adminKey, ingredient.id, { active: !ingredient.active }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao alterar ingrediente.') }
    finally { setMenuSaving(false) }
  }

  async function restockItem(item: InventoryItem) {
    const answer = window.prompt(`Quantas unidades deseja adicionar ao estoque de ${item.name}?`, '10')
    if (answer === null) return
    const quantity = Number(answer)
    if (!Number.isInteger(quantity) || quantity < 1) { setError('Informe uma quantidade inteira maior que zero.'); return }
    setMenuSaving(true); setError('')
    try { await api.restockInventory(adminKey, { itemType: item.item_type, itemId: item.id, quantity }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao repor estoque.') }
    finally { setMenuSaving(false) }
  }

  function addSpecialDate(container: HTMLDivElement) {
    if (!storeOperation) return
    const input = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`)!
    const date = input('date').value; const label = input('label').value.trim(); const closed = input('closed').checked
    if (!date || !label) { setError('Informe a data e a descrição.'); return }
    const entry = { date, label, closed, ...(closed ? {} : { opensAt: input('opensAt').value, closesAt: input('closesAt').value }) }
    setStoreOperation({ ...storeOperation, specialDates: [...storeOperation.specialDates.filter((item) => item.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date)) })
    input('date').value = ''; input('label').value = ''; input('closed').checked = false
  }

  function addSimpleLine(setter: Dispatch<SetStateAction<SimpleOrderLine[]>>, productId: string) {
    const product = menuProducts.find((item) => item.id === productId); if (!product) return
    setter((current) => { const found = current.find((item) => item.productId === productId && !item.existingItemId); return found ? current.map((item) => item === found ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { productId, name: product.name, quantity: 1 }] })
  }

  async function createAssistedOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!assistedLines.length) { setError('Adicione ao menos um produto.'); return }
    const data = new FormData(event.currentTarget); const fulfillmentType = String(data.get('fulfillmentType')) as 'delivery' | 'pickup'; setMenuSaving(true); setError('')
    try {
      await api.createOrder({
        customer: { name: data.get('customerName'), phone: data.get('phone'), email: data.get('email') || undefined },
        fulfillmentType, paymentMethod: data.get('paymentMethod'), notes: data.get('notes') || 'Pedido realizado pelo atendimento.',
        address: fulfillmentType === 'delivery' ? { street: data.get('street'), number: data.get('number'), neighborhood: data.get('neighborhood'), city: data.get('city'), state: data.get('state'), postalCode: data.get('postalCode'), complement: data.get('complement') || undefined, reference: data.get('reference') || undefined } : undefined,
        items: assistedLines.map((item) => ({ productId: item.productId, quantity: item.quantity, addonIds: [], notes: item.notes })),
      })
      setAssistedOrderOpen(false); setAssistedLines([]); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao criar pedido assistido.') }
    finally { setMenuSaving(false) }
  }

  function beginOrderEdit(order: OrderDetails) {
    setEditingOrder(order); setEditLines(order.items.map((item) => ({ existingItemId: item.id, productId: item.product_id, name: item.product_name, quantity: item.quantity, notes: item.notes ?? undefined })))
  }

  async function saveOrderEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingOrder || !editLines.length) { setError('O pedido precisa ter ao menos um item.'); return }
    const data = new FormData(event.currentTarget); setMenuSaving(true); setError('')
    try {
      const updated = await api.editAdminOrder(adminKey, editingOrder.id, {
        customerName: data.get('customerName'), phone: data.get('phone'), notes: data.get('notes') || undefined,
        address: editingOrder.fulfillment_type === 'delivery' ? { street: data.get('street'), number: data.get('number'), neighborhood: data.get('neighborhood'), city: data.get('city'), state: data.get('state'), postalCode: data.get('postalCode'), complement: data.get('complement') || undefined, reference: data.get('reference') || undefined } : undefined,
        items: editLines.map(({ existingItemId, productId, quantity, notes }) => ({ existingItemId, ...(!existingItemId ? { productId } : {}), quantity, notes })),
      })
      setEditingOrder(null); setSelectedOrder(updated); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao editar pedido.') }
    finally { setMenuSaving(false) }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMenuSaving(true); setError('')
    const form = event.currentTarget; const data = new FormData(form)
    try { await api.createCategory(adminKey, { name: data.get('name'), sortOrder: menuCategories.length + 1 }); form.reset(); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao criar categoria.') }
    finally { setMenuSaving(false) }
  }

  async function toggleCategory(category: AdminCategory) {
    setMenuSaving(true); setError('')
    try { await api.updateCategory(adminKey, category.id, { active: !category.active }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao alterar categoria.') }
    finally { setMenuSaving(false) }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSettingsSaving(true); setError('')
    const data = new FormData(event.currentTarget)
    const weeklyHours = Object.fromEntries(weekDays.map(([key]) => [key, {
      enabled: data.get(`${key}Enabled`) === 'on',
      opensAt: String(data.get(`${key}OpensAt`)), closesAt: String(data.get(`${key}ClosesAt`)),
    }]))
    const payload = {
      profile: {
        name: data.get('storeName'), phone: data.get('storePhone'),
        address: { street: data.get('storeStreet'), number: data.get('storeNumber'), neighborhood: data.get('storeNeighborhood'), city: data.get('storeCity'), state: data.get('storeState'), postalCode: data.get('storePostalCode') },
      },
      operation: {
        status: data.get('storeStatus'), opensAt: data.get('opensAt'), closesAt: data.get('closesAt'),
        etaMin: Number(data.get('etaMin')), etaMax: Number(data.get('etaMax')), deliveryRadiusKm: Number(data.get('deliveryRadiusKm')),
        weeklyHours, specialDates: storeOperation?.specialDates ?? [],
      },
    }
    try { const saved = await api.updateAdminSettings(adminKey, payload); setStoreProfile(saved.profile); setStoreOperation(saved.operation) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao salvar configurações.') }
    finally { setSettingsSaving(false) }
  }

  async function createZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSettingsSaving(true); setError('')
    const form = event.currentTarget; const data = new FormData(form)
    try { await api.createDeliveryZone(adminKey, { neighborhood: data.get('neighborhood'), city: data.get('city'), fee: Number(data.get('fee')) }); form.reset(); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao cadastrar bairro.') }
    finally { setSettingsSaving(false) }
  }

  async function toggleZone(zone: DeliveryZone) {
    setSettingsSaving(true); setError('')
    try { await api.updateDeliveryZone(adminKey, zone.id, { active: !zone.active }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao alterar bairro.') }
    finally { setSettingsSaving(false) }
  }

  async function editZoneFee(zone: DeliveryZone) {
    const value = window.prompt(`Nova taxa para ${zone.neighborhood}:`, Number(zone.fee).toFixed(2).replace('.', ','))
    if (value === null) return
    const fee = Number(value.replace(',', '.'))
    if (!Number.isFinite(fee) || fee < 0) { setError('Informe uma taxa válida.'); return }
    setSettingsSaving(true); setError('')
    try { await api.updateDeliveryZone(adminKey, zone.id, { fee }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao alterar taxa.') }
    finally { setSettingsSaving(false) }
  }

  async function reviewDelivery(order: AdminOrder, status: 'approved' | 'rejected') {
    const feeText = status === 'approved' ? window.prompt('Qual será a taxa de entrega para este endereço?', '0,00') : null
    if (status === 'approved' && feeText === null) return
    const note = window.prompt(status === 'approved' ? 'Observação da aprovação (opcional):' : 'Motivo da recusa:')?.trim() || undefined
    if (status === 'rejected' && !note) { setError('O motivo da recusa é obrigatório.'); return }
    const deliveryFee = status === 'approved' ? Number(String(feeText).replace(',', '.')) : undefined
    if (status === 'approved' && !Number.isFinite(deliveryFee)) { setError('Informe uma taxa válida.'); return }
    setWorkingOrder(order.id); setError('')
    try { await api.reviewDelivery(adminKey, order.id, { status, deliveryFee, note }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao analisar entrega.') }
    finally { setWorkingOrder('') }
  }

  async function openChat(id: string) {
    try {
      setSelectedChat(await api.adminChatThread(adminKey, id))
      setChats((await api.adminChats(adminKey)).conversations)
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao abrir atendimento.') }
  }

  async function sendChatReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedChat) return
    const form = event.currentTarget; const data = new FormData(form); setSettingsSaving(true); setError('')
    try { await api.sendAdminChatMessage(adminKey, selectedChat.conversation.id, String(data.get('message'))); form.reset(); setSelectedChat(await api.adminChatThread(adminKey, selectedChat.conversation.id)); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao responder atendimento.') }
    finally { setSettingsSaving(false) }
  }

  async function toggleChatStatus() {
    if (!selectedChat) return
    const status = selectedChat.conversation.status === 'open' ? 'closed' : 'open'
    await api.updateChatStatus(adminKey, selectedChat.conversation.id, status)
    setSelectedChat(await api.adminChatThread(adminKey, selectedChat.conversation.id)); await load()
  }

  async function logoutAdmin() {
    try { await api.logout() } finally { setAdminUser(null); setOrders([]); setDashboard(null) }
  }

  if (authChecking) return <main className="admin-auth-page"><div className="admin-auth-loading"><LoaderCircle className="spin" /><span>Verificando sessão segura...</span></div></main>
  if (!adminUser) return <AdminAuth onAuthenticated={setAdminUser} />

  return <div className="admin-shell">
    <aside className="admin-sidebar"><a className="admin-brand" href="/"><span>B</span><div><strong>{storeProfile?.name ?? 'Brasa & Massa'}</strong><small>Painel operacional</small></div></a><nav><a className="is-active" href="#dashboard"><TrendingUp size={18} />Visão geral</a><a href="#pedidos"><ShoppingBag size={18} />Pedidos ativos</a><a href="#configuracoes"><Settings size={18} />Configurações</a><a href="#entregas"><Truck size={18} />Áreas de entrega</a><a className="chat-nav-link" href="#atendimento"><MessageCircle size={18} />Atendimento{chats.some((chat) => chat.unread) && <i className="nav-unread-dot" title="Nova mensagem" />}</a><a href="#cardapio"><Tags size={18} />Cardápio</a></nav><a className="back-store" href="/"><ArrowLeft size={16} />Voltar à loja</a></aside>
    <main className="admin-main"><header className="admin-header"><div><small>Operação em tempo real</small><h1>Olá, equipe da cozinha</h1></div><div className="admin-header-actions"><button className={alertsEnabled ? 'sound-toggle is-active' : 'sound-toggle'} onClick={() => void enableAlerts()}><Volume2 size={17} />{alertsEnabled ? 'Avisos ativos' : 'Ativar avisos'}</button><button onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={17} />Atualizar</button></div></header>
      <div className="admin-session"><span><CheckCircle2 size={16} /><span><strong>Sessão administrativa protegida</strong><small>{adminUser.name} · {adminUser.email}</small></span></span><button onClick={() => void logoutAdmin()}><LogOut size={16} />Sair</button></div>
      {error && <div className="admin-error">{error}</div>}
      {newOrderCount > 0 && <div className="new-order-notice"><BellRing size={21} /><span><strong>{newOrderCount} {newOrderCount === 1 ? 'pedido novo aguardando aceite' : 'pedidos novos aguardando aceite'}</strong><small>Os cartões destacados permanecem assim até a equipe aceitar ou rejeitar.</small></span><a href="#pedidos">Ver pedidos</a></div>}
      {inventory.lowStockCount > 0 && <div className="low-stock-notice"><AlertTriangle size={21} /><span><strong>{inventory.lowStockCount} {inventory.lowStockCount === 1 ? 'item com estoque baixo' : 'itens com estoque baixo'}</strong><small>Reponha os itens antes que desapareçam do cardápio.</small></span><a href="#estoque">Ver estoque</a></div>}
      <section id="dashboard" className="dashboard-section"><div className="section-line"><div><small>Faturamento</small><h2>Resumo da operação</h2></div></div>
        <div className="sales-calendar"><div className="calendar-heading"><span><CalendarDays size={19} /></span><div><strong>Período das vendas</strong><small>{rangeLabel}</small></div></div><div className="period-tabs">{([['day','Hoje'],['week','Semana'],['month','Mês'],['7','7 dias'],['15','15 dias'],['30','30 dias']] as const).map(([value,label]) => <button key={value} className={activePreset === value ? 'is-active' : ''} onClick={() => applyPreset(value)}>{label}</button>)}</div><form className="date-range" onSubmit={submitRange}><label>Data inicial<input type="date" value={dateFrom} max={today} onChange={(event) => { setDateFrom(event.target.value); setActivePreset('custom') }} required /></label><span>até</span><label>Data final<input type="date" value={dateTo} min={dateFrom} max={today} onChange={(event) => { setDateTo(event.target.value); setActivePreset('custom') }} required /></label><button>Aplicar período</button></form><p>Para consultar somente um dia, selecione a mesma data nos dois calendários.</p></div>
        <div className="metrics"><article><span><Banknote size={20} /></span><small>Faturamento</small><strong>{currency.format(dashboard?.revenue ?? 0)}</strong><p>Somente pagamentos confirmados</p></article><article><span><CheckCircle2 size={20} /></span><small>Pedidos pagos</small><strong>{dashboard?.paidOrders ?? 0}</strong><p>No período selecionado</p></article><article><span><TrendingUp size={20} /></span><small>Ticket médio</small><strong>{currency.format(dashboard?.averageTicket ?? 0)}</strong><p>Média dos pedidos pagos</p></article><article><span><ChefHat size={20} /></span><small>Em andamento</small><strong>{allOrders.filter((order) => !['completed', 'cancelled'].includes(order.order_status)).length}</strong><p>Aguardando conclusão</p></article></div>
      </section>
      <section id="pedidos" className="orders-section"><div className="section-line"><div><small>Fila da cozinha</small><h2>Pedidos ativos <b className="new-order-counter">{newOrderCount}</b></h2></div><div className="order-section-actions"><span className="auto-refresh"><Clock3 size={15} />Atualiza a cada 15 segundos · {delayedCount} atrasados</span><button onClick={() => setAssistedOrderOpen(true)}><Plus size={16} />Pedido por WhatsApp</button></div></div>
        <div className="order-filters"><span><Filter size={15} />Filtrar</span><select value={orderFilters.fulfillmentType ?? ''} onChange={(event) => updateOrderFilter('fulfillmentType', event.target.value)}><option value="">Entrega e retirada</option><option value="delivery">Somente entrega</option><option value="pickup">Somente retirada</option></select><select value={orderFilters.paymentMethod ?? ''} onChange={(event) => updateOrderFilter('paymentMethod', event.target.value)}><option value="">Todas as formas</option><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="credit_card">Crédito</option><option value="debit_card">Débito</option></select><select value={orderFilters.paymentStatus ?? ''} onChange={(event) => updateOrderFilter('paymentStatus', event.target.value)}><option value="">Qualquer pagamento</option><option value="pending">Pendente</option><option value="paid">Pago</option><option value="cancelled">Cancelado</option><option value="refunded">Estornado</option></select><select value={orderFilters.status ?? ''} onChange={(event) => updateOrderFilter('status', event.target.value)}><option value="">Todos os status</option><option value="received">Novos</option><option value="confirmed">Confirmados</option><option value="preparing">Em preparo</option><option value="ready">Prontos</option><option value="out_for_delivery">Em rota</option><option value="completed">Concluídos</option><option value="cancelled">Cancelados</option></select><button onClick={() => { setOrderFilters({}); void load(adminKey, dashboardFilter, {}) }}>Limpar</button></div>
        {loading && orders.length === 0 ? <div className="admin-empty"><LoaderCircle className="spin" />Carregando pedidos...</div> : displayedOrders.length === 0 ? <div className="admin-empty"><ChefHat size={30} /><strong>Nenhum pedido encontrado</strong><span>Ajuste os filtros ou aguarde um novo pedido.</span></div> : <div className="orders-list">{displayedOrders.map((order) => {
          const next = nextStatus(order); const busy = workingOrder === order.id; const pendingReview = order.delivery_review_status === 'pending'
          const classes = ['order-row', pendingReview ? 'order-row--review' : '', order.order_status === 'received' ? 'order-row--new' : '', order.is_delayed ? 'order-row--delayed' : ''].filter(Boolean).join(' ')
          return <article className={classes} key={order.id}>
            <div className="order-code"><small>{dateTime.format(new Date(order.created_at))}</small><strong>{order.tracking_code}</strong><span className={`status status--${order.order_status}`}>{labels[order.order_status]}</span>{order.order_status === 'received' && <span className="new-badge">Novo</span>}{pendingReview && <span className="review-badge">Analisar endereço</span>}{order.is_delayed && <span className="delay-badge"><AlertTriangle size={12} />Atrasado</span>}</div>
            <div><small>Cliente</small><strong>{order.customer_name}</strong><span>{order.customer_phone}</span></div>
            <div><small>Modalidade</small><strong>{labels[order.fulfillment_type]}</strong><span>{order.neighborhood ? `${order.neighborhood} · ${order.city}` : labels[order.payment_method]}</span>{order.estimated_minutes && <span>Previsão: {order.estimated_minutes} min</span>}</div>
            <div><small>Total</small><strong>{currency.format(Number(order.total))}</strong><span className={`payment payment--${order.payment_status}`}>{pendingReview ? 'Provisório' : labels[order.payment_status]}</span></div>
            <div className="order-actions"><button className="detail-action" disabled={detailLoading} onClick={() => void openDetails(order.id)}>Ver detalhes</button>{['received', 'confirmed'].includes(order.order_status) && <button className="edit-order-action" disabled={detailLoading} onClick={() => void openOrderEdit(order.id)}><Pencil size={14} />Editar</button>}<button className="print-action" onClick={() => void printOrder(order.id)}><Printer size={14} />2 comandas</button>{pendingReview ? <><button className="secondary-action" disabled={busy} onClick={() => void reviewDelivery(order, 'approved')}>Aceitar entrega</button><button className="danger-action" disabled={busy} onClick={() => void reviewDelivery(order, 'rejected')}>Recusar entrega</button></> : order.order_status === 'received' ? <><button className="primary-action" disabled={busy} onClick={() => void changeStatus(order)}>{busy ? <LoaderCircle className="spin" size={16} /> : null}Aceitar pedido</button><button className="danger-action" disabled={busy} onClick={() => void rejectOrder(order)}>Rejeitar</button></> : <>{order.payment_status === 'pending' && <button className="secondary-action" disabled={busy} onClick={() => void markPaid(order)}>Confirmar pagamento</button>}{next && <button className="primary-action" disabled={busy} onClick={() => void changeStatus(order)}>{busy ? <LoaderCircle className="spin" size={16} /> : null}{labels[next]}</button>}<button className="danger-action" disabled={busy} onClick={() => void rejectOrder(order)}>Cancelar</button></>}</div>
          </article>
        })}</div>}
      </section>
      {storeProfile && storeOperation && <section id="configuracoes" className="admin-config-section"><div className="section-line"><div><small>Dados e operação</small><h2>Configurações da pizzaria</h2></div></div><form className="store-settings-form" onSubmit={saveSettings}>
        <div className="settings-card"><h3>Funcionamento</h3><label>Situação da loja<select name="storeStatus" defaultValue={storeOperation.status}><option value="automatic">Automático pelo horário</option><option value="open">Aberta manualmente</option><option value="closed">Fechada</option><option value="paused">Pausada temporariamente</option></select></label><div className="settings-grid"><label>Abre às<input name="opensAt" type="time" defaultValue={storeOperation.opensAt} required /></label><label>Fecha às<input name="closesAt" type="time" defaultValue={storeOperation.closesAt} required /></label><label>Tempo mínimo<input name="etaMin" type="number" min="5" defaultValue={storeOperation.etaMin} required /></label><label>Tempo máximo<input name="etaMax" type="number" min="5" defaultValue={storeOperation.etaMax} required /></label><label>Raio padrão (km)<input name="deliveryRadiusKm" type="number" min="0.1" step="0.1" defaultValue={storeOperation.deliveryRadiusKm} required /></label></div><p>Use “Fechada” para encerrar antes das 22:30 e “Pausada” para interromper pedidos por um período.</p></div>
        <div className="settings-card"><h3>Identificação e retirada</h3><div className="settings-grid"><label>Nome<input name="storeName" defaultValue={storeProfile.name} required /></label><label>Telefone<input name="storePhone" defaultValue={storeProfile.phone} /></label><label className="wide">Rua<input name="storeStreet" defaultValue={storeProfile.address.street} /></label><label>Número<input name="storeNumber" defaultValue={storeProfile.address.number} /></label><label>Bairro<input name="storeNeighborhood" defaultValue={storeProfile.address.neighborhood} /></label><label>Cidade<input name="storeCity" defaultValue={storeProfile.address.city} /></label><label>Estado<input name="storeState" defaultValue={storeProfile.address.state} maxLength={2} /></label><label>CEP<input name="storePostalCode" defaultValue={storeProfile.address.postalCode} /></label></div><p>Este endereço aparece para clientes que escolhem retirada.</p></div>
        <div className="settings-card schedule-card"><h3>Horários por dia da semana</h3><p>Desative o dia em que a loja não abre e use horários diferentes nos finais de semana.</p><div className="weekly-schedule">{weekDays.map(([key, label]) => { const schedule = storeOperation.weeklyHours[key]; return <div key={key}><label className="day-toggle"><input type="checkbox" name={`${key}Enabled`} defaultChecked={schedule.enabled} /><strong>{label}</strong></label><label>Abre<input type="time" name={`${key}OpensAt`} defaultValue={schedule.opensAt} required /></label><label>Fecha<input type="time" name={`${key}ClosesAt`} defaultValue={schedule.closesAt} required /></label></div> })}</div></div>
        <div className="settings-card schedule-card"><h3>Feriados e datas especiais</h3><p>Uma data especial substitui o horário semanal e também permite programar um fechamento antecipado.</p><div className="special-date-list">{storeOperation.specialDates.map((item) => <div key={item.date}><span><strong>{new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')}</strong><small>{item.label} · {item.closed ? 'Fechado' : `${item.opensAt}–${item.closesAt}`}</small></span><button type="button" onClick={() => setStoreOperation({ ...storeOperation, specialDates: storeOperation.specialDates.filter((date) => date.date !== item.date) })}>Remover</button></div>)}</div><div className="special-date-form"><input name="date" type="date" /><input name="label" placeholder="Ex.: Véspera de feriado" /><label><input name="closed" type="checkbox" />Fechado</label><input name="opensAt" type="time" defaultValue="18:00" /><input name="closesAt" type="time" defaultValue="21:00" /><button type="button" onClick={(event) => addSpecialDate(event.currentTarget.parentElement as HTMLDivElement)}>Adicionar data</button></div></div>
        <button className="save-settings" disabled={settingsSaving}>{settingsSaving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}Salvar configurações</button>
      </form></section>}
      <section id="entregas" className="admin-delivery-section"><div className="section-line"><div><small>Taxas e cobertura</small><h2>Bairros atendidos</h2></div></div><div className="delivery-admin-grid"><form className="zone-form" onSubmit={createZone}><h3>Novo bairro</h3><label>Bairro<input name="neighborhood" required minLength={2} /></label><label>Cidade<input name="city" required defaultValue={storeProfile?.address.city || 'Maceió'} /></label><label>Taxa de entrega<input name="fee" type="number" min="0" step="0.01" required /></label><button disabled={settingsSaving}><Plus size={16} />Cadastrar bairro</button><p>Endereços que não coincidirem com um bairro ativo entram automaticamente em análise manual.</p></form><div className="zone-list">{deliveryZones.map((zone) => <article key={zone.id} className={zone.active ? '' : 'is-paused'}><span><strong>{zone.neighborhood}</strong><small>{zone.city}</small></span><b>{currency.format(Number(zone.fee))}</b><div><button onClick={() => void editZoneFee(zone)}>Editar taxa</button><button onClick={() => void toggleZone(zone)}>{zone.active ? 'Pausar' : 'Ativar'}</button></div></article>)}</div></div></section>
      <section id="atendimento" className="admin-chat-section"><div className="section-line"><div><small>Dúvidas, elogios e reclamações</small><h2>Atendimento ao cliente</h2></div><span className={`chat-count ${chatLive ? 'is-online' : ''}`}><i />{chatLive ? 'Tempo real' : 'Reconectando'} · {chats.filter((chat) => chat.status === 'open').length} abertos</span></div><div className="admin-chat-layout"><div className="admin-chat-list">{chats.length === 0 ? <div className="admin-empty"><MessageCircle size={28} /><strong>Nenhuma conversa</strong></div> : chats.map((chat) => <button key={chat.id} className={[selectedChat?.conversation.id === chat.id ? 'is-active' : '', chat.unread ? 'has-unread' : ''].filter(Boolean).join(' ')} onClick={() => void openChat(chat.id)}>{chat.unread && <i className="admin-unread-dot" title="Nova mensagem" />}<span><strong>{chat.customer_name}</strong><small>{chat.subject}</small><p>{chat.last_message}</p></span><b>{chat.status === 'open' ? 'Aberto' : 'Encerrado'}</b></button>)}</div>{selectedChat ? <div className="admin-chat-thread"><header><div><strong>{selectedChat.conversation.subject}</strong><small>{selectedChat.conversation.customer_name} · {selectedChat.conversation.customer_email}</small></div><button onClick={() => void toggleChatStatus()}>{selectedChat.conversation.status === 'open' ? 'Encerrar' : 'Reabrir'}</button></header><div className="admin-chat-messages">{selectedChat.messages.map((message) => <div key={message.id} className={`chat-message chat-message--${message.sender_role}`}><small>{message.sender_role === 'admin' ? 'Equipe' : selectedChat.conversation.customer_name}</small><p>{message.message}</p><time>{dateTime.format(new Date(message.created_at))}</time></div>)}</div><form onSubmit={sendChatReply}><textarea name="message" required maxLength={2000} placeholder="Responder cliente · Enter envia" onKeyDown={(event) => submitMessageOnEnter(event, settingsSaving)} /><button disabled={settingsSaving}><Send size={17} /></button></form></div> : <div className="chat-placeholder"><MessageCircle size={32} /><p>Selecione uma conversa para responder.</p></div>}</div></section>
      <section id="cardapio" className="menu-admin-section"><div className="section-line"><div><small>Produtos e categorias</small><h2>Gerenciar cardápio</h2></div><button className="new-product" onClick={() => { setEditingProduct(null); setProductFormOpen(true) }}><Plus size={17} />Novo produto</button></div>
        <div className="category-manager"><div><h3>Categorias</h3><p>Pausar uma categoria também a remove da loja.</p></div><div className="category-chips">{menuCategories.map((category) => <button key={category.id} className={category.active ? 'category-chip' : 'category-chip is-paused'} onClick={() => void toggleCategory(category)} disabled={menuSaving}>{category.name}<span>{category.active ? 'Ativa' : 'Pausada'}</span></button>)}</div><form onSubmit={createCategory}><input name="name" placeholder="Nova categoria" required minLength={2} /><button disabled={menuSaving}><Plus size={15} />Adicionar</button></form></div>
        <section id="estoque" className="inventory-manager"><div className="inventory-heading"><div><h3>Controle de estoque</h3><p>Itens com 5 unidades ou menos aparecem em alerta. Estoque vazio fica indisponível para o cliente.</p></div><b>{inventory.lowStockCount} alertas</b></div><div className="inventory-grid"><div className="inventory-items">{inventory.items.filter((item) => item.stock_quantity !== null).length === 0 ? <p>Nenhum item usa estoque limitado.</p> : inventory.items.filter((item) => item.stock_quantity !== null).map((item) => <article key={`${item.item_type}-${item.id}`} className={item.is_low ? 'is-low' : ''}><span><strong>{item.name}</strong><small>{({ product: 'Produto', size: 'Tamanho', crust: 'Borda', addon: 'Adicional' } as const)[item.item_type]}</small></span><b>{item.stock_quantity} un.</b><button disabled={menuSaving} onClick={() => void restockItem(item)}><Plus size={14} />Repor</button></article>)}</div><div className="inventory-history"><h4>Últimas movimentações</h4>{inventory.movements.length === 0 ? <p>As entradas e saídas aparecerão aqui.</p> : inventory.movements.slice(0, 20).map((movement) => <div key={movement.id}><span><strong>{movement.item_name}</strong><small>{movement.reason} · {dateTime.format(new Date(movement.created_at))}</small></span><b className={movement.quantity_delta > 0 ? 'is-entry' : 'is-exit'}>{movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta}</b></div>)}</div></div></section>
        <div className="product-table"><div className="product-table-head"><span>Produto</span><span>Categoria</span><span>Preço</span><span>Disponibilidade</span><span>Ações</span></div>{menuProducts.map((product) => <article key={product.id} className={product.active ? '' : 'is-paused'}><div><strong>{product.name}</strong><small>{product.description}</small></div><span>{product.category_name}</span><b>{currency.format(Number(product.base_price))}</b><span className={product.active ? 'availability is-active' : 'availability'}>{product.active ? 'Disponível' : 'Pausado'}</span><div className="product-actions"><button title="Editar" onClick={() => { setEditingProduct(product); setProductFormOpen(true) }}><Pencil size={15} /></button><button title={product.active ? 'Pausar' : 'Ativar'} onClick={() => void toggleProduct(product)} disabled={menuSaving}><Power size={15} /></button></div></article>)}</div>
        <div className="availability-manager"><section><h3>Adicionais, bordas e tamanhos</h3><p>Pause uma opção ou defina uma quantidade limitada.</p><div className="availability-list">{adminOptions.map((option) => <article key={`${option.type}-${option.id}`} className={option.active ? '' : 'is-paused'}><span><strong>{option.name}</strong><small>{({ size: 'Tamanho', crust: 'Borda', addon: 'Adicional' } as const)[option.type]}</small></span><b>{option.stock_quantity === null ? 'Ilimitado' : `${option.stock_quantity} un.`}</b><button onClick={() => void updateOptionAvailability(option, 'stock')}>Estoque</button><button onClick={() => void updateOptionAvailability(option, 'active')}>{option.active ? 'Pausar' : 'Ativar'}</button></article>)}</div></section><section><h3>Ingredientes</h3><p>Quando um ingrediente é marcado como esgotado, os produtos vinculados somem da loja.</p><form className="ingredient-form" onSubmit={createIngredient}><input name="name" placeholder="Nome do ingrediente" required /><select name="productIds" multiple size={5}>{menuProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><button><Plus size={15} />Cadastrar e vincular</button></form><div className="ingredient-list">{ingredients.map((ingredient) => <button key={ingredient.id} className={ingredient.active ? '' : 'is-paused'} onClick={() => void toggleIngredient(ingredient)}><span><strong>{ingredient.name}</strong><small>{ingredient.product_ids.length} produtos vinculados</small></span><b>{ingredient.active ? 'Disponível' : 'Esgotado'}</b></button>)}</div></section></div>
      </section>
    </main>
    {assistedOrderOpen && <div className="detail-layer"><button className="detail-backdrop" onClick={() => setAssistedOrderOpen(false)} /><form className="order-editor-modal" onSubmit={createAssistedOrder}><header><div><small>WhatsApp ou telefone</small><h2>Novo pedido pelo atendimento</h2></div><button type="button" onClick={() => setAssistedOrderOpen(false)}><X size={20} /></button></header><div className="order-editor-content"><div className="editor-grid"><label>Nome do cliente<input name="customerName" required /></label><label>Telefone<input name="phone" required minLength={10} /></label><label>E-mail opcional<input name="email" type="email" /></label><label>Recebimento<select name="fulfillmentType" value={assistedFulfillment} onChange={(event) => setAssistedFulfillment(event.target.value as 'delivery' | 'pickup')}><option value="delivery">Entrega</option><option value="pickup">Retirada</option></select></label><label>Pagamento<select name="paymentMethod"><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="credit_card">Crédito</option><option value="debit_card">Débito</option></select></label></div>{assistedFulfillment === 'delivery' && <div className="editor-grid address-editor"><label className="wide">Rua<input name="street" required /></label><label>Número<input name="number" required /></label><label>Complemento<input name="complement" /></label><label>Bairro<input name="neighborhood" required /></label><label>Cidade<input name="city" defaultValue="Maceió" required /></label><label>Estado<input name="state" defaultValue="AL" maxLength={2} required /></label><label>CEP<input name="postalCode" required /></label><label>Referência<input name="reference" /></label></div>}<section className="editor-items"><h3>Itens</h3><select defaultValue="" onChange={(event) => { if (event.target.value) addSimpleLine(setAssistedLines, event.target.value); event.target.value = '' }}><option value="">Adicionar produto...</option>{menuProducts.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name} · {currency.format(Number(product.base_price))}</option>)}</select>{assistedLines.map((line, index) => <div key={`${line.productId}-${index}`}><strong>{line.name}</strong><input type="number" min="1" max="20" value={line.quantity} onChange={(event) => setAssistedLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} /><button type="button" onClick={() => setAssistedLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button></div>)}</section><label className="editor-notes">Observações<textarea name="notes" rows={3} /></label></div><footer><button type="button" onClick={() => setAssistedOrderOpen(false)}>Cancelar</button><button className="save-product" disabled={menuSaving}>Criar pedido</button></footer></form></div>}
    {editingOrder && <div className="detail-layer"><button className="detail-backdrop" onClick={() => setEditingOrder(null)} /><form className="order-editor-modal" onSubmit={saveOrderEdit}><header><div><small>Alteração registrada no histórico</small><h2>Editar {editingOrder.tracking_code}</h2></div><button type="button" onClick={() => setEditingOrder(null)}><X size={20} /></button></header><div className="order-editor-content"><div className="editor-grid"><label>Nome do cliente<input name="customerName" defaultValue={editingOrder.customer_name} required /></label><label>Telefone<input name="phone" defaultValue={editingOrder.customer_phone} required minLength={10} /></label></div>{editingOrder.fulfillment_type === 'delivery' && <div className="editor-grid address-editor"><label className="wide">Rua<input name="street" defaultValue={editingOrder.street ?? ''} required /></label><label>Número<input name="number" defaultValue={editingOrder.number ?? ''} required /></label><label>Complemento<input name="complement" defaultValue={editingOrder.complement ?? ''} /></label><label>Bairro<input name="neighborhood" defaultValue={editingOrder.neighborhood ?? ''} required /></label><label>Cidade<input name="city" defaultValue={editingOrder.city ?? 'Maceió'} required /></label><label>Estado<input name="state" defaultValue={editingOrder.state ?? 'AL'} maxLength={2} required /></label><label>CEP<input name="postalCode" defaultValue={editingOrder.postal_code ?? ''} required /></label><label>Referência<input name="reference" defaultValue={editingOrder.reference ?? ''} /></label></div>}<section className="editor-items"><div className="editor-items-heading"><h3>Itens do pedido</h3><select defaultValue="" onChange={(event) => { if (event.target.value) addSimpleLine(setEditLines, event.target.value); event.target.value = '' }}><option value="">Adicionar produto...</option>{menuProducts.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name} · {currency.format(Number(product.base_price))}</option>)}</select></div>{editLines.map((line, index) => <div key={line.existingItemId ?? `${line.productId}-${index}`}><span><strong>{line.name}</strong>{line.existingItemId && <small>Personalizações originais mantidas</small>}</span><input aria-label={`Quantidade de ${line.name}`} type="number" min="1" max="20" value={line.quantity} onChange={(event) => setEditLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} /><button type="button" onClick={() => setEditLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button></div>)}</section><label className="editor-notes">Observações gerais<textarea name="notes" rows={3} defaultValue={editingOrder.notes ?? ''} /></label><p className="editor-warning">O total e a taxa de entrega serão recalculados pelo servidor. A alteração ficará registrada no histórico do pedido.</p></div><footer><button type="button" onClick={() => setEditingOrder(null)}>Cancelar</button><button className="save-product" disabled={menuSaving}>{menuSaving ? <LoaderCircle className="spin" size={16} /> : null}Salvar e recalcular</button></footer></form></div>}
    {selectedOrder && <div className="detail-layer"><button className="detail-backdrop" onClick={() => setSelectedOrder(null)} aria-label="Fechar detalhes" /><aside className="order-detail"><header><div><small>Pedido completo</small><h2>{selectedOrder.tracking_code}</h2></div><button onClick={() => setSelectedOrder(null)}><X size={20} /></button></header><div className="detail-content"><section><h3>Cliente</h3><p><strong>{selectedOrder.customer_name}</strong><br />{selectedOrder.customer_phone}{selectedOrder.customer_email ? <><br />{selectedOrder.customer_email}</> : null}</p></section><section><h3>Itens do pedido</h3>{selectedOrder.items.map((item) => <div className="detail-item" key={item.id}><span>{item.quantity}×</span><div><strong>{item.product_name}</strong>{customizationSummary(item) && <small>{customizationSummary(item)}</small>}{item.notes && <small>{item.notes}</small>}</div><b>{currency.format(Number(item.unit_price) * item.quantity)}</b></div>)}</section><section className="detail-totals"><div><span>Subtotal</span><strong>{currency.format(Number(selectedOrder.subtotal))}</strong></div><div><span>Entrega</span><strong>{currency.format(Number(selectedOrder.delivery_fee))}</strong></div><div><span>Total</span><strong>{currency.format(Number(selectedOrder.total))}</strong></div></section>{selectedOrder.fulfillment_type === 'delivery' && <section><h3>Endereço de entrega</h3><div className="detail-address"><MapPin size={18} /><p>{selectedOrder.street}, {selectedOrder.number}{selectedOrder.complement ? ` — ${selectedOrder.complement}` : ''}<br />{selectedOrder.neighborhood} · {selectedOrder.city}/{selectedOrder.state}<br />CEP {selectedOrder.postal_code}{selectedOrder.reference ? <><br /><small>Referência: {selectedOrder.reference}</small></> : null}</p></div></section>}{selectedOrder.notes && <section><h3>Observações gerais</h3><p>{selectedOrder.notes}</p></section>}<section><h3>Histórico</h3>{selectedOrder.status_history.map((history) => <div className="detail-history" key={`${history.status}-${history.created_at}`}><span /><p><strong>{labels[history.status] ?? history.status}</strong>{history.note && <small>{history.note}</small>}</p><time>{dateTime.format(new Date(history.created_at))}</time></div>)}</section></div></aside></div>}
    {productFormOpen && <div className="detail-layer"><button className="detail-backdrop" onClick={() => setProductFormOpen(false)} aria-label="Fechar formulário" /><form className="product-form-modal" key={editingProduct?.id ?? 'new'} onSubmit={saveProduct}><header><div><small>Cardápio</small><h2>{editingProduct ? 'Editar produto' : 'Novo produto'}</h2></div><button type="button" onClick={() => setProductFormOpen(false)}><X size={20} /></button></header><div className="product-form-content"><label>Nome<input name="name" defaultValue={editingProduct?.name} required minLength={2} /></label><label>Categoria<select name="categoryId" defaultValue={editingProduct?.category_id} required><option value="" disabled>Selecione</option>{menuCategories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (pausada)'}</option>)}</select></label><label>Preço<input name="basePrice" type="number" min="0.01" max="9999.99" step="0.01" defaultValue={editingProduct ? Number(editingProduct.base_price) : ''} required /></label><label>Estoque limitado<input name="stockQuantity" type="number" min="0" step="1" defaultValue={editingProduct?.stock_quantity ?? ''} placeholder="Vazio = ilimitado" /></label><label className="wide-field">Descrição<textarea name="description" rows={4} defaultValue={editingProduct?.description} maxLength={500} /></label></div><footer><button type="button" onClick={() => setProductFormOpen(false)}>Cancelar</button><button className="save-product" disabled={menuSaving}>{menuSaving ? <LoaderCircle className="spin" size={16} /> : null}Salvar produto</button></footer></form></div>}
  </div>
}
