# banco/

Estrutura completa do banco do Dashboard NPS, pronta para montar o servidor
próprio.

| Arquivo | O que é | Vai para o Git? |
|---|---|---|
| `estrutura.sql` | 14 tabelas, índices, 25 chaves estrangeiras, 18 funções, 4 views e 11 triggers, extraídos do Supabase (PostgreSQL 17.6) com as migrations 01–19 aplicadas | **Sim** — não tem dado nem segredo |
| `backup/dados-<schema>-AAAA-MM-DD.sql` | Os dados, gerados por `npm run banco:exportar` | **Nunca** — tem nome/e-mail/telefone de respondentes, respostas, hashes de senha e os tokens dos links de pesquisa. `backup/` está no `.gitignore` e o repositório é público |

## Fluxo

```powershell
# 1. Na máquina que alcança o Supabase (usa SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
npm run banco:exportar            # gera backup/dados-nps-AAAA-MM-DD.sql

# 2. Leve o arquivo ao servidor por meio interno (pasta de rede, SharePoint
#    restrito). Não por e-mail, chat ou Git.

# 3. No servidor, com DATABASE_URL e DATABASE_SCHEMA=nps no .env:
npm run banco:restaurar -- backup\dados-nps-AAAA-MM-DD.sql
```

O `banco:restaurar` converte a estrutura e as migrations 13 (freio de login),
20 (plano de ação) e 21 (evidência da ação) para o schema do `.env` em memória, carrega estrutura →
migrations → dados numa ordem que
respeita as chaves estrangeiras e confere a contagem de cada tabela. Ele
**recusa** rodar se o schema já tiver tabelas do NPS.

## O que fica de fora de propósito

- `config_acesso` e `acessos_lideres` — senhas antigas em texto puro; nada no
  código novo usa.
- Permissões e RLS do Supabase (`anon`, `authenticated`) — no servidor só o app
  acessa o banco.
- `rls_auto_enable` — função interna do Supabase.

## Como os dados entram sem mudar nada

- Cada tabela vai como JSON convertido pelo próprio Postgres
  (`json_populate_recordset`), com o tipo exato de cada coluna.
- As 6 colunas calculadas (`nome_norm`, `codigo_norm`, `email_norm`) ficam de
  fora da carga: o Postgres recalcula.
- Os triggers ficam desligados durante a carga — senão o
  `nps_canal_pela_janela` preencheria o canal de 36 respostas antigas que hoje
  estão sem canal, e o `updated_at` seria reescrito.
- `pesquisas_nps` e `respostas_nps` apontam uma para a outra: a pesquisa entra
  sem `resposta_id` e o vínculo é refeito no fim.
- Tudo numa transação: carrega inteiro ou não carrega nada.

## Validação feita em 2026-09-25

Restaurado num PostgreSQL 17 local, banco `7station`, schema `nps`:
as 1.213 linhas das 14 tabelas saíram **idênticas campo a campo** às do
Supabase (lidas pelo próprio app, pelos dois motores); gerar pesquisa, abrir o
link, responder e recusar resposta repetida funcionaram; o app Next rodando
sobre esse banco abriu um link real de pesquisa.
