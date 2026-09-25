-- ============================================================================
-- MIGRATION 14 — VENDEDOR E ACESSO NO CADASTRO DE PROJETO
--
-- ---------------------------------------------------------------------------
-- POR QUE ELA EXISTE
--
-- A planilha CLIENTES_ATIVOS, que é a fonte oficial dos projetos, traz duas
-- colunas que não tinham lugar no banco:
--
--   VENDEDOR  — quem vendeu o contrato (MATHEUS, GUSTAVO, HADDAD…)
--   ACESSO    — exigência de acesso ao campo: "COM SST" ou "N.A"
--
-- Sem estas colunas, importar a planilha significaria descartar informação a
-- cada importação. Elas ficam no banco, e não no código, porque é no banco
-- que o PMO passa a mantê-las — pela tela de Projetos.
--
-- ---------------------------------------------------------------------------
-- POR QUE SÃO TEXTO LIVRE, E NÃO CHECK/FK
--
-- `acesso` hoje só tem dois valores, mas é um campo operacional que a
-- planilha pode ampliar amanhã (outra norma de SST, outro tipo de liberação).
-- Um CHECK faria a próxima importação falhar no meio; texto livre, validado
-- no tamanho, aceita o valor novo e deixa o PMO corrigir pela tela.
--
-- `vendedor` não vira FK para uma tabela de vendedores porque não existe
-- nada, hoje, que dependa dessa identidade: ninguém loga como vendedor e
-- nenhum indicador é apurado por ele. Criar a tabela agora seria estrutura
-- para um uso que não foi pedido.
--
-- Como aplicar: cole o bloco abaixo no SQL Editor do painel do Supabase.
-- É aditiva e não destrutiva — pode rodar com o sistema no ar.
--
-- STATUS: **APLICADA** em 21/09/2026.
-- ============================================================================

alter table public.projetos_mestre_nps
  add column if not exists vendedor text,
  add column if not exists acesso   text;

comment on column public.projetos_mestre_nps.vendedor is
  'Quem vendeu o contrato. Origem: coluna VENDEDOR da planilha CLIENTES_ATIVOS.';
comment on column public.projetos_mestre_nps.acesso is
  'Exigência de acesso ao campo (ex.: "COM SST", "N.A"). Origem: coluna ACESSO da planilha CLIENTES_ATIVOS.';

-- Tamanho máximo alinhado aos demais campos de texto curto do cadastro.
-- Protege contra uma célula da planilha com um parágrafo inteiro dentro.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.projetos_mestre_nps'::regclass
       and conname  = 'projetos_mestre_vendedor_tam'
  ) then
    alter table public.projetos_mestre_nps
      add constraint projetos_mestre_vendedor_tam check (char_length(vendedor) <= 160);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.projetos_mestre_nps'::regclass
       and conname  = 'projetos_mestre_acesso_tam'
  ) then
    alter table public.projetos_mestre_nps
      add constraint projetos_mestre_acesso_tam check (char_length(acesso) <= 60);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A view administrativa precisa expor as colunas novas, senão a tela de
-- Projetos não as enxerga (ela lê vw_projetos_admin, não a tabela).
--
-- `create or replace` preserva as permissões já concedidas; o corpo abaixo é
-- o da view atual acrescido de p.vendedor e p.acesso.
-- ---------------------------------------------------------------------------
-- O corpo abaixo é a definição vigente de vw_projetos_admin acrescida de
-- `m.vendedor` e `m.acesso`. Nada mais mudou.
--
-- As duas entram no FIM da lista de colunas, e não perto dos campos
-- parecidos: `create or replace view` não sabe inserir coluna no meio — ele
-- casa por POSIÇÃO e tentaria renomear `status` para `vendedor`, falhando
-- com "cannot change name of view column". Sair da ordem lógica é o preço de
-- não precisar dropar a view (o que derrubaria as permissões e qualquer
-- dependência).

create or replace view public.vw_projetos_admin as
 SELECT m.id,
    m.codigo_clockify,
    m.nome,
    m.categoria,
    m.classe_contratual,
    m.tipo_servico,
    m.segmento_cliente,
    m.escopo_geral,
    m.status,
    m.ativo,
    m.created_at,
    m.updated_at,
    m.cliente_id,
    cl.nome AS cliente_nome,
    m.lider_id,
    li.nome AS lider_nome,
    pa.ciclo AS ciclo_atual,
    pa.ciclo_id AS ciclo_atual_id,
    pa.elegivel,
    COALESCE(rc.total, 0::bigint) AS total_respondentes,
    COALESCE(pq.total, 0::bigint) AS total_pesquisas,
    COALESCE(pq.respondidas, 0::bigint) AS pesquisas_respondidas,
    COALESCE(rs.total, 0::bigint) AS total_respostas,
    rs.nps AS nps_projeto,
    isc.nota AS isc_atual,
    isc.competencia AS isc_competencia,
    m.vendedor,
    m.acesso
   FROM projetos_mestre_nps m
     LEFT JOIN clientes_nps cl ON cl.id = m.cliente_id
     LEFT JOIN lideres_nps li ON li.id = m.lider_id
     LEFT JOIN LATERAL ( SELECT p.ciclo,
            p.ciclo_id,
            p.elegivel
           FROM projetos_nps p
             JOIN ciclos_nps c ON c.id = p.ciclo_id
          WHERE p.projeto_id = m.id
          ORDER BY c.data_inicio DESC NULLS LAST
         LIMIT 1) pa ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS total
           FROM projeto_respondentes_nps pr
          WHERE pr.projeto_id = m.id AND pr.ativo) rc ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS total,
            count(*) FILTER (WHERE s.status = 'respondida'::text) AS respondidas
           FROM pesquisas_nps s
          WHERE s.projeto_id = m.id AND s.ativo) pq ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS total,
            round(count(*) FILTER (WHERE r.nota_q4 >= 9)::numeric * 100::numeric / NULLIF(count(*), 0)::numeric - count(*) FILTER (WHERE r.nota_q4 <= 6)::numeric * 100::numeric / NULLIF(count(*), 0)::numeric) AS nps
           FROM respostas_nps r
          WHERE r.projeto_id = m.id AND r.nota_q4 >= 0 AND r.nota_q4 <= 10) rs ON true
     LEFT JOIN LATERAL ( SELECT i.nota,
            i.competencia
           FROM isc_nps i
          WHERE i.projeto_id = m.id
          ORDER BY i.competencia DESC
         LIMIT 1) isc ON true;

-- A view é reaberta pelo `create or replace`, então o fechamento ao público
-- da migration 12 precisa ser reafirmado aqui.
revoke all on public.vw_projetos_admin from anon, authenticated;


-- ============================================================================
-- VERIFICAÇÃO — rode depois de aplicar.
-- ============================================================================
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='projetos_mestre_nps'
--    and column_name in ('vendedor','acesso');   -- deve voltar as duas


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- alter table public.projetos_mestre_nps
--   drop constraint if exists projetos_mestre_vendedor_tam,
--   drop constraint if exists projetos_mestre_acesso_tam,
--   drop column if exists vendedor,
--   drop column if exists acesso;
