-- ============================================================================
-- MIGRATION 25 — TODA CONTAGEM SÓ COM PROJETOS ELEGÍVEIS DO CICLO
--
-- Regra (definida pela direção em 2026-11-03): projeto e resposta só entram
-- em total, NPS, cobertura ou média se o projeto estiver ELEGÍVEL e ATIVO no
-- ciclo da resposta (projetos_nps.elegivel e projetos_nps.ativo). Projeto
-- apenas ativo — stand by, menos de 3 meses, N.A. — não conta.
--
-- Nenhum dado é apagado nem alterado: a resposta de projeto não elegível
-- continua gravada e visível na lista de Respostas; só deixa de entrar nas
-- contas.
--
--   1. vw_respostas_enriquecidas ganha `elegivel_no_ciclo`, que as rotas
--      usam para somar só o que vale.
--   2. vw_projetos_admin: total_respostas e nps_projeto só com respostas de
--      ciclos em que o projeto era elegível.
--   3. vw_operacao_ciclo ganha `participacao_ativa`: projeto retirado do
--      ciclo (ativo = false) deixa de contar na Operação e nos pendentes de
--      plano de ação.
--
-- Colunas novas vão SEMPRE no fim: `create or replace view` não aceita mudar
-- a ordem nem remover colunas.
-- ============================================================================

-- ─── 1. Respostas: elegível no ciclo? ───────────────────────────────────────
create or replace view public.vw_respostas_enriquecidas as
 SELECT r.id,
    r.identificador,
    r.nota_q1,
    r.nota_q2,
    r.nota_q3,
    r.nota_q4,
    r.feedback,
    r."timestamp",
    r.ciclo,
    r.ciclo_id,
    r.codigo_clockify,
    r.canal_resposta,
    r.pesquisa_id,
    r.respondente_id,
    r.projeto_id,
    m.nome AS projeto_nome,
    cl.nome AS cliente_nome,
    cl.id AS cliente_id,
    resp.nome AS respondente_nome,
    COALESCE(h.lider_nome, r.lider) AS lider_periodo,
    h.lider_id AS lider_periodo_id,
    m.lider_id AS lider_atual_id,
    li.nome AS lider_atual,
        CASE
            WHEN r.nota_q4 IS NULL OR r.nota_q4 < 0 OR r.nota_q4 > 10 THEN NULL::text
            WHEN r.nota_q4 >= 9 THEN 'PROMOTOR'::text
            WHEN r.nota_q4 >= 7 THEN 'NEUTRO'::text
            ELSE 'DETRATOR'::text
        END AS categoria,
    r.nota_q4 IS NOT NULL AND r.nota_q4 >= 0 AND r.nota_q4 <= 10 AS resposta_valida,
    r.resposta_grupo_id,
    r.grupo_projetos,
    EXISTS ( SELECT 1
           FROM projetos_nps pn
          WHERE pn.projeto_id = r.projeto_id AND pn.ciclo_id = r.ciclo_id
            AND pn.elegivel AND COALESCE(pn.ativo, true)) AS elegivel_no_ciclo
   FROM respostas_nps r
     LEFT JOIN projetos_mestre_nps m ON m.id = r.projeto_id
     LEFT JOIN clientes_nps cl ON cl.id = m.cliente_id
     LEFT JOIN lideres_nps li ON li.id = m.lider_id
     LEFT JOIN respondentes_nps resp ON resp.id = r.respondente_id
     LEFT JOIN LATERAL ( SELECT h2.lider_nome,
            h2.lider_id
           FROM projeto_lideranca_hist_nps h2
          WHERE h2.projeto_id = r.projeto_id AND r."timestamp" >= h2.iniciado_em AND (h2.encerrado_em IS NULL OR r."timestamp" < h2.encerrado_em)
          ORDER BY h2.iniciado_em DESC
         LIMIT 1) h ON true;

-- ─── 2. Projetos: respostas e NPS só de ciclos em que era elegível ──────────
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
          WHERE r.projeto_id = m.id AND r.nota_q4 >= 0 AND r.nota_q4 <= 10
            AND EXISTS ( SELECT 1
                   FROM projetos_nps pn
                  WHERE pn.projeto_id = r.projeto_id AND pn.ciclo_id = r.ciclo_id
                    AND pn.elegivel AND COALESCE(pn.ativo, true))) rs ON true
     LEFT JOIN LATERAL ( SELECT i.nota,
            i.competencia
           FROM isc_nps i
          WHERE i.projeto_id = m.id
          ORDER BY i.competencia DESC
         LIMIT 1) isc ON true;

-- ─── 3. Operação: participação ativa no ciclo ───────────────────────────────
create or replace view public.vw_operacao_ciclo as
 SELECT p.id AS participacao_id,
    p.projeto_id,
    p.ciclo,
    p.ciclo_id,
    p.elegivel,
    m.codigo_clockify,
    m.nome AS projeto_nome,
    m.status AS projeto_status,
    m.ativo AS projeto_ativo,
    cl.nome AS cliente_nome,
    cl.id AS cliente_id,
    p.lider AS lider_ciclo,
    p.lider_id,
    COALESCE(rc.total, 0::bigint) AS respondentes,
    COALESCE(pq.total, 0::bigint) AS pesquisas,
    COALESCE(pq.enviadas, 0::bigint) AS pesquisas_enviadas,
    COALESCE(pq.respondidas, 0::bigint) AS pesquisas_respondidas,
    COALESCE(rs.total, 0::bigint) AS respostas,
        CASE
            WHEN NOT p.elegivel THEN 'nao_elegivel'::text
            WHEN COALESCE(rs.total, 0::bigint) > 0 THEN 'respondido'::text
            WHEN COALESCE(pq.total, 0::bigint) = 0 THEN 'sem_pesquisa'::text
            WHEN COALESCE(pq.enviadas, 0::bigint) > 0 THEN 'aguardando_resposta'::text
            ELSE 'pesquisa_gerada'::text
        END AS situacao,
    COALESCE(p.ativo, true) AS participacao_ativa
   FROM projetos_nps p
     JOIN projetos_mestre_nps m ON m.id = p.projeto_id
     LEFT JOIN clientes_nps cl ON cl.id = m.cliente_id
     LEFT JOIN LATERAL ( SELECT count(*) AS total
           FROM projeto_respondentes_nps pr
          WHERE pr.projeto_id = p.projeto_id AND pr.ativo) rc ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS total,
            count(*) FILTER (WHERE s.status = ANY (ARRAY['enviada'::text, 'respondida'::text])) AS enviadas,
            count(*) FILTER (WHERE s.status = 'respondida'::text) AS respondidas
           FROM pesquisas_nps s
          WHERE s.projeto_id = p.projeto_id AND s.ativo AND (s.ciclo_id = p.ciclo_id OR s.tipo = 'finalizacao'::text)) pq ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS total
           FROM respostas_nps r
          WHERE r.projeto_id = p.projeto_id AND r.ciclo_id = p.ciclo_id AND r.nota_q4 >= 0 AND r.nota_q4 <= 10) rs ON true;

-- ─── Permissões: as views são reabertas, o fechamento é reafirmado ──────────
revoke all on public.vw_respostas_enriquecidas, public.vw_projetos_admin, public.vw_operacao_ciclo
  from anon, authenticated;

-- ─── Verificação ────────────────────────────────────────────────────────────
-- Respostas do 2026.2 que deixam de contar (esperado: 1, a do BJA):
--   select codigo_clockify, projeto_nome, respondente_nome
--     from vw_respostas_enriquecidas
--    where ciclo = '2026.2' and not elegivel_no_ciclo;
