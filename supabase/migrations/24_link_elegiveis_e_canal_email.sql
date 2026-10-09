-- ============================================================================
-- MIGRATION 24 — LINK ÚNICO SÓ COM PROJETOS ELEGÍVEIS; CANAL "EMAIL"
--
-- Dois acertos na resposta pelo link (migration 23):
--
--   1. O link único juntava TODA pesquisa de ciclo aberta da pessoa no ciclo,
--      inclusive de projeto que não é elegível naquele período (ou que saiu
--      do ciclo). Agora o grupo só reúne pesquisas cujo projeto está elegível
--      e ativo em projetos_nps para o ciclo da pesquisa. Pesquisa de projeto
--      não elegível continua respondível, mas sozinha — não arrasta nem é
--      arrastada para o grupo.
--
--   2. A resposta pelo link era gravada com canal 'LINK'. O link chega ao
--      cliente por e-mail: o canal é 'EMAIL'.
--
-- Dados já gravados:
--   - canal 'LINK' vira 'EMAIL';
--   - respostas agrupadas são reagrupadas só entre as cópias de projetos
--     elegíveis. A cópia de projeto não elegível NÃO é apagada (resposta é o
--     dado que o sistema guarda): sai do grupo e fica como resposta avulsa,
--     para a direção decidir se exclui. A consulta no fim lista quais são.
-- ============================================================================

-- ─── Elegibilidade de uma pesquisa no seu ciclo ─────────────────────────────
create or replace function public.nps_pesquisa_elegivel(p_projeto_id uuid, p_ciclo_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
  select exists (
    select 1 from projetos_nps pn
     where pn.projeto_id = p_projeto_id
       and pn.ciclo_id   = p_ciclo_id
       and pn.elegivel
       and coalesce(pn.ativo, true)
  )
$function$;

-- ─── O grupo de um link: só projetos elegíveis do ciclo ─────────────────────
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
          and nps_pesquisa_elegivel(s.projeto_id, s.ciclo_id)
          and g.tipo = 'ciclo_semestral' and g.ativo and g.status <> 'respondida'
          and g.respondente_id = s.respondente_id
          and g.ciclo_id = s.ciclo_id
          and nps_pesquisa_elegivel(g.projeto_id, g.ciclo_id))
   where s.id = p_pesquisa_id
$function$;

-- ─── Responder: igual à 23, com canal 'EMAIL' ───────────────────────────────
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
       'EMAIL', true, 'pesquisa_token',
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

-- ─── Dados: canal ───────────────────────────────────────────────────────────
update public.respostas_nps set canal_resposta = 'EMAIL' where canal_resposta = 'LINK';

-- ─── Dados: grupos só com as cópias elegíveis ───────────────────────────────
with copia as (
  select r.id, r.resposta_grupo_id, r.codigo_clockify, r.projeto,
         public.nps_pesquisa_elegivel(r.projeto_id, r.ciclo_id) as ok
    from public.respostas_nps r
   where r.resposta_grupo_id is not null
),
grupo as (
  select resposta_grupo_id,
         count(*) filter (where ok) as n,
         string_agg(codigo_clockify || ' — ' || projeto, '; ' order by codigo_clockify)
           filter (where ok) as nomes
    from copia
   group by resposta_grupo_id
)
update public.respostas_nps r
   set resposta_grupo_id = case when c.ok and g.n > 1 then r.resposta_grupo_id end,
       grupo_projetos    = case when c.ok and g.n > 1 then g.nomes end
  from copia c
  join grupo g using (resposta_grupo_id)
 where r.id = c.id
   and (   r.resposta_grupo_id is distinct from case when c.ok and g.n > 1 then r.resposta_grupo_id end
        or r.grupo_projetos    is distinct from case when c.ok and g.n > 1 then g.nomes end);

-- ─── Permissões ─────────────────────────────────────────────────────────────
revoke all on function public.nps_pesquisa_elegivel(uuid, uuid) from public, anon, authenticated;
revoke all on function public.nps_pesquisas_do_link(uuid) from public, anon, authenticated;
revoke all on function public.nps_responder_pesquisa(text, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.nps_pesquisa_elegivel(uuid, uuid) to service_role;
grant execute on function public.nps_pesquisas_do_link(uuid) to service_role;
grant execute on function public.nps_responder_pesquisa(text, integer, integer, integer, integer, text) to service_role;

-- ─── Verificação ────────────────────────────────────────────────────────────
-- Deve voltar zero:
--   select count(*) from respostas_nps where canal_resposta = 'LINK';
--
-- Respostas de projeto NÃO elegível no ciclo (vieram do link antigo). Ficam
-- como avulsas; a direção decide se exclui pela tela de Respostas:
--   select r.id, r.ciclo, r.codigo_clockify, r.projeto, r.identificador, r."timestamp"
--     from respostas_nps r
--    where r.match_projeto = 'pesquisa_token'
--      and not nps_pesquisa_elegivel(r.projeto_id, r.ciclo_id)
--    order by r."timestamp";
