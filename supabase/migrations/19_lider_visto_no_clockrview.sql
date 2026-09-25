-- Ultimo lider que o Clockrview informou para o projeto.
--
-- O lider continua editavel no NPS (a lideranca muda na pratica antes de o
-- Clockrview ser atualizado). Sem esta coluna, a sincronizacao diaria
-- desfaria a troca manual no dia seguinte, devolvendo o lider do Clockrview.
--
-- Com ela, a sincronizacao so troca o lider quando o CLOCKRVIEW muda: se o
-- valor que chega e o mesmo ja visto, a escolha feita no NPS e mantida. A
-- mudanca mais recente, de qualquer um dos lados, e a que vale.
--
-- Guarda o e-mail do lider (ou o nome normalizado, quando o Clockrview nao
-- traz e-mail). Nulo = nunca sincronizado.

alter table public.projetos_mestre_nps
  add column if not exists lider_clockrview text;

comment on column public.projetos_mestre_nps.lider_clockrview is
  'Ultimo lider informado pelo Clockrview (e-mail ou nome normalizado). A sincronizacao so troca o lider quando este valor muda.';
