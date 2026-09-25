-- ============================================================================
-- A JANELA DO WHATSAPP VEM DO CICLO, NAO DE UMA SEGUNDA DATA
-- ============================================================================
-- Correcao da migration 17, aplicada no mesmo dia e antes de qualquer ciclo
-- ter janela preenchida -- por isso a coluna pode sair sem perda de dado.
--
-- A 17 pedia duas datas ao PMO: "e-mail ate X" e "WhatsApp ate Y". Mas a
-- regra real tem so um ponto de decisao. O periodo de coleta ja e o ciclo:
--
--     [data_inicio .. canal_email_ate]        -> EMAIL
--     (canal_email_ate .. data_fim]           -> WHATSAPP
--
-- Um `Y` separado nao acrescenta nada e abre espaco para contradicao: bastava
-- digitar uma data depois do fim do ciclo para criar respostas classificadas
-- como WhatsApp fora do periodo que o ciclo cobre. Uma data so nao tem como
-- discordar do ciclo.
--
-- Fora do intervalo do ciclo nao ha canal. O campo descreve como a coleta
-- DAQUELE ciclo foi conduzida; uma data de fora dele nao foi conduzida de
-- jeito nenhum, e chutar 'WHATSAPP' ali seria inventar.
-- ============================================================================

alter table public.ciclos_nps drop constraint if exists ciclos_nps_janelas_chk;
alter table public.ciclos_nps drop column if exists canal_whatsapp_ate;

comment on column public.ciclos_nps.canal_email_ate is
  'Ultimo dia (inclusive) da coleta por e-mail. Do dia seguinte ate data_fim, o canal e WhatsApp.';

-- O corte tem de cair DENTRO do ciclo: fora dele, uma das duas janelas nasce
-- vazia e as respostas ficam sem canal, sem ninguem perceber.
alter table public.ciclos_nps
  add constraint ciclos_nps_corte_chk check (
    canal_email_ate is null
    or (
      (data_inicio is null or canal_email_ate >= data_inicio)
      and (data_fim is null or canal_email_ate <= data_fim)
    )
  );

create or replace function public.nps_canal_da_data(p_ciclo_id uuid, p_dia date)
returns text language sql stable as $fn$
  select case
           when c.canal_email_ate is null then null
           when c.data_inicio is not null and p_dia < c.data_inicio then null
           when c.data_fim    is not null and p_dia > c.data_fim    then null
           when p_dia <= c.canal_email_ate then 'EMAIL'
           else 'WHATSAPP'
         end
    from public.ciclos_nps c
   where c.id = p_ciclo_id;
$fn$;

-- O gatilho e nps_aplicar_canais_do_ciclo continuam como estao: os dois
-- chamam nps_canal_da_data, que e onde a regra mora.

-- ============================================================================
-- VERIFICACAO
-- ============================================================================
-- select codigo, data_inicio, canal_email_ate, data_fim from public.ciclos_nps;
