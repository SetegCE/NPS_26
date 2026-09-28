-- ============================================================================
-- MIGRATION 23 — UM LINK POR PESSOA NO CICLO
--
-- Quem responde por mais de um projeto (ex.: a mesma pessoa do cliente em
-- Pedra da Boca e UFV Arinos) recebia um link por projeto e teria de
-- responder a mesma pesquisa de satisfação duas vezes. Agora:
--
--   - as pesquisas de CICLO da mesma pessoa, no mesmo ciclo, ainda abertas,
--     formam um só "link" (nps_pesquisas_do_link). O "Copiar link" entrega o
--     mesmo endereço em qualquer um dos projetos (nps_token_do_link) — e os
--     links antigos de cada projeto continuam valendo, levando ao mesmo lugar;
--   - a pessoa responde UMA vez, vendo a lista dos projetos avaliados
--     (nps_projetos_do_link);
--   - o banco grava uma resposta POR PROJETO, com as mesmas notas, ligadas por
--     resposta_grupo_id; grupo_projetos guarda, em cada cópia, os projetos da
--     resposta — é o que a direção e o líder veem ("vale para os projetos...").
--
-- Pesquisa de FINALIZAÇÃO continua individual: é o fechamento de um projeto
-- específico.
-- ============================================================================

alter table public.respostas_nps
  add column if not exists resposta_grupo_id uuid,
  add column if not exists grupo_projetos text;

comment on column public.respostas_nps.resposta_grupo_id is
  'Mesma resposta registrada para vários projetos (um link por pessoa no ciclo). Nulo = resposta de um projeto só.';
comment on column public.respostas_nps.grupo_projetos is
  'Projetos cobertos pela mesma resposta ("código — nome; ..."), para exibir sem consulta extra.';

create index if not exists respostas_nps_grupo_idx
  on public.respostas_nps (resposta_grupo_id) where resposta_grupo_id is not null;

-- ─── O grupo de um link ─────────────────────────────────────────────────────
-- A própria pesquisa e, se for de ciclo e ainda aberta, as outras pesquisas de
-- ciclo abertas da mesma pessoa no mesmo ciclo.
create or replace function public.nps_pesquisas_do_link(p_pesquisa_id uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
  select g.id
    from pesquisas_nps s
    join pesquisas_nps g
      on g.id = s.id
      or (    s.tipo = 'ciclo_semestral' and s.ativo and s.status <> 'respondida'
          and g.tipo = 'ciclo_semestral' and g.ativo and g.status <> 'respondida'
          and g.respondente_id = s.respondente_id
          and g.ciclo_id = s.ciclo_id)
   where s.id = p_pesquisa_id
$function$;

-- Token que o "Copiar link" entrega: o da pesquisa mais antiga do grupo, para
-- que todos os projetos da pessoa devolvam o MESMO endereço.
create or replace function public.nps_token_do_link(p_pesquisa_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
  select p.token
    from pesquisas_nps p
   where p.id in (select id from nps_pesquisas_do_link(p_pesquisa_id))
   order by p.data_geracao nulls last, p.id
   limit 1
$function$;

-- Projetos que o link cobre, para o formulário público mostrar.
create or replace function public.nps_projetos_do_link(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'projeto', m.nome, 'codigo', m.codigo_clockify,
           'cliente', cl.nome, 'lider', li.nome)
         order by m.codigo_clockify), '[]'::jsonb)
    from pesquisas_nps s
    join lateral nps_pesquisas_do_link(s.id) g on true
    join pesquisas_nps p on p.id = g.id
    join projetos_mestre_nps m on m.id = p.projeto_id
    left join clientes_nps cl on cl.id = m.cliente_id
    left join lideres_nps li on li.id = m.lider_id
   where s.token = p_token
$function$;

-- ─── Responder: uma resposta por projeto do link ────────────────────────────
create or replace function public.nps_responder_pesquisa(p_token text, p_q1 integer, p_q2 integer, p_q3 integer, p_q4 integer, p_feedback text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_s        public.pesquisas_nps%rowtype;
  v_g        public.pesquisas_nps%rowtype;
  v_proj     public.projetos_mestre_nps%rowtype;
  v_resp     public.respondentes_nps%rowtype;
  v_ciclo_cd text;
  v_ciclo_id uuid;
  v_rid      uuid;
  v_primeira uuid;
  v_ids      uuid[];
  v_grupo    uuid;
  v_nomes    text;
  v_n        integer := 0;
begin
  if p_q4 is null or p_q4 < 0 or p_q4 > 10 then raise exception 'Q4_OBRIGATORIA'; end if;
  if p_q1 is not null and (p_q1 < 0 or p_q1 > 10) then raise exception 'NOTA_INVALIDA'; end if;
  if p_q2 is not null and (p_q2 < 0 or p_q2 > 10) then raise exception 'NOTA_INVALIDA'; end if;
  if p_q3 is not null and (p_q3 < 0 or p_q3 > 10) then raise exception 'NOTA_INVALIDA'; end if;

  select * into v_s from public.pesquisas_nps where token = p_token;
  if not found then raise exception 'PESQUISA_NAO_ENCONTRADA'; end if;

  -- Trava o grupo inteiro SEMPRE na ordem do id: dois links do mesmo grupo
  -- respondidos ao mesmo tempo esperam um pelo outro em vez de se travarem
  -- (deadlock) ou de gravarem a resposta duas vezes.
  perform 1 from public.pesquisas_nps
   where id in (select id from public.nps_pesquisas_do_link(v_s.id))
   order by id
   for update;

  select * into v_s from public.pesquisas_nps where id = v_s.id;
  if not v_s.ativo then raise exception 'PESQUISA_ENCERRADA'; end if;
  if v_s.status = 'respondida' then raise exception 'PESQUISA_JA_RESPONDIDA'; end if;

  select array_agg(id order by id) into v_ids from public.nps_pesquisas_do_link(v_s.id);
  select * into v_resp from public.respondentes_nps where id = v_s.respondente_id;

  if array_length(v_ids, 1) > 1 then
    v_grupo := gen_random_uuid();
    select string_agg(m.codigo_clockify || ' — ' || m.nome, '; ' order by m.codigo_clockify)
      into v_nomes
      from public.pesquisas_nps p join public.projetos_mestre_nps m on m.id = p.projeto_id
     where p.id = any(v_ids);
  end if;

  for v_g in select * from public.pesquisas_nps where id = any(v_ids) order by data_geracao nulls last, id loop
    select * into v_proj from public.projetos_mestre_nps where id = v_g.projeto_id;

    v_ciclo_id := v_g.ciclo_id;
    v_ciclo_cd := null;
    if v_ciclo_id is not null then
      select codigo into v_ciclo_cd from public.ciclos_nps where id = v_ciclo_id;
    else
      -- Pesquisa de finalizacao: associa ao ciclo aberto vigente, se houver
      select id, codigo into v_ciclo_id, v_ciclo_cd
        from public.ciclos_nps where status = 'aberto'
        order by data_inicio desc limit 1;
    end if;

    insert into public.respostas_nps
      (identificador, nota_q1, nota_q2, nota_q3, nota_q4, feedback, "timestamp",
       ciclo, ciclo_id, codigo_clockify, cliente, lider, projeto,
       classe_contratual, tipo_servico, segmento_cliente, escopo_geral,
       canal_resposta, respondeu, match_projeto,
       pesquisa_id, respondente_id, projeto_id,
       resposta_grupo_id, grupo_projetos)
    values
      (v_resp.nome, p_q1, p_q2, p_q3, p_q4, nullif(btrim(coalesce(p_feedback,'')),''), now(),
       v_ciclo_cd, v_ciclo_id, v_proj.codigo_clockify,
       v_g.cliente_nome, v_g.lider_nome, v_proj.nome,
       v_proj.classe_contratual, v_proj.tipo_servico, v_proj.segmento_cliente, v_proj.escopo_geral,
       'LINK', true, 'pesquisa_token',
       v_g.id, v_g.respondente_id, v_g.projeto_id,
       v_grupo, v_nomes)
    returning id into v_rid;

    update public.pesquisas_nps
       set status = 'respondida', data_resposta = now(), resposta_id = v_rid
     where id = v_g.id;

    perform public.nps_auditar('responder','pesquisa', v_g.id,
      case when v_grupo is null then format('Resposta registrada por %s', v_resp.nome)
           else format('Resposta registrada por %s (resposta única para %s projetos: %s)',
                       v_resp.nome, array_length(v_ids, 1), v_nomes) end,
      'respondente', v_resp.nome,
      null, jsonb_build_object('resposta_id', v_rid, 'nota_q4', p_q4, 'resposta_grupo_id', v_grupo));

    v_primeira := coalesce(v_primeira, v_rid);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'resposta_id', v_primeira, 'projetos', v_n);
end;
$function$;

-- ─── Excluir uma cópia: as outras se ajustam ────────────────────────────────
-- A direção pode excluir a resposta de um dos projetos (nps_excluir). As
-- cópias que ficam passam a listar só os projetos restantes; se sobrar uma,
-- ela volta a ser resposta de um projeto só.
create or replace function public.nps_regrupar_resposta()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_n     integer;
  v_nomes text;
begin
  if old.resposta_grupo_id is null then return old; end if;
  select count(*), string_agg(codigo_clockify || ' — ' || projeto, '; ' order by codigo_clockify)
    into v_n, v_nomes
    from respostas_nps where resposta_grupo_id = old.resposta_grupo_id;
  update respostas_nps
     set resposta_grupo_id = case when v_n > 1 then resposta_grupo_id end,
         grupo_projetos    = case when v_n > 1 then v_nomes end
   where resposta_grupo_id = old.resposta_grupo_id;
  return old;
end
$function$;

drop trigger if exists nps_regrupar_resposta_tg on public.respostas_nps;
create trigger nps_regrupar_resposta_tg
  after delete on public.respostas_nps
  for each row execute function public.nps_regrupar_resposta();

revoke all on function public.nps_regrupar_resposta() from public, anon, authenticated;

-- ─── Views: o que as telas mostram ──────────────────────────────────────────
-- Colunas novas SEMPRE no fim: create or replace view nao aceita outra ordem.

create or replace view public.vw_pesquisas as
 SELECT s.id,
    s.projeto_id,
    s.respondente_id,
    s.tipo,
    s.ciclo_id,
    s.status,
    s.data_geracao,
    s.data_envio,
    s.data_resposta,
    s.resposta_id,
    s.gerada_por,
    s.ativo,
    s.token,
    c.codigo AS ciclo_codigo,
    m.codigo_clockify,
    m.nome AS projeto_nome,
    m.lider_id,
    cl.nome AS cliente_nome,
    li.nome AS lider_nome,
    rp.nome AS respondente_nome,
    rp.email AS respondente_email,
    rp.telefone AS respondente_telefone,
    -- Quantos projetos o link desta pesquisa cobre (1 = link só dela).
    (SELECT count(*) FROM nps_pesquisas_do_link(s.id))::integer AS link_projetos,
    -- Respondida junto com outros projetos: quais.
    rr.grupo_projetos AS resposta_grupo_projetos
   FROM pesquisas_nps s
     JOIN projetos_mestre_nps m ON m.id = s.projeto_id
     JOIN respondentes_nps rp ON rp.id = s.respondente_id
     LEFT JOIN clientes_nps cl ON cl.id = m.cliente_id
     LEFT JOIN lideres_nps li ON li.id = m.lider_id
     LEFT JOIN ciclos_nps c ON c.id = s.ciclo_id
     LEFT JOIN respostas_nps rr ON rr.id = s.resposta_id;

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
    r.grupo_projetos
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

-- ─── Permissões: só o servidor (service_role), como todas as nps_* ──────────
revoke all on function public.nps_pesquisas_do_link(uuid) from public, anon, authenticated;
revoke all on function public.nps_token_do_link(uuid)     from public, anon, authenticated;
revoke all on function public.nps_projetos_do_link(text)  from public, anon, authenticated;
revoke all on function public.nps_responder_pesquisa(text, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.nps_pesquisas_do_link(uuid) to service_role;
grant execute on function public.nps_token_do_link(uuid)     to service_role;
grant execute on function public.nps_projetos_do_link(text)  to service_role;
grant execute on function public.nps_responder_pesquisa(text, integer, integer, integer, integer, text) to service_role;
revoke all on public.vw_pesquisas, public.vw_respostas_enriquecidas from anon, authenticated;
