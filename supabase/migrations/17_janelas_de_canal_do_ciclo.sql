-- ============================================================================
-- JANELAS DE CANAL POR CICLO
-- ============================================================================
-- O canal da resposta ("chegou por e-mail" ou "chegou porque cobramos no
-- WhatsApp") nao vem do formulario: quem responde nao escolhe canal, so
-- clica no link. Quem sabe o canal e o PMO, que conduziu a coleta -- e ate
-- agora esse conhecimento so existia depois, a mao.
--
-- Historico curto disto, para nao repetirmos o caminho:
--
--  1. a regra viveu em CODIGO (lib/dashboard.ts): "no ciclo 2026.1, ate
--     11/05/2026 foi e-mail; dali em diante, WhatsApp". Corrigir uma data
--     exigia deploy, e o ciclo seguinte exigiria outro `if`;
--  2. a migration 16 tirou a regra do codigo gravando o canal em cada linha
--     de respostas_nps -- certo, mas pontual: valeu para as 4 linhas daquele
--     ciclo e nao resolveu o proximo;
--  3. aqui a regra vira CADASTRO. O PMO declara as duas datas no ciclo, e o
--     banco carimba sozinho.
--
-- O dado continua gravado por resposta, como a 16 estabeleceu. Estas colunas
-- nao sao consultadas na hora de exibir: sao a origem do carimbo, nao um
-- calculo repetido a cada leitura. Um canal ja gravado nunca e recalculado
-- pelas costas -- so muda quando o PMO aplica as janelas de proposito.
-- ============================================================================

alter table public.ciclos_nps
  add column if not exists canal_email_ate    date,
  add column if not exists canal_whatsapp_ate date;

comment on column public.ciclos_nps.canal_email_ate is
  'Ultimo dia (inclusive) em que as respostas do ciclo chegaram por e-mail.';
comment on column public.ciclos_nps.canal_whatsapp_ate is
  'Ultimo dia (inclusive) da janela de WhatsApp, que comeca no dia seguinte a canal_email_ate.';

-- A ordem importa: WhatsApp comeca onde o e-mail termina. Deixar as duas
-- trocadas criaria uma janela vazia e respostas sem canal, sem aviso nenhum.
alter table public.ciclos_nps
  drop constraint if exists ciclos_nps_janelas_chk;
alter table public.ciclos_nps
  add constraint ciclos_nps_janelas_chk check (
    canal_email_ate is null
    or canal_whatsapp_ate is null
    or canal_whatsapp_ate > canal_email_ate
  );


-- ── O canal de uma data, dado o ciclo ───────────────────────────────────────
-- Uma funcao so, usada pelo gatilho e pela aplicacao retroativa. Duas copias
-- desta regra divergiriam no dia em que alguem ajustasse uma delas.
create or replace function public.nps_canal_da_data(p_ciclo_id uuid, p_dia date)
returns text language sql stable as $$
  select case
           when c.canal_email_ate is not null and p_dia <= c.canal_email_ate
             then 'EMAIL'
           when c.canal_whatsapp_ate is not null and p_dia <= c.canal_whatsapp_ate
                and (c.canal_email_ate is null or p_dia > c.canal_email_ate)
             then 'WHATSAPP'
           else null
         end
    from public.ciclos_nps c
   where c.id = p_ciclo_id;
$$;


-- ── Carimbo automatico na entrada ───────────────────────────────────────────
-- Gatilho, e nao alteracao de nps_responder_pesquisa, por dois motivos: vale
-- para QUALQUER caminho de insercao (formulario, importacao, correcao a mao),
-- e nao mexe numa funcao de ~120 linhas que ja carrega a regra de negocio
-- inteira da resposta.
--
-- So preenche o que veio vazio. Canal informado explicitamente manda: quem
-- escreveu sabia de algo que a janela nao sabe.
create or replace function public.nps_canal_pela_janela()
returns trigger language plpgsql as $$
begin
  if new.canal_resposta is not null and btrim(new.canal_resposta) <> '' then
    return new;
  end if;
  if new.ciclo_id is null then
    return new;
  end if;

  new.canal_resposta := public.nps_canal_da_data(
    new.ciclo_id,
    (coalesce(new."timestamp", now()))::date
  );
  return new;
end $$;

drop trigger if exists nps_canal_pela_janela_tg on public.respostas_nps;
create trigger nps_canal_pela_janela_tg
  before insert on public.respostas_nps
  for each row execute function public.nps_canal_pela_janela();


-- ── Aplicacao retroativa ────────────────────────────────────────────────────
-- As janelas quase sempre sao declaradas DEPOIS da coleta: o PMO so sabe que
-- "do dia 10 em diante foi WhatsApp" quando o periodo passou. Sem isto, as
-- datas so valeriam para respostas futuras e o ciclo corrente ficaria de fora
-- -- que e justamente o caso de uso.
--
-- Reescreve o canal das respostas que caem nas janelas, inclusive as que ja
-- tinham canal: a declaracao do PMO e a fonte de verdade sobre como aquele
-- ciclo foi conduzido. Respostas fora das janelas nao sao tocadas.
create or replace function public.nps_aplicar_canais_do_ciclo(p_ciclo_id uuid)
returns jsonb language plpgsql as $$
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
end $$;


-- ============================================================================
-- VERIFICACAO
-- ============================================================================
-- select codigo, canal_email_ate, canal_whatsapp_ate from public.ciclos_nps;
-- select ciclo, canal_resposta, count(*) from public.respostas_nps group by 1,2;
