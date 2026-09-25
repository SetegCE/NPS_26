-- ============================================================================
-- MIGRATION 21 — EVIDENCIA DA ACAO CONCLUIDA
--
-- O lider marca a acao como feita (check) e PRECISA informar uma evidencia:
-- um link, em geral para a pasta de evidencias do cliente. A regra vale no
-- banco (constraint + funcao), nao so na tela.
--
--  - evidencia_url: link http(s) da evidencia;
--  - concluido_em: quando a acao foi marcada como concluida (preenchido pela
--    funcao; limpo se a acao voltar a ficar em aberto).
-- ============================================================================

alter table public.plano_acao_itens_nps
  add column if not exists evidencia_url text,
  add column if not exists concluido_em timestamptz;

alter table public.plano_acao_itens_nps
  drop constraint if exists plano_itens_evidencia_url_chk,
  drop constraint if exists plano_itens_concluido_exige_evidencia;

-- So http(s): impede "javascript:" e afins virarem link clicavel na tela.
alter table public.plano_acao_itens_nps
  add constraint plano_itens_evidencia_url_chk check (
    evidencia_url is null
    or (evidencia_url ~* '^https?://[^[:space:]]+$' and char_length(evidencia_url) <= 1000)
  ),
  add constraint plano_itens_concluido_exige_evidencia check (
    situacao <> 'concluido' or nullif(btrim(coalesce(evidencia_url, '')), '') is not null
  );

-- A view expande x.* na criacao: precisa ser recriada para trazer as colunas
-- novas (drop + create, porque a ordem das colunas muda).
drop view if exists public.vw_plano_acao_itens;
create view public.vw_plano_acao_itens as
select
  x.*,
  case
    when x.situacao = 'concluido' then 'concluido'
    when x.situacao = 'atrasado' or (x.prazo is not null and x.prazo < current_date) then 'atrasado'
    else 'no_prazo'
  end as situacao_efetiva
from public.plano_acao_itens_nps x;
revoke all on public.vw_plano_acao_itens from anon, authenticated;

-- Funcao de salvar ganha a evidencia. A assinatura muda, entao a antiga sai.
drop function if exists public.nps_salvar_acao_plano(uuid, uuid, text, text, text, text, numeric, date, text, text, text, text, uuid);

create or replace function public.nps_salvar_acao_plano(
  p_plano_id uuid, p_item_id uuid,
  p_o_que text, p_por_que text, p_onde text, p_quem text,
  p_quanto numeric, p_prazo date, p_situacao text, p_observacao text,
  p_ator text, p_ator_tipo text, p_exigir_lider_id uuid default null,
  p_evidencia_url text default null
) returns jsonb
language plpgsql security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_plano     public.planos_acao_nps%rowtype;
  v_proj      public.projetos_mestre_nps%rowtype;
  v_ant       public.plano_acao_itens_nps%rowtype;
  v_id        uuid;
  v_ordem     int;
  v_situacao  text := coalesce(p_situacao, 'no_prazo');
  v_evidencia text := nullif(btrim(coalesce(p_evidencia_url, '')), '');
begin
  select * into v_plano from public.planos_acao_nps where id = p_plano_id;
  if not found then raise exception 'PLANO_NAO_ENCONTRADO'; end if;
  if not v_plano.passivel then raise exception 'PROJETO_SEM_PLANO_DE_ACAO'; end if;
  if v_plano.encerrado_em is not null then raise exception 'PLANO_ENCERRADO'; end if;

  select * into v_proj from public.projetos_mestre_nps where id = v_plano.projeto_id;
  if p_exigir_lider_id is not null and v_proj.lider_id is distinct from p_exigir_lider_id then
    raise exception 'NAO_AUTORIZADO';
  end if;

  if nullif(btrim(coalesce(p_o_que, '')), '') is null then raise exception 'O_QUE_OBRIGATORIO'; end if;
  if v_situacao not in ('no_prazo', 'concluido', 'atrasado') then raise exception 'SITUACAO_INVALIDA'; end if;
  if p_quanto is not null and p_quanto < 0 then raise exception 'VALOR_INVALIDO'; end if;
  if v_evidencia is not null and (v_evidencia !~* '^https?://[^[:space:]]+$' or char_length(v_evidencia) > 1000) then
    raise exception 'EVIDENCIA_INVALIDA';
  end if;
  if v_situacao = 'concluido' and v_evidencia is null then raise exception 'EVIDENCIA_OBRIGATORIA'; end if;

  if p_item_id is null then
    select coalesce(max(ordem), 0) + 1 into v_ordem from public.plano_acao_itens_nps where plano_id = p_plano_id;
    insert into public.plano_acao_itens_nps
      (plano_id, ordem, o_que, por_que, onde, quem, quanto, prazo, situacao, observacao,
       evidencia_url, concluido_em, atualizado_por)
    values (p_plano_id, v_ordem, btrim(p_o_que), nullif(btrim(coalesce(p_por_que, '')), ''),
            nullif(btrim(coalesce(p_onde, '')), ''), nullif(btrim(coalesce(p_quem, '')), ''),
            p_quanto, p_prazo, v_situacao, nullif(btrim(coalesce(p_observacao, '')), ''),
            v_evidencia, case when v_situacao = 'concluido' then now() end, p_ator)
    returning id into v_id;
  else
    select * into v_ant from public.plano_acao_itens_nps
     where id = p_item_id and plano_id = p_plano_id for update;
    if not found then raise exception 'ACAO_NAO_ENCONTRADA'; end if;
    update public.plano_acao_itens_nps set
      o_que = btrim(p_o_que),
      por_que = nullif(btrim(coalesce(p_por_que, '')), ''),
      onde = nullif(btrim(coalesce(p_onde, '')), ''),
      quem = nullif(btrim(coalesce(p_quem, '')), ''),
      quanto = p_quanto,
      prazo = p_prazo,
      situacao = v_situacao,
      observacao = nullif(btrim(coalesce(p_observacao, '')), ''),
      evidencia_url = v_evidencia,
      -- Data da conclusao: mantida se ja estava concluida; nova se acabou de
      -- ser marcada; limpa se voltou a ficar em aberto.
      concluido_em = case
        when v_situacao <> 'concluido' then null
        when v_ant.situacao = 'concluido' then coalesce(v_ant.concluido_em, now())
        else now()
      end,
      atualizado_por = p_ator
    where id = p_item_id
    returning id into v_id;
  end if;

  perform public.nps_auditar(
    case when p_item_id is null then 'criar_acao_plano'
         when v_situacao = 'concluido' and v_ant.situacao is distinct from 'concluido' then 'concluir_acao_plano'
         else 'editar_acao_plano' end,
    'plano_acao', p_plano_id,
    format('Plano %s: acao %s — %s', v_plano.numero,
           case when p_item_id is null then 'criada'
                when v_situacao = 'concluido' and v_ant.situacao is distinct from 'concluido' then 'concluida'
                else 'atualizada' end,
           left(btrim(p_o_que), 120)),
    p_ator_tipo, p_ator,
    case when p_item_id is null then null
         else jsonb_build_object('item_id', v_ant.id, 'o_que', v_ant.o_que, 'prazo', v_ant.prazo,
                                 'situacao', v_ant.situacao, 'evidencia_url', v_ant.evidencia_url) end,
    jsonb_build_object('item_id', v_id, 'o_que', p_o_que, 'prazo', p_prazo, 'situacao', v_situacao,
                       'evidencia_url', v_evidencia));

  return jsonb_build_object('id', v_id);
end;
$function$;

revoke all on function public.nps_salvar_acao_plano(uuid, uuid, text, text, text, text, numeric, date, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.nps_salvar_acao_plano(uuid, uuid, text, text, text, text, numeric, date, text, text, text, text, uuid, text) to service_role;
