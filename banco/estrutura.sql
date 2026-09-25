-- ============================================================================
-- Dashboard NPS — estrutura completa do banco (schema public)
--
-- Extraida do Supabase (projeto NPS_2026, PostgreSQL 17.6) em 2026-09-25,
-- ja com as migrations 01 a 19 aplicadas. E a fonte da verdade da estrutura:
-- as migrations 01-11 foram aplicadas direto no Supabase e nao estao no repo.
--
-- Contem: 14 tabelas, indices, 25 chaves estrangeiras, 18 funcoes, 4 views e
-- 11 triggers. NAO contem dados (ver banco/README.md) nem:
--   - config_acesso / acessos_lideres: senhas antigas em texto puro, sem uso;
--   - permissoes/RLS do Supabase (anon, authenticated): no servidor proprio
--     so o app acessa o banco;
--   - rls_auto_enable: funcao interna do Supabase.
--
-- Para o servidor (schema "nps"), converta antes de rodar:
--   node scripts/converter-dump-schema.mjs banco/estrutura.sql - nps
-- A migration 13 (freio de login) vai depois desta estrutura.
-- ============================================================================

SET search_path = public;
SET check_function_bodies = false;
SET client_min_messages = warning;

-- ─── Extensoes ──────────────────────────────────────────────────────────────
-- pgcrypto: token dos links de pesquisa (gen_random_bytes). Extensao e uma por
-- banco: se ja existir em outro schema, o "if not exists" nao faz nada.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ─── Funcoes ────────────────────────────────────────────────────────────────
-- Vem antes das tabelas: as colunas calculadas nome_norm/codigo_norm chamam
-- nps_norm().

CREATE OR REPLACE FUNCTION public.nps_norm(txt text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
  select upper(btrim(regexp_replace(
    translate(
      txt,
      'àáâãäåèéêëìíîïòóôõöùúûüçñýÿÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑÝ',
      'aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY'
    ),
    '\s+', ' ', 'g')))
$function$
;

CREATE OR REPLACE FUNCTION public.nps_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.usuarios_nps_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.nps_gerar_token()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select replace(replace(replace(encode(extensions.gen_random_bytes(32),'base64'),'+','-'),'/','_'),'=','');
$function$
;

CREATE OR REPLACE FUNCTION public.nps_auditar(p_acao text, p_entidade text, p_registro_id uuid, p_descricao text, p_ator_tipo text, p_ator_nome text, p_antes jsonb DEFAULT NULL::jsonb, p_depois jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  insert into public.auditoria_nps
    (acao, entidade, registro_id, descricao, ator_tipo, ator_nome, valores_anteriores, valores_novos)
  values (p_acao, p_entidade, p_registro_id, p_descricao, p_ator_tipo, p_ator_nome, p_antes, p_depois)
  returning id;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_canal_da_data(p_ciclo_id uuid, p_dia date)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
           -- Sem corte declarado nao ha o que carimbar.
           when c.canal_email_ate is null then null
           -- Fora do ciclo: nem e-mail nem WhatsApp. O canal descreve como a
           -- COLETA DAQUELE CICLO foi conduzida, e uma data de fora dela nao
           -- foi conduzida de jeito nenhum.
           when c.data_inicio is not null and p_dia < c.data_inicio then null
           when c.data_fim    is not null and p_dia > c.data_fim    then null
           when p_dia <= c.canal_email_ate then 'EMAIL'
           else 'WHATSAPP'
         end
    from public.ciclos_nps c
   where c.id = p_ciclo_id;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_canal_pela_janela()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.canal_resposta is not null and btrim(new.canal_resposta) <> '' then
    return new;
  end if;
  if new.ciclo_id is null then
    return new;
  end if;
  new.canal_resposta := public.nps_canal_da_data(
    new.ciclo_id, (coalesce(new."timestamp", now()))::date
  );
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.nps_aplicar_canais_do_ciclo(p_ciclo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_email    integer := 0;
  v_whatsapp integer := 0;
  v_fora     integer := 0;
begin
  if not exists (select 1 from public.ciclos_nps where id = p_ciclo_id) then
    raise exception 'CICLO_NAO_ENCONTRADO';
  end if;

  with alvo as (
    select r.id,
           public.nps_canal_da_data(p_ciclo_id, (r."timestamp")::date) as canal
      from public.respostas_nps r
     where r.ciclo_id = p_ciclo_id
  ),
  aplicado as (
    update public.respostas_nps r
       set canal_resposta = a.canal
      from alvo a
     where r.id = a.id
       and a.canal is not null
       and r.canal_resposta is distinct from a.canal
    returning a.canal
  )
  select count(*) filter (where canal = 'EMAIL'),
         count(*) filter (where canal = 'WHATSAPP')
    into v_email, v_whatsapp
    from aplicado;

  select count(*) into v_fora
    from public.respostas_nps r
   where r.ciclo_id = p_ciclo_id
     and public.nps_canal_da_data(p_ciclo_id, (r."timestamp")::date) is null;

  return jsonb_build_object('email', v_email, 'whatsapp', v_whatsapp, 'fora_das_janelas', v_fora);
end $function$
;

CREATE OR REPLACE FUNCTION public.nps_alterar_lider(p_projeto_id uuid, p_lider_id uuid, p_ator text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_proj    public.projetos_mestre_nps%rowtype;
  v_novo    public.lideres_nps%rowtype;
  v_ant     public.projeto_lideranca_hist_nps%rowtype;
  v_ciclo   uuid;
  v_agora   timestamptz := now();
begin
  select * into v_proj from public.projetos_mestre_nps where id = p_projeto_id for update;
  if not found then raise exception 'PROJETO_NAO_ENCONTRADO'; end if;

  select * into v_novo from public.lideres_nps where id = p_lider_id;
  if not found then raise exception 'LIDER_NAO_ENCONTRADO'; end if;
  if not v_novo.ativo then raise exception 'LIDER_INATIVO'; end if;

  select * into v_ant from public.projeto_lideranca_hist_nps
   where projeto_id = p_projeto_id and encerrado_em is null;

  if v_ant.lider_id is not distinct from p_lider_id then
    return jsonb_build_object('alterado', false, 'motivo', 'LIDER_JA_E_O_ATUAL');
  end if;

  -- 1. Encerra o periodo anterior (historico preservado, nada e sobrescrito)
  if v_ant.id is not null then
    update public.projeto_lideranca_hist_nps
       set encerrado_em = v_agora
     where id = v_ant.id;
  end if;

  -- 2. Abre o novo periodo
  insert into public.projeto_lideranca_hist_nps
    (projeto_id, lider_id, lider_nome, iniciado_em, alterado_por, observacao)
  values (p_projeto_id, v_novo.id, v_novo.nome, v_agora, p_ator, p_observacao);

  -- 3. Lider atual do mestre
  update public.projetos_mestre_nps set lider_id = p_lider_id where id = p_projeto_id;

  -- 4. Participacao no ciclo MAIS RECENTE passa ao novo lider.
  --    Ciclos anteriores permanecem intactos e as respostas NAO sao reatribuidas.
  select p.ciclo_id into v_ciclo
    from public.projetos_nps p join public.ciclos_nps c on c.id = p.ciclo_id
   where p.projeto_id = p_projeto_id
   order by c.data_inicio desc nulls last limit 1;

  if v_ciclo is not null then
    update public.projetos_nps
       set lider = v_novo.nome, lider_id = v_novo.id
     where projeto_id = p_projeto_id and ciclo_id = v_ciclo;
  end if;

  perform public.nps_auditar(
    'alterar_lider', 'projeto', p_projeto_id,
    format('Lider alterado de %s para %s', coalesce(v_ant.lider_nome,'(sem lider)'), v_novo.nome),
    'pmo', p_ator,
    jsonb_build_object('lider_id', v_ant.lider_id, 'lider_nome', v_ant.lider_nome),
    jsonb_build_object('lider_id', v_novo.id, 'lider_nome', v_novo.nome, 'observacao', p_observacao)
  );

  return jsonb_build_object(
    'alterado', true,
    'lider_anterior', v_ant.lider_nome,
    'lider_novo', v_novo.nome,
    'alterado_em', v_agora
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_criar_projeto(p_dados jsonb, p_ator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_id     uuid;
  v_lider  public.lideres_nps%rowtype;
  v_ciclo  public.ciclos_nps%rowtype;
  v_cod    text := btrim(p_dados->>'codigo_clockify');
begin
  if v_cod is null or v_cod = '' then raise exception 'CODIGO_OBRIGATORIO'; end if;
  if nullif(btrim(coalesce(p_dados->>'nome','')),'') is null then raise exception 'NOME_OBRIGATORIO'; end if;

  if exists (select 1 from public.projetos_mestre_nps where codigo_norm = public.nps_norm(v_cod)) then
    raise exception 'CODIGO_DUPLICADO';
  end if;

  insert into public.projetos_mestre_nps
    (codigo_clockify, nome, cliente_id, lider_id, categoria, classe_contratual,
     tipo_servico, segmento_cliente, escopo_geral, status)
  values (
    v_cod,
    btrim(p_dados->>'nome'),
    nullif(p_dados->>'cliente_id','')::uuid,
    nullif(p_dados->>'lider_id','')::uuid,
    nullif(btrim(coalesce(p_dados->>'categoria','')),''),
    nullif(btrim(coalesce(p_dados->>'classe_contratual','')),''),
    nullif(btrim(coalesce(p_dados->>'tipo_servico','')),''),
    nullif(btrim(coalesce(p_dados->>'segmento_cliente','')),''),
    nullif(btrim(coalesce(p_dados->>'escopo_geral','')),''),
    coalesce(nullif(p_dados->>'status',''), 'ativo')
  ) returning id into v_id;

  -- Periodo de lideranca inicial
  select * into v_lider from public.lideres_nps where id = nullif(p_dados->>'lider_id','')::uuid;
  if v_lider.id is not null then
    insert into public.projeto_lideranca_hist_nps
      (projeto_id, lider_id, lider_nome, iniciado_em, alterado_por, observacao)
    values (v_id, v_lider.id, v_lider.nome, now(), p_ator, 'Lider definido no cadastro do projeto.');
  end if;

  -- Participacao no ciclo, quando informado (item 14: nunca automatico)
  select * into v_ciclo from public.ciclos_nps where id = nullif(p_dados->>'ciclo_id','')::uuid;
  if v_ciclo.id is not null then
    insert into public.projetos_nps
      (ciclo, ciclo_id, projeto_id, cliente_id, lider_id, cliente, projeto, lider,
       codigo_clockify, classe_contratual, tipo_servico, segmento_cliente, escopo_geral,
       categoria, elegivel, ativo)
    select v_ciclo.codigo, v_ciclo.id, v_id, m.cliente_id, m.lider_id,
           cl.nome, m.nome, v_lider.nome, m.codigo_clockify, m.classe_contratual,
           m.tipo_servico, m.segmento_cliente, m.escopo_geral, m.categoria,
           coalesce((p_dados->>'elegivel')::boolean, true), true
      from public.projetos_mestre_nps m
      left join public.clientes_nps cl on cl.id = m.cliente_id
     where m.id = v_id;
  end if;

  perform public.nps_auditar('criar', 'projeto', v_id,
    format('Projeto %s criado', v_cod), 'pmo', p_ator, null, p_dados);

  return jsonb_build_object('id', v_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_definir_ativo_projeto(p_projeto_id uuid, p_ativo boolean, p_ator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_antes boolean;
begin
  select ativo into v_antes from public.projetos_mestre_nps where id = p_projeto_id for update;
  if not found then raise exception 'PROJETO_NAO_ENCONTRADO'; end if;

  update public.projetos_mestre_nps set ativo = p_ativo where id = p_projeto_id;

  perform public.nps_auditar(
    case when p_ativo then 'reativar' else 'inativar' end, 'projeto', p_projeto_id,
    case when p_ativo then 'Projeto reativado' else 'Projeto inativado (dados historicos preservados)' end,
    'pmo', p_ator,
    jsonb_build_object('ativo', v_antes), jsonb_build_object('ativo', p_ativo));

  return jsonb_build_object('ativo', p_ativo);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_definir_participacao_ciclo(p_projeto_id uuid, p_ciclo_id uuid, p_participar boolean, p_elegivel boolean, p_ator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_ciclo public.ciclos_nps%rowtype;
  v_m     public.projetos_mestre_nps%rowtype;
  v_cli   text;
  v_lid   text;
  v_ex    public.projetos_nps%rowtype;
begin
  select * into v_ciclo from public.ciclos_nps where id = p_ciclo_id;
  if not found then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  if v_ciclo.status = 'encerrado' then raise exception 'CICLO_ENCERRADO'; end if;

  select * into v_m from public.projetos_mestre_nps where id = p_projeto_id;
  if not found then raise exception 'PROJETO_NAO_ENCONTRADO'; end if;

  select * into v_ex from public.projetos_nps where projeto_id = p_projeto_id and ciclo_id = p_ciclo_id;

  if p_participar then
    select nome into v_cli from public.clientes_nps where id = v_m.cliente_id;
    select nome into v_lid from public.lideres_nps  where id = v_m.lider_id;

    if v_ex.id is null then
      insert into public.projetos_nps
        (ciclo, ciclo_id, projeto_id, cliente_id, lider_id, cliente, projeto, lider,
         codigo_clockify, classe_contratual, tipo_servico, segmento_cliente, escopo_geral,
         categoria, elegivel, ativo)
      values (v_ciclo.codigo, v_ciclo.id, v_m.id, v_m.cliente_id, v_m.lider_id,
              v_cli, v_m.nome, v_lid, v_m.codigo_clockify, v_m.classe_contratual,
              v_m.tipo_servico, v_m.segmento_cliente, v_m.escopo_geral, v_m.categoria,
              coalesce(p_elegivel, true), true);
      perform public.nps_auditar('incluir_em_ciclo','projeto', p_projeto_id,
        format('Projeto incluido no ciclo %s', v_ciclo.codigo), 'pmo', p_ator, null,
        jsonb_build_object('ciclo', v_ciclo.codigo, 'elegivel', coalesce(p_elegivel,true)));
    else
      update public.projetos_nps set elegivel = coalesce(p_elegivel, elegivel), ativo = true
       where id = v_ex.id;
      perform public.nps_auditar('alterar_elegibilidade','projeto', p_projeto_id,
        format('Elegibilidade no ciclo %s', v_ciclo.codigo), 'pmo', p_ator,
        jsonb_build_object('elegivel', v_ex.elegivel),
        jsonb_build_object('elegivel', coalesce(p_elegivel, v_ex.elegivel)));
    end if;
  else
    if v_ex.id is null then
      return jsonb_build_object('alterado', false, 'motivo', 'PROJETO_NAO_ESTA_NO_CICLO');
    end if;
    -- Nunca apaga: marca como inativo/nao elegivel naquele ciclo
    update public.projetos_nps set ativo = false, elegivel = false where id = v_ex.id;
    perform public.nps_auditar('retirar_de_ciclo','projeto', p_projeto_id,
      format('Projeto retirado do ciclo %s (registro preservado)', v_ciclo.codigo),
      'pmo', p_ator, jsonb_build_object('ativo', true), jsonb_build_object('ativo', false));
  end if;

  return jsonb_build_object('alterado', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_definir_participantes_ciclo(p_ciclo_id uuid, p_itens jsonb, p_ator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  item        jsonb;
  v_ciclo     public.ciclos_nps%rowtype;
  v_projeto   uuid;
  v_participa boolean;
  v_elegivel  boolean;
  v_incluidos int := 0;
  v_retirados int := 0;
begin
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'ITENS_INVALIDOS'; end if;

  select * into v_ciclo from public.ciclos_nps where id = p_ciclo_id;
  if not found then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
  if v_ciclo.status = 'encerrado' then raise exception 'CICLO_ENCERRADO'; end if;

  for item in select * from jsonb_array_elements(p_itens) loop
    v_projeto   := (item->>'projeto_id')::uuid;
    v_participa := coalesce((item->>'participar')::boolean, false);
    v_elegivel  := coalesce((item->>'elegivel')::boolean, true);

    perform public.nps_definir_participacao_ciclo(
      v_projeto, p_ciclo_id, v_participa, v_elegivel, p_ator);

    if v_participa then v_incluidos := v_incluidos + 1;
    else v_retirados := v_retirados + 1;
    end if;
  end loop;

  perform public.nps_auditar(
    'definir_participantes', 'ciclo', p_ciclo_id,
    format('Participantes do ciclo %s definidos: %s incluidos, %s retirados',
           v_ciclo.codigo, v_incluidos, v_retirados),
    'pmo', p_ator, null,
    jsonb_build_object('incluidos', v_incluidos, 'retirados', v_retirados));

  return jsonb_build_object('incluidos', v_incluidos, 'retirados', v_retirados);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_definir_status_ciclo(p_ciclo_id uuid, p_status text, p_ator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_antes text; v_cod text;
begin
  if p_status not in ('planejamento','aberto','encerrado') then raise exception 'STATUS_INVALIDO'; end if;
  select status, codigo into v_antes, v_cod from public.ciclos_nps where id = p_ciclo_id for update;
  if not found then raise exception 'CICLO_NAO_ENCONTRADO'; end if;

  update public.ciclos_nps set status = p_status where id = p_ciclo_id;

  perform public.nps_auditar('alterar_status','ciclo', p_ciclo_id,
    format('Ciclo %s: %s -> %s', v_cod, v_antes, p_status), 'pmo', p_ator,
    jsonb_build_object('status', v_antes), jsonb_build_object('status', p_status));

  return jsonb_build_object('status', p_status);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_gerar_pesquisa(p_projeto_id uuid, p_respondente_id uuid, p_tipo text, p_ciclo_id uuid, p_ator text, p_forcar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_exist public.pesquisas_nps%rowtype;
  v_proj  public.projetos_mestre_nps%rowtype;
  v_resp  public.respondentes_nps%rowtype;
  v_lider text;
  v_cli   text;
  v_id    uuid;
  v_token text;
  v_ciclo uuid := case when p_tipo = 'finalizacao' then null else p_ciclo_id end;
begin
  if p_tipo not in ('ciclo_semestral','finalizacao') then raise exception 'TIPO_INVALIDO'; end if;
  if p_tipo = 'ciclo_semestral' and v_ciclo is null then raise exception 'CICLO_OBRIGATORIO'; end if;

  select * into v_proj from public.projetos_mestre_nps where id = p_projeto_id;
  if not found then raise exception 'PROJETO_NAO_ENCONTRADO'; end if;
  if not v_proj.ativo then raise exception 'PROJETO_INATIVO'; end if;

  select * into v_resp from public.respondentes_nps where id = p_respondente_id;
  if not found then raise exception 'RESPONDENTE_NAO_ENCONTRADO'; end if;

  -- Verificacao de duplicidade ANTES de gerar (item 8 — nunca silenciosa)
  select * into v_exist from public.pesquisas_nps
   where projeto_id = p_projeto_id and respondente_id = p_respondente_id
     and tipo = p_tipo
     and coalesce(ciclo_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(v_ciclo,'00000000-0000-0000-0000-000000000000'::uuid)
     and ativo;

  if found and not p_forcar then
    return jsonb_build_object(
      'duplicada', true,
      'pesquisa', jsonb_build_object(
        'id', v_exist.id, 'token', v_exist.token, 'status', v_exist.status,
        'data_geracao', v_exist.data_geracao, 'data_envio', v_exist.data_envio,
        'data_resposta', v_exist.data_resposta));
  end if;

  -- Forcado: encerra a anterior preservando o registro (nunca apaga)
  if found and p_forcar then
    update public.pesquisas_nps set ativo = false, status = 'encerrada' where id = v_exist.id;
    perform public.nps_auditar('encerrar','pesquisa', v_exist.id,
      'Pesquisa encerrada para permitir nova geracao da mesma combinacao', 'pmo', p_ator,
      jsonb_build_object('status', v_exist.status, 'ativo', true), null);
  end if;

  select nome into v_cli   from public.clientes_nps where id = v_proj.cliente_id;
  select nome into v_lider from public.lideres_nps  where id = v_proj.lider_id;
  v_token := public.nps_gerar_token();

  insert into public.pesquisas_nps
    (projeto_id, respondente_id, tipo, ciclo_id, token, status,
     lider_nome, cliente_nome, projeto_nome, gerada_por)
  values (p_projeto_id, p_respondente_id, p_tipo, v_ciclo, v_token, 'gerada',
          v_lider, v_cli, v_proj.nome, p_ator)
  returning id into v_id;

  -- Garante o vinculo N:N projeto <-> respondente
  insert into public.projeto_respondentes_nps (projeto_id, respondente_id)
  values (p_projeto_id, p_respondente_id)
  on conflict (projeto_id, respondente_id) do update set ativo = true;

  perform public.nps_auditar('gerar','pesquisa', v_id,
    format('Pesquisa %s gerada para %s no projeto %s', p_tipo, v_resp.nome, v_proj.codigo_clockify),
    'pmo', p_ator, null,
    jsonb_build_object('projeto_id', p_projeto_id, 'respondente_id', p_respondente_id,
                       'tipo', p_tipo, 'ciclo_id', v_ciclo));

  return jsonb_build_object('duplicada', false,
    'pesquisa', jsonb_build_object('id', v_id, 'token', v_token, 'status','gerada'));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_participantes_do_ciclo(p_ciclo_id uuid)
 RETURNS TABLE(projeto_id uuid, codigo_clockify text, projeto_nome text, cliente_nome text, lider_nome text, status text, participa boolean, elegivel boolean, respostas bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select
    m.id,
    m.codigo_clockify,
    m.nome,
    cl.nome,
    li.nome,
    m.status,
    (p.id is not null and p.ativo) as participa,
    coalesce(p.elegivel, true)     as elegivel,
    coalesce(r.total, 0)           as respostas
  from public.projetos_mestre_nps m
  left join public.clientes_nps cl on cl.id = m.cliente_id
  left join public.lideres_nps  li on li.id = m.lider_id
  left join public.projetos_nps  p on p.projeto_id = m.id and p.ciclo_id = p_ciclo_id
  left join lateral (
    select count(*) as total from public.respostas_nps rr
    where rr.projeto_id = m.id and rr.ciclo_id = p_ciclo_id and rr.nota_q4 between 0 and 10
  ) r on true
  where m.ativo
  order by cl.nome nulls last, m.nome;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_passagem_ciclo(p_ciclo_origem_id uuid, p_ciclo_destino_id uuid, p_decisoes jsonb, p_ator text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  d           jsonb;
  v_projeto   uuid;
  v_decisao   text;
  v_motivo    text;
  v_obs       text;
  v_levados   int := 0;
  v_registros int := 0;
begin
  if jsonb_typeof(p_decisoes) <> 'array' then raise exception 'DECISOES_INVALIDAS'; end if;

  for d in select * from jsonb_array_elements(p_decisoes) loop
    v_projeto := (d->>'projeto_id')::uuid;
    v_decisao := d->>'decisao';
    v_motivo  := nullif(btrim(coalesce(d->>'motivo','')),'');
    v_obs     := nullif(btrim(coalesce(d->>'observacao','')),'');

    if v_decisao not in ('levar','nao_levar','encerrado','pesquisa_finalizacao','nao_elegivel') then
      raise exception 'DECISAO_INVALIDA: %', v_decisao;
    end if;
    if v_motivo = 'outro' and v_obs is null then
      raise exception 'OBSERVACAO_OBRIGATORIA_PARA_OUTRO';
    end if;

    insert into public.ciclo_transicao_nps
      (projeto_id, ciclo_origem_id, ciclo_destino_id, decisao, motivo, observacao, decidido_por)
    values (v_projeto, p_ciclo_origem_id, p_ciclo_destino_id, v_decisao, v_motivo, v_obs, p_ator)
    on conflict (projeto_id, ciclo_destino_id) do update
      set decisao = excluded.decisao, motivo = excluded.motivo,
          observacao = excluded.observacao, decidido_por = excluded.decidido_por;
    v_registros := v_registros + 1;

    -- Somente "levar" e "pesquisa_finalizacao" entram no ciclo destino
    if v_decisao in ('levar','pesquisa_finalizacao') then
      perform public.nps_definir_participacao_ciclo(
        v_projeto, p_ciclo_destino_id, true,
        (v_decisao = 'levar'), p_ator);
      v_levados := v_levados + 1;
    end if;

    perform public.nps_auditar('passagem_ciclo','projeto', v_projeto,
      format('Decisao de passagem: %s%s', v_decisao, coalesce(' / '||v_motivo,'')),
      'pmo', p_ator, null,
      jsonb_build_object('ciclo_origem', p_ciclo_origem_id, 'ciclo_destino', p_ciclo_destino_id,
                         'decisao', v_decisao, 'motivo', v_motivo, 'observacao', v_obs));
  end loop;

  return jsonb_build_object('registros', v_registros, 'levados', v_levados);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_registrar_isc(p_projeto_id uuid, p_competencia date, p_nota integer, p_observacao text, p_ator text, p_ator_tipo text, p_exigir_lider_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_comp  date := date_trunc('month', p_competencia)::date;
  v_proj  public.projetos_mestre_nps%rowtype;
  v_lider text;
  v_ante  public.isc_nps%rowtype;
  v_id    uuid;
begin
  if p_nota is null or p_nota < 0 or p_nota > 10 then raise exception 'NOTA_INVALIDA'; end if;

  select * into v_proj from public.projetos_mestre_nps where id = p_projeto_id;
  if not found then raise exception 'PROJETO_NAO_ENCONTRADO'; end if;
  if not v_proj.ativo then raise exception 'PROJETO_INATIVO'; end if;

  -- Autorizacao validada no servidor: lider so registra nos proprios projetos (item 27)
  if p_exigir_lider_id is not null and v_proj.lider_id is distinct from p_exigir_lider_id then
    raise exception 'NAO_AUTORIZADO';
  end if;

  -- Preserva o lider correspondente ao periodo da competencia (item 23)
  select h.lider_nome into v_lider
    from public.projeto_lideranca_hist_nps h
   where h.projeto_id = p_projeto_id
     and h.iniciado_em < (v_comp + interval '1 month')
     and (h.encerrado_em is null or h.encerrado_em >= v_comp)
   order by h.iniciado_em desc limit 1;

  if v_lider is null then
    select nome into v_lider from public.lideres_nps where id = v_proj.lider_id;
  end if;

  select * into v_ante from public.isc_nps where projeto_id = p_projeto_id and competencia = v_comp;

  insert into public.isc_nps
    (projeto_id, lider_id, lider_nome, competencia, nota, observacao, registrado_por)
  values (p_projeto_id, v_proj.lider_id, coalesce(v_lider,'N/A'), v_comp, p_nota,
          nullif(btrim(coalesce(p_observacao,'')),''), p_ator)
  on conflict (projeto_id, competencia) do update
    set nota = excluded.nota,
        observacao = excluded.observacao,
        registrado_por = excluded.registrado_por,
        lider_id = excluded.lider_id,
        lider_nome = excluded.lider_nome
  returning id into v_id;

  perform public.nps_auditar(
    case when v_ante.id is null then 'registrar' else 'editar' end, 'isc', v_id,
    format('ISC %s/%s = %s', to_char(v_comp,'MM'), to_char(v_comp,'YYYY'), p_nota),
    p_ator_tipo, p_ator,
    case when v_ante.id is null then null
         else jsonb_build_object('nota', v_ante.nota, 'observacao', v_ante.observacao) end,
    jsonb_build_object('nota', p_nota, 'observacao', p_observacao));

  return jsonb_build_object('id', v_id, 'competencia', v_comp, 'nota', p_nota);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nps_responder_pesquisa(p_token text, p_q1 integer, p_q2 integer, p_q3 integer, p_q4 integer, p_feedback text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_s        public.pesquisas_nps%rowtype;
  v_proj     public.projetos_mestre_nps%rowtype;
  v_resp     public.respondentes_nps%rowtype;
  v_ciclo_cd text;
  v_ciclo_id uuid;
  v_rid      uuid;
begin
  if p_q4 is null or p_q4 < 0 or p_q4 > 10 then raise exception 'Q4_OBRIGATORIA'; end if;
  if p_q1 is not null and (p_q1 < 0 or p_q1 > 10) then raise exception 'NOTA_INVALIDA'; end if;
  if p_q2 is not null and (p_q2 < 0 or p_q2 > 10) then raise exception 'NOTA_INVALIDA'; end if;
  if p_q3 is not null and (p_q3 < 0 or p_q3 > 10) then raise exception 'NOTA_INVALIDA'; end if;

  select * into v_s from public.pesquisas_nps where token = p_token for update;
  if not found then raise exception 'PESQUISA_NAO_ENCONTRADA'; end if;
  if not v_s.ativo then raise exception 'PESQUISA_ENCERRADA'; end if;
  if v_s.status = 'respondida' then raise exception 'PESQUISA_JA_RESPONDIDA'; end if;

  select * into v_proj from public.projetos_mestre_nps where id = v_s.projeto_id;
  select * into v_resp from public.respondentes_nps   where id = v_s.respondente_id;

  v_ciclo_id := v_s.ciclo_id;
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
     pesquisa_id, respondente_id, projeto_id)
  values
    (v_resp.nome, p_q1, p_q2, p_q3, p_q4, nullif(btrim(coalesce(p_feedback,'')),''), now(),
     v_ciclo_cd, v_ciclo_id, v_proj.codigo_clockify,
     v_s.cliente_nome, v_s.lider_nome, v_proj.nome,
     v_proj.classe_contratual, v_proj.tipo_servico, v_proj.segmento_cliente, v_proj.escopo_geral,
     'LINK', true, 'pesquisa_token',
     v_s.id, v_s.respondente_id, v_s.projeto_id)
  returning id into v_rid;

  update public.pesquisas_nps
     set status = 'respondida', data_resposta = now(), resposta_id = v_rid
   where id = v_s.id;

  perform public.nps_auditar('responder','pesquisa', v_s.id,
    format('Resposta registrada por %s', v_resp.nome), 'respondente', v_resp.nome,
    null, jsonb_build_object('resposta_id', v_rid, 'nota_q4', p_q4));

  return jsonb_build_object('ok', true, 'resposta_id', v_rid);
end;
$function$
;

-- ─── Tabelas ────────────────────────────────────────────────────────────────

CREATE TABLE public.auditoria_nps (
  id uuid default gen_random_uuid() not null,
  acao text not null,
  entidade text not null,
  registro_id uuid,
  descricao text,
  ator_tipo text not null,
  ator_nome text not null,
  valores_anteriores jsonb,
  valores_novos jsonb,
  created_at timestamp with time zone default now() not null,
  constraint auditoria_ator_tipo_chk CHECK ((ator_tipo = ANY (ARRAY['pmo'::text, 'lider'::text, 'sistema'::text, 'respondente'::text]))),
  constraint auditoria_nps_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ciclo_transicao_nps (
  id uuid default gen_random_uuid() not null,
  projeto_id uuid not null,
  ciclo_origem_id uuid,
  ciclo_destino_id uuid not null,
  decisao text not null,
  motivo text,
  observacao text,
  decidido_por text not null,
  created_at timestamp with time zone default now() not null,
  constraint ciclo_transicao_decisao_chk CHECK ((decisao = ANY (ARRAY['levar'::text, 'nao_levar'::text, 'encerrado'::text, 'pesquisa_finalizacao'::text, 'nao_elegivel'::text]))),
  constraint ciclo_transicao_motivo_chk CHECK (((motivo IS NULL) OR (motivo = ANY (ARRAY['projeto_encerrado'::text, 'menos_de_tres_meses'::text, 'em_encerramento'::text, 'cancelado'::text, 'standby'::text, 'outro'::text])))),
  constraint ciclo_transicao_outro_exige_obs CHECK (((motivo <> 'outro'::text) OR (NULLIF(btrim(COALESCE(observacao, ''::text)), ''::text) IS NOT NULL))),
  constraint ciclo_transicao_nps_pkey PRIMARY KEY (id),
  constraint uq_ciclo_transicao UNIQUE (projeto_id, ciclo_destino_id)
);

CREATE TABLE public.ciclos_nps (
  id uuid default gen_random_uuid() not null,
  codigo text not null,
  descricao text,
  status text default 'planejamento'::text not null,
  data_inicio date,
  data_fim date,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  canal_email_ate date,
  constraint ciclos_nps_corte_chk CHECK (((canal_email_ate IS NULL) OR (((data_inicio IS NULL) OR (canal_email_ate >= data_inicio)) AND ((data_fim IS NULL) OR (canal_email_ate <= data_fim))))),
  constraint ciclos_nps_status_chk CHECK ((status = ANY (ARRAY['planejamento'::text, 'aberto'::text, 'encerrado'::text]))),
  constraint ciclos_nps_pkey PRIMARY KEY (id),
  constraint ciclos_nps_codigo_key UNIQUE (codigo)
);

CREATE TABLE public.clientes_nps (
  id uuid default gen_random_uuid() not null,
  nome text not null,
  nome_norm text GENERATED ALWAYS AS (nps_norm(nome)) STORED,
  segmento text,
  ativo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint clientes_nps_nome_nao_vazio CHECK ((btrim(nome) <> ''::text)),
  constraint clientes_nps_pkey PRIMARY KEY (id),
  constraint clientes_nps_nome_norm_key UNIQUE (nome_norm)
);

CREATE TABLE public.isc_nps (
  id uuid default gen_random_uuid() not null,
  projeto_id uuid not null,
  lider_id uuid,
  lider_nome text not null,
  competencia date not null,
  nota smallint not null,
  observacao text,
  registrado_por text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint isc_nps_competencia_dia1_chk CHECK ((EXTRACT(day FROM competencia) = (1)::numeric)),
  constraint isc_nps_nota_chk CHECK (((nota >= 0) AND (nota <= 10))),
  constraint isc_nps_pkey PRIMARY KEY (id),
  constraint uq_isc_projeto_competencia UNIQUE (projeto_id, competencia)
);

CREATE TABLE public.lideres_nps (
  id uuid default gen_random_uuid() not null,
  nome text not null,
  nome_norm text GENERATED ALWAYS AS (nps_norm(nome)) STORED,
  email text,
  ativo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint lideres_nps_nome_nao_vazio CHECK ((btrim(nome) <> ''::text)),
  constraint lideres_nps_pkey PRIMARY KEY (id),
  constraint lideres_nps_nome_norm_key UNIQUE (nome_norm)
);

CREATE TABLE public.pesquisas_nps (
  id uuid default gen_random_uuid() not null,
  projeto_id uuid not null,
  respondente_id uuid not null,
  tipo text not null,
  ciclo_id uuid,
  token text not null,
  status text default 'gerada'::text not null,
  lider_nome text,
  cliente_nome text,
  projeto_nome text,
  data_geracao timestamp with time zone default now() not null,
  data_envio timestamp with time zone,
  data_resposta timestamp with time zone,
  resposta_id uuid,
  gerada_por text default 'PMO'::text not null,
  ativo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint pesquisas_nps_ciclo_chk CHECK (((tipo <> 'ciclo_semestral'::text) OR (ciclo_id IS NOT NULL))),
  constraint pesquisas_nps_status_chk CHECK ((status = ANY (ARRAY['gerada'::text, 'enviada'::text, 'respondida'::text, 'pendente'::text, 'encerrada'::text]))),
  constraint pesquisas_nps_tipo_chk CHECK ((tipo = ANY (ARRAY['ciclo_semestral'::text, 'finalizacao'::text]))),
  constraint pesquisas_nps_pkey PRIMARY KEY (id),
  constraint pesquisas_nps_token_key UNIQUE (token)
);

CREATE TABLE public.projeto_lideranca_hist_nps (
  id uuid default gen_random_uuid() not null,
  projeto_id uuid not null,
  lider_id uuid,
  lider_nome text not null,
  iniciado_em timestamp with time zone default now() not null,
  encerrado_em timestamp with time zone,
  alterado_por text default 'SISTEMA'::text not null,
  observacao text,
  created_at timestamp with time zone default now() not null,
  constraint lideranca_periodo_valido CHECK (((encerrado_em IS NULL) OR (encerrado_em >= iniciado_em))),
  constraint projeto_lideranca_hist_nps_pkey PRIMARY KEY (id)
);

CREATE TABLE public.projeto_respondentes_nps (
  id uuid default gen_random_uuid() not null,
  projeto_id uuid not null,
  respondente_id uuid not null,
  ativo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint projeto_respondentes_nps_pkey PRIMARY KEY (id),
  constraint uq_projeto_respondente UNIQUE (projeto_id, respondente_id)
);

CREATE TABLE public.projetos_mestre_nps (
  id uuid default gen_random_uuid() not null,
  codigo_clockify text not null,
  codigo_norm text GENERATED ALWAYS AS (nps_norm(codigo_clockify)) STORED,
  nome text not null,
  cliente_id uuid,
  lider_id uuid,
  categoria text,
  classe_contratual text,
  tipo_servico text,
  segmento_cliente text,
  escopo_geral text,
  status text default 'ativo'::text not null,
  ativo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  vendedor text,
  acesso text,
  lider_clockrview text,
  constraint projetos_mestre_acesso_tam CHECK ((char_length(acesso) <= 60)),
  constraint projetos_mestre_nps_codigo_nao_vazio CHECK ((btrim(codigo_clockify) <> ''::text)),
  constraint projetos_mestre_nps_status_chk CHECK ((status = ANY (ARRAY['ativo'::text, 'em_encerramento'::text, 'encerrado'::text, 'cancelado'::text, 'standby'::text]))),
  constraint projetos_mestre_vendedor_tam CHECK ((char_length(vendedor) <= 160)),
  constraint projetos_mestre_nps_pkey PRIMARY KEY (id),
  constraint projetos_mestre_nps_codigo_norm_key UNIQUE (codigo_norm)
);

CREATE TABLE public.projetos_nps (
  id uuid default gen_random_uuid() not null,
  ciclo text not null,
  cliente text,
  projeto text,
  projeto_key text,
  lider text,
  classe_contratual text,
  tipo_servico text,
  escopo_geral text,
  codigo_clockify text,
  ativo boolean default true,
  segmento_cliente text,
  projeto_id uuid,
  ciclo_id uuid,
  cliente_id uuid,
  lider_id uuid,
  categoria text,
  elegivel boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint projetos_nps_pkey PRIMARY KEY (id)
);

CREATE TABLE public.respondentes_nps (
  id uuid default gen_random_uuid() not null,
  nome text not null,
  nome_norm text GENERATED ALWAYS AS (nps_norm(nome)) STORED,
  cliente_id uuid,
  email text,
  email_norm text GENERATED ALWAYS AS (NULLIF(lower(btrim(email)), ''::text)) STORED,
  telefone text,
  ativo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint respondentes_nps_nome_nao_vazio CHECK ((btrim(nome) <> ''::text)),
  constraint respondentes_nps_pkey PRIMARY KEY (id)
);

CREATE TABLE public.respostas_nps (
  id uuid default gen_random_uuid() not null,
  identificador text not null,
  nota_q1 integer,
  nota_q2 integer,
  nota_q3 integer,
  nota_q4 integer,
  feedback text,
  "timestamp" timestamp with time zone,
  lider text,
  ciclo text,
  projeto text,
  projeto_key text,
  classe_contratual text,
  tipo_servico text,
  canal_resposta text,
  respondeu boolean default true,
  cliente text,
  codigo_clockify text,
  escopo_geral text,
  segmento_cliente text,
  match_projeto text,
  pesquisa_id uuid,
  respondente_id uuid,
  projeto_id uuid,
  ciclo_id uuid,
  created_at timestamp with time zone default now() not null,
  constraint respostas_nps_pkey PRIMARY KEY (id)
);

CREATE TABLE public.usuarios_nps (
  id uuid default gen_random_uuid() not null,
  nome text not null,
  email text not null,
  email_norm text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  senha_hash text not null,
  papel text default 'lider'::text not null,
  lider_id uuid,
  ativo boolean default true not null,
  ultimo_acesso_em timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint usuarios_nps_email_chk CHECK ((email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text)),
  constraint usuarios_nps_nome_chk CHECK ((btrim(nome) <> ''::text)),
  constraint usuarios_nps_papel_chk CHECK ((papel = ANY (ARRAY['pmo'::text, 'lider'::text]))),
  constraint usuarios_nps_pkey PRIMARY KEY (id),
  constraint usuarios_nps_email_norm_key UNIQUE (email_norm)
);

-- ─── Indices ────────────────────────────────────────────────────────────────

CREATE INDEX idx_auditoria_ator ON public.auditoria_nps USING btree (ator_nome, created_at DESC);
CREATE INDEX idx_auditoria_data ON public.auditoria_nps USING btree (created_at DESC);
CREATE INDEX idx_auditoria_entidade ON public.auditoria_nps USING btree (entidade, registro_id, created_at DESC);
CREATE INDEX idx_isc_competencia ON public.isc_nps USING btree (competencia DESC);
CREATE INDEX idx_isc_lider ON public.isc_nps USING btree (lider_id);
CREATE INDEX idx_lideranca_lider ON public.projeto_lideranca_hist_nps USING btree (lider_id);
CREATE INDEX idx_lideranca_projeto ON public.projeto_lideranca_hist_nps USING btree (projeto_id, iniciado_em DESC);
CREATE INDEX idx_pesquisas_ciclo ON public.pesquisas_nps USING btree (ciclo_id);
CREATE INDEX idx_pesquisas_projeto ON public.pesquisas_nps USING btree (projeto_id);
CREATE INDEX idx_pesquisas_status ON public.pesquisas_nps USING btree (status);
CREATE INDEX idx_proj_resp_projeto ON public.projeto_respondentes_nps USING btree (projeto_id);
CREATE INDEX idx_proj_resp_respondente ON public.projeto_respondentes_nps USING btree (respondente_id);
CREATE INDEX idx_projetos_mestre_ativo ON public.projetos_mestre_nps USING btree (ativo);
CREATE INDEX idx_projetos_mestre_cliente ON public.projetos_mestre_nps USING btree (cliente_id);
CREATE INDEX idx_projetos_mestre_lider ON public.projetos_mestre_nps USING btree (lider_id);
CREATE INDEX idx_projetos_nps_ciclo ON public.projetos_nps USING btree (ciclo_id);
CREATE INDEX idx_projetos_nps_cod ON public.projetos_nps USING btree (nps_norm(codigo_clockify));
CREATE INDEX idx_projetos_nps_lider ON public.projetos_nps USING btree (lider_id);
CREATE INDEX idx_projetos_nps_projeto ON public.projetos_nps USING btree (projeto_id);
CREATE INDEX idx_respostas_ciclo ON public.respostas_nps USING btree (ciclo);
CREATE INDEX idx_respostas_cod ON public.respostas_nps USING btree (nps_norm(codigo_clockify));
CREATE INDEX idx_respostas_pesquisa ON public.respostas_nps USING btree (pesquisa_id);
CREATE INDEX idx_respostas_projeto ON public.respostas_nps USING btree (projeto_id);
CREATE INDEX idx_respostas_respondente ON public.respostas_nps USING btree (respondente_id);
CREATE INDEX idx_transicao_destino ON public.ciclo_transicao_nps USING btree (ciclo_destino_id);
CREATE UNIQUE INDEX uq_lideranca_periodo_aberto ON public.projeto_lideranca_hist_nps USING btree (projeto_id) WHERE (encerrado_em IS NULL);
CREATE UNIQUE INDEX uq_pesquisa_combinacao ON public.pesquisas_nps USING btree (projeto_id, respondente_id, tipo, COALESCE(ciclo_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE ativo;
CREATE UNIQUE INDEX uq_projetos_nps_ciclo_codigo ON public.projetos_nps USING btree (nps_norm(ciclo), nps_norm(codigo_clockify));
CREATE UNIQUE INDEX uq_respondentes_email ON public.respondentes_nps USING btree (email_norm) WHERE (email_norm IS NOT NULL);
CREATE UNIQUE INDEX uq_respondentes_nome_cliente ON public.respondentes_nps USING btree (nome_norm, cliente_id) WHERE (cliente_id IS NOT NULL);
CREATE UNIQUE INDEX uq_respondentes_nome_sem_cliente ON public.respondentes_nps USING btree (nome_norm) WHERE (cliente_id IS NULL);
CREATE INDEX usuarios_nps_lider_idx ON public.usuarios_nps USING btree (lider_id);

-- ─── Chaves estrangeiras ────────────────────────────────────────────────────
-- Depois das tabelas porque pesquisas_nps e respostas_nps apontam uma para a
-- outra. Numa carga de dados, rode os dados ANTES deste bloco (ou com
-- session_replication_role = replica, como faz banco/dados gerado pelo script).

ALTER TABLE ONLY public.ciclo_transicao_nps
  ADD CONSTRAINT ciclo_transicao_nps_ciclo_destino_id_fkey FOREIGN KEY (ciclo_destino_id) REFERENCES ciclos_nps(id);
ALTER TABLE ONLY public.ciclo_transicao_nps
  ADD CONSTRAINT ciclo_transicao_nps_ciclo_origem_id_fkey FOREIGN KEY (ciclo_origem_id) REFERENCES ciclos_nps(id);
ALTER TABLE ONLY public.ciclo_transicao_nps
  ADD CONSTRAINT ciclo_transicao_nps_projeto_id_fkey FOREIGN KEY (projeto_id) REFERENCES projetos_mestre_nps(id);
ALTER TABLE ONLY public.isc_nps
  ADD CONSTRAINT isc_nps_lider_id_fkey FOREIGN KEY (lider_id) REFERENCES lideres_nps(id);
ALTER TABLE ONLY public.isc_nps
  ADD CONSTRAINT isc_nps_projeto_id_fkey FOREIGN KEY (projeto_id) REFERENCES projetos_mestre_nps(id);
ALTER TABLE ONLY public.pesquisas_nps
  ADD CONSTRAINT pesquisas_nps_ciclo_id_fkey FOREIGN KEY (ciclo_id) REFERENCES ciclos_nps(id);
ALTER TABLE ONLY public.pesquisas_nps
  ADD CONSTRAINT pesquisas_nps_projeto_id_fkey FOREIGN KEY (projeto_id) REFERENCES projetos_mestre_nps(id);
ALTER TABLE ONLY public.pesquisas_nps
  ADD CONSTRAINT pesquisas_nps_respondente_id_fkey FOREIGN KEY (respondente_id) REFERENCES respondentes_nps(id);
ALTER TABLE ONLY public.pesquisas_nps
  ADD CONSTRAINT pesquisas_nps_resposta_id_fkey FOREIGN KEY (resposta_id) REFERENCES respostas_nps(id);
ALTER TABLE ONLY public.projeto_lideranca_hist_nps
  ADD CONSTRAINT projeto_lideranca_hist_nps_lider_id_fkey FOREIGN KEY (lider_id) REFERENCES lideres_nps(id);
ALTER TABLE ONLY public.projeto_lideranca_hist_nps
  ADD CONSTRAINT projeto_lideranca_hist_nps_projeto_id_fkey FOREIGN KEY (projeto_id) REFERENCES projetos_mestre_nps(id);
ALTER TABLE ONLY public.projeto_respondentes_nps
  ADD CONSTRAINT projeto_respondentes_nps_projeto_id_fkey FOREIGN KEY (projeto_id) REFERENCES projetos_mestre_nps(id);
ALTER TABLE ONLY public.projeto_respondentes_nps
  ADD CONSTRAINT projeto_respondentes_nps_respondente_id_fkey FOREIGN KEY (respondente_id) REFERENCES respondentes_nps(id);
ALTER TABLE ONLY public.projetos_mestre_nps
  ADD CONSTRAINT projetos_mestre_nps_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes_nps(id);
ALTER TABLE ONLY public.projetos_mestre_nps
  ADD CONSTRAINT projetos_mestre_nps_lider_id_fkey FOREIGN KEY (lider_id) REFERENCES lideres_nps(id);
ALTER TABLE ONLY public.projetos_nps
  ADD CONSTRAINT projetos_nps_ciclo_id_fkey FOREIGN KEY (ciclo_id) REFERENCES ciclos_nps(id);
ALTER TABLE ONLY public.projetos_nps
  ADD CONSTRAINT projetos_nps_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes_nps(id);
ALTER TABLE ONLY public.projetos_nps
  ADD CONSTRAINT projetos_nps_lider_id_fkey FOREIGN KEY (lider_id) REFERENCES lideres_nps(id);
ALTER TABLE ONLY public.projetos_nps
  ADD CONSTRAINT projetos_nps_projeto_id_fkey FOREIGN KEY (projeto_id) REFERENCES projetos_mestre_nps(id);
ALTER TABLE ONLY public.respondentes_nps
  ADD CONSTRAINT respondentes_nps_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes_nps(id);
ALTER TABLE ONLY public.respostas_nps
  ADD CONSTRAINT respostas_nps_ciclo_id_fkey FOREIGN KEY (ciclo_id) REFERENCES ciclos_nps(id);
ALTER TABLE ONLY public.respostas_nps
  ADD CONSTRAINT respostas_nps_pesquisa_id_fkey FOREIGN KEY (pesquisa_id) REFERENCES pesquisas_nps(id);
ALTER TABLE ONLY public.respostas_nps
  ADD CONSTRAINT respostas_nps_projeto_id_fkey FOREIGN KEY (projeto_id) REFERENCES projetos_mestre_nps(id);
ALTER TABLE ONLY public.respostas_nps
  ADD CONSTRAINT respostas_nps_respondente_id_fkey FOREIGN KEY (respondente_id) REFERENCES respondentes_nps(id);
ALTER TABLE ONLY public.usuarios_nps
  ADD CONSTRAINT usuarios_nps_lider_id_fkey FOREIGN KEY (lider_id) REFERENCES lideres_nps(id) ON DELETE SET NULL;

-- ─── Views ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.vw_operacao_ciclo AS
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
        END AS situacao
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

CREATE OR REPLACE VIEW public.vw_pesquisas AS
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
    rp.telefone AS respondente_telefone
   FROM pesquisas_nps s
     JOIN projetos_mestre_nps m ON m.id = s.projeto_id
     JOIN respondentes_nps rp ON rp.id = s.respondente_id
     LEFT JOIN clientes_nps cl ON cl.id = m.cliente_id
     LEFT JOIN lideres_nps li ON li.id = m.lider_id
     LEFT JOIN ciclos_nps c ON c.id = s.ciclo_id;

CREATE OR REPLACE VIEW public.vw_projetos_admin AS
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

CREATE OR REPLACE VIEW public.vw_respostas_enriquecidas AS
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
    r.nota_q4 IS NOT NULL AND r.nota_q4 >= 0 AND r.nota_q4 <= 10 AS resposta_valida
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

-- ─── Triggers ───────────────────────────────────────────────────────────────

CREATE TRIGGER trg_touch_ciclos_nps BEFORE UPDATE ON public.ciclos_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER trg_touch_clientes_nps BEFORE UPDATE ON public.clientes_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER trg_touch_isc_nps BEFORE UPDATE ON public.isc_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER trg_touch_lideres_nps BEFORE UPDATE ON public.lideres_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER trg_touch_pesquisas_nps BEFORE UPDATE ON public.pesquisas_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER trg_touch_projeto_respondentes_nps BEFORE UPDATE ON public.projeto_respondentes_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER trg_touch_projetos_mestre_nps BEFORE UPDATE ON public.projetos_mestre_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER trg_touch_projetos_nps BEFORE UPDATE ON public.projetos_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER trg_touch_respondentes_nps BEFORE UPDATE ON public.respondentes_nps FOR EACH ROW EXECUTE FUNCTION nps_touch_updated_at();
CREATE TRIGGER nps_canal_pela_janela_tg BEFORE INSERT ON public.respostas_nps FOR EACH ROW EXECUTE FUNCTION nps_canal_pela_janela();
CREATE TRIGGER usuarios_nps_touch_tg BEFORE UPDATE ON public.usuarios_nps FOR EACH ROW EXECUTE FUNCTION usuarios_nps_touch();
