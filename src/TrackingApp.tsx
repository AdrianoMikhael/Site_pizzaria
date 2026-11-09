import { type FormEvent, useEffect, useState } from 'react'
import { ArrowLeft, Check, ChefHat, Clock3, LoaderCircle, MapPin, PackageCheck, Search, Truck } from 'lucide-react'
import { api, customizationSummary, type OrderDetails } from './api'

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const statusLabels: Record<string, string> = {
  received: 'Pedido recebido', confirmed: 'Pedido confirmado', preparing: 'Em preparo',
  ready: 'Pronto', out_for_delivery: 'Saiu para entrega', completed: 'Concluído', cancelled: 'Cancelado',
}
const paymentLabels: Record<string, string> = { pending: 'Aguardando confirmação', paid: 'Pagamento confirmado', cancelled: 'Cancelado', refunded: 'Estornado' }
const steps = [
  { status: 'received', label: 'Recebido', icon: Clock3 },
  { status: 'confirmed', label: 'Confirmado', icon: Check },
  { status: 'preparing', label: 'Em preparo', icon: ChefHat },
  { status: 'ready', label: 'Pronto', icon: PackageCheck },
  { status: 'out_for_delivery', label: 'Em rota', icon: Truck },
  { status: 'completed', label: 'Concluído', icon: Check },
]

export default function TrackingApp() {
  const query = new URLSearchParams(window.location.search)
  const [code, setCode] = useState(query.get('code') ?? '')
  const [phone, setPhone] = useState(query.get('phone') ?? '')
  const [order, setOrder] = useState<OrderDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function searchOrder(searchCode = code, searchPhone = phone, updateUrl = true) {
    if (!searchCode || !searchPhone) return
    setLoading(true); setError('')
    try {
      const data = await api.trackOrder(searchCode.trim().toUpperCase(), searchPhone)
      setOrder(data)
      if (updateUrl) window.history.replaceState({}, '', `?code=${encodeURIComponent(searchCode.trim().toUpperCase())}&phone=${encodeURIComponent(searchPhone)}`)
    } catch (caught) { setOrder(null); setError(caught instanceof Error ? caught.message : 'Pedido não encontrado.') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (code && phone) void searchOrder(code, phone, false) }, [])
  useEffect(() => {
    if (!order) return
    const timer = window.setInterval(() => void searchOrder(code, phone, false), 15000)
    return () => window.clearInterval(timer)
  }, [order?.id, code, phone])

  function submit(event: FormEvent) { event.preventDefault(); void searchOrder() }
  const currentIndex = order ? steps.findIndex((step) => step.status === order.order_status) : -1
  const visibleSteps = order?.fulfillment_type === 'pickup' ? steps.filter((step) => step.status !== 'out_for_delivery') : steps
  const isDelayed = Boolean(order?.accepted_at && order?.estimated_minutes
    && Date.now() > new Date(order.accepted_at).getTime() + order.estimated_minutes * 60_000
    && !['completed', 'cancelled'].includes(order.order_status))

  return <div className="tracking-shell">
    <header><a className="tracking-brand" href="/"><span>B</span><div><strong>Brasa & Massa</strong><small>Pizzaria artesanal</small></div></a><a href="/"><ArrowLeft size={16} />Voltar ao cardápio</a></header>
    <main><section className="tracking-intro"><span className="kicker">Seu pedido, passo a passo</span><h1>Acompanhe sem precisar ligar.</h1><p>Informe o código recebido no checkout e o mesmo telefone usado no pedido.</p>
      <form onSubmit={submit}><label>Código do pedido<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="PZ-20261103-ABC123" required /></label><label>Telefone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(11) 99999-9999" required /></label><button disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <Search size={18} />}{loading ? 'Buscando' : 'Acompanhar'}</button></form>{error && <p className="tracking-error">{error}</p>}</section>
      {order && <section className="tracking-result"><div className="result-head"><div><small>Pedido {order.tracking_code}</small><h2>{statusLabels[order.order_status]}</h2><p>Atualização automática a cada 15 segundos.</p></div><div className={`payment-card payment-card--${order.payment_status}`}><span>Pagamento</span><strong>{paymentLabels[order.payment_status]}</strong></div></div>
        {order.delivery_review_status === 'pending' && <div className="delivery-review-message"><strong>Endereço em análise</strong><span>A pizzaria está verificando se consegue fazer esta entrega. A taxa e o total mostrados ainda são provisórios.</span></div>}
        {order.delivery_review_status === 'approved' && <div className="delivery-review-message is-approved"><strong>Entrega aprovada</strong><span>O endereço e a taxa de {currency.format(Number(order.delivery_fee))} foram confirmados pela pizzaria.</span></div>}
        {order.estimated_minutes && <div className={isDelayed ? 'eta-message is-delayed' : 'eta-message'}><strong>{isDelayed ? 'Pedido passou da previsão' : `Previsão individual: ${order.estimated_minutes} minutos`}</strong><span>{isDelayed ? 'A equipe já consegue identificar o atraso no painel. Fale com o atendimento se precisar.' : 'O prazo começou a contar quando a pizzaria aceitou o pedido.'}</span></div>}
        {order.order_status === 'cancelled' ? <div className="cancelled-message">Este pedido foi cancelado. Entre em contato com a pizzaria se precisar de ajuda.</div> : <div className="timeline">{visibleSteps.map((step) => { const originalIndex = steps.findIndex((item) => item.status === step.status); const done = currentIndex >= originalIndex; const Icon = step.icon; return <div className={done ? 'timeline-step is-done' : 'timeline-step'} key={step.status}><span><Icon size={18} /></span><strong>{step.label}</strong></div> })}</div>}
        <div className="order-details"><article><h3>Resumo</h3>{order.items.map((item) => <div className="summary-line" key={item.id}><span>{item.quantity}× {item.product_name}</span><strong>{currency.format(Number(item.unit_price) * item.quantity)}</strong>{customizationSummary(item) && <small>{customizationSummary(item)}</small>}{item.notes && <small>{item.notes}</small>}</div>)}<div className="summary-total"><span>Total</span><strong>{currency.format(Number(order.total))}</strong></div></article><article><h3>{order.fulfillment_type === 'delivery' ? 'Entrega' : 'Retirada'}</h3>{order.fulfillment_type === 'delivery' ? <div className="address"><MapPin size={18} /><p>{order.street}, {order.number}{order.complement ? ` — ${order.complement}` : ''}<br />{order.neighborhood} · {order.city}/{order.state}<br /><small>CEP {order.postal_code}</small></p></div> : <p className="muted">Seu pedido ficará disponível para retirada quando o status mudar para “Pronto”.</p>}<h3 className="history-title">Histórico</h3>{order.status_history.map((history) => <div className="history-line" key={`${history.status}-${history.created_at}`}><span /><p><strong>{statusLabels[history.status] ?? history.status}</strong><small>{history.note ? `${history.note} · ` : ''}{dateTime.format(new Date(history.created_at))}</small></p></div>)}</article></div>
      </section>}
    </main>
  </div>
}
