# Dashboard NPS — Seteg Soluções Ambientais
## Documentação Técnica e Funcional

**Versão:** 12  
**Data:** Setembro 2026  
**Repositório:** https://github.com/lais-seteg/dashboard_nps

> **Versão 12 — Módulo de Gestão PMO.** Acrescenta ao dashboard existente a
> gestão operacional do PMO: projetos, respondentes, pesquisas com link
> individual, ciclos, ISC, histórico e auditoria. O dashboard de NPS e todos os
> seus cálculos continuam exatamente como estavam — o que mudou foi *de onde*
> ele lê os dados. Detalhes de arquitetura, deploy e perfis: [`README.md`](README.md).
>
> **Mudança estrutural:** o navegador não acessa mais o Supabase diretamente.
> Toda leitura e escrita passa por uma API em `/api` (Vercel Serverless), que
> valida sessão e perfil no servidor. As seções 2, 3 e 4 abaixo refletem isso.

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura Técnica](#2-arquitetura-técnica)
3. [Banco de Dados — Supabase](#3-banco-de-dados--supabase)
4. [Autenticação e Controle de Acesso](#4-autenticação-e-controle-de-acesso)
5. [Regras de Negócio](#5-regras-de-negócio)
6. [Estrutura do Dashboard — Gestão (Admin)](#6-estrutura-do-dashboard--gestão-admin)
7. [Estrutura do Dashboard — Líder](#7-estrutura-do-dashboard--líder)
8. [Filtros Disponíveis](#8-filtros-disponíveis)
9. [Exportação CSV](#9-exportação-csv)
10. [Relatório PDF](#10-relatório-pdf)
11. [Fluxo de Carregamento de Dados](#11-fluxo-de-carregamento-de-dados)
12. [Identidade Visual e Layout](#12-identidade-visual-e-layout)
13. [Matriz de Acesso Admin × Líder](#13-matriz-de-acesso-admin--líder)

---

## 1. Visão Geral

O **Dashboard NPS Seteg** é uma aplicação web de monitoramento em tempo real do Net Promoter Score dos projetos da Seteg Soluções Ambientais Ltda. Integra dados de pesquisas de satisfação de clientes com o universo oficial de projetos cadastrados, gerando análises por ciclo semestral, por líder, por tipo de serviço e por segmento.

### Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 (App Router) + React 18 + TypeScript; Tailwind disponível, CSS próprio preservado |
| Backend | Route handlers do Next (Node 20) sobre o PostgREST do Supabase |
| Banco de Dados | Supabase (PostgreSQL 17) — acessado **somente pelo servidor** |
| Autenticação | E-mail + senha (scrypt) verificados no servidor + JWT HS256 (`jose`) em cookie `httpOnly` |
| Geração de PDF | jsPDF empacotado no projeto, carregado sob demanda |
| Hospedagem | Vercel |

> Esta é a mesma pilha do **SGA Seteg**, e de propósito: mesmo padrão de
> sessão, mesmo endurecimento de cabeçalhos e a mesma separação entre o
> porteiro leve (middleware em Edge) e a checagem autoritativa (no banco).
>
> A única divergência deliberada é o hash de senha: o SGA usa bcrypt, aqui
> ficou scrypt. O motivo está em `lib/senha.ts` — as senhas já gravadas estão
> nesse formato e scrypt é memory-hard, então trocar alinharia a letra às
> custas da força real.

### Arquivos Principais

| Arquivo | Responsabilidade |
|---|---|
| `app/layout.tsx` | Documento raiz. A barra lateral **não** mora aqui |
| `app/(app)/layout.tsx` | Casca das telas internas; é onde a sessão é conferida no banco |
| `app/globals.css` | Estilos, paleta e responsividade (junção de dashboard.css + app.css) |
| `app/login/page.tsx` | Tela de acesso |
| `app/(app)/dashboard/*` | Dashboard NPS: KPIs, painéis, incidência, tabela, metodologia |
| `app/(app)/…/page.tsx` | Uma pasta por tela: projetos, respondentes, pesquisas, ciclos, operação, clientes, líderes, ISC, histórico |
| `app/pesquisa/[token]/*` | Formulário público da pesquisa, renderizado no servidor |
| `app/api/**/route.ts` | Uma rota por recurso da API |
| `componentes/` | Peças de interface: tabela, paginação, modal, toast, campos, estados |
| `componentes/telas/` | Uma tela administrativa por arquivo |
| `lib/token.ts` | Assinatura e verificação do cookie de sessão (`jose`) |
| `lib/session.ts` | Guardas de autorização; revalida a credencial no banco |
| `lib/senha.ts` | scrypt, comparação em tempo constante, impressão da credencial |
| `lib/autenticar.ts` | Login: busca por e-mail e confere a senha |
| `lib/rotas.ts` | Quais rotas são públicas e quais são exclusivas do PMO |
| `lib/rateLimit.ts` | Freio de força bruta, contado no banco |
| `lib/db.ts` | Cliente PostgREST e auditoria |
| `lib/validacao.ts` | Validação e saneamento de toda entrada (sem dependência do Next) |
| `lib/dashboard.ts` | Motor do NPS: casamento resposta↔projeto, canal, líder atual, métricas |
| `lib/cicloInicial.ts` | Em que ciclo o dashboard abre — o mais recente já iniciado e com resposta |
| `lib/cliente/` | Lado do navegador: cliente da API, hook de listagem, cache de auxiliares, PDF |
| `middleware.ts` | Porteiro em Edge: confere a assinatura do cookie |
| `next.config.js` | CSP, HSTS e demais cabeçalhos de segurança |
| `supabase/migrations/` | Migrations versionadas |
| `tests/*.test.mjs` | Testes de validação, sessão, recorte do líder e cálculo do NPS |

---

## 2. Arquitetura Técnica

```
┌──────────────────────────────────────────────────────────────┐
│                     Navegador do Usuário                      │
│                                                              │
│  /login                      tela de acesso                  │
│  /dashboard, /projetos…      telas internas (grupo "(app)")  │
│  /pesquisa/[token]           formulário público, sem login   │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS — cookie httpOnly de sessão
┌───────────────────────────▼──────────────────────────────────┐
│                middleware.ts — Edge Runtime                   │
│  Primeira barreira: confere só a ASSINATURA do cookie.        │
│  Não consulta o banco — é porteiro, não é a última palavra.   │
└───────────────────────────┬──────────────────────────────────┘
┌───────────────────────────▼──────────────────────────────────┐
│           Next.js — app/api/**/route.ts (Node)                │
│                                                              │
│  lib/session   revalida a credencial NO BANCO a cada chamada │
│  lib/validacao valida e sanitiza toda entrada                │
│  lib/dashboard casa resposta com projeto e calcula o NPS     │
│  rotas:        auth, dashboard, projetos, respondentes,      │
│                pesquisas, ciclos, operacao, clientes,        │
│                lideres, isc, historico, auditoria, responder │
└───────────────────────────┬──────────────────────────────────┘
                            │ service_role — nunca sai do servidor
┌───────────────────────────▼──────────────────────────────────┐
│                    Supabase (PostgreSQL)                      │
│                                                              │
│  Originais:  respostas_nps   projetos_nps                    │
│              config_acesso   acessos_lideres                 │
│  Novas:      clientes_nps    lideres_nps    ciclos_nps       │
│              projetos_mestre_nps   respondentes_nps          │
│              projeto_respondentes_nps   pesquisas_nps        │
│              projeto_lideranca_hist_nps  isc_nps             │
│              ciclo_transicao_nps         auditoria_nps       │
│              nps_tentativas_login  (freio de login)          │
│  Views:      vw_projetos_admin   vw_operacao_ciclo           │
│              vw_respostas_enriquecidas   vw_pesquisas        │
│  Funções:    regras de negócio atômicas (nps_*)              │
└──────────────────────────────────────────────────────────────┘
```

> **RLS fechada.** Nenhuma tabela tem policy para `anon` ou `authenticated`.
> A chave publicável do Supabase não dá mais acesso a nada e foi removida do
> front-end.

### Padrão de Chave Única de Projeto

Todo projeto é identificado pela chave:

```
chaveDoProjeto(item) → normalizar(ciclo) + '||' + normalizar(codigo_clockify)   [lib/dashboard.ts]
```

O `codigo_clockify` é o **identificador oficial** de cada projeto. Ele é a chave de vínculo entre `respostas_nps` e `projetos_nps`. Nenhum outro campo (nome, cliente) é usado como identificador primário.

---

## 3. Banco de Dados — Supabase

**URL:** `https://acpugxkikuzbvtjwxups.supabase.co`

### 3.1 Tabela `respostas_nps`

Armazena cada resposta recebida da pesquisa de satisfação.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | Identificador único |
| `identificador` | text | Nome da pessoa que respondeu |
| `nota_q1` | numeric (0–10) | Q1 — Nota Técnica / Desempenho |
| `nota_q2` | numeric (0–10) | Q2 — Relacionamento com a equipe |
| `nota_q3` | numeric (0–10) | Q3 — Efetividade da Comunicação |
| `nota_q4` | numeric (0–10) | **Q4 — Indicação (base do NPS)** |
| `feedback` | text | Comentário aberto do respondente |
| `timestamp` | timestamptz | Data e hora da resposta |
| `ciclo` | text | Ex: `2025.2`, `2026.1` |
| `canal_resposta` | text | Canal original informado |
| `origem` | text | Alias de `canal_resposta` |
| `codigo_clockify` | text | **Chave de vínculo com `projetos_nps`** |
| `cliente` | text | Campo auxiliar (fallback) |
| `lider` | text | Campo auxiliar (fallback) |
| `projeto` | text | Campo auxiliar (fallback) |

> **Nota:** Os campos `cliente`, `lider` e `projeto` em `respostas_nps` são usados apenas como fallback quando não há correspondência via `codigo_clockify` em `projetos_nps`. Os dados oficiais sempre vêm de `projetos_nps`.

### 3.2 Tabela `projetos_nps`

Universo oficial de projetos por ciclo. Define o denominador de todas as taxas de adesão.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | Identificador único |
| `ciclo` | text | Ex: `2025.2`, `2026.1` |
| `codigo_clockify` | text | **Identificador oficial do projeto** |
| `lider` | text | Líder responsável no ciclo |
| `cliente` | text | Nome do cliente |
| `projeto` | text | Nome do projeto |
| `classe_contratual` | text | A (> R$250k), B (R$50k–250k), C (≤ R$50k) |
| `tipo_servico` | text | Ex: Licenciamento Ambiental, ESG, Automação |
| `segmento_cliente` | text | Ex: Energia, Mineração, Agronegócio |

> **Nota:** O campo `lider_atual` **não existe na tabela** — ele é computado em runtime pela função `computeLiderAtual()`, que identifica o líder do ciclo mais recente para cada `codigo_clockify`. Isso garante que projetos migrados de líder sejam atribuídos corretamente.

### 3.3 Tabela `config_acesso`

Armazena a senha global de acesso à gestão/admin.

| Campo | Tipo | Descrição |
|---|---|---|
| `chave` | text PK | `senha_dashboard` |
| `valor` | text | Senha em texto plano |

### 3.4 Tabela `acessos_lideres`

Senhas individuais de cada líder.

| Campo | Tipo | Descrição |
|---|---|---|
| `lider` | text | Nome do líder (deve corresponder ao campo `lider` de `projetos_nps`) |
| `senha` | text | Senha legada — esvaziada no primeiro login de cada líder |
| `senha_hash` | text | Hash scrypt, gravado na migração transparente |
| `lider_id` | uuid | FK para `lideres_nps` |
| `ativo` | boolean | Se falso, login bloqueado |

### 3.5 Tabelas do Módulo PMO

Nenhuma tabela existente foi removida ou renomeada. As colunas acrescentadas às
tabelas antigas são todas nullable ou com default, de modo que as 73 linhas de
`projetos_nps` e as 76 de `respostas_nps` seguiram intactas.

| Tabela | Papel |
|---|---|
| `clientes_nps` | Cliente (empresa). Nome único por normalização |
| `lideres_nps` | Líder. Nome único por normalização |
| `ciclos_nps` | Ciclo semestral: `planejamento` · `aberto` · `encerrado` |
| `projetos_mestre_nps` | **Identidade estável do projeto**, uma linha por `codigo_clockify` |
| `projeto_lideranca_hist_nps` | Períodos de liderança (`iniciado_em` / `encerrado_em`) |
| `respondentes_nps` | Pessoa que responde. E-mail único quando informado |
| `projeto_respondentes_nps` | **Relação N:N** projeto ↔ respondente |
| `pesquisas_nps` | Pesquisa individual (projeto + respondente + tipo + ciclo), com token |
| `isc_nps` | ISC mensal. Único por `projeto_id + competencia` |
| `ciclo_transicao_nps` | Decisões de passagem entre ciclos, com motivo |
| `auditoria_nps` | Rastreabilidade das alterações administrativas |

**Papel de `projetos_nps` na v12.** Ela passou a ser explicitamente a
*participação do projeto em um ciclo* (uma linha por projeto × ciclo) e continua
sendo o denominador de todas as taxas. Ganhou `projeto_id`, `ciclo_id`,
`cliente_id`, `lider_id`, `categoria` e `elegivel`. A chave lógica que o
front-end já usava (`ciclo || codigo_clockify`) virou índice único de verdade.

**Views de leitura**

| View | Para que serve |
|---|---|
| `vw_projetos_admin` | Listagem de projetos com cliente, líder, ciclo, NPS e ISC |
| `vw_operacao_ciclo` | Uma linha por projeto × ciclo, com respondentes, pesquisas, respostas e situação |
| `vw_respostas_enriquecidas` | Resposta + categoria NPS + **líder do período da resposta** |
| `vw_pesquisas` | Pesquisa com projeto, cliente, líder e respondente já resolvidos |

**Funções de negócio** (atômicas, executáveis só pela `service_role`)

`nps_alterar_lider` · `nps_criar_projeto` · `nps_definir_ativo_projeto` ·
`nps_gerar_pesquisa` · `nps_responder_pesquisa` · `nps_registrar_isc` ·
`nps_definir_participacao_ciclo` · `nps_passagem_ciclo` ·
`nps_definir_status_ciclo` · `nps_auditar` · `nps_norm`

### 3.6 Migração dos Dados Existentes

Backfill executado sem apagar nada:

| Gerado a partir de | Resultado |
|---|---|
| `projetos_nps.ciclo` | 2 ciclos (2025.2 encerrado, 2026.1 aberto) |
| `projetos_nps.cliente` | 33 clientes |
| `projetos_nps.lider` + `acessos_lideres` | 13 líderes |
| `projetos_nps.codigo_clockify` | 54 projetos mestre (73 participações em 2 ciclos) |
| Sequência de líderes por ciclo | 65 períodos de liderança |
| `respostas_nps.identificador` | 63 respondentes |
| Quem respondeu o quê | 69 vínculos projeto ↔ respondente |

Zero registros órfãos: toda participação tem projeto e ciclo, toda resposta tem
respondente e projeto, todo projeto tem um período de liderança aberto.

---

## 4. Autenticação e Controle de Acesso

### 4.1 Tipos de Acesso

| Perfil | Como Acessa | O que Vê |
|---|---|---|
| **PMO / Gestão** | Senha global (`config_acesso`) | Todos os dados e todas as áreas administrativas |
| **Líder** | Senha individual (`acessos_lideres`) | Apenas os projetos sob sua responsabilidade **atual** |

As senhas são as mesmas de sempre — ninguém precisou trocar.

### 4.2 Fluxo de Login

1. O usuário digita a senha
2. O navegador envia `POST /api/login` — a senha **não** é comparada no cliente
3. O servidor confere contra `config_acesso` e depois `acessos_lideres`
4. Em caso de acerto, devolve um **token de sessão assinado** (HMAC-SHA256, validade de 12 h)
5. O token volta num cookie `httpOnly` — o JavaScript da página não o lê, então um XSS não rouba a sessão. O navegador o reenvia sozinho a cada chamada

**Migração transparente para hash.** As senhas estavam em texto plano. No
primeiro login de cada usuário, o servidor confere o texto plano, grava o hash
scrypt em `senha_hash` e limpa a coluna antiga. Nenhuma senha muda; após o
primeiro acesso de todos, não resta senha em texto plano no banco.

### 4.3 Proteção de Sessão

O token é um JWT HS256 assinado com `NPS_SESSION_SECRET` (variável de
ambiente, só no servidor). Ele carrega perfil, nome, `lider_id`, o id da
credencial usada e uma impressão digital da senha vigente. Qualquer alteração
na carga — por exemplo trocar `"perfil":"lider"` por `"perfil":"pmo"` —
invalida a assinatura e a sessão é recusada com `401`.

**O token vive num cookie `httpOnly`.** Nada é guardado em `localStorage`: o
JavaScript da página não consegue ler o cookie, então um XSS não rouba a
sessão. Também não há mais nenhum valor de perfil no navegador — o que a tela
desenha vem do servidor, por props, já reconferido no banco.

**A sessão é revalidada no banco a cada requisição** (`lib/session.ts`), e é
isso que faz duas coisas passarem a valer de imediato, sem esperar o token
expirar:

| Ação do PMO | Efeito |
|---|---|
| Desativar um acesso de líder | A próxima requisição dele cai para o login |
| Trocar a senha (do PMO ou de um líder) | Todas as sessões abertas com a senha antiga caem |

O segundo caso usa a impressão digital gravada no token: ela é um resumo do
*hash*, nunca da senha, e serve apenas para detectar que a credencial mudou.

**Freio de força bruta.** Cinco tentativas erradas do mesmo IP em cinco
minutos bloqueiam por quinze. O contador fica no banco
(`nps_tentativas_login`), não na memória do processo: na Vercel cada
invocação pode cair numa instância nova, e um contador em memória zerava a
cada cold start — ou seja, o freio anterior quase não existia. Se a consulta
do freio falhar, a tentativa é **permitida**: um limitador que derruba o login
inteiro quando o banco soluça é pior do que limitador nenhum.


### 4.4 Isolamento de Dados do Líder

O recorte do líder é aplicado **no servidor**, não no navegador:

- `/api/dashboard` resolve os projetos cujo `lider_id` é o da sessão e filtra
  projetos e respostas por esse conjunto
- Toda listagem administrativa aplica o mesmo recorte
- Endpoints de escrita exigem perfil PMO (`403` para líder), mesmo se chamados
  diretamente por fora da interface
- `nps_registrar_isc` revalida a titularidade do projeto dentro do próprio banco
- Esconder menus e botões continua existindo, mas apenas por conveniência

> **O que mudou na prática:** antes, o isolamento era cosmético — a chave
> publicável permitia ler toda a base, inclusive as senhas. Agora a chave
> pública não existe mais no front e a RLS está fechada.

### 4.5 Visibilidade após troca de líder

O líder enxerga os projetos sob responsabilidade **atual** (`projetos_mestre_nps.lider_id`).
Ao trocar o líder, o novo passa a ver o projeto e o anterior deixa de vê-lo como
ativo — mas as respostas já recebidas continuam atribuídas ao período de quem
era responsável na época (ver seção 5.7).

---

## 5. Regras de Negócio

### 5.1 Cálculo do NPS

```
NPS = Math.round((%Promotores) − (%Detratores))

Promotores: nota_q4 ∈ [9, 10]
Neutros:    nota_q4 ∈ [7, 8]
Detratores: nota_q4 ∈ [0, 6]
```

**Apenas Q4 entra no cálculo do NPS.** Q1, Q2 e Q3 são indicadores complementares.

Uma resposta só é considerada **válida** se `nota_q4` está presente e no intervalo [0, 10].

### 5.2 Classificação do NPS

| Faixa | Classificação |
|---|---|
| 75 a 100 | Excelência |
| 50 a 74 | Qualidade |
| 1 a 49 | Aperfeiçoamento |
| −100 a 0 | Zona Crítica |

### 5.3 Metas Estratégicas Seteg

| Meta | Valor | Descrição |
|---|---|---|
| NPS Mínimo | ≥ 90 | Índice NPS corporativo por ciclo |
| Taxa de Resposta | ≥ 75% | % de projetos únicos que responderam |

### 5.4 Contagem de Projetos Únicos

O **universo de projetos** vem de `projetos_nps`, só as linhas com `ativo = true`. Um projeto é único pela chave `ciclo||codigo_clockify`. O mesmo `codigo_clockify` em ciclos diferentes representa o mesmo projeto em períodos distintos.

Quando o PMO retira um projeto de um ciclo, `nps_definir_participacao_ciclo` não apaga a linha — marca `ativo = false` e registra na auditoria, para não perder o histórico. Por isso a consulta do dashboard filtra por `ativo`: sem o filtro, "retirar do ciclo" não retirava nada da tela e o projeto seguia no denominador do NPS.

Resposta de projeto retirado do ciclo continua aparecendo — ela cai no cliente/líder gravados na própria linha de `respostas_nps` (ver 5.8).

### 5.5 Canal da resposta

O canal vem de `respostas_nps.canal_resposta`, sempre. Não há mais regra de canal no código.

Havia: *"no ciclo 2026.1, até 11/05/2026 o envio foi por e-mail do PMO; dali em diante, pelos líderes"*. A regra **descartava** os 36 valores que o banco já gravava naquele ciclo e recalculava tudo pela data. Conferido linha a linha antes de tirar: a regra concordava 100% com o banco. As 4 linhas que estavam sem canal foram preenchidas pela migration 16 e a regra saiu.

A classificação é por conteúdo, não por lista fechada:

```
contém "MAIL"             → e-mail
contém "WHATS" ou "LIDER" → WhatsApp
qualquer outra coisa      → outro
```

O balde "outro" existe para que um canal novo — `LINK`, por exemplo, que o banco já grava — apareça no total em vez de sumir. O painel Origem soma os três e anota quantas vieram por outro canal.

### 5.6 Normalização de Texto

Todas as comparações de texto (nomes, clientes, projetos, líderes) passam por normalização canônica:

```javascript
normalizar(valor) →
  .normalize('NFD')           // decompõe caracteres acentuados
  .replace(acentos)           // remove diacríticos
  .replace(/\s+/g, ' ')       // colapsa espaços múltiplos
  .trim()
  .toUpperCase()
```

Isso garante que variações ortográficas (`MARCELO` vs `Marcelo`, `CEARÀ` vs `CEARÁ`) não gerem duplicatas.

### 5.7 Líder atual × líder do período

São duas coisas diferentes, e a distinção importa.

**Líder atual** — quem responde pelo projeto hoje. Vive em
`projetos_mestre_nps.lider_id` e define o que cada líder enxerga. No dashboard,
`computeLiderAtual()` continua calculando o mesmo valor a partir do ciclo mais
recente, para as análises comparativas entre ciclos.

**Líder do período** — quem respondia pelo projeto *na data da resposta*.
Resolvido por `vw_respostas_enriquecidas` contra `projeto_lideranca_hist_nps`.

> Uma resposta de 05/2026 num projeto que trocou de líder em 07/2026 continua
> associada ao líder anterior. **Respostas nunca são reatribuídas
> retroativamente** — é isso que o histórico por líder usa.

### 5.8 Troca de líder

Ao trocar o líder de um projeto (`nps_alterar_lider`), em uma única transação:

1. o período aberto é encerrado com `encerrado_em = agora`;
2. um novo período é aberto para o novo líder;
3. `projetos_mestre_nps.lider_id` é atualizado;
4. a participação no **ciclo mais recente** passa ao novo líder — ciclos
   anteriores ficam intactos;
5. a alteração é registrada em `auditoria_nps` com líder anterior, novo, data e
   autor.

Nenhuma resposta é tocada. Trocar para o mesmo líder é um no-op.

### 5.9 ISC — Índice de Satisfação do Cliente

Indicador **interno**, de 0 a 10, registrado mensalmente pelo líder.

| | NPS | ISC |
|---|---|---|
| Quem informa | o cliente | o líder |
| Origem | resposta da pesquisa (Q4) | registro mensal |
| Escala | −100 a +100 | 0 a 10 |

**O ISC não compõe nem altera o NPS.** São exibidos lado a lado, visualmente
separados, e há teste automatizado garantindo que registrar ISC não move o NPS.

Restrição: no máximo **um ISC por projeto por competência** (constraint única em
`projeto_id + competencia`, com a competência sempre normalizada para o dia 1).

### 5.10 Pesquisas e duplicidade

Uma pesquisa é a combinação **projeto + respondente + tipo + ciclo**. Maria
avaliando três projetos gera três pesquisas e três respostas independentes; três
pessoas avaliando um projeto também.

Antes de gerar, o sistema verifica se a combinação já existe. Se existir, avisa e
oferece três saídas ao PMO: ver a existente, copiar o link dela, ou gerar uma
nova mesmo assim. Nesse último caso a anterior é **encerrada, não apagada**.
Duplicidade nunca acontece em silêncio.

O link carrega um token aleatório de 32 bytes. O formulário público resolve
respondente, cliente, projeto, líder, tipo e ciclo **a partir do token** — o
respondente não escolhe nem altera nenhum desses dados, e um token só abre a
própria pesquisa.

### 5.8 Fallback de Dados

Quando uma resposta em `respostas_nps` não tem correspondência em `projetos_nps` via `codigo_clockify`, ela usa o cliente, o líder e o projeto gravados na **própria linha de resposta**. Também é banco: não há mais nenhuma tabela de cadastro embutida no código.

> **O que havia aqui.** `lib/mapeamentoLegado.ts`, com ~55 linhas de *nome de
> contato → cliente/líder/projeto*, para as respostas de 2025.2 colhidas antes
> de `projetos_mestre_nps` existir. Antes disso a lista morava em
> `dashboard.js`, baixada por qualquer navegador que abrisse o sistema — nomes
> de contato de cliente em texto puro no bundle.
>
> Depois da importação da planilha, as 78 respostas passaram a casar por
> `codigo_clockify` e o arquivo ficou sem uso. Foi removido: dado cadastral em
> código significa que corrigir um nome exige deploy, e o cadastro é do PMO,
> na tela.

### 5.9 Ciclos Disponíveis

Os ciclos vêm de `ciclos_nps` — não há lista de ciclos no código. O comparativo
usa sempre os **dois últimos ciclos cadastrados**, e o dashboard abre no ciclo
mais recente que já começou e tem resposta (`lib/cicloInicial.ts`).

Em 21/09/2026 o banco tinha 2025.2 e 2026.1, os dois encerrados. O 2026.2
chegou a existir com conteúdo de teste e foi excluído — será criado de novo
quando o ciclo abrir de fato.

**Sem ciclo aberto o sistema não quebra**, mas não gera pesquisa nova: os
formulários que precisam de um ciclo (`cicloAberto` em
`lib/cliente/auxiliares.ts`) ficam sem valor padrão e o cadastro de pesquisa
espera o PMO criar o próximo ciclo na tela de Ciclos.

---

## 6. Estrutura do Dashboard — Gestão (Admin)

O admin visualiza o dashboard completo com todas as seções ativas.

### 6.1 Barra de Status (Header)

- **Status de Conexão:** indicador verde pulsante quando conectado ao Supabase
- **Última Atualização:** horário e data da última renderização
- **Botão Metodologia:** abre modal com explicação completa do NPS Seteg
- **Botão Sair:** confirmação antes de encerrar sessão

### 6.2 Filtros (Admin — completos)

| Filtro | Campo | Valores |
|---|---|---|
| Ciclo | `ciclo` | Lista dinâmica de `ciclos_nps` (ou Todos) |
| Cliente | `cliente` | Lista dinâmica de `projetos_nps` |
| Líder | `lider_atual` | Lista dinâmica de `projetos_nps` |
| Projeto | `projeto` | Lista dinâmica de `projetos_nps` |
| Categoria | `categoria` | Promotor, Neutro, Detrator |
| Classe *(admin-only)* | `classe_contratual` | A, B, C |
| Serviço *(admin-only)* | `tipo_servico` | Lista dinâmica |
| Segmento *(admin-only)* | `segmento_cliente` | Lista dinâmica |
| Canal | `canal` | Email (PMO), WhatsApp (Via Líder), legados |

> O filtro de ciclo é inicializado automaticamente no ciclo mais recente disponível.

### 6.3 KPIs

| KPI | Descrição | Meta |
|---|---|---|
| NPS | Índice calculado de Q4 | ≥ 90 |
| Projetos Respondidos | % de projetos únicos com resposta válida | ≥ 75% |
| Promotores | Quantidade com nota Q4 ∈ [9,10] | — |
| Neutros | Quantidade com nota Q4 ∈ [7,8] | — |
| Detratores | Quantidade com nota Q4 ∈ [0,6] | — |

Cada KPI exibe badge verde **✓ Meta Atingida** ou vermelho **✗ Abaixo da Meta**.

### 6.4 Analytics Row (3 cards laterais)

**Card 1 — Metas Estratégicas**
- Termômetros verticais: NPS (escala −100 a +100) e Projetos (0–100%)
- Marcador visual da meta em cada termômetro
- Detalhe: X de Y projetos responderam

**Card 2 — Origem das Respostas**
- Termômetros verticais: Email vs WhatsApp
- Percentual e quantidade absoluta por canal

**Card 3 — Desempenho por Pergunta**
- Barras horizontais para Q1, Q2, Q3, Q4
- Score /10 com gradiente de cor (verde → amarelo → vermelho)

### 6.5 Comparativo de Ciclos

Exibe **sempre ambos os ciclos** (2025.2 e 2026.1), independente do filtro de ciclo ativo. Esta é a única seção que ignora o filtro de ciclo.

| Coluna | Descrição |
|---|---|
| Ciclo | 2025.2 / 2026.1 |
| Total Projetos | Projetos únicos em `projetos_nps` |
| Respondidos | Projetos com resposta válida |
| Não Respondidos | Total − Respondidos |
| Taxa (%) | Respondidos / Total |
| NPS | Índice NPS do ciclo |
| Promotores / Neutros / Detratores | Contagens |

Linha de evolução: diferença de NPS e taxa entre ciclos.

### 6.6 Incidência Comparativa de Respostas *(admin-only, recolhível)*

Compara cada projeto (por `codigo_clockify`) entre 2025.2 e 2026.1.

**Regra de exibição:**
- Filtro = `2026.1` ou sem filtro → exibe tabela de comparação
- Filtro = `2025.2` → exibe mensagem "Sem ciclo anterior disponível"

| Coluna | Descrição |
|---|---|
| Cliente | Nome do cliente |
| Projeto | Nome do projeto |
| Cód. Clockify | Identificador oficial |
| Líder | Líder atual do projeto |
| Elegível 2025.2 | Projeto cadastrado em `projetos_nps` no ciclo 2025.2 |
| Elegível 2026.1 | Projeto cadastrado em `projetos_nps` no ciclo 2026.1 |
| Respondeu 2025.2 | Possui resposta válida em 2025.2 |
| Respondeu 2026.1 | Possui resposta válida em 2026.1 |
| Análise da Resposta | Classificação automática (ver tabela abaixo) |

**Classificações da coluna Análise:**

| Classificação | Condição |
|---|---|
| Respondeu nos dois ciclos | Elegível e respondeu em 2025.2 e 2026.1 |
| Respondeu apenas em 2026.1 | Elegível em ambos, respondeu só em 2026.1 |
| Respondeu apenas em 2025.2 | Elegível em ambos, respondeu só em 2025.2 |
| Nunca respondeu | Elegível em ambos, sem resposta |
| Novo projeto em 2026.1 | Apenas em 2026.1 (não existia em 2025.2) |
| Projeto encerrado após 2025.2 | Apenas em 2025.2 (não continuou em 2026.1) |

### 6.7 Incidência de Resposta (Accordion)

Dois painéis recolhíveis com contagem de projetos:

**Painel "Responderam"**

| Coluna | Descrição |
|---|---|
| Ciclo | Ciclo da resposta |
| Cliente | Nome do cliente |
| Projeto | Nome do projeto |
| Líder | Responsável |
| Classe | Classe contratual |
| Tipo Serviço | Tipo de serviço |
| Cód. Clockify | Identificador |
| Respostas | Quantidade de respostas recebidas |
| Canal | EMAIL ou WHATSAPP |

**Painel "Não Responderam"**

Mesmas colunas, sem Respostas/Canal. Status: `Não respondeu`.

### 6.8 Análise por Líder *(admin-only, recolhível)*

Tabela consolidada de desempenho por líder no escopo atual:

| Coluna | Descrição |
|---|---|
| Líder | Nome do líder |
| Projetos | Total de projetos no escopo |
| Responderam | Projetos com resposta válida |
| Não Responderam | Projetos sem resposta |
| Taxa (%) | Responderam / Projetos |
| NPS | Índice NPS do líder |

Ordenada por Taxa decrescente.

**Card "Líderes sem adesão"** (exibido abaixo da tabela quando existirem):
- Lista os líderes com 0 respostas (possuem projetos mas não obtiveram nenhuma resposta)
- Exibe: nome do líder e "0 de N projetos"

### 6.9 Respostas Detalhadas

Tabela completa e paginável de todas as respostas no escopo filtrado.

| Coluna | Descrição |
|---|---|
| Nome | `identificador` do respondente |
| Cliente | Cliente do projeto |
| Líder | Líder responsável |
| Projeto | Nome do projeto |
| Q1 | Nota Técnica (0–10) |
| Q2 | Relacionamento (0–10) |
| Q3 | Comunicação (0–10) |
| Q4 | Indicação NPS (0–10) |
| Categoria | PROMOTOR / NEUTRO / DETRATOR |
| Feedback | Comentário (truncado — clique para ver completo) |
| Data | Timestamp formatado |
| Ações | Botão de detalhes completos |

**Paginação:** 10 / 25 / 50 / 100 itens por página. Navegação por primeira/anterior/número/próxima/última.

**Modal de Detalhes:** ao clicar no ícone, exibe todas as informações da resposta em tela cheia, incluindo feedback completo.

---

## 7. Estrutura do Dashboard — Líder

O líder acessa um dashboard personalizado, limitado aos seus próprios dados.

### 7.1 Diferenças Visuais

- **Mensagem de boas-vindas:** "Bem-vindo, [NOME DO LÍDER]" exibida no topo
- **Filtro de Líder:** oculto (o líder não pode filtrar por outros líderes)
- **Seções ocultas:** Análise por Líder, Incidência Comparativa, filtros de Classe/Serviço/Segmento

### 7.2 Seções Disponíveis para o Líder

| Seção | Disponível |
|---|---|
| KPIs | ✓ (dados do líder) |
| Metas Estratégicas | ✓ |
| Origem das Respostas | ✓ |
| Desempenho por Pergunta | ✓ |
| Comparativo de Ciclos | ✓ (dados do líder nos dois ciclos) |
| Incidência Comparativa | ✗ |
| Incidência de Resposta | ✓ (projetos do líder) |
| Análise por Líder | ✗ |
| Respostas Detalhadas | ✓ (respostas dos projetos do líder) |
| Exportação CSV | ✓ (dados do líder) |
| Exportação PDF | ✓ (relatório personalizado do líder) |

### 7.3 Filtros do Líder

Disponíveis: Ciclo, Cliente, Projeto, Categoria, Canal.  
Não disponíveis: Líder, Classe, Serviço, Segmento.

---

## 8. Filtros Disponíveis

### Ordem de Exibição na Barra de Filtros

1. Ciclo
2. Cliente
3. Líder
4. Projeto
5. Categoria
6. Classe *(admin-only)*
7. Serviço *(admin-only)*
8. Segmento *(admin-only)*
9. Canal
10. Botão Limpar

### Comportamento dos Filtros

- Todos os filtros são **cumulativos** (AND entre eles)
- **Exceção — Comparativo de Ciclos:** sempre mostra todos os ciclos, ignorando o filtro de ciclo
- Alteração em qualquer filtro recalcula imediatamente todas as métricas, tabelas e seções
- Botão **Limpar** restaura todos os filtros para "Todos" e re-renderiza

### Inicialização

- O filtro de Ciclo é inicializado automaticamente no **ciclo mais recente** disponível em `projetos_nps`
- Os demais filtros são populados dinamicamente a partir dos dados carregados

---

## 9. Exportação CSV

**Botão:** "Exportar CSV" na seção Respostas Detalhadas.

**Conteúdo:** respostas conforme os filtros ativos no momento da exportação.

**Colunas:**

```
Nome, Cliente, Líder, Projeto, Q1, Q2, Q3, Q4,
Categoria, Ciclo, Origem, Feedback, Data
```

**Formato:** UTF-8 com BOM (compatível com Excel), vírgula como separador, valores com aspas duplas.

**Nome do arquivo:** `nps_seteg_export_YYYY-MM-DD.csv`

---

## 10. Relatório PDF

Gerado pelo botão **"Exportar PDF"** na seção Respostas Detalhadas.

### Tipos de Relatório

| Tipo | Quando | Badge na Capa |
|---|---|---|
| Relatório Geral | Admin sem filtros | RELATÓRIO GERAL |
| Relatório Filtrado | Admin com filtros | RELATÓRIO FILTRADO |
| Relatório do Líder | Acesso de líder | RELATÓRIO DO LÍDER |

### Estrutura do PDF — Relatório de Gestão (Admin)

| Seção | Conteúdo |
|---|---|
| **Capa** | Logo Seteg, título, ciclos, filtros aplicados, data |
| **Sumário** | Índice numerado de todas as seções |
| **1. Apresentação e Metodologia** | O que é NPS, classificações, fórmula, faixas, metas Seteg, questionário |
| **2. Resumo Executivo** | Status geral, metas atingidas/não atingidas, achados, recomendações |
| **3. Comparativo entre Ciclos** | Tabela comparativa 2025.2 vs 2026.1 (sempre ambos, ignora filtro de ciclo) |
| **4. Incidência Comparativa de Respostas** | Comparação projeto a projeto por `codigo_clockify` entre ciclos |
| **5. Segmentações** | 5.1 Por Classe Contratual · 5.2.1 Por Tipo de Serviço · 5.2.2 Por Segmento · 5.3 Incidência |
| **6. Clientes que Responderam e Não Responderam** | Blocos A (responderam) e B (não responderam) |
| **7. Análise de Canais** | Distribuição Email × WhatsApp |
| **8. Quadro de NPS de Clientes e Respostas** | Listagem completa nome/projeto/notas/categoria |
| **9. Metas e Performance** | Cards de meta NPS e taxa com barras de progresso |
| **10. Detalhamento por Dimensão** | Scores Q1–Q4 com classificação e análise |
| **11. Análise Geral** | Contexto geral, distribuição, tabela por líder, cards melhor/pior, líderes sem adesão |
| **Encerramento** | Página "Obrigada" |

### Estrutura do PDF — Relatório do Líder

Versão simplificada, sem seções de gestão:

| Seção | Conteúdo |
|---|---|
| Capa | Com badge "RELATÓRIO DO LÍDER" e nome |
| Sumário | 7 itens (sem comparativo, segmentações, canais) |
| Apresentação e Metodologia | Idem |
| Resumo Executivo | Sem "Recomendações" |
| Clientes que Responderam / Não Responderam | Apenas projetos do líder |
| Quadro de NPS de Clientes e Respostas | Idem |
| Metas e Performance | Idem |
| Detalhamento por Dimensão | Idem |
| Análise Geral | Sem líderes sem adesão, seção "Resultado do Líder" |

### Lógica dos Cards de Líder no PDF

**Card Verde — Melhor Resultado:**
- Critério 1: maior NPS
- Critério 2 (empate): maior taxa de resposta
- Ignora líderes com 0 respostas

**Card Vermelho — Ponto de Atenção:**
- Critério 1: menor NPS
- Critério 2 (empate): menor taxa de resposta
- Ignora líderes com 0 respostas

**Tabela Líderes sem Adesão:**
- Líderes com `responderam = 0` e `totalProj > 0`
- Exibida apenas no relatório geral (não no relatório do líder)

---

## 11. Fluxo de Carregamento de Dados

```
INÍCIO
  │
  ├─► Fase 1 (síncrona): Carregar projetos_nps
  │     • Filtrado por lider (se perfil líder)
  │     • Computa lider_atual para cada codigo_clockify
  │     • Determina ciclo mais recente disponível
  │
  ├─► Fase 2 (síncrona): Carregar respostas_nps
  │     • Filtrado ao ciclo mais recente
  │     • Filtrado por codigo_clockify do líder (se perfil líder)
  │     • processData(): vincula com projetos_nps, infere ciclo/canal
  │
  ├─► Renderização inicial
  │     • KPIs, filtros, tabelas
  │     • Filtro de ciclo inicializado no mais recente
  │
  └─► Fase 3 (background / lazy): Carregar ciclos anteriores
        • respostas_nps ciclos != ciclo_recente
        • Mescla com dados já carregados
        • Re-renderiza mantendo filtros ativos
```

---

## 12. Identidade Visual e Layout

### Paleta de Cores

| Variável | Hex | Uso |
|---|---|---|
| `--seteg-dark-blue` | `#071D49` | Fundo, headers, elementos primários |
| `--seteg-medium-blue` | `#2C5697` | Destaques, botões, bordas |
| `--seteg-orange` | `#FF8200` | Acento, bordas de seção, CTAs |
| `--seteg-yellow` | `#FBE122` | Neutros, avisos, NPS médio |
| `--seteg-green` | `#6CC24A` | Promotores, metas atingidas, positivo |
| `--danger` | `#FF6B6B` | Detratores, erros, negativo |

### Categorias de Respostas

| Categoria | Cor |
|---|---|
| PROMOTOR | Verde (`#6CC24A`) |
| NEUTRO | Amarelo (`#FBE122`) |
| DETRATOR | Vermelho (`#FF6B6B`) |

### Responsividade

O layout é responsivo, com breakpoints em 1400px, 1280px, 1080px, 900px, 768px, 600px e 480px. Em telas menores, filtros e KPIs reorganizam-se em grade reduzida.

### Seções Recolhíveis

As seções **Incidência Comparativa de Respostas** e **Análise por Líder** são recolhíveis (clique no cabeçalho). Ficam expandidas por padrão. O estado recolhido não afeta os dados nem os cálculos.

---

## 13. Matriz de Acesso Admin × Líder

| Recurso | Admin | Líder |
|---|---|---|
| Dados de todos os líderes | ✓ | ✗ |
| Dados próprios | ✓ | ✓ |
| Filtro: Ciclo | ✓ | ✓ |
| Filtro: Cliente | ✓ | ✓ |
| Filtro: Líder | ✓ | ✗ |
| Filtro: Projeto | ✓ | ✓ |
| Filtro: Categoria | ✓ | ✓ |
| Filtro: Classe Contratual | ✓ | ✗ |
| Filtro: Tipo de Serviço | ✓ | ✗ |
| Filtro: Segmento | ✓ | ✗ |
| Filtro: Canal | ✓ | ✓ |
| Seção: Comparativo de Ciclos | ✓ | ✓ |
| Seção: Incidência Comparativa | ✓ | ✗ |
| Seção: Incidência de Resposta | ✓ | ✓ |
| Seção: Análise por Líder | ✓ | ✗ |
| Seção: Respostas Detalhadas | ✓ | ✓ |
| Exportação CSV | ✓ | ✓ |
| PDF: Comparativo entre Ciclos | ✓ | ✗ |
| PDF: Incidência Comparativa | ✓ | ✗ |
| PDF: Segmentações | ✓ | ✗ |
| PDF: Análise de Canais | ✓ | ✗ |
| PDF: Recomendações | ✓ | ✗ |
| PDF: Líderes sem Adesão | ✓ | ✗ |
| PDF: Análise por Líder | ✓ | ✓ (apenas o próprio) |

---

*Documento gerado em Junho de 2026. Seteg Soluções Ambientais Ltda — uso interno.*
