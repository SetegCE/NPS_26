/**
 * Em qual ciclo o dashboard abre: o mais recente que JÁ COMEÇOU e JÁ TEM
 * RESPOSTA.
 *
 * ── Por que não é simplesmente "o último ciclo" ─────────────────────────
 *
 * Era essa a regra herdada, e funcionou enquanto o último ciclo era também o
 * que estava coletando. Quando o PMO cadastrou o 2026.2 com início em
 * outubro, o painel passou a abrir nele — um ciclo que ainda não começou,
 * com 2 respostas soltas — e escondeu atrás do filtro as 40 do ciclo
 * corrente. A tela abria praticamente vazia e parecia que o sistema não
 * estava lendo o banco.
 *
 * As duas condições são necessárias, e cada uma sozinha falha:
 *
 *  - só "tem resposta" não resolve: o 2026.2 tem 2, e continuaria escolhido;
 *  - só "já começou" resolve hoje, mas em outubro o 2026.2 começa e o painel
 *    voltaria a abrir quase vazio no primeiro dia.
 *
 * Juntas, o painel acompanha a coleta: fica no ciclo corrente e migra para o
 * seguinte quando ele de fato começa a receber resposta.
 *
 * Vive fora do componente para poder ser testado — ver
 * tests/cicloInicial.test.mjs.
 *
 * @param ciclos          Códigos presentes nas participações, em ordem crescente.
 * @param inicioPorCiclo  Código -> data_inicio (AAAA-MM-DD) do cadastro de ciclos.
 * @param respostasPorCiclo Código -> quantas respostas, no escopo de quem perguntou.
 * @param hojeISO         Data de referência; existe para o teste fixar o "hoje".
 */
export function cicloInicial(
  ciclos: string[],
  inicioPorCiclo: Record<string, string | null | undefined>,
  respostasPorCiclo: Record<string, number>,
  hojeISO: string = new Date().toISOString().slice(0, 10)
): string {
  if (!ciclos.length) return "";

  // Ciclo sem data cadastrada conta como já iniciado: a data é opcional no
  // cadastro, e sumir do padrão por falta dela seria pior do que incluí-lo.
  const jaComecou = (c: string) => {
    const inicio = inicioPorCiclo[c];
    return !inicio || inicio <= hojeISO;
  };
  const temResposta = (c: string) => (respostasPorCiclo[c] || 0) > 0;

  const iniciados = ciclos.filter(jaComecou);

  const ideal = iniciados.filter(temResposta);
  if (ideal.length) return ideal[ideal.length - 1];

  // Nenhum ciclo iniciado tem resposta (sistema novo, ou primeiro ciclo).
  // Fica no mais recente que começou; se nenhum começou, no primeiro.
  if (iniciados.length) return iniciados[iniciados.length - 1];
  return ciclos[0];
}
