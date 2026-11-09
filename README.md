# Brasa & Massa — projeto de pizzaria

Projeto em React + TypeScript com uma API própria em Fastify e banco PostgreSQL local via PGlite.
O nome, os produtos, os preços e a chave Pix são provisórios para validação.

## Rodar site, API e banco

```bash
npm install
npm run dev:all
```

O frontend recarrega automaticamente. Para mudanças no backend, encerre com `Ctrl+C` e execute
`npm run dev:all` novamente; isso permite que o banco PGlite feche os arquivos com segurança.

- Site: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3333/api/health`
- Banco persistente local: pasta `data/` (não é enviada ao Git)

Clientes podem se cadastrar pela loja. O primeiro administrador é criado em `/admin.html` sem
código; depois que ele existe, novos cadastros administrativos públicos são bloqueados. Todo novo
usuário precisa confirmar o e-mail antes de entrar.

No ambiente local, a tela mostra o link de confirmação para facilitar os testes. Para envio real,
copie `.env.example` para `.env` e configure `RESEND_API_KEY`, `EMAIL_FROM` e `WEB_PUBLIC_URL`.
Em produção, a API não inicia sem a URL pública do site e a chave do serviço de e-mail.

## Verificações

```bash
npm test
npm run check:api
npm run build
npm audit
```

A lista de rotas e exemplos está em [`docs/API.md`](docs/API.md).

## Progresso

- [x] Base React + TypeScript responsiva
- [x] Página inicial, categorias, busca e sacola demonstrativa
- [x] Banco com clientes, endereços, categorias, produtos, pedidos, itens e histórico
- [x] API de catálogo
- [x] API para criar e acompanhar pedidos
- [x] Cálculo de preço e taxa feito exclusivamente no servidor
- [x] API administrativa protegida para fila, status e pagamento manual
- [x] Dashboard de faturamento por dia, semana e mês
- [x] Calendário de vendas por dia específico ou intervalo personalizado
- [x] Atalhos de faturamento para 7, 15 e 30 dias
- [x] Testes de integração do fluxo principal
- [x] Ligar cardápio, sacola e checkout visual à API
- [x] Painel inicial da cozinha com fila, pagamento e dashboard
- [x] Tela pública de acompanhamento com atualização automática
- [x] Detalhes completos, itens, endereço e histórico na cozinha
- [x] Cadastro e edição de categorias, produtos, preços e disponibilidade
- [x] Categoria separada para pizzas doces
- [x] Personalização de pizzas com tamanho, segundo sabor, borda e adicionais
- [x] Preço das personalizações recalculado e salvo pela API
- [x] Cadastro e login seguro do cliente e do administrador
- [x] Sessões persistentes em cookie HttpOnly e permissões por função
- [x] Preferências, endereço e histórico recente salvos na conta do cliente
- [x] Confirmação de e-mail por link com validade de 24 horas e opção de reenvio
- [x] Primeiro administrador sem código e bloqueio de novos cadastros públicos
- [ ] Migrar o PostgreSQL local para Supabase
- [ ] Publicar o site no Cloudflare
- [ ] Automatizar confirmação do Pix em uma etapa futura

## Decisão de arquitetura

O PGlite permite desenvolver agora sem Docker e grava os dados no computador. O schema usa SQL
PostgreSQL para facilitar a migração posterior ao Supabase. Na publicação, o banco não ficará no
Cloudflare Pages: a aplicação usará o Supabase como banco compartilhado e persistente.
