-- ============================================================================
-- MIGRATION 20 — PLANO DE ACAO POR PROJETO E CICLO
--
-- Fluxo (modelo 5W2H da planilha de plano de acao do PMO):
--
--  1. Para cada projeto ELEGIVEL que ja recebeu resposta no ciclo, o PMO
--     decide: "E passivel de plano de acao?" Sim ou Nao. Pode decidir a
--     qualquer momento depois da primeira resposta (nao espera o ciclo fechar).
--  2. Nao: fica registrado e nada mais aparece.
--  3. Sim: o PMO escreve o cabecalho — Assunto e Objetivo (o contexto geral da
--     oportunidade). O plano ganha numero sequencial por ano ("001/2026") e o
--     Responsavel e o lider do projeto.
--  4. O lider preenche as acoes: O que, Por que, Onde, Quem, Quanto, Prazo e
--     a Situacao (No prazo / Concluido / Atrasado).
--  5. Acao nao concluida com prazo vencido aparece como ATRASADA sozinha (na
--     view), sem depender de alguem lembrar de trocar a situacao.
--  6. O PMO encerra o plano (data de encerramento) e pode reabrir.
--
-- Tudo passa por funcoes com auditoria, como o resto do sistema. Nada e
-- apagado em silencio: a decisao pode ser trocada (fica na auditoria) e a
-- remocao de uma acao registra o que ela era.
-- ============================================================================

-- ─── Tabelas ────────────────────────────────────────────────────────────────

create table if not exists public.planos_acao_nps (
  id                uuid primary key default gen_random_uuid(),
  projeto_id        uuid not null references public.projetos_mestre_nps(id),
  ciclo_id          uuid not null references public.ciclos_nps(id),
  passivel          boolean not null,
  numero            text,
  assunto           text,
  objetivo          text,
  responsavel_id    uuid references public.lideres_nps(id),
  responsavel_nome  text,
  inicio            date,
  encerrado_em      date,
  decidido_por      text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_plano_projeto_ciclo unique (projeto_id, ciclo_id),
  constraint uq_plano_numero unique (numero),
  -- Com plano: precisa de assunto e objetivo. Sem plano: nao ha cabecalho.
  constraint planos_acao_cabecalho_chk check (
    (passivel and nullif(btrim(coalesce(assunto, '')), '') is not null
              and nullif(btrim(coalesce(objetivo, '')), '') is not null)
    or (not passivel and encerrado_em is null)
  ),
  constraint planos_acao_assunto_tam check (char_length(assunto) <= 200),
  constraint planos_acao_objetivo_tam check (char_length(objetivo) <= 4000)
);

create table if not exists public.plano_acao_itens_nps (
  id              uuid primary key default gen_random_uuid(),
  plano_id        uuid not null references public.planos_acao_nps(id),
  ordem           integer not null,
  o_que           text not null,
  por_que         text,
  onde            text,
  quem            text,
  quanto          numeric(14, 2),
  prazo           date,
  situacao        text not null default 'no_prazo',
  observacao      text,
  atualizado_por  text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint plano_itens_situacao_chk check (situacao in ('no_prazo', 'concluido', 'atrasado')),
  constraint plano_itens_o_que_chk check (btrim(o_que) <> ''),
  constraint plano_itens_quanto_chk check (quanto is null or quanto >= 0)
);

create index if not exists idx_planos_ciclo on public.planos_acao_nps (ciclo_id);
create index if not exists idx_planos_responsavel on public.planos_acao_nps (responsavel_id);
create index if not exists idx_plano_itens_plano on public.plano_acao_itens_nps (plano_id, ordem);

drop trigger if exists trg_touch_planos_acao_nps on public.planos_acao_nps;
create trigger trg_touch_planos_acao_nps before update on public.planos_acao_nps
  for each row execute function public.nps_touch_updated_at();
drop trigger if exists trg_touch_plano_acao_itens_nps on public.plano_acao_itens_nps;
create trigger trg_touch_plano_acao_itens_nps before update on public.plano_acao_itens_nps
  for each row execute function public.nps_touch_updated_at();

-- Mesmo fechamento das demais tabelas: so a service_role (API) acessa.
alter table public.planos_acao_nps enable row level security;
alter table public.plano_acao_itens_nps enable row level security;
revoke all on public.planos_acao_nps from anon, authenticated;
revoke all on public.plano_acao_itens_nps from anon, authenticated;

-- ─── View ───────────────────────────────────────────────────────────────────

create or replace view public.vw_planos_acao as
select
  p.id,
  p.projeto_id,
  p.ciclo_id,
  c.codigo           as ciclo_codigo,
  p.passivel,
  p.numero,
  p.assunto,
  p.objetivo,
  p.responsavel_id,
  p.responsavel_nome,
  p.inicio,
  p.encerrado_em,
  p.decidido_por,
  p.created_at,
  p.updated_at,
  m.codigo_clockify,
  m.nome             as projeto_nome,
  m.lider_id,
  cl.nome            as cliente_nome,
  li.nome            as lider_nome,
  coalesce(i.total, 0)       as total_acoes,
  coalesce(i.concluidas, 0)  as acoes_concluidas,
  coalesce(i.atrasadas, 0)   as acoes_atrasadas,
  coalesce(i.no_prazo, 0)    as acoes_no_prazo,
  case
    when not p.passivel then 'sem_plano'
    when p.encerrado_em is not null then 'encerrado'
    when coalesce(i.total, 0) = 0 then 'aguardando_acoes'
    when coalesce(i.atrasadas, 0) > 0 then 'com_atraso'
    when i.concluidas = i.total then 'concluido'
    else 'em_andamento'
  end as situacao
from public.planos_acao_nps p
join public.projetos_mestre_nps m on m.id = p.projeto_id
join public.ciclos_nps c on c.id = p.ciclo_id
left join public.clientes_nps cl on cl.id = m.cliente_id
left join public.lideres_nps li on li.id = m.lider_id
left join lateral (
  select count(*) as total,
         count(*) filter (where x.situacao = 'concluido') as concluidas,
         count(*) filter (where x.situacao <> 'concluido'
                            and (x.situacao = 'atrasado' or (x.prazo is not null and x.prazo < current_date))) as atrasadas,
         count(*) filter (where x.situacao <> 'concluido'
                            and x.situacao <> 'atrasado'
                            and (x.prazo is null or x.prazo >= current_date)) as no_prazo
    from public.plano_acao_itens_nps x
   where x.plano_id = p.id
) i on true;

-- Acoes com a situacao EFETIVA: prazo vencido e nao concluida = atrasado.
create or replace view public.vw_plano_acao_itens as
select
  x.*,
  case
    when x.situacao = 'concluido' then 'concluido'
    when x.situacao = 'atrasado' or (x.prazo is not null and x.prazo < current_date) then 'atrasado'
    else 'no_prazo'
  end as situacao_efetiva
from public.plano_acao_itens_nps x;

revoke all on public.vw_planos_acao from anon, authenticated;
revoke all on public.vw_plano_acao_itens from anon, authenticated;

-- ─── Funcoes ────────────────────────────────────────────────────────────────

-- Decisao do PMO (e cabecalho, quando Sim). Chamar de novo troca a decisao ou
-- edita o cabecalho; o numero, uma vez dado, nao muda.
create or replace function public.nps_definir_plano_acao(
  p_projeto_id uuid, p_ciclo_id uuid, p_passivel boolean,
  p_assunto text, p_objetivo text, p_ator text
) returns jsonb
language plpgsql security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_part   public.projetos_nps%rowtype;
  v_ciclo  public.ciclos_nps%rowtype;
  v_proj   public.projetos_mestre_nps%rowtype;
  v_ant    public.planos_acao_nps%rowtype;
  v_lider  text;
  v_numero text;
  v_ano    int;
  v_seq    int;
  v_id     uuid;
  v_itens  int;
begin
  select * into v_ciclo from public.ciclos_nps where id = p_ciclo_id;
  if not found then raise exception 'CICLO_NAO_ENCONTRADO'; end if;

  select * into v_proj from public.projetos_mestre_nps where id = p_projeto_id;
  if not found then raise exception 'PROJETO_NAO_ENCONTRADO'; end if;

  select * into v_part from public.projetos_nps
   where projeto_id = p_projeto_id and ciclo_id = p_ciclo_id;
  if not found or not v_part.elegivel then raise exception 'PROJETO_NAO_ELEGIVEL_NO_CICLO'; end if;

  -- So depois da primeira resposta valida no ciclo.
  if not exists (
    select 1 from public.respostas_nps r
     where r.projeto_id = p_projeto_id and r.ciclo_id = p_ciclo_id
       and r.nota_q4 between 0 and 10
  ) then
    raise exception 'PROJETO_SEM_RESPOSTA_NO_CICLO';
  end if;

  if p_passivel and (nullif(btrim(coalesce(p_assunto, '')), '') is null
                     or nullif(btrim(coalesce(p_objetivo, '')), '') is null) then
    raise exception 'ASSUNTO_E_OBJETIVO_OBRIGATORIOS';
  end if;

  select * into v_ant from public.planos_acao_nps
   where projeto_id = p_projeto_id and ciclo_id = p_ciclo_id for update;

  -- Trocar Sim -> Nao com acoes ja lancadas apagaria o trabalho do lider.
  if found and v_ant.passivel and not p_passivel then
    select count(*) into v_itens from public.plano_acao_itens_nps where plano_id = v_ant.id;
    if v_itens > 0 then raise exception 'PLANO_COM_ACOES'; end if;
  end if;

  select nome into v_lider from public.lideres_nps where id = v_proj.lider_id;

  v_numero := v_ant.numero;
  if p_passivel and v_numero is null then
    -- Sequencial por ano: "001/2026". O lock evita dois planos com o mesmo
    -- numero quando o PMO decide dois projetos ao mesmo tempo.
    perform pg_advisory_xact_lock(hashtext('nps_numero_plano_acao'));
    v_ano := extract(year from now())::int;
    select coalesce(max(split_part(numero, '/', 1)::int), 0) + 1 into v_seq
      from public.planos_acao_nps where numero like '%/' || v_ano;
    v_numero := lpad(v_seq::text, 3, '0') || '/' || v_ano;
  end if;

  insert into public.planos_acao_nps
    (projeto_id, ciclo_id, passivel, numero, assunto, objetivo,
     responsavel_id, responsavel_nome, inicio, decidido_por)
  values (
    p_projeto_id, p_ciclo_id, p_passivel,
    case when p_passivel then v_numero end,
    case when p_passivel then btrim(p_assunto) end,
    case when p_passivel then btrim(p_objetivo) end,
    case when p_passivel then v_proj.lider_id end,
    case when p_passivel then v_lider end,
    case when p_passivel then current_date end,
    p_ator)
  on conflict (projeto_id, ciclo_id) do update set
    passivel         = excluded.passivel,
    numero           = case when excluded.passivel then coalesce(planos_acao_nps.numero, excluded.numero) else planos_acao_nps.numero end,
    assunto          = excluded.assunto,
    objetivo         = excluded.objetivo,
    responsavel_id   = case when excluded.passivel then coalesce(planos_acao_nps.responsavel_id, excluded.responsavel_id) end,
    responsavel_nome = case when excluded.passivel then coalesce(planos_acao_nps.responsavel_nome, excluded.responsavel_nome) end,
    inicio           = case when excluded.passivel then coalesce(planos_acao_nps.inicio, excluded.inicio) end,
    encerrado_em     = case when excluded.passivel then planos_acao_nps.encerrado_em end,
    decidido_por     = excluded.decidido_por
  returning id into v_id;

  perform public.nps_auditar(
    case when v_ant.id is null then 'decidir_plano_acao' else 'alterar_plano_acao' end,
    'plano_acao', v_id,
    format('Projeto %s no ciclo %s: %s', v_proj.codigo_clockify, v_ciclo.codigo,
           case when p_passivel then 'passivel de plano de acao' else 'sem plano de acao' end),
    'pmo', p_ator,
    case when v_ant.id is null then null
         else jsonb_build_object('passivel', v_ant.passivel, 'assunto', v_ant.assunto, 'objetivo', v_ant.objetivo) end,
    jsonb_build_object('passivel', p_passivel, 'assunto', p_assunto, 'objetivo', p_objetivo));

  return jsonb_build_object('id', v_id, 'numero', case when p_passivel then v_numero end, 'passivel', p_passivel);
end;
$function$;

-- Cria (p_item_id nulo) ou edita uma acao. Lider so nos proprios projetos.
create or replace function public.nps_salvar_acao_plano(
  p_plano_id uuid, p_item_id uuid,
  p_o_que text, p_por_que text, p_onde text, p_quem text,
  p_quanto numeric, p_prazo date, p_situacao text, p_observacao text,
  p_ator text, p_ator_tipo text, p_exigir_lider_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_plano public.planos_acao_nps%rowtype;
  v_proj  public.projetos_mestre_nps%rowtype;
  v_ant   public.plano_acao_itens_nps%rowtype;
  v_id    uuid;
  v_ordem int;
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
  if coalesce(p_situacao, 'no_prazo') not in ('no_prazo', 'concluido', 'atrasado') then
    raise exception 'SITUACAO_INVALIDA';
  end if;
  if p_quanto is not null and p_quanto < 0 then raise exception 'VALOR_INVALIDO'; end if;

  if p_item_id is null then
    select coalesce(max(ordem), 0) + 1 into v_ordem from public.plano_acao_itens_nps where plano_id = p_plano_id;
    insert into public.plano_acao_itens_nps
      (plano_id, ordem, o_que, por_que, onde, quem, quanto, prazo, situacao, observacao, atualizado_por)
    values (p_plano_id, v_ordem, btrim(p_o_que), nullif(btrim(coalesce(p_por_que, '')), ''),
            nullif(btrim(coalesce(p_onde, '')), ''), nullif(btrim(coalesce(p_quem, '')), ''),
            p_quanto, p_prazo, coalesce(p_situacao, 'no_prazo'),
            nullif(btrim(coalesce(p_observacao, '')), ''), p_ator)
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
      situacao = coalesce(p_situacao, 'no_prazo'),
      observacao = nullif(btrim(coalesce(p_observacao, '')), ''),
      atualizado_por = p_ator
    where id = p_item_id
    returning id into v_id;
  end if;

  perform public.nps_auditar(
    case when p_item_id is null then 'criar_acao_plano' else 'editar_acao_plano' end,
    'plano_acao', p_plano_id,
    format('Plano %s: acao %s — %s', v_plano.numero,
           case when p_item_id is null then 'criada' else 'atualizada' end, left(btrim(p_o_que), 120)),
    p_ator_tipo, p_ator,
    case when p_item_id is null then null
         else jsonb_build_object('item_id', v_ant.id, 'o_que', v_ant.o_que, 'prazo', v_ant.prazo, 'situacao', v_ant.situacao) end,
    jsonb_build_object('item_id', v_id, 'o_que', p_o_que, 'prazo', p_prazo, 'situacao', coalesce(p_situacao, 'no_prazo')));

  return jsonb_build_object('id', v_id);
end;
$function$;

-- Remove uma acao lancada por engano. A auditoria guarda o que ela era.
create or replace function public.nps_remover_acao_plano(
  p_plano_id uuid, p_item_id uuid, p_ator text, p_ator_tipo text, p_exigir_lider_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_plano public.planos_acao_nps%rowtype;
  v_proj  public.projetos_mestre_nps%rowtype;
  v_ant   public.plano_acao_itens_nps%rowtype;
begin
  select * into v_plano from public.planos_acao_nps where id = p_plano_id;
  if not found then raise exception 'PLANO_NAO_ENCONTRADO'; end if;
  if v_plano.encerrado_em is not null then raise exception 'PLANO_ENCERRADO'; end if;

  select * into v_proj from public.projetos_mestre_nps where id = v_plano.projeto_id;
  if p_exigir_lider_id is not null and v_proj.lider_id is distinct from p_exigir_lider_id then
    raise exception 'NAO_AUTORIZADO';
  end if;

  delete from public.plano_acao_itens_nps where id = p_item_id and plano_id = p_plano_id
  returning * into v_ant;
  if v_ant.id is null then raise exception 'ACAO_NAO_ENCONTRADA'; end if;

  perform public.nps_auditar('remover_acao_plano', 'plano_acao', p_plano_id,
    format('Plano %s: acao removida — %s', v_plano.numero, left(v_ant.o_que, 120)),
    p_ator_tipo, p_ator, to_jsonb(v_ant), null);

  return jsonb_build_object('removida', true);
end;
$function$;

-- Encerra (data de hoje) ou reabre o plano. So o PMO.
create or replace function public.nps_encerrar_plano_acao(
  p_plano_id uuid, p_encerrar boolean, p_ator text
) returns jsonb
language plpgsql security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_plano public.planos_acao_nps%rowtype;
begin
  select * into v_plano from public.planos_acao_nps where id = p_plano_id for update;
  if not found then raise exception 'PLANO_NAO_ENCONTRADO'; end if;
  if not v_plano.passivel then raise exception 'PROJETO_SEM_PLANO_DE_ACAO'; end if;

  update public.planos_acao_nps
     set encerrado_em = case when p_encerrar then current_date end
   where id = p_plano_id;

  perform public.nps_auditar(
    case when p_encerrar then 'encerrar_plano_acao' else 'reabrir_plano_acao' end,
    'plano_acao', p_plano_id,
    format('Plano %s %s', v_plano.numero, case when p_encerrar then 'encerrado' else 'reaberto' end),
    'pmo', p_ator,
    jsonb_build_object('encerrado_em', v_plano.encerrado_em),
    jsonb_build_object('encerrado_em', case when p_encerrar then current_date end));

  return jsonb_build_object('encerrado', p_encerrar);
end;
$function$;

-- Como as demais nps_*: so a service_role (API) executa.
revoke all on function public.nps_definir_plano_acao(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.nps_salvar_acao_plano(uuid, uuid, text, text, text, text, numeric, date, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.nps_remover_acao_plano(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.nps_encerrar_plano_acao(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.nps_definir_plano_acao(uuid, uuid, boolean, text, text, text) to service_role;
grant execute on function public.nps_salvar_acao_plano(uuid, uuid, text, text, text, text, numeric, date, text, text, text, text, uuid) to service_role;
grant execute on function public.nps_remover_acao_plano(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.nps_encerrar_plano_acao(uuid, boolean, text) to service_role;
