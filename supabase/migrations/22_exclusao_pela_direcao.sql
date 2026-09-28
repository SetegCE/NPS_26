-- ============================================================================
-- MIGRATION 22 — EXCLUSÃO DE REGISTROS PELA DIREÇÃO (PMO)
--
-- Uma função só, nps_excluir(entidade, id, ator), para o botão "Excluir" de
-- todas as telas. Ela decide o que pode sair e o que leva junto:
--
--   resposta     sai; a pesquisa que ela respondeu volta a ficar aberta
--                (status 'gerada', sem data) — o link vale de novo.
--   pesquisa     sai; se já tinha resposta, a RESPOSTA FICA (só perde o
--                vínculo com a pesquisa).
--   plano        sai com as ações dele.
--   isc          sai.
--   respondente  sai com os vínculos e as pesquisas não respondidas.
--                Recusa se tiver resposta.
--   projeto      sai com participações, vínculos, pesquisas não respondidas
--                e histórico de liderança. Recusa se tiver resposta, plano de
--                ação ou ISC.
--   ciclo        sai com participações, transições e pesquisas não
--                respondidas. Recusa se tiver resposta ou plano de ação.
--   lider        sai com o histórico e a conta de acesso de líder dele.
--                Recusa se liderar projeto, tiver ISC ou for responsável por
--                plano de ação.
--   cliente      sai. Recusa se tiver projeto ou respondente.
--   conta        (usuarios_nps) sai. Recusa a última conta ativa da direção.
--                A API recusa antes a exclusão da própria conta.
--
-- Nunca apaga resposta em cascata: resposta é o dado que o sistema existe
-- para guardar. Quando o registro carrega resposta, a mensagem diz quantas e
-- o que fazer (inativar ou excluir as respostas antes).
--
-- Toda exclusão vai para auditoria_nps com o registro inteiro em
-- valores_anteriores — dá para saber o que saiu e refazer à mão se preciso.
--
-- Recusas saem como 'EXCLUSAO_BLOQUEADA:<mensagem>'; lib/db.ts devolve a
-- mensagem ao usuário com status 409.
-- ============================================================================

create or replace function public.nps_excluir(p_entidade text, p_id uuid, p_ator text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_antes  jsonb;
  v_desc   text;
  v_n      integer;
  v_extra  jsonb := '{}'::jsonb;
begin
  if p_id is null then raise exception 'VALOR_INVALIDO'; end if;

  if p_entidade = 'resposta' then
    select to_jsonb(r) into v_antes from respostas_nps r where id = p_id;
    if v_antes is null then raise exception 'RESPOSTA_NAO_ENCONTRADA'; end if;
    update pesquisas_nps
       set resposta_id = null, status = 'gerada', data_resposta = null
     where resposta_id = p_id;
    get diagnostics v_n = row_count;
    delete from respostas_nps where id = p_id;
    v_extra := jsonb_build_object('pesquisas_reabertas', v_n);
    v_desc := format('Resposta de %s (%s, ciclo %s) excluída',
      coalesce(v_antes->>'identificador', 'respondente'),
      coalesce(v_antes->>'projeto', '—'), coalesce(v_antes->>'ciclo', '—'));

  elsif p_entidade = 'pesquisa' then
    select to_jsonb(p) into v_antes from pesquisas_nps p where id = p_id;
    if v_antes is null then raise exception 'PESQUISA_NAO_ENCONTRADA'; end if;
    update respostas_nps set pesquisa_id = null where pesquisa_id = p_id;
    delete from pesquisas_nps where id = p_id;
    v_desc := format('Pesquisa de %s (%s) excluída',
      coalesce(v_antes->>'cliente_nome', '—'), coalesce(v_antes->>'projeto_nome', '—'));

  elsif p_entidade = 'plano' then
    select to_jsonb(p) into v_antes from planos_acao_nps p where id = p_id;
    if v_antes is null then raise exception 'PLANO_NAO_ENCONTRADO'; end if;
    select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_extra
      from plano_acao_itens_nps i where plano_id = p_id;
    v_extra := jsonb_build_object('acoes', v_extra);
    delete from plano_acao_itens_nps where plano_id = p_id;
    delete from planos_acao_nps where id = p_id;
    v_desc := format('Plano de ação %s excluído', coalesce(v_antes->>'numero', '(sem número)'));

  elsif p_entidade = 'isc' then
    select to_jsonb(i) into v_antes from isc_nps i where id = p_id;
    if v_antes is null then raise exception 'ISC_NAO_ENCONTRADO'; end if;
    delete from isc_nps where id = p_id;
    v_desc := format('Nota ISC %s (competência %s) excluída',
      v_antes->>'nota', coalesce(v_antes->>'competencia', '—'));

  elsif p_entidade = 'respondente' then
    select to_jsonb(r) into v_antes from respondentes_nps r where id = p_id;
    if v_antes is null then raise exception 'RESPONDENTE_NAO_ENCONTRADO'; end if;
    select count(*) into v_n from respostas_nps where respondente_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:Este respondente tem % resposta(s) registrada(s). Exclua as respostas antes ou apenas inative o respondente.', v_n;
    end if;
    delete from pesquisas_nps where respondente_id = p_id;
    delete from projeto_respondentes_nps where respondente_id = p_id;
    delete from respondentes_nps where id = p_id;
    v_desc := format('Respondente %s excluído', v_antes->>'nome');

  elsif p_entidade = 'projeto' then
    select to_jsonb(m) into v_antes from projetos_mestre_nps m where id = p_id;
    if v_antes is null then raise exception 'PROJETO_NAO_ENCONTRADO'; end if;
    select count(*) into v_n from respostas_nps where projeto_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:Este projeto tem % resposta(s) de NPS. Exclua as respostas antes ou apenas inative o projeto.', v_n;
    end if;
    select count(*) into v_n from planos_acao_nps where projeto_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:Este projeto tem % plano(s) de ação. Exclua os planos antes ou apenas inative o projeto.', v_n;
    end if;
    select count(*) into v_n from isc_nps where projeto_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:Este projeto tem % nota(s) de ISC. Exclua as notas antes ou apenas inative o projeto.', v_n;
    end if;
    delete from pesquisas_nps where projeto_id = p_id;
    delete from projeto_respondentes_nps where projeto_id = p_id;
    delete from ciclo_transicao_nps where projeto_id = p_id;
    delete from projeto_lideranca_hist_nps where projeto_id = p_id;
    delete from projetos_nps where projeto_id = p_id;
    delete from projetos_mestre_nps where id = p_id;
    v_desc := format('Projeto %s — %s excluído', v_antes->>'codigo_clockify', v_antes->>'nome');

  elsif p_entidade = 'ciclo' then
    select to_jsonb(c) into v_antes from ciclos_nps c where id = p_id;
    if v_antes is null then raise exception 'CICLO_NAO_ENCONTRADO'; end if;
    select count(*) into v_n from respostas_nps where ciclo_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:O ciclo % tem % resposta(s). Ciclos com respostas não podem ser excluídos — encerre o ciclo.', v_antes->>'codigo', v_n;
    end if;
    select count(*) into v_n from planos_acao_nps where ciclo_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:O ciclo % tem % plano(s) de ação. Exclua os planos antes.', v_antes->>'codigo', v_n;
    end if;
    delete from pesquisas_nps where ciclo_id = p_id;
    delete from ciclo_transicao_nps where ciclo_origem_id = p_id or ciclo_destino_id = p_id;
    delete from projetos_nps where ciclo_id = p_id;
    delete from ciclos_nps where id = p_id;
    v_desc := format('Ciclo %s excluído', v_antes->>'codigo');

  elsif p_entidade = 'lider' then
    select to_jsonb(l) into v_antes from lideres_nps l where id = p_id;
    if v_antes is null then raise exception 'LIDER_NAO_ENCONTRADO'; end if;
    select count(*) into v_n from projetos_mestre_nps where lider_id = p_id;
    if v_n = 0 then select count(*) into v_n from projetos_nps where lider_id = p_id; end if;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:% lidera ou liderou % projeto(s). Troque o líder desses projetos antes ou apenas inative o cadastro.', v_antes->>'nome', v_n;
    end if;
    select count(*) into v_n from isc_nps where lider_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:% tem % nota(s) de ISC registradas. Apenas inative o cadastro.', v_antes->>'nome', v_n;
    end if;
    select count(*) into v_n from planos_acao_nps where responsavel_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:% é responsável por % plano(s) de ação. Apenas inative o cadastro.', v_antes->>'nome', v_n;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email)), '[]'::jsonb)
      into v_extra from usuarios_nps u where lider_id = p_id and papel = 'lider';
    v_extra := jsonb_build_object('contas_excluidas', v_extra);
    delete from usuarios_nps where lider_id = p_id and papel = 'lider';
    delete from projeto_lideranca_hist_nps where lider_id = p_id;
    delete from lideres_nps where id = p_id;
    v_desc := format('Líder %s excluído', v_antes->>'nome');

  elsif p_entidade = 'cliente' then
    select to_jsonb(c) into v_antes from clientes_nps c where id = p_id;
    if v_antes is null then raise exception 'CLIENTE_NAO_ENCONTRADO'; end if;
    select count(*) into v_n from projetos_mestre_nps where cliente_id = p_id;
    if v_n = 0 then select count(*) into v_n from projetos_nps where cliente_id = p_id; end if;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:O cliente % tem % projeto(s). Apenas inative o cadastro.', v_antes->>'nome', v_n;
    end if;
    select count(*) into v_n from respondentes_nps where cliente_id = p_id;
    if v_n > 0 then
      raise exception 'EXCLUSAO_BLOQUEADA:O cliente % tem % respondente(s). Apenas inative o cadastro.', v_antes->>'nome', v_n;
    end if;
    delete from clientes_nps where id = p_id;
    v_desc := format('Cliente %s excluído', v_antes->>'nome');

  elsif p_entidade = 'conta' then
    select to_jsonb(u) - 'senha_hash' into v_antes from usuarios_nps u where id = p_id;
    if v_antes is null then raise exception 'CONTA_NAO_ENCONTRADA'; end if;
    if v_antes->>'papel' = 'pmo' and (v_antes->>'ativo')::boolean then
      select count(*) into v_n from usuarios_nps where papel = 'pmo' and ativo and id <> p_id;
      if v_n = 0 then
        raise exception 'EXCLUSAO_BLOQUEADA:Esta é a última conta ativa da direção. Crie outra antes de excluir esta.';
      end if;
    end if;
    delete from usuarios_nps where id = p_id;
    v_desc := format('Conta de acesso de %s (%s) excluída', v_antes->>'nome', v_antes->>'email');

  else
    raise exception 'VALOR_INVALIDO';
  end if;

  perform nps_auditar('excluir', p_entidade, p_id, v_desc, 'pmo', p_ator,
                      v_antes || case when v_extra = '{}'::jsonb then '{}'::jsonb
                                      else jsonb_build_object('_levado_junto', v_extra) end,
                      null);

  return jsonb_build_object('ok', true, 'entidade', p_entidade, 'id', p_id, 'descricao', v_desc);
end
$function$;

revoke all on function public.nps_excluir(text, uuid, text) from public, anon, authenticated;
grant execute on function public.nps_excluir(text, uuid, text) to service_role;
