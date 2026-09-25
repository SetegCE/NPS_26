-- Preenche o canal das respostas de 2026.1 que ficaram sem ele.
--
-- O canal dessas 4 linhas so existia em CODIGO: lib/dashboard.ts tinha a
-- regra "no ciclo 2026.1, ate 11/05/2026 o envio foi por e-mail do PMO; dali
-- em diante, pelos lideres". A regra reproduz exatamente o que o banco ja
-- gravou nas outras 36 linhas do ciclo (22 EMAIL, 14 WHATSAPP) -- conferido
-- antes de rodar -- entao aplica-la as 4 que faltam nao inventa nada, so
-- termina o preenchimento.
--
-- Com isto o canal passa a vir inteiramente do banco e a regra sai do codigo.
-- Aplicada em 21/09/2026 (versao 20260921131228).
update public.respostas_nps
   set canal_resposta = case
         when timestamp < timestamp '2026-05-11 00:00:00' then 'EMAIL'
         else 'WHATSAPP'
       end
 where ciclo = '2026.1'
   and (canal_resposta is null or btrim(canal_resposta) = '');
