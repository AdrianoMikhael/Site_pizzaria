type VerificationEmail = {
  to: string
  name: string
  verificationUrl: string
  role: 'customer' | 'admin'
  apiKey?: string
  from: string
}

type OrderStatusEmail = {
  to: string
  name: string
  trackingCode: string
  status: 'confirmed' | 'ready' | 'out_for_delivery' | 'cancelled'
  trackingUrl: string
  cancellationReason?: string | null
  apiKey?: string
  from: string
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

export async function sendVerificationEmail(input: VerificationEmail) {
  if (!input.apiKey) return { delivery: 'development' as const }

  const accountLabel = input.role === 'admin' ? 'administrativa' : 'de cliente'
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: 'Confirme seu e-mail — Brasa & Massa',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#2c231b">
          <h1 style="color:#b93227">Brasa &amp; Massa</h1>
          <p>Olá, ${escapeHtml(input.name)}.</p>
          <p>Confirme seu e-mail para ativar sua conta ${accountLabel}.</p>
          <p style="margin:28px 0">
            <a href="${escapeHtml(input.verificationUrl)}" style="background:#b93227;color:white;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Confirmar meu e-mail</a>
          </p>
          <p style="font-size:13px;color:#756b62">Este link expira em 24 horas. Se você não criou a conta, ignore esta mensagem.</p>
        </div>`,
    }),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Falha ao enviar e-mail de confirmação (${response.status}): ${details}`)
  }
  return { delivery: 'sent' as const }
}

export async function sendOrderStatusEmail(input: OrderStatusEmail) {
  if (!input.apiKey) return { delivery: 'development' as const }
  const content = {
    confirmed: { subject: 'Seu pedido foi aceito', title: 'Pedido aceito!', message: 'A pizzaria aceitou seu pedido e já vai começar a preparação.' },
    ready: { subject: 'Seu pedido está pronto', title: 'Pedido pronto!', message: 'Seu pedido está pronto para retirada ou para seguir com a entrega.' },
    out_for_delivery: { subject: 'Seu pedido saiu para entrega', title: 'Saiu para entrega!', message: 'O entregador já está a caminho com seu pedido.' },
    cancelled: { subject: 'Seu pedido foi cancelado', title: 'Pedido cancelado', message: input.cancellationReason ? `Motivo informado: ${input.cancellationReason}` : 'O pedido foi cancelado pela pizzaria.' },
  }[input.status]
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: `${content.subject} — ${input.trackingCode}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#2c231b"><h1 style="color:#b93227">Brasa &amp; Massa</h1><p>Olá, ${escapeHtml(input.name)}.</p><h2>${content.title}</h2><p>${escapeHtml(content.message)}</p><p><strong>Código:</strong> ${escapeHtml(input.trackingCode)}</p><p style="margin:28px 0"><a href="${escapeHtml(input.trackingUrl)}" style="background:#b93227;color:white;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Acompanhar pedido</a></p></div>`,
    }),
  })
  if (!response.ok) throw new Error(`Falha ao enviar aviso do pedido (${response.status}).`)
  return { delivery: 'sent' as const }
}
