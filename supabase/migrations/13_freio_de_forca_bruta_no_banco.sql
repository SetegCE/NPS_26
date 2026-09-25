-- ============================================================================
-- MIGRATION 13 — FREIO DE FORÇA BRUTA CONTADO NO BANCO
--
-- STATUS: **PENDENTE — aplicar junto com a migration 12.**
--
-- ---------------------------------------------------------------------------
-- POR QUE ELA EXISTE
--
-- A versão anterior contava as tentativas de login num `Map` do processo
-- (api/_rotas/login.js). Isso faz sentido num servidor Node único, mas este
-- sistema roda na Vercel: cada invocação pode cair numa instância nova, e o
-- contador zera a cada cold start. Bastava espaçar as tentativas para nunca
-- bater no limite — ou seja, na prática o freio quase não existia, justamente
-- no ambiente em que mais importava.
--
-- No banco o contador é um só para todas as instâncias. É a mesma correção
-- que o SGA já aplicou (lib/rateLimit.ts + tabela TentativaLogin).
--
-- ---------------------------------------------------------------------------
-- POR QUE A CONTAGEM É UMA FUNÇÃO, E NÃO SELECT + UPDATE NA API
--
-- Ler o contador, somar 1 e gravar de volta a partir da aplicação abre uma
-- corrida: dez tentativas simultâneas leem "0 falhas" e todas gravam "1".
-- Um atacante que dispare em paralelo nunca acumula falhas. Aqui o
-- INSERT ... ON CONFLICT resolve tudo dentro de uma instrução, e o Postgres
-- serializa as concorrentes na mesma linha.
--
-- ---------------------------------------------------------------------------
-- O CUSTO
--
-- Duas consultas a mais no caminho do login (uma leitura antes, uma escrita
-- depois) e nenhuma em qualquer outra tela. Login é operação rara — ninguém
-- entra no sistema dez vezes por minuto —, então isso não aparece no uso do
-- dia a dia.
--
-- Como aplicar: cole o bloco abaixo no SQL Editor do painel do Supabase,
-- ou rode `supabase db push` se estiver usando a CLI.
-- ============================================================================

create table if not exists public.nps_tentativas_login (
  -- `ip::senha` não serve aqui: diferente do SGA, este sistema não tem
  -- usuário — a senha É a identidade. A chave é só o IP, então o freio é por
  -- origem da tentativa.
  chave              text        primary key,
  falhas             integer     not null default 0,
  primeira_falha_em  timestamptz not null default now(),
  bloqueado_ate      timestamptz,
  atualizado_em      timestamptz not null default now()
);

comment on table public.nps_tentativas_login is
  'Freio de força bruta do login, compartilhado por todas as instâncias serverless.';

alter table public.nps_tentativas_login enable  row level security;
alter table public.nps_tentativas_login force   row level security;
revoke all on public.nps_tentativas_login from anon, authenticated;

-- ── Parâmetros do freio ─────────────────────────────────────────────────────
--   janela de acumulação : 5 min
--   falhas até bloquear  : 5
--   duração do bloqueio  : 15 min
--   validade do registro : 24 h (varrido oportunisticamente)
--
-- Ficaram embutidos nas funções, e não numa tabela de configuração, porque
-- uma tabela a mais para guardar quatro números é complexidade sem uso: quem
-- muda esses valores mexe no código e roda a migration de novo.

/**
 * Segundos restantes de bloqueio para esta chave. 0 = liberado.
 * Não registra nada — só consulta.
 */
create or replace function public.nps_freio_login_verificar(p_chave text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, ceil(extract(epoch from (bloqueado_ate - now())))::integer)
    from public.nps_tentativas_login
   where chave = p_chave
     and bloqueado_ate is not null
     and bloqueado_ate > now();
$$;

/**
 * Registra uma tentativa que falhou e devolve o total de falhas na janela.
 *
 * Fora da janela de 5 minutos a contagem recomeça: cinco erros espalhados por
 * um mês são esquecimento, não ataque.
 */
create or replace function public.nps_freio_login_falha(p_chave text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_falhas integer;
begin
  insert into public.nps_tentativas_login as t (chave, falhas, primeira_falha_em, atualizado_em)
  values (p_chave, 1, now(), now())
  on conflict (chave) do update
    set falhas = case
          when now() - t.primeira_falha_em <= interval '5 minutes' then t.falhas + 1
          else 1
        end,
        primeira_falha_em = case
          when now() - t.primeira_falha_em <= interval '5 minutes' then t.primeira_falha_em
          else now()
        end,
        atualizado_em = now()
  returning t.falhas into v_falhas;

  if v_falhas >= 5 then
    update public.nps_tentativas_login
       set bloqueado_ate = now() + interval '15 minutes'
     where chave = p_chave;
  end if;

  -- Limpeza oportunista, só quando já se está escrevendo: sem isto a tabela
  -- cresceria para sempre com registros que não valem mais nada.
  delete from public.nps_tentativas_login
   where atualizado_em < now() - interval '24 hours';

  return v_falhas;
end $$;

/**
 * Login certo: zera o histórico daquela origem.
 *
 * Um acerto apaga a dívida de erros anteriores — não faz sentido penalizar
 * quem digitou errado duas vezes e acertou na terceira.
 */
create or replace function public.nps_freio_login_sucesso(p_chave text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.nps_tentativas_login where chave = p_chave;
$$;

-- Somente a service_role executa, como todas as funções nps_*.
revoke all on function public.nps_freio_login_verificar(text) from public, anon, authenticated;
revoke all on function public.nps_freio_login_falha(text)     from public, anon, authenticated;
revoke all on function public.nps_freio_login_sucesso(text)   from public, anon, authenticated;


-- ============================================================================
-- VERIFICAÇÃO — rode depois de aplicar.
-- ============================================================================
-- select public.nps_freio_login_verificar('teste');  -- deve voltar vazio/0
-- select public.nps_freio_login_falha('teste');      -- 1
-- select public.nps_freio_login_falha('teste');      -- 2
-- select public.nps_freio_login_sucesso('teste');
-- select * from public.nps_tentativas_login where chave = 'teste';  -- vazio


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- drop function if exists public.nps_freio_login_verificar(text);
-- drop function if exists public.nps_freio_login_falha(text);
-- drop function if exists public.nps_freio_login_sucesso(text);
-- drop table    if exists public.nps_tentativas_login;
