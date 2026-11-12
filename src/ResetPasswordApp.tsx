import { Check, KeyRound, LoaderCircle } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api } from './api'

export default function ResetPasswordApp() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(token ? '' : 'O link de recuperação está incompleto.')
  const [success, setSuccess] = useState(false)
  const [redirectTo, setRedirectTo] = useState('/')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password'))
    const confirmation = String(data.get('confirmation'))
    if (password !== confirmation) { setError('As duas senhas precisam ser iguais.'); return }
    setSending(true); setError('')
    try {
      const result = await api.resetPassword(token, password)
      setRedirectTo(result.redirectTo); setSuccess(true)
      window.setTimeout(() => window.location.replace(result.redirectTo), 900)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível redefinir a senha.')
    } finally { setSending(false) }
  }

  return <main className="reset-page"><section className="reset-card">
    <a className="reset-brand" href="/"><span>B</span><div><strong>Brasa & Massa</strong><small>Pizzaria artesanal</small></div></a>
    <span className={success ? 'reset-icon is-success' : 'reset-icon'}>{success ? <Check size={28} /> : <KeyRound size={27} />}</span>
    <small>Segurança da conta</small>
    <h1>{success ? 'Senha atualizada!' : 'Crie uma nova senha'}</h1>
    {success ? <><p>Sua sessão anterior foi encerrada. Você já está conectado com segurança.</p><a className="reset-action" href={redirectTo}>Continuar agora</a></>
      : <form onSubmit={submit}><label>Nova senha<input name="password" type="password" minLength={8} maxLength={128} required placeholder="Mínimo 8 caracteres, com letra e número" /></label><label>Confirmar senha<input name="confirmation" type="password" minLength={8} maxLength={128} required /></label>{error && <p className="reset-error">{error}</p>}<button disabled={sending || !token}>{sending ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}Salvar nova senha</button></form>}
  </section></main>
}
