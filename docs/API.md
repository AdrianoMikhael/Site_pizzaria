# API da pizzaria

Base local: `http://127.0.0.1:3333`

## Rotas públicas

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/api/health` | Confirma API e banco ativos |
| `GET` | `/api/store` | Configuração pública da loja e Pix provisório |
| `GET` | `/api/categories` | Categorias ativas |
| `GET` | `/api/products` | Produtos; aceita `category` e `search` |
| `GET` | `/api/products/:id` | Detalhes de um produto |
| `GET` | `/api/customizations` | Tamanhos, bordas e adicionais ativos |
| `POST` | `/api/orders` | Cria um pedido e calcula o total no servidor |
| `GET` | `/api/orders/track/:codigo?phone=...` | Acompanha um pedido validando o telefone |

Exemplo de criação:

```json
{
  "customer": {
    "name": "Maria Silva",
    "phone": "(11) 99999-8888"
  },
  "fulfillmentType": "delivery",
  "address": {
    "street": "Rua das Flores",
    "number": "123",
    "neighborhood": "Centro",
    "city": "São Paulo",
    "state": "SP",
    "postalCode": "01001-000"
  },
  "paymentMethod": "pix",
  "items": [
    {
      "productId": "pizza-margherita",
      "secondFlavorId": "pizza-calabresa",
      "sizeId": "size-large",
      "crustId": "crust-catupiry",
      "addonIds": ["addon-cheese"],
      "quantity": 1
    }
  ]
}
```

O cliente envia identificadores das escolhas e a quantidade. O preço atual dos sabores e os
acréscimos de tamanho, borda e adicionais são buscados no banco e calculados pela API. Em pizzas
meio a meio, o preço base é o do sabor mais caro. O segundo sabor precisa pertencer à mesma
categoria, mantendo pizzas salgadas e pizzas doces separadas. Subtotal, taxa de entrega e total
também são calculados no servidor, impedindo alteração de valores pelo navegador.

## Autenticação e conta

| Método | Rota | Finalidade |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Cadastra cliente ou o primeiro administrador |
| `POST` | `/api/auth/verify-email` | Confirma o token, cria a primeira sessão e devolve o caminho de retorno |
| `POST` | `/api/auth/resend-verification` | Gera e envia um novo link de confirmação |
| `POST` | `/api/auth/forgot-password` | Solicita um link de recuperação sem revelar se a conta existe |
| `POST` | `/api/auth/reset-password` | Troca a senha com um token válido de uso único |
| `POST` | `/api/auth/login` | Cria uma sessão segura |
| `POST` | `/api/auth/logout` | Encerra a sessão atual |
| `GET` | `/api/auth/me` | Retorna o usuário autenticado e suas preferências |
| `PATCH` | `/api/auth/profile` | Atualiza nome, telefone e preferências |
| `GET` | `/api/auth/orders` | Lista os últimos pedidos do usuário |

As senhas exigem no mínimo oito caracteres, uma letra e um número. Elas são derivadas com `scrypt`
e salt individual. O navegador recebe somente um token aleatório em cookie `HttpOnly`, `SameSite=Lax`;
o banco armazena apenas o hash desse token. As sessões duram 30 dias por padrão.

O cadastro gera um token de confirmação armazenado apenas como hash e válido por 24 horas. O login
fica bloqueado até a confirmação. Sem `RESEND_API_KEY`, o ambiente local devolve o link para teste;
com a chave configurada, a API envia o e-mail pela Resend. O endpoint de reenvio não revela se um
endereço está ou não cadastrado.

O e-mail abre `confirmar-email.html`, que confirma o token sem deixar o usuário preso na API e
redireciona automaticamente para o caminho e a seção em que o cadastro começou. A rota `GET`
antiga permanece disponível apenas para links já enviados.

Em “Esqueci minha senha”, a API sempre devolve a mesma resposta pública, exista ou não uma conta
com aquele e-mail. Para uma conta ativa e confirmada, o link de recuperação vale por uma hora e
só pode ser usado uma vez. Ao trocar a senha, todas as sessões anteriores são encerradas e uma nova
sessão é criada. No desenvolvimento, uma falha da Resend também libera um link local para teste.

O remetente `onboarding@resend.dev` serve apenas para testes limitados. O envio real para os
clientes exige um domínio validado na Resend e um `EMAIL_FROM` pertencente a esse domínio.

O primeiro administrador pode se cadastrar sem código somente enquanto não existe nenhum usuário
com função `admin`. Depois disso, o cadastro administrativo público é bloqueado. Em produção, o
cabeçalho de desenvolvimento `x-admin-key` é desativado e todas as rotas administrativas exigem
uma sessão com função `admin`.

Ao finalizar um pedido autenticado, nome, telefone, forma de recebimento, pagamento e último
endereço de entrega são atualizados na conta e reaparecem preenchidos no próximo checkout.

## Rotas administrativas

Todas exigem uma sessão autenticada com função `admin`.

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/api/admin/orders` | Lista até 100 pedidos; aceita `status` |
| `GET` | `/api/admin/orders/:id` | Pedido completo, cliente, endereço, itens e histórico |
| `PATCH` | `/api/admin/orders/:id/status` | Avança o estado operacional do pedido |
| `PATCH` | `/api/admin/orders/:id/payment` | Confirma ou corrige pagamento manualmente |
| `GET` | `/api/admin/dashboard?period=day` | Faturamento de `day`, `week` ou `month` |
| `GET` | `/api/admin/dashboard?from=2026-11-01&to=2026-11-15` | Faturamento por intervalo inclusivo de datas |
| `GET` | `/api/admin/categories` | Lista categorias ativas e pausadas |
| `POST` | `/api/admin/categories` | Cria uma categoria |
| `PATCH` | `/api/admin/categories/:id` | Edita ou pausa uma categoria |
| `GET` | `/api/admin/products` | Lista todo o cardápio administrativo |
| `POST` | `/api/admin/products` | Cria um produto |
| `PATCH` | `/api/admin/products/:id` | Edita preço, dados ou disponibilidade |

Fluxo permitido do pedido:

```text
received → confirmed → preparing → ready → out_for_delivery → completed
                                      └──────────────→ completed (retirada)
```

Um pedido pode ser cancelado antes de ser concluído. Saltos inválidos retornam HTTP `409`.

Estados de pagamento: `pending`, `paid`, `cancelled` e `refunded`. O faturamento considera somente
pedidos marcados como pagos e não cancelados.

As datas personalizadas usam o fuso `America/Sao_Paulo`. Para consultar apenas um dia, envie a
mesma data em `from` e `to`. A API exige as duas datas e rejeita intervalos em que `from` seja
posterior a `to`.

## Segurança já aplicada

- Validação dos dados recebidos pela API.
- Consultas SQL parametrizadas.
- Cálculo de preço no servidor.
- Telefone obrigatório para acompanhar um pedido.
- Senhas protegidas com `scrypt` e salt exclusivo.
- Sessões com tokens aleatórios, hash no banco e cookies `HttpOnly`.
- Confirmação obrigatória do e-mail com token aleatório, hash no banco e expiração.
- Recuperação de senha com resposta neutra, token de uso único, hash no banco e expiração.
- Somente o primeiro cadastro administrativo é público; os seguintes são bloqueados.
- Limite temporário de tentativas de login por IP e e-mail.
- Histórico de cada mudança operacional.
