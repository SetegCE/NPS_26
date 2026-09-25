# Dashboard NPS + Gestão PMO — Seteg

Dashboard de NPS dos projetos da Seteg, com o módulo de gestão operacional do
PMO: projetos, respondentes, pesquisas, ciclos, ISC e auditoria.

A documentação funcional detalhada está em [`DOCUMENTACAO.md`](DOCUMENTACAO.md).

**Stack:** Next.js 14 (App Router) · TypeScript · React 18 · Tailwind ·
PostgreSQL 17 (plpgsql). É a mesma base do SGA Seteg — mesmo padrão de
sessão, mesmo endurecimento de cabeçalhos, mesma separação entre o porteiro
leve (middleware) e a checagem autoritativa (banco).

**Banco:** com `DATABASE_URL` o app fala direto com o Postgres
(`lib/dbPostgres.ts`) — é o modo do **servidor próprio**, com o passo a passo
em [`DEPLOY.md`](DEPLOY.md). Sem ela, usa o PostgREST do Supabase, onde o
sistema rodou até a migração.

---

## Arquitetura

```
Navegador
  ├── /login                     tela de acesso (senha)
  ├── /dashboard, /projetos…     telas internas, dentro do grupo (app)
  └── /pesquisa/[token]          formulário público, renderizado no servidor
              │
              │  HTTPS — o cookie httpOnly de sessão viaja sozinho
              ▼
middleware.ts (Edge)             porteiro: confere a ASSINATURA do cookie
              │
              ▼
Next.js — app/api/**/route.ts    cada rota revalida a sessão no BANCO
  └── lib/  token (jose) · session · senha (scrypt) · db (PostgREST)
            http/validacao · dashboard (NPS) · rateLimit · resumo
              │
              │  service_role — nunca sai do servidor
              ▼
Supabase (PostgreSQL)
  tabelas + views + ~12 funções plpgsql com as regras de negócio atômicas
```

Três coisas valem ser ditas explicitamente:

- **O navegador não fala com o banco.** Toda leitura e escrita passa pelas
  route handlers, que validam sessão e perfil a cada chamada.
- **O token não fica no JavaScript.** Ele vive num cookie `httpOnly`, que a
  página não consegue ler — um XSS não rouba a sessão.
- **A regra de negócio continua no banco.** As funções `nps_*` garantem
  atomicidade; a aplicação as chama, não as reimplementa. Foi por isso que o
  porte manteve o PostgREST em vez de trocar por um ORM.

---

## Configuração

### 1. Variáveis de ambiente

Copie [`.env.example`](.env.example) e configure as três na Vercel
(Settings → Environment Variables), em Production, Preview e Development:

| Variável | O que é |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço — **só no servidor** |
| `NPS_SESSION_SECRET` | Segredo que assina o cookie de sessão |

Gerar o segredo:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> Sem `NPS_SESSION_SECRET` a aplicação **não sobe**, de propósito. A versão
> anterior caía para a service_role key e, na falta dela, para uma string
> vazia — qualquer pessoa que lesse o repositório forjaria um token de PMO.

### 2. Banco — migrations

```
supabase/migrations/12_rls_fechar_acesso_publico.sql      ← fecha o banco ao público   [PENDENTE]
supabase/migrations/13_freio_de_forca_bruta_no_banco.sql  ← freio de login             [PENDENTE]
supabase/migrations/14_vendedor_e_acesso_do_projeto.sql   ← colunas da planilha        [APLICADA]
supabase/migrations/15_login_por_email.sql                ← contas de acesso           [APLICADA]
supabase/migrations/16_canal_da_resposta_no_banco.sql     ← canal sai do código        [APLICADA]
supabase/migrations/19_lider_visto_no_clockrview.sql      ← líder manual x Clockrview  [APLICADA]
```

**A 12 é a mais urgente do repositório.** Enquanto ela não roda, `config_acesso`
e `acessos_lideres` seguem com leitura pública — ou seja, a senha do PMO e as
senhas dos líderes continuam acessíveis a quem souber consultar o Supabase.

Ordem obrigatória: configurar as variáveis → deploy → confirmar que o login
funciona → **só então** aplicar as migrations. Cada arquivo explica o porquê,
como verificar e como reverter.

A 13 pode ser aplicada a qualquer momento: até lá o freio de força bruta falha
aberto (o login funciona, apenas sem limite de tentativas).

---

## Desenvolvimento local

```bash
npm install
cp .env.example .env.local     # e preencha SUPABASE_SERVICE_ROLE_KEY, NPS_SESSION_SECRET e CLOCKRVIEW_API_KEY
npm run dev                    # http://localhost:3000
```

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento do Next |
| `npm run build` | Build de produção (grava em `.next`) — roda typecheck e lint |
| `npm run build:verificar` | Mesmo build, em `.next-build`. Use este com o `npm run dev` ligado |
| `npm run check` | Confere se as credenciais do `.env.local` funcionam contra o banco |
| `npm test` | Testes de validação, sessão, rotas, recorte do líder e cálculo do NPS |

### Criar conta ou redefinir senha

**Pela tela**, em **Líderes** — só o PMO enxerga. Cada linha traz criar conta
(para quem ainda não tem), redefinir senha e desativar/reativar o acesso. A
senha é derivada com scrypt no route handler e só o hash chega ao banco
(`lib/acessos.ts`); a senha em claro vive o tempo de uma requisição e não entra
na resposta nem na auditoria. Redefinir a senha derruba na hora as sessões
abertas com a antiga — inclusive a sua, se for a sua conta.

O e-mail não é editável depois de criada: ele é a identidade da conta
(`email_norm` é único e é por ele que o login busca), e deixar trocá-lo por um
campo de tela transformaria "corrigir um typo" em "assumir outra conta".

**Pelo seed**, que continua sendo o caminho para carga inicial e para quando
não há ninguém logado para abrir a tela:

```bash
node scripts/seed-usuarios.mjs            # simulação
node scripts/seed-usuarios.mjs --aplicar  # grava
```

Ele lê `secrets/usuarios-iniciais.json` (fora do git — ver
[`secrets/README.md`](secrets/README.md)), deriva o hash scrypt **na máquina**
e grava só o hash. Nenhuma senha em claro atravessa a rede, vai para o banco
ou aparece no terminal. Reexecutar redefine a senha de quem estiver no
arquivo — é assim que se atende a um "esqueci minha senha".

### Projetos: vêm do Clockrview

O Clockrview é a fonte oficial dos projetos. **Código, nome, cliente, líder e
ativo/inativo** vêm da API externa dele
(`GET https://clockrview.setegce.com/api/externo/projetos`, header `x-api-key`)
e, com exceção do líder, não se editam no NPS. O NPS continua dono do que o Clockrview não tem:
status da pesquisa (ativo, standby, em encerramento...), categoria, classe
contratual, serviço, segmento, escopo, vendedor e acesso.

O banco guarda um **espelho** dos projetos (`projetos_mestre_nps`), e não por
gosto: respostas, pesquisas, ciclos, ISC e histórico de liderança apontam para
o id do projeto, e é isso que mantém o NPS histórico ligado ao projeto certo.

A sincronização roda de dois jeitos:

- **pelo botão** *Sincronizar com Clockrview*, na tela de Projetos (só PMO).
  Primeiro mostra a prévia do que vai mudar; só grava quando o PMO confirma;
- **sozinha, todo dia às 06h** (cron da Vercel em `vercel.json`, rota
  `/api/cron/sincronizar-projetos`, protegida por `CRON_SECRET`).

Precisa de `CLOCKRVIEW_API_KEY` (e `CRON_SECRET`, para o cron) no
`.env.local` e nas variáveis de ambiente da Vercel.

Regras (`lib/sincronizarProjetos.ts`, testadas em `tests/clockrview.test.mjs`):

- **o código casa número a número.** `#0221-2-2025` (planilha antiga) e
  `0221-02-2025` (Clockrview) são o mesmo projeto, e o banco passa a guardar o
  formato do Clockrview;
- **não apaga nada.** Projeto que não está no Clockrview continua no banco;
  inativo no Clockrview vira inativo no NPS, com respostas preservadas;
- **projeto novo só entra se estiver ativo** no Clockrview, e **não entra em
  ciclo**. Participação em ciclo é decisão do PMO na tela de Ciclos;
- **líder casa pelo e-mail** (cadastro do líder, depois conta de acesso,
  depois nome) e **muda por `nps_alterar_lider`**, que fecha o período anterior
  — resposta antiga nunca muda de dono. Líder inativo no NPS não recebe o
  projeto: a prévia avisa para reativar. Líder novo é criado sem conta de
  acesso; a conta se cria na tela de Líderes;
- **o líder continua editável no NPS** (botão *Alterar líder*), porque a
  liderança muda antes de o Clockrview ser atualizado. A sincronização **não
  desfaz** essa troca: cada projeto guarda o último líder visto no Clockrview
  (`lider_clockrview`, migration 19) e o líder só é trocado quando o
  Clockrview muda. Vale a mudança mais recente, de qualquer lado. A prévia
  lista os projetos cujo líder foi mantido diferente do Clockrview;
- sem líder ou cliente no Clockrview, o NPS mantém o que já tinha.

O antigo `scripts/importar-planilha.mjs` está **desativado**: depois da
sincronização o banco guarda o código no formato do Clockrview e o importador
criaria duplicatas.

### Sincronizar os participantes de um ciclo

A sincronização acima cuida do cadastro, mas de propósito não mexe em ciclo. Para
fazer a lista de participantes de um ciclo bater com a planilha:

```bash
node scripts/sincronizar-ciclo.mjs "C:/.../CLIENTES_ATIVOS.csv" --ciclo=2026.2            # simulação
node scripts/sincronizar-ciclo.mjs "C:/.../CLIENTES_ATIVOS.csv" --ciclo=2026.2 --aplicar  # retira
node scripts/sincronizar-ciclo.mjs "C:/.../CLIENTES_ATIVOS.csv" --ciclo=2026.2 --aplicar --incluir
```

Ele **retira** do ciclo o projeto que não está na planilha, do mesmo jeito que
o PMO faz na tela: `nps_definir_participacao_ciclo` marca `ativo = false` e
grava na auditoria. A linha continua no banco e voltar é marcar de novo.

Três proteções embutidas:

- **projeto que já respondeu naquele ciclo não é retirado.** Tirar a
  participação de quem respondeu deixaria a resposta órfã do cadastro e mudaria
  o número do ciclo de lugar;
- **incluir é separado de aplicar.** `--aplicar` só retira; colocar projeto em
  ciclo aberto é decidir que aquele cliente será pesquisado, e isso é do PMO —
  por isso exige o `--incluir` explícito;
- **ciclo encerrado é recusado.** O passado não se reescreve.

Rodado em 21/09/2026 sobre o ciclo 2026.2, que tinha 19 projetos de edições
anteriores (`#0006-4-2024` ao lado do `#0006-5-2025` que o substituiu). Esse
ciclo foi excluído logo depois — o conteúdo dele era teste — e será criado de
novo quando abrir de verdade. Rode este script no ciclo novo antes de gerar as
pesquisas, que é quando a lista de participantes ainda pode ser corrigida sem
efeito nenhum.

> **Por que precisa da `service_role` até para testar?** O front não fala com o
> banco — quem fala é o servidor, e ele precisa dessa chave para autenticar no
> Supabase. Sem ela o site carrega, mas o login responde *"Falta configurar
> SUPABASE_SERVICE_ROLE_KEY no servidor"*.

### Erros comuns

| Sintoma | Causa |
|---|---|
| A aplicação não inicia, com erro sobre `NPS_SESSION_SECRET` | A variável não está no `.env.local`. É intencional: sem segredo não é seguro assinar sessões. |
| *"Falta configurar SUPABASE_SERVICE_ROLE_KEY"* | Idem, no `.env.local`. |
| *"A porta 3000 já está em uso"* | `npx kill-port 3000`, ou `npm run dev -- -p 3001`. |
| **Tela branca**, com 404 em todo CSS/JS no console | Alguém rodou `next build` com o `next dev` ligado: os dois escrevem em `.next` e o build apaga os chunks que o dev está servindo. Pare o dev, apague `.next`, suba de novo — e use `npm run build:verificar` da próxima vez. |
| Login recusa a senha certa | A senha é conferida no banco. Confirme que a `SUPABASE_URL` aponta para o projeto correto. |
| Voltou para o login sozinho | O acesso foi desativado ou a senha mudou: a sessão é revalidada no banco a cada requisição. |

---

## Perfis de acesso

O acesso é por **e-mail e senha**, uma conta por pessoa (`usuarios_nps`).
Antes a senha era a identidade — uma global do PMO e uma por líder,
compartilhadas: a auditoria registrava "Acesso como pmo" sem dizer quem, e
desligar alguém obrigava a trocar a senha de todos que a conheciam.

| | PMO | Líder |
|---|---|---|
| Dashboard NPS | todos os projetos | apenas os seus |
| Projetos | sincronizar com o Clockrview, trocar líder, editar os campos do NPS | somente leitura dos seus |
| Respondentes | cadastrar e vincular | leitura dos seus projetos |
| Pesquisas | gerar, copiar link, mudar status | copiar link das suas |
| Ciclos | criar, abrir, encerrar, passagem | — |
| Operação do ciclo | tudo | recorte próprio |
| ISC | acompanhar todos | registrar nos seus |
| Histórico / Auditoria | completo | apenas os próprios resultados |
| Acesso dos líderes | criar conta, redefinir senha, desativar e reativar (tela Líderes) | — |

Desativar o **acesso** (`usuarios_nps.ativo`) é diferente de inativar o
**cadastro** do líder (`lideres_nps.ativo`): o primeiro bloqueia o login na
requisição seguinte, o segundo tira o nome das listagens ativas e dos selects.
Nenhum dos dois apaga projeto, resposta ou histórico de liderança. Ninguém
desativa a própria conta — se fosse a última, não sobraria quem desfizesse.

A autorização é validada **no servidor**, em três camadas:

1. `middleware.ts` barra a rota pela assinatura do cookie (Edge, sem banco);
2. a página confere a sessão no banco (`lib/session.ts`);
3. a route handler confere de novo, e o recorte do líder é aplicado na consulta.

Esconder o menu é só conveniência: um líder que chame `/api/projetos` por fora
recebe `403`, e um que peça `?lider=<outro>` recebe os próprios projetos.

---

## Rotas

| Rota | Quem acessa |
|---|---|
| `/dashboard` | PMO e Líder |
| `/projetos`, `/projetos/[id]` | PMO |
| `/meus-projetos` | Líder |
| `/respondentes`, `/ciclos` | PMO |
| `/pesquisas` | PMO e Líder (o líder vê as suas) |
| `/operacao-ciclo`, `/clientes`, `/lideres`, `/historico` | PMO |
| `/isc` | PMO e Líder |
| `/resultados` | Líder |
| `/login` | público |
| `/pesquisa/[token]` | público, sem login |

---

## Segurança

| O que | Onde |
|---|---|
| Acesso por e-mail e senha, uma conta por pessoa | `usuarios_nps`, `lib/autenticar.ts` |
| Sessão em cookie `httpOnly`, JWT HS256 (`jose`), 12 h | `lib/token.ts` |
| Sessão revalidada no banco a cada requisição | `lib/session.ts` |
| Troca de senha derruba as sessões abertas | `lib/senha.ts` (`impressaoDaCredencial`) |
| Senha em scrypt, assíncrono, com migração transparente do texto plano | `lib/senha.ts`, `lib/autenticar.ts` |
| Freio de força bruta por IP + e-mail, contado no banco | `lib/rateLimit.ts` + migration 13 |
| Mesma resposta para e-mail inexistente, conta inativa e senha errada | `app/api/auth/login/route.ts` |
| Classificação de rotas do middleware, com teste | `lib/rotas.ts`, `tests/rotas.test.mjs` |
| CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy | `next.config.js` |
| Validação de todo dado vindo do cliente, com whitelist de ordenação | `lib/validacao.ts` |
| Nenhum recurso externo: fontes e ícones são do próprio site | `app/globals.css`, `componentes/Icone.tsx` |

O relatório em PDF e o jsPDF são carregados sob demanda (`import()`), só no
primeiro clique em "Exportar PDF" — fora do caminho crítico da página.

---

## Regras de negócio preservadas

- **NPS**: só Q4. Promotor 9–10, neutro 7–8, detrator 0–6. `round(%promo − %detr)`.
- **Cobertura**: projetos únicos com ≥1 resposta ÷ projetos elegíveis.
- **Indicadores são coisas diferentes**: projetos elegíveis ≠ projetos
  respondidos ≠ respondentes ≠ respostas.
- **ISC não entra no NPS.** É percepção interna do líder, exibida à parte.
- **Nada é apagado.** Projetos, pesquisas e participações em ciclo são
  inativados, nunca excluídos.
- **Respostas nunca são reatribuídas.** Trocar o líder abre um novo período no
  histórico; as respostas antigas continuam ligadas ao líder da época.
  Quem aplica isso na leitura é `escopoDoLider()` (`lib/session.ts`), que
  recorta por **participação no ciclo** (`projetos_nps.lider_id`) e não pelo
  líder de hoje (`projetos_mestre_nps.lider_id`). A diferença aparece quando a
  PMO passa um projeto adiante: `nps_alterar_lider` move só o ciclo mais
  recente, então o líder novo não herda o que foi colhido sob o anterior, e o
  anterior não perde de vista o próprio período.

Todas estão cobertas por teste em `tests/dashboard.test.mjs` e
`tests/resumo.test.mjs`.
