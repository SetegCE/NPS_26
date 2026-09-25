"use client";

// Comparativo entre ciclos.
//
// Nao obedece ao filtro de ciclo de proposito: a pergunta que ele responde e
// "como evoluimos de um ciclo para o outro", entao precisa dos dois.

import { chaveDoProjeto, chaveValida, type Projeto, type Resposta } from "@/lib/dashboard";

// Os ciclos comparados vêm por prop, derivados do que existe no banco. Eram
// fixos ("2025.2" e "2026.1") e envelheceram no dia em que o 2026.2 foi
// cadastrado: o painel seguiria comparando dois semestres antigos para
// sempre.

interface Linha {
  ciclo: string;
  totalProjetos: number;
  respondidos: number;
  naoRespondidos: number;
  taxa: number;
  nps: number;
  promotores: number;
  neutros: number;
  detratores: number;
}

function classeNps(nps: number): string {
  if (nps >= 50) return "nps-bom";
  if (nps >= 0) return "nps-medio";
  return "nps-ruim";
}

export function Comparativo({
  respostas,
  projetos,
  ciclosComparados,
}: {
  respostas: Resposta[];
  projetos: Projeto[];
  /** [anterior, atual] — os dois ciclos mais recentes presentes nos dados. */
  ciclosComparados: string[];
}) {
  const linhas: Linha[] = ciclosComparados.map((c) => {
    const doCiclo = respostas.filter((d) => d.ciclo === c);
    const projetosDoCiclo = projetos.filter((p) => p.ciclo === c);

    const chaves = new Set(projetosDoCiclo.map((p) => chaveDoProjeto(p)).filter(chaveValida));
    const totalProjetos = chaves.size;

    const validas = doCiclo.filter((d) => d.respostaValida);
    const t = validas.length;
    const promotores = validas.filter((d) => d.categoria === "PROMOTOR").length;
    const detratores = validas.filter((d) => d.categoria === "DETRATOR").length;
    const neutros = t - promotores - detratores;
    const nps = t > 0 ? Math.round((promotores / t) * 100 - (detratores / t) * 100) : 0;

    const respondidos = new Set(
      validas
        .map((d) => d.projetoContagemKey)
        .filter((k): k is string => Boolean(k) && (chaves.size === 0 || chaves.has(k!)))
    ).size;

    return {
      ciclo: c,
      totalProjetos,
      respondidos,
      naoRespondidos: totalProjetos - respondidos,
      taxa: totalProjetos > 0 ? Math.round((respondidos / totalProjetos) * 100) : 0,
      nps,
      promotores,
      neutros,
      detratores,
    };
  });

  if (!linhas.some((r) => r.totalProjetos > 0 || r.respondidos > 0)) {
    return (
      <p className="empty-state" style={{ padding: "1rem" }}>
        Sem dados de projetos cadastrados para comparação.
      </p>
    );
  }

  // Com um único ciclo cadastrado não há evolução a mostrar.
  const temDois = linhas.length === 2;
  const difNps = temDois ? linhas[1].nps - linhas[0].nps : 0;
  const difTaxa = temDois ? linhas[1].taxa - linhas[0].taxa : 0;

  return (
    <div className="table-wrapper">
      <table className="comparativo-table">
        <thead>
          <tr>
            <th>Ciclo</th>
            <th>Total Projetos</th>
            <th>Respondidos</th>
            <th>Não Respondidos</th>
            <th>Taxa (%)</th>
            <th>NPS</th>
            <th>Promotores</th>
            <th>Neutros</th>
            <th>Detratores</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((r) => (
            <tr key={r.ciclo}>
              <td>
                <strong>{r.ciclo}</strong>
              </td>
              <td>{r.totalProjetos}</td>
              <td>{r.respondidos}</td>
              <td>{r.naoRespondidos}</td>
              <td>{r.taxa}%</td>
              <td className={classeNps(r.nps)}>
                <strong>{r.nps}</strong>
              </td>
              <td>{r.promotores}</td>
              <td>{r.neutros}</td>
              <td>{r.detratores}</td>
            </tr>
          ))}
          {temDois ? (
          <tr className="comparativo-diff">
            <td colSpan={5}>
              <em>
                Evolução {linhas[0].ciclo} → {linhas[1].ciclo}
              </em>
            </td>
            <td className={difNps > 0 ? "nps-bom" : difNps < 0 ? "nps-ruim" : ""}>
              <strong>
                {difNps > 0 ? "+" : ""}
                {difNps}
              </strong>
            </td>
            <td colSpan={3}>
              {difNps > 0 ? "↑ Melhora" : difNps < 0 ? "↓ Queda" : "= Estável"} | Taxa:{" "}
              {difTaxa > 0 ? "+" : ""}
              {difTaxa}pp
            </td>
          </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
