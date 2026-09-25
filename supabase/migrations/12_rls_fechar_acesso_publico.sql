-- ============================================================================
-- MIGRATION 12 — FECHAMENTO DO ACESSO PÚBLICO AO BANCO (itens 27 e 35)
--
-- STATUS: **PENDENTE — ainda não aplicada.**
-- As migrations 01 a 11 já foram aplicadas no projeto NPS_2026
-- (acpugxkikuzbvtjwxups). Esta é a única que falta.
--
-- ---------------------------------------------------------------------------
-- POR QUE ELA EXISTE
--
-- Antes: toda tabela tinha `SELECT using(true)` para o papel `public`,
-- inclusive `config_acesso` e `acessos_lideres`. Como a chave publicável
-- estava embutida no dashboard.js servido ao navegador, qualquer pessoa
-- conseguia ler a senha do admin e as 11 senhas dos líderes em texto plano.
--
-- Depois: nenhum acesso anônimo ao banco. Todo dado passa pela API em /api,
-- que usa a service_role (exclusiva do servidor) e valida sessão e perfil a
-- cada chamada. A service_role ignora RLS, então a API segue funcionando.
--
-- ---------------------------------------------------------------------------
-- QUANDO APLICAR — A ORDEM IMPORTA
--
-- No instante em que esta migration roda, qualquer versão antiga do front que
-- ainda fale direto com o Supabase para de funcionar. Por isso:
--
--   1. Configure as variáveis de ambiente na Vercel (ver README):
--        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NPS_SESSION_SECRET
--   2. Faça o deploy desta versão do código.
--   3. Confirme que o login e o dashboard funcionam em produção.
--   4. SÓ ENTÃO aplique esta migration.
--
-- Entre os passos 2 e 4 o sistema funciona nos dois modos, então não há
-- janela de indisponibilidade.
--
-- Como aplicar: cole o bloco abaixo no SQL Editor do painel do Supabase,
-- ou rode `supabase db push` se estiver usando a CLI.
-- ============================================================================

-- 1. Remove as policies permissivas das tabelas originais
drop policy if exists "Leitura pública"                          on public.respostas_nps;
drop policy if exists "Leitura pública"                          on public.projetos_nps;
drop policy if exists "Leitura pública"                          on public.config_acesso;
drop policy if exists "Leitura pública da senha"                 on public.config_acesso;
drop policy if exists "Apenas autenticados leem config"          on public.config_acesso;
drop policy if exists "Bloquear escrita pública"                 on public.config_acesso;
drop policy if exists "Leitura pública"                          on public.acessos_lideres;
drop policy if exists "Permitir leitura dos acessos dos líderes" on public.acessos_lideres;

-- 2. RLS ligada e sem policy alguma em tudo
--    (nega anon e authenticated por padrão; service_role continua passando)
do $$
declare t text;
begin
  foreach t in array array[
    'respostas_nps','projetos_nps','config_acesso','acessos_lideres',
    'clientes_nps','lideres_nps','ciclos_nps','projetos_mestre_nps',
    'projeto_lideranca_hist_nps','respondentes_nps','projeto_respondentes_nps',
    'pesquisas_nps','isc_nps','ciclo_transicao_nps','auditoria_nps'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 3. Views também ficam inacessíveis ao público.
--    Views executam com os privilégios do dono, então RLS nas tabelas de base
--    não bastaria: é preciso revogar o SELECT da própria view.
revoke all on public.vw_projetos_admin         from anon, authenticated;
revoke all on public.vw_operacao_ciclo         from anon, authenticated;
revoke all on public.vw_respostas_enriquecidas from anon, authenticated;
revoke all on public.vw_pesquisas              from anon, authenticated;

-- 4. Funções de negócio: somente a service_role executa
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'nps\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;

-- 5. Corrige o alerta do linter: rls_auto_enable era executável por anon
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- 6. Nada de privilégio herdado por objetos criados no futuro
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;


-- ============================================================================
-- VERIFICAÇÃO — rode depois de aplicar. As duas consultas devem voltar vazias.
-- ============================================================================
-- -- (a) Nenhuma policy permissiva sobrando:
-- select tablename, policyname, roles::text
--   from pg_policies
--  where schemaname = 'public' and 'anon' = any(roles || '{public}'::name[]);
--
-- -- (b) Nenhum privilégio de leitura para anon:
-- select table_name, privilege_type
--   from information_schema.role_table_grants
--  where table_schema = 'public' and grantee in ('anon','authenticated');


-- ============================================================================
-- ROLLBACK — só se o deploy precisar ser revertido antes de a API subir.
-- Reverter REABRE a exposição das senhas; prefira corrigir o deploy.
-- ============================================================================
-- grant select on public.projetos_nps, public.respostas_nps to anon;
-- create policy "Leitura pública" on public.projetos_nps  for select using (true);
-- create policy "Leitura pública" on public.respostas_nps for select using (true);
-- grant select on public.config_acesso, public.acessos_lideres to anon;
-- create policy "Leitura pública da senha" on public.config_acesso
--   for select using (chave = 'senha_dashboard');
-- create policy "Permitir leitura dos acessos" on public.acessos_lideres
--   for select using (ativo = true);
