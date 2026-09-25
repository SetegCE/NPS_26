// Resumo de um conjunto de respostas — a mesma formula de NPS usada no
// dashboard, escrita uma unica vez.
//
// Compartilhada entre o historico por cliente e o historico por lider. Se
// cada rota calculasse o seu, duas telas do mesmo sistema poderiam mostrar
// NPS diferente para o mesmo conjunto de respostas.

export interface RespostaResumivel {
  resposta_valida?: boolean | null;
  categoria?: string | null;
  respondente_id?: string | null;
  projeto_id?: string | null;
  nota_q1?: number | string | null;
  nota_q2?: number | string | null;
  nota_q3?: number | string | null;
  nota_q4?: number | string | null;
}

export interface Resumo {
  respostas: number;
  respondentes: number;
  projetos_com_resposta: number;
  nps: number;
  promotores: number;
  neutros: number;
  detratores: number;
  medias: { Q1: number | null; Q2: number | null; Q3: number | null; Q4: number | null };
}

type CampoNota = "nota_q1" | "nota_q2" | "nota_q3" | "nota_q4";

export function resumirRespostas(respostas: RespostaResumivel[]): Resumo {
  // `resposta_valida` vem da view: e ela que decide o que entra na conta
  // (resposta sem Q4, por exemplo, nao e avaliacao de NPS).
  const validas = respostas.filter((r) => r.resposta_valida);
  const promotores = validas.filter((r) => r.categoria === "PROMOTOR").length;
  const neutros = validas.filter((r) => r.categoria === "NEUTRO").length;
  const detratores = validas.filter((r) => r.categoria === "DETRATOR").length;

  // Somente Q4 entra no NPS. Q1/Q2/Q3 sao indicadores complementares e
  // aparecem apenas como media.
  const nps = validas.length
    ? Math.round((promotores / validas.length) * 100 - (detratores / validas.length) * 100)
    : 0;

  const media = (campo: CampoNota): number | null => {
    const ns = validas.map((r) => r[campo]).filter((n) => n !== null && n !== undefined);
    return ns.length
      ? Number((ns.reduce((s: number, n) => s + Number(n), 0) / ns.length).toFixed(2))
      : null;
  };

  return {
    respostas: validas.length,
    respondentes: new Set(validas.map((r) => r.respondente_id).filter(Boolean)).size,
    projetos_com_resposta: new Set(validas.map((r) => r.projeto_id).filter(Boolean)).size,
    nps,
    promotores,
    neutros,
    detratores,
    medias: {
      Q1: media("nota_q1"),
      Q2: media("nota_q2"),
      Q3: media("nota_q3"),
      Q4: media("nota_q4"),
    },
  };
}
