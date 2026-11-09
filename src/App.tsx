import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, Check, ChevronRight, Clock3, Heart, LoaderCircle, LogOut, MapPin, Minus,
  MessageCircle, Plus, RotateCcw, Search, Send, ShoppingBag, Star, Trash2, UserRound, X,
} from 'lucide-react'
import {
  api, type ApiCategory, type ApiProduct, type AuthUser, type CartLine, type CreatedOrder,
  type ChatConversation, type ChatThread, type DeliveryQuote, type FavoriteProduct, type OrderDetails,
  type PizzaCustomizations, type StoreInfo, type UserOrder, type UserSavedAddress,
} from './api'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const cartStorageKey = 'brasa-massa-cart-v1'

function submitMessageOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, busy: boolean) {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  if (!busy && event.currentTarget.value.trim()) event.currentTarget.form?.requestSubmit()
}

function savedCart() {
  try {
    const value = JSON.parse(localStorage.getItem(cartStorageKey) ?? '[]')
    return Array.isArray(value) ? value.filter((item) => item?.cartKey && item?.id && item.quantity > 0).slice(0, 30) as CartLine[] : []
  } catch { return [] }
}
const artwork: Record<string, string> = {
  'pizza-margherita': 'margherita', 'pizza-calabresa': 'calabresa',
  'pizza-frango': 'queijos', 'pizza-portuguesa': 'combo',
  'bebida-refrigerante': 'bebida', 'sobremesa-brownie': 'doce',
}

function PizzaArtwork({ variant }: { variant: string }) {
  return (
    <div className={`pizza-art pizza-art--${variant}`} aria-hidden="true">
      <div className="pizza-art__shadow" /><div className="pizza-art__board">
        <div className="pizza-art__crust"><div className="pizza-art__cheese">
          <i className="topping topping--one" /><i className="topping topping--two" />
          <i className="topping topping--three" /><i className="topping topping--four" />
          <i className="leaf leaf--one" /><i className="leaf leaf--two" />
        </div></div>
      </div>
    </div>
  )
}

function PizzaCustomizer({ product, products, options, onClose, onAdd }: {
  product: ApiProduct
  products: ApiProduct[]
  options: PizzaCustomizations
  onClose: () => void
  onAdd: (line: CartLine) => void
}) {
  const [secondFlavorId, setSecondFlavorId] = useState('')
  const [sizeId, setSizeId] = useState(options.sizes[0]?.id ?? '')
  const [crustId, setCrustId] = useState(options.crusts[0]?.id ?? '')
  const [addonIds, setAddonIds] = useState<string[]>([])
  const flavors = products.filter((item) => item.category_slug === product.category_slug && item.id !== product.id)
  const secondFlavor = products.find((item) => item.id === secondFlavorId)
  const size = options.sizes.find((item) => item.id === sizeId)
  const crust = options.crusts.find((item) => item.id === crustId)
  const addons = options.addons.filter((item) => addonIds.includes(item.id))
  const unitPrice = Math.max(Number(product.base_price), Number(secondFlavor?.base_price ?? 0))
    + Number(size?.price_delta ?? 0) + Number(crust?.price_delta ?? 0)
    + addons.reduce((total, item) => total + Number(item.price_delta), 0)

  function toggleAddon(id: string) {
    setAddonIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 5))
  }

  function confirm() {
    const customization = {
      secondFlavorId: secondFlavorId || undefined,
      sizeId: sizeId || undefined,
      crustId: crustId || undefined,
      addonIds,
    }
    const displayName = secondFlavor ? `${product.name} / ${secondFlavor.name}` : product.name
    const labels = [size?.name, crust?.id !== 'crust-none' ? crust?.name : undefined, ...addons.map((item) => item.name)].filter(Boolean)
    const cartKey = `${product.id}:${secondFlavorId}:${sizeId}:${crustId}:${[...addonIds].sort().join(',')}`
    onAdd({ ...product, cartKey, quantity: 1, unitPrice, displayName, customizationLabel: labels.join(' · '), customization })
  }

  return (
    <div className="modal-layer">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Fechar personalização" />
      <section className="pizza-customizer" role="dialog" aria-modal="true" aria-labelledby="customizer-title">
        <header><div><span>Monte do seu jeito</span><h2 id="customizer-title">{product.name}</h2></div><button onClick={onClose} aria-label="Fechar"><X size={20} /></button></header>
        <div className="customizer-content">
          <section><h3>Segundo sabor <small>opcional, da mesma categoria</small></h3><select value={secondFlavorId} onChange={(event) => setSecondFlavorId(event.target.value)}><option value="">Pizza inteira de {product.name}</option>{flavors.map((flavor) => <option key={flavor.id} value={flavor.id}>Metade {flavor.name} · {currency.format(Number(flavor.base_price))}</option>)}</select></section>
          <section><h3>Tamanho</h3><div className="option-grid">{options.sizes.map((item) => <label key={item.id} className={sizeId === item.id ? 'custom-option is-active' : 'custom-option'}><input type="radio" name="size" checked={sizeId === item.id} onChange={() => setSizeId(item.id)} /><strong>{item.name}</strong><small>{item.slices} fatias · {Number(item.price_delta) ? `+ ${currency.format(Number(item.price_delta))}` : 'sem acréscimo'}</small></label>)}</div></section>
          <section><h3>Borda</h3><div className="option-grid">{options.crusts.map((item) => <label key={item.id} className={crustId === item.id ? 'custom-option is-active' : 'custom-option'}><input type="radio" name="crust" checked={crustId === item.id} onChange={() => setCrustId(item.id)} /><strong>{item.name}</strong><small>{Number(item.price_delta) ? `+ ${currency.format(Number(item.price_delta))}` : 'sem acréscimo'}</small></label>)}</div></section>
          <section><h3>Adicionais <small>até 5</small></h3><div className="option-grid">{options.addons.map((item) => <label key={item.id} className={addonIds.includes(item.id) ? 'custom-option is-active' : 'custom-option'}><input type="checkbox" checked={addonIds.includes(item.id)} disabled={!addonIds.includes(item.id) && addonIds.length >= 5} onChange={() => toggleAddon(item.id)} /><strong>{item.name}</strong><small>+ {currency.format(Number(item.price_delta))}</small></label>)}</div></section>
        </div>
        <footer><div><span>Preço desta pizza</span><strong>{currency.format(unitPrice)}</strong><small>O servidor confirma o valor ao criar o pedido.</small></div><button onClick={confirm} disabled={!sizeId || !crustId}>Adicionar à sacola <Plus size={18} /></button></footer>
      </section>
    </div>
  )
}

function AccountModal({ user, onUserChange, onClose, onRepeatOrder, onFavoriteToCart, initialError = '', initialMessage = '' }: {
  user: AuthUser | null
  onUserChange: (user: AuthUser | null) => void
  onClose: () => void
  onRepeatOrder: (orderId: string) => Promise<void>
  onFavoriteToCart: (product: ApiProduct) => void
  initialError?: string
  initialMessage?: string
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [orders, setOrders] = useState<UserOrder[]>([])
  const [addresses, setAddresses] = useState<UserSavedAddress[]>([])
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([])
  const [addressFormOpen, setAddressFormOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(initialError)
  const [message, setMessage] = useState(initialMessage)
  const [pendingVerification, setPendingVerification] = useState<{ email: string; developmentVerificationUrl?: string } | null>(null)

  useEffect(() => {
    if (user) Promise.all([api.myOrders(), api.myAddresses(), api.favorites()])
      .then(([orderData, addressData, favoriteData]) => { setOrders(orderData.orders); setAddresses(addressData.addresses); setFavorites(favoriteData.products) })
      .catch(() => { setOrders([]); setAddresses([]); setFavorites([]) })
  }, [user])

  async function reloadAccountData() {
    const [orderData, addressData, favoriteData] = await Promise.all([api.myOrders(), api.myAddresses(), api.favorites()])
    setOrders(orderData.orders); setAddresses(addressData.addresses); setFavorites(favoriteData.products)
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSending(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      if (mode === 'login') {
        const result = await api.login({ email: data.get('email'), password: data.get('password') })
        onUserChange(result.user)
      } else {
        const result = await api.register({
          role: 'customer', name: data.get('name'), phone: data.get('phone'),
          email: data.get('email'), password: data.get('password'),
          returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        })
        setPendingVerification({ email: result.email, developmentVerificationUrl: result.developmentVerificationUrl })
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível autenticar.') }
    finally { setSending(false) }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSending(true); setError(''); setMessage('')
    const data = new FormData(event.currentTarget)
    try {
      const result = await api.updateProfile({ name: data.get('name'), phone: data.get('phone') })
      onUserChange(result.user); setMessage('Dados atualizados com segurança.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível atualizar.') }
    finally { setSending(false) }
  }

  async function logout() {
    setSending(true); setError('')
    try { await api.logout(); onUserChange(null); setOrders([]) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível sair.') }
    finally { setSending(false) }
  }

  async function addAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setSending(true); setError('')
    try {
      await api.createAddress({
        label: data.get('label'), street: data.get('street'), number: data.get('number'), complement: data.get('complement') || undefined,
        neighborhood: data.get('neighborhood'), city: data.get('city'), state: data.get('state'), postalCode: data.get('postalCode'),
        reference: data.get('reference') || undefined, isDefault: data.get('isDefault') === 'on',
      })
      form.reset(); setAddressFormOpen(false); await reloadAccountData(); setMessage('Endereço salvo.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível salvar o endereço.') }
    finally { setSending(false) }
  }

  async function removeAddress(id: string) {
    if (!window.confirm('Remover este endereço salvo?')) return
    setSending(true); setError('')
    try { await api.deleteAddress(id); await reloadAccountData() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível remover o endereço.') }
    finally { setSending(false) }
  }

  async function removeFavorite(productId: string) {
    setSending(true); setError('')
    try { await api.removeFavorite(productId); await reloadAccountData() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível remover o favorito.') }
    finally { setSending(false) }
  }

  async function removeSavedNote(note: string) {
    if (!user) return
    setSending(true); setError('')
    try {
      const result = await api.updateProfile({ preferences: { savedOrderNotes: (user.preferences.savedOrderNotes ?? []).filter((item) => item !== note) } })
      onUserChange(result.user); setMessage('Observação removida.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível remover a observação.') }
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

  async function enterDemoCustomer() {
    setSending(true); setError('')
    try {
      const result = await api.login({ email: 'cliente@pizzaria.local', password: 'PizzaCliente123' })
      onUserChange(result.user)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível entrar na conta de teste.') }
    finally { setSending(false) }
  }

  return <div className="modal-layer"><button className="drawer-backdrop" onClick={onClose} aria-label="Fechar conta" /><section className="account-modal"><header><div><span>{user ? 'Minha conta' : 'Área do cliente'}</span><h2>{user ? `Olá, ${user.name.split(' ')[0]}` : mode === 'login' ? 'Entrar' : 'Criar conta'}</h2></div><button onClick={onClose} aria-label="Fechar"><X size={20} /></button></header>
    {user ? <div className="account-content"><form className="account-profile" onSubmit={saveProfile}><h3>Seus dados</h3><div className="form-grid"><label className="field field--wide">Nome<input name="name" defaultValue={user.name} required minLength={2} /></label><label className="field">Telefone<input name="phone" defaultValue={user.phone ?? ''} required minLength={10} /></label><label className="field">E-mail<input value={user.email} disabled /></label></div><button disabled={sending}>Salvar meus dados</button></form>
      <section className="saved-preferences"><h3>Preferências salvas</h3><div><span>Recebimento</span><strong>{user.preferences.fulfillmentType === 'pickup' ? 'Retirada' : user.preferences.fulfillmentType === 'delivery' ? 'Entrega' : 'Ainda não definido'}</strong><span>Pagamento</span><strong>{user.preferences.paymentMethod ? { pix: 'Pix', cash: 'Dinheiro', credit_card: 'Crédito', debit_card: 'Débito' }[user.preferences.paymentMethod] : 'Ainda não definido'}</strong></div><p>Essas opções são atualizadas automaticamente quando você faz um pedido.</p></section>
      <section className="account-addresses"><div className="account-section-title"><h3>Meus endereços</h3><button onClick={() => setAddressFormOpen((value) => !value)}><Plus size={14} />Adicionar</button></div>{addresses.length === 0 ? <p>Nenhum endereço salvo.</p> : addresses.map((address) => <article key={address.id}><span><strong>{address.label}{address.is_default ? ' · Principal' : ''}</strong><small>{address.street}, {address.number} · {address.neighborhood}, {address.city}/{address.state}</small></span><button aria-label={`Remover ${address.label}`} onClick={() => void removeAddress(address.id)}><Trash2 size={15} /></button></article>)}{addressFormOpen && <form className="saved-address-form" onSubmit={addAddress}><input name="label" placeholder="Nome: Casa, Trabalho..." required /><input name="postalCode" placeholder="CEP" required /><input name="street" placeholder="Rua" required /><input name="number" placeholder="Número" required /><input name="complement" placeholder="Complemento" /><input name="neighborhood" placeholder="Bairro" required /><input name="city" placeholder="Cidade" defaultValue="Maceió" required /><input name="state" placeholder="UF" defaultValue="AL" maxLength={2} required /><input name="reference" placeholder="Referência" /><label><input type="checkbox" name="isDefault" />Usar como principal</label><button disabled={sending}>Salvar endereço</button></form>}</section>
      <section className="account-favorites"><h3>Meus favoritos</h3>{favorites.length === 0 ? <p>Use o coração no cardápio para salvar seus preferidos.</p> : favorites.map((favorite) => <article key={favorite.id}><span><strong>{favorite.name}</strong><small>{currency.format(Number(favorite.base_price))}</small></span><button title="Adicionar à sacola" onClick={() => { onFavoriteToCart(favorite); onClose() }}><Plus size={15} /></button><button title="Remover favorito" onClick={() => void removeFavorite(favorite.id)}><Trash2 size={15} /></button></article>)}</section>
      <section className="saved-notes"><h3>Observações salvas</h3>{(user.preferences.savedOrderNotes ?? []).length === 0 ? <p>Você pode salvar uma observação durante o checkout, como “sem cebola”.</p> : user.preferences.savedOrderNotes?.map((note) => <div key={note}><span>{note}</span><button onClick={() => void removeSavedNote(note)}><Trash2 size={14} /></button></div>)}</section>
      <section className="account-orders"><h3>Histórico completo</h3>{orders.length === 0 ? <p>Seus próximos pedidos aparecerão aqui.</p> : orders.map((order) => <article key={order.id}><a href={`/acompanhar.html?code=${encodeURIComponent(order.tracking_code)}&phone=${encodeURIComponent(user.phone ?? '')}`}><span><strong>{order.tracking_code}</strong><small>{new Date(order.created_at).toLocaleDateString('pt-BR')} · {order.order_status}</small></span><b>{currency.format(Number(order.total))}</b></a><button onClick={() => void onRepeatOrder(order.id)}><RotateCcw size={14} />Repetir pedido</button></article>)}</section>
      {message && <p className="form-success">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="logout-button" onClick={() => void logout()} disabled={sending}><LogOut size={17} />Sair da conta</button></div>
      : pendingVerification ? <div className="account-content verification-pending"><span className="verification-icon"><Check size={24} /></span><h3>Confirme seu e-mail</h3><p>Enviamos um link para <strong>{pendingVerification.email}</strong>. Abra esse link para ativar sua conta.</p>{pendingVerification.developmentVerificationUrl && <a className="development-verification" href={pendingVerification.developmentVerificationUrl}>Abrir link de confirmação local</a>}{message && <p className="form-success">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="resend-button" onClick={() => void resendVerification()} disabled={sending}>{sending ? <LoaderCircle className="spin" size={16} /> : null}Reenviar confirmação</button><button className="text-button" onClick={() => { setPendingVerification(null); setMode('login'); setMessage('') }}>Voltar para o login</button></div>
        : <div className="account-content">{import.meta.env.DEV && mode === 'login' && <div className="demo-login-box"><strong>Conta temporária de cliente</strong><code>cliente@pizzaria.local</code><code>PizzaCliente123</code><button onClick={() => void enterDemoCustomer()} disabled={sending}>Entrar como cliente de teste</button></div>}<div className="auth-tabs"><button className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError('') }}>Entrar</button><button className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError('') }}>Criar conta</button></div><form className="auth-form" onSubmit={authenticate}>{mode === 'register' && <><label className="field">Nome completo<input name="name" required minLength={2} /></label><label className="field">Telefone<input name="phone" required minLength={10} placeholder="(11) 99999-9999" /></label></>}<label className="field">E-mail<input name="email" type="email" required /></label><label className="field">Senha<input name="password" type="password" required minLength={8} placeholder="Mínimo 8 caracteres, com letra e número" /></label>{message && <p className="form-success">{message}</p>}{error && <p className="form-error">{error}</p>}<button disabled={sending}>{sending ? <LoaderCircle className="spin" size={17} /> : <UserRound size={17} />}{mode === 'login' ? 'Entrar com segurança' : 'Cadastrar cliente'}</button></form><p className="auth-note">Após o cadastro, confirme seu e-mail. Sua sessão fica protegida em um cookie inacessível ao JavaScript da página.</p></div>}
  </section></div>
}

function CustomerChat({ user, onClose, onLogin, onUnreadChange }: {
  user: AuthUser | null; onClose: () => void; onLogin: () => void; onUnreadChange: (count: number) => void
}) {
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [thread, setThread] = useState<ChatThread | null>(null)
  const [newChat, setNewChat] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [chatLive, setChatLive] = useState(false)

  async function load() {
    if (!user) return
    try {
      const result = await api.myChats()
      setConversations(result.conversations)
      onUnreadChange(result.conversations.filter((conversation) => conversation.unread).length)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao carregar atendimentos.') }
  }
  useEffect(() => { void load() }, [user])
  useEffect(() => {
    if (!thread) return
    const timer = window.setInterval(() => {
      void api.chatThread(thread.conversation.id).then(async (result) => { setThread(result); await load() }).catch(() => undefined)
    }, 8000)
    return () => window.clearInterval(timer)
  }, [thread?.conversation.id])
  useEffect(() => {
    if (!user) return
    const threadId = thread?.conversation.id
    const events = new EventSource('/api/chat/events')
    const refresh = async () => {
      if (threadId) await api.chatThread(threadId).then(setThread).catch(() => undefined)
      await load()
    }
    events.addEventListener('open', () => setChatLive(true))
    events.addEventListener('chat', refresh)
    events.onerror = () => setChatLive(false)
    return () => { events.removeEventListener('chat', refresh); events.close() }
  }, [user?.id, thread?.conversation.id])

  async function openConversation(id: string) {
    try { setThread(await api.chatThread(id)); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao abrir atendimento.') }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSending(true); setError('')
    const data = new FormData(event.currentTarget)
    try {
      const created = await api.createChat({ category: data.get('category'), subject: data.get('subject'), message: data.get('message') })
      setThread(await api.chatThread(created.id)); setNewChat(false); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao iniciar atendimento.') }
    finally { setSending(false) }
  }

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!thread) return
    const form = event.currentTarget; const data = new FormData(form); setSending(true); setError('')
    try { await api.sendChatMessage(thread.conversation.id, String(data.get('message'))); form.reset(); setThread(await api.chatThread(thread.conversation.id)); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Erro ao enviar mensagem.') }
    finally { setSending(false) }
  }

  return <div className="modal-layer chat-layer"><button className="drawer-backdrop" onClick={onClose} aria-label="Fechar atendimento" /><section className="customer-chat">
    <header><div><small>Atendimento {user && <span className={chatLive ? 'live-status is-online' : 'live-status'}>{chatLive ? 'ao vivo' : 'reconectando'}</span>}</small><h2>Fale com a pizzaria</h2></div><button onClick={onClose}><X size={20} /></button></header>
    {!user ? <div className="chat-login"><MessageCircle size={35} /><h3>Entre para conversar</h3><p>Assim suas mensagens e respostas ficam salvas com segurança.</p><button onClick={onLogin}>Entrar ou criar conta</button></div>
      : thread ? <div className="chat-thread"><button className="chat-back" onClick={() => setThread(null)}>← Todos os atendimentos</button><div className="chat-title"><strong>{thread.conversation.subject}</strong><span>{thread.conversation.status === 'open' ? 'Em atendimento' : 'Encerrado'}</span></div><div className="chat-messages">{thread.messages.map((message) => <div key={message.id} className={`chat-message chat-message--${message.sender_role}`}><small>{message.sender_role === 'admin' ? 'Pizzaria' : 'Você'}</small><p>{message.message}</p><time>{new Date(message.created_at).toLocaleString('pt-BR')}</time></div>)}</div>{thread.conversation.status === 'open' && <form className="chat-reply" onSubmit={reply}><textarea name="message" required maxLength={2000} placeholder="Digite sua mensagem · Enter envia" onKeyDown={(event) => submitMessageOnEnter(event, sending)} /><button disabled={sending}><Send size={17} /></button></form>}</div>
        : newChat ? <form className="new-chat-form" onSubmit={create}><label>Assunto<select name="category" required><option value="question">Dúvida</option><option value="clarification">Esclarecimento</option><option value="complaint">Reclamação</option><option value="compliment">Elogio</option><option value="other">Outro</option></select></label><label>Título<input name="subject" required minLength={3} maxLength={120} /></label><label>Mensagem<textarea name="message" required rows={6} maxLength={2000} placeholder="Enter envia · Shift+Enter quebra a linha" onKeyDown={(event) => submitMessageOnEnter(event, sending)} /></label><div><button type="button" onClick={() => setNewChat(false)}>Cancelar</button><button disabled={sending}>Enviar</button></div></form>
          : <div className="chat-list"><button className="new-chat" onClick={() => setNewChat(true)}><Plus size={17} />Novo atendimento</button>{conversations.length === 0 ? <p className="chat-empty">Você ainda não iniciou uma conversa.</p> : conversations.map((conversation) => <button key={conversation.id} className={conversation.unread ? 'has-unread' : ''} onClick={() => void openConversation(conversation.id)}>{conversation.unread && <i className="unread-dot" title="Nova mensagem" />}<span><strong>{conversation.subject}</strong><small>{conversation.last_message}</small></span><b>{conversation.status === 'open' ? 'Aberto' : 'Encerrado'}</b></button>)}</div>}
    {error && <p className="form-error chat-error">{error}</p>}
  </section></div>
}

function Checkout({ cart, user, store, onUserChange, onClose, onSuccess }: {
  cart: CartLine[]
  user: AuthUser | null
  store: StoreInfo | null
  onUserChange: (user: AuthUser) => void
  onClose: () => void
  onSuccess: (order: CreatedOrder) => void
}) {
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>(user?.preferences.fulfillmentType ?? 'delivery')
  const [payment, setPayment] = useState(user?.preferences.paymentMethod ?? 'pix')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [cepLoading, setCepLoading] = useState(false)
  const [quote, setQuote] = useState<DeliveryQuote | null>(null)
  const [savedAddresses, setSavedAddresses] = useState<UserSavedAddress[]>([])
  const [notes, setNotes] = useState('')
  const [address, setAddress] = useState({
    street: user?.preferences.address?.street ?? '', number: user?.preferences.address?.number ?? '',
    complement: user?.preferences.address?.complement ?? '', neighborhood: user?.preferences.address?.neighborhood ?? '',
    city: user?.preferences.address?.city ?? 'Maceió', state: user?.preferences.address?.state ?? 'AL',
    postalCode: user?.preferences.address?.postalCode ?? '', reference: user?.preferences.address?.reference ?? '',
  })
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  const deliveryFee = fulfillment === 'delivery' ? (quote?.deliveryFee ?? 0) : 0

  useEffect(() => {
    if (!user) return
    api.myAddresses().then((result) => {
      setSavedAddresses(result.addresses)
      const preferred = result.addresses.find((item) => item.is_default)
      if (preferred) setAddress({ street: preferred.street, number: preferred.number, complement: preferred.complement ?? '', neighborhood: preferred.neighborhood, city: preferred.city, state: preferred.state, postalCode: preferred.postalCode, reference: preferred.reference ?? '' })
    }).catch(() => setSavedAddresses([]))
  }, [user?.id])

  function selectSavedAddress(id: string) {
    const selected = savedAddresses.find((item) => item.id === id)
    if (!selected) return
    setAddress({ street: selected.street, number: selected.number, complement: selected.complement ?? '', neighborhood: selected.neighborhood, city: selected.city, state: selected.state, postalCode: selected.postalCode, reference: selected.reference ?? '' })
    setQuote(null)
  }

  function updateAddress(field: keyof typeof address, value: string) {
    setAddress((current) => ({ ...current, [field]: value }))
    if (field === 'neighborhood' || field === 'city') setQuote(null)
  }

  async function lookupCep() {
    setCepLoading(true); setError('')
    try {
      const found = await api.lookupCep(address.postalCode)
      const next = { ...address, ...found, complement: address.complement || found.complement || '' }
      setAddress(next)
      if (found.neighborhood && found.city) setQuote(await api.deliveryQuote(found))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível consultar o CEP.') }
    finally { setCepLoading(false) }
  }

  async function ensureQuote() {
    if (fulfillment !== 'delivery') return null
    const current = await api.deliveryQuote({ neighborhood: address.neighborhood, city: address.city, postalCode: address.postalCode })
    setQuote(current); return current
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSending(true)
    setError('')
    try {
      await ensureQuote()
      const address = fulfillment === 'delivery' ? {
        street: data.get('street'), number: data.get('number'),
        complement: data.get('complement') || undefined, neighborhood: data.get('neighborhood'),
        city: data.get('city'), state: data.get('state'), postalCode: data.get('postalCode'),
        reference: data.get('reference') || undefined,
      } : undefined
      const order = await api.createOrder({
        customer: { name: data.get('name'), phone: data.get('phone'), email: data.get('email') || undefined },
        fulfillmentType: fulfillment, address, paymentMethod: payment,
        changeFor: payment === 'cash' && data.get('changeFor') ? Number(data.get('changeFor')) : undefined,
        notes: data.get('notes') || undefined, saveNote: data.get('saveNote') === 'on',
        saveAddressLabel: fulfillment === 'delivery' ? data.get('saveAddressLabel') || undefined : undefined,
        items: cart.map((item) => ({ productId: item.id, quantity: item.quantity, ...item.customization })),
      })
      if (user) api.me().then((result) => onUserChange(result.user)).catch(() => undefined)
      onSuccess(order)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar o pedido.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="modal-layer">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Fechar checkout" />
      <form className="checkout-modal" onSubmit={submit}>
        <header><div><span>Finalizar pedido</span><h2>Seus dados</h2></div><button type="button" onClick={onClose}><X size={20} /></button></header>
        <div className="checkout-content">
          <fieldset><legend>Contato</legend><div className="form-grid">
            <label className="field field--wide">Nome completo<input name="name" required minLength={2} defaultValue={user?.name} /></label>
            <label className="field">Telefone<input name="phone" required placeholder="(11) 99999-9999" minLength={10} defaultValue={user?.phone ?? ''} /></label>
            <label className="field">E-mail (opcional)<input name="email" type="email" defaultValue={user?.email} /></label>
          </div></fieldset>

          <fieldset><legend>Como você quer receber?</legend><div className="choice-grid">
            <label className={fulfillment === 'delivery' ? 'choice is-active' : 'choice'}><input type="radio" checked={fulfillment === 'delivery'} onChange={() => setFulfillment('delivery')} />Entrega</label>
            <label className={fulfillment === 'pickup' ? 'choice is-active' : 'choice'}><input type="radio" checked={fulfillment === 'pickup'} onChange={() => setFulfillment('pickup')} />Retirada</label>
          </div></fieldset>

          {fulfillment === 'pickup' && <p className="pickup-address"><MapPin size={17} /><span><strong>Retirada em {store?.profile.name ?? 'nossa pizzaria'}</strong>{store?.profile.address.street ? `${store.profile.address.street}, ${store.profile.address.number} · ${store.profile.address.neighborhood}, ${store.profile.address.city}/${store.profile.address.state}` : 'O endereço será informado pela pizzaria.'}</span></p>}

          {fulfillment === 'delivery' && <fieldset><legend>Endereço</legend>{savedAddresses.length > 0 && <label className="field saved-address-select">Usar endereço salvo<select defaultValue="" onChange={(event) => selectSavedAddress(event.target.value)}><option value="">Preencher outro endereço</option>{savedAddresses.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.street}, {item.number}</option>)}</select></label>}<div className="form-grid">
            <label className="field cep-field">CEP<span><input name="postalCode" required placeholder="00000-000" value={address.postalCode} onChange={(event) => updateAddress('postalCode', event.target.value)} /><button type="button" onClick={() => void lookupCep()} disabled={cepLoading}>{cepLoading ? <LoaderCircle className="spin" size={15} /> : 'Buscar'}</button></span></label>
            <label className="field field--wide">Rua<input name="street" required value={address.street} onChange={(event) => updateAddress('street', event.target.value)} /></label>
            <label className="field">Número<input name="number" required value={address.number} onChange={(event) => updateAddress('number', event.target.value)} /></label>
            <label className="field">Complemento<input name="complement" value={address.complement} onChange={(event) => updateAddress('complement', event.target.value)} /></label>
            <label className="field">Bairro<input name="neighborhood" required value={address.neighborhood} onBlur={() => address.neighborhood && address.city && void ensureQuote()} onChange={(event) => updateAddress('neighborhood', event.target.value)} /></label>
            <label className="field">Cidade<input name="city" required value={address.city} onChange={(event) => updateAddress('city', event.target.value)} /></label>
            <label className="field">Estado<input name="state" required value={address.state} onChange={(event) => updateAddress('state', event.target.value.toUpperCase())} maxLength={2} /></label>
            <label className="field field--wide">Referência<input name="reference" value={address.reference} onChange={(event) => updateAddress('reference', event.target.value)} /></label>
          </div>{user && <label className="field save-address-label">Salvar este endereço como<input name="saveAddressLabel" placeholder="Ex.: Casa, Trabalho (opcional)" /></label>}{quote && <p className={`delivery-quote delivery-quote--${quote.serviceStatus}`}>{quote.serviceStatus === 'available' ? `Taxa de entrega: ${currency.format(quote.deliveryFee ?? 0)}.` : 'Fora dos bairros cadastrados: o admin analisará se a entrega é possível e definirá a taxa.'}</p>}</fieldset>}

          <fieldset><legend>Forma de pagamento</legend><div className="choice-grid choice-grid--payments">
            {([['pix', 'Pix'], ['cash', 'Dinheiro'], ['credit_card', 'Crédito'], ['debit_card', 'Débito']] as const).map(([value, label]) => (
              <label key={value} className={payment === value ? 'choice is-active' : 'choice'}><input type="radio" checked={payment === value} onChange={() => setPayment(value)} />{label}</label>
            ))}
          </div>
          {payment === 'pix' && <p className="payment-note"><strong>Pix manual:</strong> a chave aparecerá após o pedido. A pizzaria confirmará o recebimento.</p>}
          {payment === 'cash' && <label className="field compact-field">Troco para quanto?<input name="changeFor" type="number" min="0" step="0.01" /></label>}
          </fieldset>
          <label className="field">Observações{user && (user.preferences.savedOrderNotes ?? []).length > 0 && <select defaultValue="" onChange={(event) => setNotes(event.target.value)}><option value="">Escolher observação salva...</option>{user.preferences.savedOrderNotes?.map((note) => <option key={note} value={note}>{note}</option>)}</select>}<textarea name="notes" rows={3} placeholder="Ex.: retirar cebola" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {user && notes.trim() && <label className="save-note-check"><input type="checkbox" name="saveNote" />Salvar esta observação para os próximos pedidos</label>}
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer><div><span>{fulfillment === 'delivery' ? (quote?.serviceStatus === 'review' ? 'Total provisório · taxa sob análise' : 'Total estimado com entrega') : 'Total para retirada'}</span><strong>{currency.format(subtotal + deliveryFee)}</strong></div><button disabled={sending || store?.isAcceptingOrders === false}>{sending ? <><LoaderCircle className="spin" size={18} />Enviando</> : store?.isAcceptingOrders === false ? 'Loja fechada' : <>Confirmar pedido<ArrowRight size={18} /></>}</button></footer>
      </form>
    </div>
  )
}

export default function App() {
  const emailStatus = new URLSearchParams(window.location.search)
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [customizations, setCustomizations] = useState<PizzaCustomizations>({ sizes: [], crusts: [], addons: [] })
  const [customizingProduct, setCustomizingProduct] = useState<ApiProduct | null>(null)
  const [activeCategory, setActiveCategory] = useState('Destaques')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>(savedCart)
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null)
  const [store, setStore] = useState<StoreInfo | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [accountOpen, setAccountOpen] = useState(() => emailStatus.has('email_confirmed') || emailStatus.has('email_error'))

  useEffect(() => {
    Promise.all([api.products(), api.categories(), api.customizations(), api.store()])
      .then(([productData, categoryData, customizationData, storeData]) => { setProducts(productData.products); setCategories(categoryData.categories); setCustomizations(customizationData); setStore(storeData) })
      .catch((error) => setCatalogError(error instanceof Error ? error.message : 'Erro ao carregar cardápio.'))
    api.me().then((result) => setCurrentUser(result.user)).catch(() => setCurrentUser(null))
  }, [])
  useEffect(() => { localStorage.setItem(cartStorageKey, JSON.stringify(cart)) }, [cart])
  useEffect(() => {
    if (!currentUser) { setFavoriteIds([]); return }
    api.favorites().then((result) => setFavoriteIds(result.products.map((product) => product.id))).catch(() => setFavoriteIds([]))
  }, [currentUser?.id])
  useEffect(() => {
    if (currentUser?.role !== 'customer') { setUnreadChatCount(0); return }
    const refreshUnread = () => {
      void api.myChats().then((result) => setUnreadChatCount(result.conversations.filter((conversation) => conversation.unread).length)).catch(() => undefined)
    }
    refreshUnread()
    const events = new EventSource('/api/chat/events')
    events.addEventListener('chat', refreshUnread)
    return () => { events.removeEventListener('chat', refreshUnread); events.close() }
  }, [currentUser?.id, currentUser?.role])

  const visibleProducts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR')
    return products.filter((product, index) => {
      const matchesCategory = activeCategory === 'Destaques' ? index < 4 : product.category_name === activeCategory
      return matchesCategory && (!normalized || `${product.name} ${product.description}`.toLocaleLowerCase('pt-BR').includes(normalized))
    })
  }, [activeCategory, products, search])

  const itemCount = cart.reduce((total, item) => total + item.quantity, 0)
  const subtotal = cart.reduce((total, item) => total + item.unitPrice * item.quantity, 0)
  function addLine(line: CartLine) { setCart((current) => { const found = current.find((item) => item.cartKey === line.cartKey); return found ? current.map((item) => item.cartKey === line.cartKey ? { ...item, quantity: item.quantity + 1 } : item) : [...current, line] }); setCustomizingProduct(null); setCartOpen(true) }
  function addToCart(product: ApiProduct) {
    if (['pizzas', 'pizzas-doces'].includes(product.category_slug)) { setCustomizingProduct(product); return }
    addLine({ ...product, cartKey: `plain:${product.id}`, quantity: 1, unitPrice: Number(product.base_price), displayName: product.name, customization: { addonIds: [] } })
  }
  function changeQuantity(cartKey: string, delta: number) { setCart((current) => current.map((item) => item.cartKey === cartKey ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter((item) => item.quantity > 0)) }

  async function toggleFavorite(productId: string) {
    if (!currentUser) { setAccountOpen(true); return }
    const isFavorite = favoriteIds.includes(productId)
    try {
      if (isFavorite) await api.removeFavorite(productId); else await api.addFavorite(productId)
      setFavoriteIds((current) => isFavorite ? current.filter((id) => id !== productId) : [...current, productId])
    } catch (caught) { setCatalogError(caught instanceof Error ? caught.message : 'Não foi possível atualizar o favorito.') }
  }

  async function repeatOrder(orderId: string) {
    const order: OrderDetails = await api.myOrder(orderId)
    const repeated = order.items.map((item): CartLine => {
      const product = products.find((candidate) => candidate.id === item.product_id)
      if (!product) throw new Error(`${item.product_name} não está mais disponível no cardápio.`)
      const customization = {
        secondFlavorId: item.customizations?.secondFlavorId ?? undefined,
        sizeId: item.customizations?.size?.id ?? undefined,
        crustId: item.customizations?.crust?.id ?? undefined,
        addonIds: item.customizations?.addons?.map((addon) => addon.id) ?? [],
      }
      const customizationLabel = [item.customizations?.size?.name, item.customizations?.crust?.id !== 'crust-none' ? item.customizations?.crust?.name : undefined, ...(item.customizations?.addons?.map((addon) => addon.name) ?? [])].filter(Boolean).join(' · ')
      return { ...product, cartKey: `repeat:${item.id}`, quantity: item.quantity, unitPrice: Number(item.unit_price), displayName: item.product_name, customizationLabel, customization }
    })
    setCart(repeated); setAccountOpen(false); setCartOpen(true)
  }

  return (
    <div className="app-shell">
      <header className="site-header"><a className="brand" href="#inicio"><span className="brand__mark">B</span><span><strong>{store?.profile.name ?? 'Brasa & Massa'}</strong><small>Pizzaria artesanal</small></span></a>
        <button className="delivery-location" type="button"><MapPin size={18} /><span><small>Entrega ou retirada</small><strong>Escolha no checkout</strong></span><ChevronRight size={17} /></button>
        <div className="header-actions"><a className="icon-button login-button" href="/acompanhar.html"><Clock3 size={19} /><span>Acompanhar</span></a><button className="icon-button login-button chat-header-button" onClick={() => setChatOpen(true)} aria-label={unreadChatCount ? `Atendimento com ${unreadChatCount} conversa não lida` : 'Abrir atendimento'}><MessageCircle size={19} /><span>Atendimento</span>{unreadChatCount > 0 && <i className="unread-dot unread-dot--header" />}</button><button className="icon-button login-button account-button" aria-label={currentUser ? `Abrir conta de ${currentUser.name}` : 'Entrar ou criar conta'} onClick={() => setAccountOpen(true)}><UserRound size={19} /><span>{currentUser ? currentUser.name.split(' ')[0] : 'Entrar'}</span></button><a className="icon-button login-button admin-link" href="/admin.html"><UserRound size={19} /><span>Admin</span></a><button className="cart-button" aria-label={`Abrir sacola com ${itemCount} itens`} onClick={() => setCartOpen(true)}><ShoppingBag size={20} /><span>Sacola</span>{itemCount > 0 && <b>{itemCount}</b>}</button></div>
      </header>
      <main><section className="hero" id="inicio"><div className="hero__content"><span className={`eyebrow store-state store-state--${store?.currentStatus ?? 'closed'}`}><i /> {store?.statusLabel ?? 'Consultando horário'} · {store?.effectiveHours?.enabled === false ? 'não abre hoje' : `${store?.effectiveHours?.opensAt ?? store?.operation.opensAt ?? '18:00'}–${store?.effectiveHours?.closesAt ?? store?.operation.closesAt ?? '22:30'}`}</span><h1>Massa leve,<br /><em>brasa de verdade.</em></h1><p>Ingredientes frescos, fermentação lenta e pedidos acompanhados do recebimento até a entrega.</p><div className="hero__actions"><button className="primary-button" onClick={() => document.querySelector('#cardapio')?.scrollIntoView({ behavior: 'smooth' })}>Ver cardápio <ArrowRight size={19} /></button><span className="delivery-time"><Clock3 size={18} /><span><small>Entrega estimada</small><strong>{store?.operation.etaMin ?? 35}–{store?.operation.etaMax ?? 40} min</strong></span></span></div><div className="hero__rating"><span className="avatars"><i>J</i><i>M</i><i>A</i></span><span><strong><Star size={15} fill="currentColor" /> 4,9</strong><small>mais de 800 clientes felizes</small></span></div></div>
        <div className="hero__visual"><span className="hero__stamp">Feita<br />na hora</span><PizzaArtwork variant="hero" /><div className="ingredient ingredient--tomato" /><div className="ingredient ingredient--basil" /><div className="ingredient ingredient--pepper" /></div></section>
        <section className="benefits"><div><Check size={18} /><span><strong>Preço protegido</strong><small>Calculado pela API</small></span></div><div><Check size={18} /><span><strong>Pagamento manual</strong><small>Pix ou na entrega</small></span></div><div><Check size={18} /><span><strong>Acompanhamento</strong><small>Status do pedido registrado</small></span></div></section>
        <section className="menu-section" id="cardapio"><div className="section-heading"><div><span className="section-kicker">Cardápio vindo do banco</span><h2>Escolha o sabor de hoje</h2></div><label className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no cardápio" /></label></div>
          <nav className="category-tabs">{['Destaques', ...categories.map((item) => item.name)].map((category) => <button key={category} className={category === activeCategory ? 'is-active' : ''} onClick={() => setActiveCategory(category)}>{category}</button>)}</nav>
          {catalogError && <p className="form-error">{catalogError}</p>}
          {!catalogError && products.length === 0 && <div className="catalog-loading"><LoaderCircle className="spin" /> Carregando cardápio...</div>}
          <div className="product-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}><button className={favoriteIds.includes(product.id) ? 'favorite-button is-favorite' : 'favorite-button'} aria-label={favoriteIds.includes(product.id) ? `Remover ${product.name} dos favoritos` : `Favoritar ${product.name}`} onClick={() => void toggleFavorite(product.id)}><Heart size={18} fill={favoriteIds.includes(product.id) ? 'currentColor' : 'none'} /></button><PizzaArtwork variant={artwork[product.id] ?? 'margherita'} /><div className="product-card__content"><span className="product-card__tag">{product.category_name}</span><h3>{product.name}</h3><p>{product.description}</p><div className="product-card__footer"><span><small>A partir de</small><strong>{currency.format(Number(product.base_price))}</strong></span><button onClick={() => addToCart(product)} aria-label={`Adicionar ${product.name}`}><Plus size={20} /></button></div></div></article>)}</div>
          {products.length > 0 && visibleProducts.length === 0 && <div className="empty-results"><Search size={28} /><strong>Nenhum item encontrado</strong><span>Tente buscar outro sabor.</span></div>}
        </section></main>
      <footer className="site-footer"><a className="brand brand--footer" href="#inicio"><span className="brand__mark">B</span><span><strong>{store?.profile.name ?? 'Brasa & Massa'}</strong><small>Pizzaria artesanal</small></span></a><p>{store?.profile.address.street ? `${store.profile.address.street}, ${store.profile.address.number} · ${store.profile.address.neighborhood}` : 'Endereço da pizzaria configurável pelo admin.'}{store?.profile.phone ? ` · ${store.profile.phone}` : ''}</p><span>© 2026 {store?.profile.name ?? 'Brasa & Massa'}</span></footer>

      {cartOpen && <div className="drawer-layer"><button className="drawer-backdrop" onClick={() => setCartOpen(false)} aria-label="Fechar sacola" /><aside className="cart-drawer"><div className="cart-drawer__header"><div><span>Sua sacola</span><strong>{itemCount} {itemCount === 1 ? 'item' : 'itens'}</strong></div><button onClick={() => setCartOpen(false)}><X size={21} /></button></div><div className="cart-drawer__content">{cart.length === 0 ? <div className="empty-cart"><span><ShoppingBag size={30} /></span><strong>Sua sacola está vazia</strong><p>Escolha uma pizza para começar.</p><button onClick={() => setCartOpen(false)}>Explorar cardápio</button></div> : cart.map((item) => <div className="cart-item" key={item.cartKey}><div className="cart-item__thumb"><span /></div><div className="cart-item__info"><strong>{item.displayName}</strong><small>{item.customizationLabel || item.category_name}</small><span>{currency.format(item.unitPrice * item.quantity)}</span></div><div className="quantity-control"><button onClick={() => changeQuantity(item.cartKey, -1)}><Minus size={15} /></button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.cartKey, 1)}><Plus size={15} /></button></div></div>)}</div>{cart.length > 0 && <div className="cart-drawer__footer"><div><span>Subtotal</span><strong>{currency.format(subtotal)}</strong></div><small>A API recalculará o valor final com segurança.</small><button onClick={() => { setCartOpen(false); setCheckoutOpen(true) }}>Continuar pedido <ArrowRight size={18} /></button></div>}</aside></div>}
      {customizingProduct && <PizzaCustomizer product={customizingProduct} products={products} options={customizations} onClose={() => setCustomizingProduct(null)} onAdd={addLine} />}
      {accountOpen && <AccountModal user={currentUser} onUserChange={setCurrentUser} onClose={() => setAccountOpen(false)} onRepeatOrder={repeatOrder} onFavoriteToCart={addToCart} initialMessage={emailStatus.has('email_confirmed') ? 'E-mail confirmado. Sua conta está ativa.' : ''} initialError={emailStatus.has('email_error') ? 'Este link de confirmação é inválido ou expirou. Solicite um novo link.' : ''} />}
      {chatOpen && <CustomerChat user={currentUser} onUnreadChange={setUnreadChatCount} onClose={() => setChatOpen(false)} onLogin={() => { setChatOpen(false); setAccountOpen(true) }} />}
      {checkoutOpen && <Checkout cart={cart} user={currentUser} store={store} onUserChange={setCurrentUser} onClose={() => setCheckoutOpen(false)} onSuccess={(order) => { setCheckoutOpen(false); setCreatedOrder(order); setCart([]) }} />}
      {createdOrder && <div className="modal-layer"><button className="drawer-backdrop" onClick={() => setCreatedOrder(null)} /><section className="success-modal"><span className="success-icon"><Check size={28} /></span><small>Pedido recebido</small><h2>{createdOrder.deliveryReviewStatus === 'pending' ? 'Entrega em análise' : 'Agora é com a gente!'}</h2><p>{createdOrder.deliveryReviewStatus === 'pending' ? 'O endereço está fora dos bairros cadastrados. O admin analisará a entrega e poderá ajustar a taxa.' : 'Guarde este código para acompanhar seu pedido:'}</p><strong className="tracking-code">{createdOrder.trackingCode}</strong><div className="success-summary"><span>{createdOrder.deliveryReviewStatus === 'pending' ? 'Total provisório' : 'Total confirmado pela API'}</span><b>{currency.format(createdOrder.total)}</b><span>Pagamento</span><b>Pendente</b></div><div className="pix-box"><small>Chave Pix provisória</small><strong>PIX-A-DEFINIR</strong><span>A confirmação ainda é manual nesta etapa.</span></div><a className="tracking-action" href={`/acompanhar.html?code=${encodeURIComponent(createdOrder.trackingCode)}`}>Acompanhar este pedido</a><button onClick={() => setCreatedOrder(null)}>Voltar ao cardápio</button></section></div>}
    </div>
  )
}
