-- ============================================================================
-- MIGRATION 15 — LOGIN POR E-MAIL E SENHA
--
-- STATUS: **APLICADA** em 21/09/2026.
--
-- ---------------------------------------------------------------------------
-- POR QUE ELA EXISTE
--
-- Até aqui o sistema não tinha usuário: a SENHA era a identidade. Havia uma
-- senha global do PMO em `config_acesso` e uma senha por líder em
-- `acessos_lideres`. Três problemas práticos disso:
--
--  1. senha compartilhada não tem dono. A auditoria registrava "Acesso como
--     pmo", e não quem entrou;
--  2. desligar uma pessoa obrigava a trocar a senha de todo mundo que a
--     conhecia;
--  3. as 12 senhas estavam em TEXTO PLANO no banco, e a migration 12 (que
--     fecha a leitura pública) ainda não havia rodado — ou seja, eram
--     legíveis por quem tivesse a chave publicável.
--
-- Esta tabela resolve os três: cada pessoa tem e-mail próprio, a senha nasce
-- com hash scrypt e o papel é do usuário, não da senha.
--
-- ---------------------------------------------------------------------------
-- O QUE ACONTECE COM AS TABELAS ANTIGAS
--
-- `config_acesso` e `acessos_lideres` NÃO são apagadas nem alteradas aqui.
-- Elas deixam de ser consultadas pelo login (ver lib/autenticar.ts) e ficam
-- como registro histórico. Apagá-las é uma decisão à parte, para depois de o
-- novo acesso estar em uso e conferido.
--
-- Mesmo assim: a migration 12 continua necessária: enquanto ela não rodar,
-- as senhas antigas em texto plano seguem legíveis publicamente.
--
-- ---------------------------------------------------------------------------
-- POR QUE `papel` É TEXTO COM CHECK, E NÃO ENUM
--
-- O resto do sistema já fala 'pmo' e 'lider' (lib/token.ts, lib/session.ts,
-- as funções nps_*). Manter o mesmo vocabulário em texto evita converter tipo
-- em toda fronteira e mantém a autorização existente valendo sem uma linha de
-- mudança. Um enum daria a mesma garantia com mais atrito.
-- ============================================================================

create table if not exists public.usuarios_nps (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  email       text not null,
  -- Coluna normalizada e ÚNICA: é por ela que o login busca. Sem isto,
  -- "Fernando@Setegce.com" e "fernando@setegce.com" seriam contas diferentes,
  -- e o autocapitalize do celular viraria "credenciais inválidas".
  email_norm  text generated always as (lower(btrim(email))) stored unique,
  senha_hash  text not null,
  papel       text not null default 'lider',
  -- Amarra o usuário ao cadastro de líderes. É dele que sai o recorte
  -- "cada líder só vê os seus". Nulo para quem é pmo, que vê tudo.
  lider_id    uuid references public.lideres_nps(id) on delete set null,
  ativo       boolean not null default true,
  ultimo_acesso_em timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint usuarios_nps_papel_chk check (papel in ('pmo','lider')),
  constraint usuarios_nps_email_chk check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint usuarios_nps_nome_chk  check (btrim(nome) <> '')
);

comment on table public.usuarios_nps is
  'Contas de acesso ao Dashboard NPS: e-mail + senha. Substitui config_acesso (senha única do PMO) e acessos_lideres (senha por líder).';
comment on column public.usuarios_nps.senha_hash is
  'scrypt no formato scrypt$sal$derivada. NUNCA guardar senha em claro aqui.';
comment on column public.usuarios_nps.lider_id is
  'Cadastro em lideres_nps ao qual esta conta corresponde. Define o recorte do líder.';

create index if not exists usuarios_nps_lider_idx on public.usuarios_nps(lider_id);

-- updated_at automático, no mesmo padrão das demais tabelas.
create or replace function public.usuarios_nps_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists usuarios_nps_touch_tg on public.usuarios_nps;
create trigger usuarios_nps_touch_tg
  before update on public.usuarios_nps
  for each row execute function public.usuarios_nps_touch();

-- Fechada ao público desde o nascimento: só a service_role lê e escreve.
-- Não repetir aqui o erro que a migration 12 existe para corrigir.
alter table public.usuarios_nps enable row level security;
alter table public.usuarios_nps force  row level security;
revoke all on public.usuarios_nps from anon, authenticated;


-- ============================================================================
-- CARGA INICIAL
-- ============================================================================
-- Não fica aqui, de propósito: senha não entra em arquivo versionado.
-- Use o seed, que lê secrets/usuarios-iniciais.json e grava só o hash:
--
--     node scripts/seed-usuarios.mjs --aplicar


-- ============================================================================
-- VERIFICAÇÃO
-- ============================================================================
-- select nome, email, papel, ativo from public.usuarios_nps order by papel, nome;
-- -- senha_hash deve começar com 'scrypt$' em TODAS as linhas:
-- select count(*) filter (where senha_hash not like 'scrypt$%') as fora_do_padrao
--   from public.usuarios_nps;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- Reverter derruba o acesso de todo mundo: o login passou a depender desta
-- tabela. Só faz sentido se o deploy for revertido junto.
--
-- drop trigger if exists usuarios_nps_touch_tg on public.usuarios_nps;
-- drop function if exists public.usuarios_nps_touch();
-- drop table if exists public.usuarios_nps;
