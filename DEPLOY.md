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
A estrutura do banco está em `banco/estrutura.sql`.

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

## 2. Banco: levar os dados do Supabase para o schema `nps`

Detalhes em [`banco/README.md`](banco/README.md). Não precisa de `pg_dump` nem
de `psql`: os dois passos são scripts do próprio projeto, e o fluxo foi
validado num PostgreSQL 17 local com banco `7station` e schema `nps` (as
1.213 linhas saíram idênticas às do Supabase).

### 2.1 Congelar o sistema atual

Entre a exportação e a virada do domínio ninguém gera pesquisa, sincroniza,
edita cadastro ou responde — senão a gravação fica no Supabase. Hoje só o
próprio app grava no banco (não há integração externa escrevendo nele).

### 2.2 Exportar (na máquina que alcança o Supabase)

```powershell
npm run banco:exportar
```

Gera `backup/dados-nps-AAAA-MM-DD.sql`. Esse arquivo tem dado pessoal, hashes
de senha e os tokens dos links de pesquisa: leve ao servidor por meio interno
(pasta de rede, SharePoint restrito). **Nunca** por e-mail, chat ou Git — o
repositório é público.

### 2.3 Extensões

As funções usam `pgcrypto` (token dos links) e `uuid-ossp`. O restaurar tenta
criá-las no schema `extensions`; se o usuário `7station` não tiver permissão,
um administrador roda antes:

```sql
create schema if not exists extensions;
create extension if not exists pgcrypto   schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
```

(Se já existirem em outro schema do `7station`, tudo bem: o `search_path` das
funções é `nps, extensions, public`.)

### 2.4 Restaurar (no servidor, com o `.env` do passo 1)

```powershell
npm run banco:restaurar -- backupdados-nps-AAAA-MM-DD.sql
npm run check
```

Carrega a estrutura (`banco/estrutura.sql`), a migration 13 (freio de força
bruta do login) e os dados, convertendo tudo para o schema do `DATABASE_SCHEMA`,
e confere a contagem de cada tabela. Recusa rodar se o schema já tiver tabelas
do NPS.

Ficam de fora de propósito as tabelas `config_acesso` e `acessos_lideres`
(senhas antigas em texto puro, sem uso) e as permissões públicas do Supabase.

### 2.5 Dois cuidados do servidor

- **Fuso horário:** o app fixa a sessão do banco em UTC, como no Supabase (o
  canal E-mail/WhatsApp sai de `now()::date`). Nada a configurar.
- **Ordem alfabética (collation):** o Supabase ordena como `en_US`. Um banco
  criado com `locale=C` ordena acentos e maiúsculas de outro jeito — muda só a
  ordem das listas, nunca os dados. Se for criar um banco novo em vez de usar
  o `7station`, prefira `locale_provider icu icu_locale 'en-US'`.

### 2.6 Alternativa com pg_dump

Se preferir o dump nativo: `pg_dump` 17 do Supabase com
`--schema=public --no-owner --no-privileges` e
`--exclude-table=public.config_acesso --exclude-table=public.acessos_lideres`,
depois `node scripts/converter-dump-schema.mjs estrutura.sql dados.sql nps` e
`psql` nos arquivos gerados. O caminho dos scripts acima é o validado.

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
