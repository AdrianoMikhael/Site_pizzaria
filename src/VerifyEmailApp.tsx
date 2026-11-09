import { Check, LoaderCircle, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'

type VerificationState = 'checking' | 'confirmed' | 'error'

export default function VerifyEmailApp() {
  const [state, setState] = useState<VerificationState>('checking')
  const [message, setMessage] = useState('Confirmando seu e-mail com segurança...')
  const [redirectTo, setRedirectTo] = useState('/')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      setState('error'); setMessage('O link de confirmação está incompleto.')
      return
    }
    api.verifyEmail(token).then((result) => {
      setRedirectTo(result.redirectTo)
      setState('confirmed')
      setMessage('E-mail confirmado. Retornando para onde você parou...')
      window.setTimeout(() => window.location.replace(result.redirectTo), 250)
    }).catch((error) => {
      setState('error')
      setMessage(error instanceof Error ? error.message : 'Não foi possível confirmar este e-mail.')
    })
  }, [])

  return <main className="verify-page"><section className="verify-card">
    <a className="verify-brand" href="/"><span>B</span><div><strong>Brasa & Massa</strong><small>Pizzaria artesanal</small></div></a>
    <span className={`verify-status verify-status--${state}`}>
      {state === 'checking' ? <LoaderCircle className="spin" size={28} /> : state === 'confirmed' ? <Check size={29} /> : <RotateCcw size={27} />}
    </span>
    <small>Confirmação de conta</small>
    <h1>{state === 'checking' ? 'Só um instante' : state === 'confirmed' ? 'Tudo certo!' : 'Link não confirmado'}</h1>
    <p>{message}</p>
    {state === 'confirmed' && <a className="verify-action" href={redirectTo}>Continuar agora</a>}
    {state === 'error' && <><a className="verify-action" href="/">Voltar para a pizzaria</a><p className="verify-help">Entre novamente e use a opção de reenviar confirmação.</p></>}
  </section></main>
}
