# Deploy — Dashboard NPS no servidor próprio

Segue o mesmo padrão do Clockrview (`0000-1-2026--clockrview/DEPLOY.md`):

- Windows com **Node.js 20 LTS**, **Git** e **cloudflared**;
- o app roda com `npm start` (`next start`) em HTTP numa porta local;
- **Postgres compartilhado** do servidor (porta 5432, banco `7station`), com
  **um schema por sistema** — o NPS usa o schema `nps`;
- HTTPS e domínio fixo pelo **túnel nomeado da Cloudflare**
  (`nps.setegce.com` → `http://localhost:<PORT>`);
- tarefas periódicas pelo **Agendador de Tarefas do Windows**;
- backup diário do Postgres (o schema `nps` precisa entrar no script de backup).

O código fala direto com o Postgres (`lib/dbPostgres.ts`) quando
`DATABASE_URL` está definida. Não há dependência do Supabase no servidor.

---

## 1. Primeira instalação

```powershell
cd "C:\Users\ricardo.ti\dev\SETEG MEMORIA"
git clone https://github.com/lais-seteg/NPS_26.git
cd NPS_26
npm install
```

Crie o `.env` a partir do `.env.example` e preencha:

| Variável | Valor no servidor |
|---|---|
| `DATABASE_URL` | `postgresql://7station:<senha>@localhost:5432/7station` |
| `DATABASE_SCHEMA` | `nps` |
| `DATABASE_SSL` | (vazio — Postgres local, sem SSL) |
| `PORT` | uma porta livre, ex. `3020` (o Clockrview usa a 3000) |
| `NPS_SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CLOCKRVIEW_API_URL` / `CLOCKRVIEW_API_KEY` | API externa do Clockrview |
| `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `NPS_LOG_SINCRONIZACAO` | (opcional) caminho do log da tarefa agendada |

> `DATABASE_URL` preenchida faz o sistema **ignorar** `SUPABASE_URL` e
> `SUPABASE_SERVICE_ROLE_KEY` — não precisam existir no servidor.

---

## 2. Banco: migrar do Supabase para o schema `nps`

Use o **pg_dump/psql da versão 17** (o Supabase roda PostgreSQL 17.6).
Connection string do Supabase: painel → Connect → *Session pooler*.

### 2.1 Exportar do Supabase

As tabelas `config_acesso` e `acessos_lideres` **ficam de fora**: guardam as
senhas antigas em texto puro, e nenhum código, função ou view as usa mais (o
login é `usuarios_nps`, com senha em hash). `--no-privileges` também deixa de
fora as permissões públicas do Supabase (`anon`, `authenticated`).

```powershell
$SUPA = "postgresql://postgres.acpugxkikuzbvtjwxups:<senha>@<host>.pooler.supabase.com:5432/postgres"
$EXCLUIR = "--exclude-table=public.config_acesso", "--exclude-table=public.acessos_lideres"

pg_dump $SUPA --schema=public --schema-only --no-owner --no-privileges @EXCLUIR -f estrutura.sql
pg_dump $SUPA --schema=public --data-only   --no-owner --no-privileges @EXCLUIR -f dados.sql
```

> Congele o sistema antigo (ninguém respondendo pesquisa) entre este passo e a
> virada do domínio, para nenhuma resposta ficar para trás.

### 2.2 Converter para o schema `nps`

```powershell
node scripts\converter-dump-schema.mjs estrutura.sql dados.sql nps
node scripts\converter-dump-schema.mjs supabase\migrations\13_freio_de_forca_bruta_no_banco.sql - nps
```

Gera `estrutura.nps.sql`, `dados.nps.sql` e a migration 13 convertida. O
script troca `public.` por `nps.` na estrutura, ajusta o `search_path` fixado
nas funções e, nos dados, mexe **só** nas linhas `COPY` (o conteúdo das
respostas nunca é alterado). Se ele listar linhas para conferir, olhe antes
de seguir.

### 2.3 Extensões

As funções `nps_*` usam o `pgcrypto` (tokens das pesquisas) e o `uuid-ossp`.
Extensão é uma por banco: confira se já existem no `7station`.

```sql
select extname, extnamespace::regnamespace from pg_extension;
-- se faltarem:
create schema if not exists extensions;
create extension if not exists pgcrypto   schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
```

O `search_path` das funções convertidas é `nps, extensions, public`, então
elas acham as extensões em `extensions` ou em `public`.

### 2.4 Restaurar

```powershell
$LOCAL = "postgresql://7station:<senha>@localhost:5432/7station"
psql $LOCAL -v ON_ERROR_STOP=1 -f estrutura.nps.sql
psql $LOCAL -v ON_ERROR_STOP=1 -f dados.nps.sql
psql $LOCAL -v ON_ERROR_STOP=1 -f supabase\migrations\13_freio_de_forca_bruta_no_banco.nps.sql
```

A migration 13 cria o freio de força bruta do login (contagem de tentativas no
banco). A 12 não é necessária: ela só fechava o acesso público do Supabase,
que não existe no servidor, e as tabelas de senha antigas já ficaram de fora.

### 2.5 Conferir que nada se perdeu

```powershell
npm run check
```

Compare a contagem de linhas de cada tabela na origem e no destino (tem que
ser idêntica):

```sql
select 'respostas_nps', count(*) from nps.respostas_nps union all
select 'pesquisas_nps', count(*) from nps.pesquisas_nps union all
select 'projetos_mestre_nps', count(*) from nps.projetos_mestre_nps union all
select 'projetos_nps', count(*) from nps.projetos_nps union all
select 'respondentes_nps', count(*) from nps.respondentes_nps union all
select 'projeto_respondentes_nps', count(*) from nps.projeto_respondentes_nps union all
select 'clientes_nps', count(*) from nps.clientes_nps union all
select 'lideres_nps', count(*) from nps.lideres_nps union all
select 'ciclos_nps', count(*) from nps.ciclos_nps union all
select 'isc_nps', count(*) from nps.isc_nps union all
select 'projeto_lideranca_hist_nps', count(*) from nps.projeto_lideranca_hist_nps union all
select 'ciclo_transicao_nps', count(*) from nps.ciclo_transicao_nps union all
select 'auditoria_nps', count(*) from nps.auditoria_nps union all
select 'usuarios_nps', count(*) from nps.usuarios_nps;
```

(No Supabase, a mesma consulta trocando `nps.` por `public.`.)

---

## 3. Subir o app

```powershell
npm run build
npm start          # escuta na PORT do .env
```

Teste em `http://localhost:<PORT>`: login, dashboard, gerar e abrir um link de
pesquisa.

---

## 4. Domínio (túnel Cloudflare)

Túnel nomeado `nps`, como o do Clockrview
(`C:\Users\ricardo.ti\.cloudflared\config-clockrview.yml` de modelo):

```yaml
# C:\Users\ricardo.ti\.cloudflared\config-nps.yml
tunnel: nps
credentials-file: C:\Users\ricardo.ti\.cloudflared\<id-do-tunel>.json
ingress:
  - hostname: nps.setegce.com
    service: http://localhost:3020
  - service: http_status:404
```

A Cloudflare termina o HTTPS. Os links de pesquisa são montados a partir do
domínio de quem acessou (`lib/link.ts`), então saem com `https://nps.setegce.com`
sem configuração extra.

---

## 5. Tarefa agendada — sincronização com o Clockrview

Substitui o cron da Vercel. O script chama a rota do próprio app
(`/api/cron/sincronizar-projetos`) com o `CRON_SECRET`, então o app precisa
estar no ar.

- **Nome:** `nps-sincronizar-projetos`
- **Gatilho:** diariamente, 06:00
- **Ação:** `node.exe "C:\Users\ricardo.ti\dev\SETEG MEMORIA\NPS_26\scripts\sincronizar-projetos-agendado.mjs"`
- **Diretório de trabalho:** `C:\Users\ricardo.ti\dev\SETEG MEMORIA\NPS_26`

Teste manual: `npm run sincronizar:agendado`.

---

## 6. Backup

Incluir o schema `nps` no `C:\Users\ricardo.ti\backup-postgres-seteg.ps1`
(backup diário das 3h enviado ao SharePoint), como foi feito com `clockrview`
e `folgas`.

---

## 7. Atualizar uma versão já instalada

```powershell
git pull
npm install
npm run build
# reiniciar o processo do npm start
```

Antes de publicar: `npx tsc --noEmit`, `npm test` e um login de teste.

---

## Validar o motor Postgres antes da virada (opcional)

Com o Supabase ainda como banco, dá para provar que o motor Postgres devolve o
mesmo que o antigo: preencha no `.env.local` a `DATABASE_URL` do Supabase
(Session pooler, `DATABASE_SSL=true`) **mantendo** `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY`, e rode:

```powershell
npm run comparar:motores
```
