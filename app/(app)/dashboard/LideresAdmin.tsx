"use client";

// Analise por lider — so o PMO ve.
//
// A visibilidade aqui e conveniencia de tela: o lider que forjasse o proprio
// perfil no cliente ainda receberia apenas os proprios projetos da API, entao
// a tabela viria com uma linha so, a dele.

import { chaveDoProjeto, chaveValida, normalizar, type Projeto, type Resposta } from "@/lib/dashboard";

interface Estatistica {
  lider: string;
  totalProjetos: number;
  responderam: number;
  naoResponderam: number;
  taxa: number;
  nps: number;
}

export function LideresAdmin({
  projetosEscopo,
  respostas,
}: {
  projetosEscopo: Projeto[];
  respostas: Resposta[];
}) {
  const lideres = [...new Set(projetosEscopo.map((p) => p.lider_atual).filter(Boolean))].sort();

  if (!lideres.length) {
    return <p className="empty-state">Sem dados de líderes no escopo atual.</p>;
  }

  const validas = respostas.filter((d) => d.respostaValida);

  const estatisticas: Estatistica[] = lideres.map((lider) => {
    const normL = normalizar(lider);
    const projetosDoLider = projetosEscopo.filter((p) => normalizar(p.lider_atual) === normL);
    const chaves = new Set(projetosDoLider.map((p) => chaveDoProjeto(p)).filter(chaveValida));
    const totalProjetos = chaves.size;

    const doLider = validas.filter(
      (d) =>
        normalizar(d.lider_atual) === normL &&
        d.projetoContagemKey &&
        chaves.has(d.projetoContagemKey)
    );
    const responderam = new Set(doLider.map((d) => d.projetoContagemKey)).size;

    const t = doLider.length;
    const promotores = doLider.filter((d) => d.categoria === "PROMOTOR").length;
    const detratores = doLider.filter((d) => d.categoria === "DETRATOR").length;

    return {
      lider,
      totalProjetos,
      responderam,
      naoResponderam: totalProjetos - responderam,
      taxa: totalProjetos > 0 ? Math.round((responderam / totalProjetos) * 100) : 0,
      nps: t > 0 ? Math.round((promotores / t) * 100 - (detratores / t) * 100) : 0,
    };
  });

  // Pior adesao primeiro nao: a ordem e por taxa DESC, para que o topo mostre
  // quem esta indo bem e o fim da tabela concentre quem precisa de atencao —
  // reforcado pelo bloco "sem adesao" logo abaixo.
  estatisticas.sort((a, b) =>
    b.taxa !== a.taxa ? b.taxa - a.taxa : a.lider.localeCompare(b.lider)
  );

  const semAdesao = estatisticas
    .filter((r) => r.responderam === 0 && r.totalProjetos > 0)
    .sort((a, b) => a.lider.localeCompare(b.lider));

  const classeTaxa = (t: number) => (t >= 75 ? "nps-bom" : t >= 50 ? "nps-medio" : "nps-ruim");
  const classeNps = (n: number) => (n >= 50 ? "nps-bom" : n >= 0 ? "nps-medio" : "nps-ruim");

  return (
    <>
      <div className="table-wrapper">
        <table className="lideres-admin-table">
          <thead>
            <tr>
              <th>Líder</th>
              <th>Projetos</th>
              <th>Responderam</th>
              <th>Não Responderam</th>
              <th>Taxa (%)</th>
              <th>NPS</th>
            </tr>
          </thead>
          <tbody>
            {estatisticas.map((r) => (
              <tr key={r.lider}>
                <td>
                  <strong>{r.lider}</strong>
                </td>
                <td>{r.totalProjetos}</td>
                <td>{r.responderam}</td>
                <td>{r.naoResponderam}</td>
                <td className={classeTaxa(r.taxa)}>{r.taxa}%</td>
                <td className={classeNps(r.nps)}>
                  <strong>{r.nps}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {semAdesao.length ? (
        <div className="lideres-sem-adesao">
          <div className="sem-adesao-header">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Líderes sem adesão
          </div>
          <div className="sem-adesao-grid">
            {semAdesao.map((r) => (
              <div className="sem-adesao-card" key={r.lider}>
                <span className="sem-adesao-nome">{r.lider}</span>
                <span className="sem-adesao-detalhe">
                  0 de {r.totalProjetos} projeto{r.totalProjetos !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
