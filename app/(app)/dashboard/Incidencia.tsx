"use client";

// Incidencia de resposta: quem respondeu e quem nao respondeu, no escopo dos
// filtros ativos.
//
// As duas tabelas ficam em accordion e so sao montadas quando abertas. Na
// versao anterior isso era feito com `data-loaded` e innerHTML sob demanda;
// aqui basta nao renderizar o corpo enquanto estiver fechado — com a
// vantagem de que reabrir nao remonta HTML a mao.

import { useState } from "react";
import {
  chaveDoProjeto,
  chaveValida,
  rotuloDoCanal,
  type Projeto,
  type Resposta,
} from "@/lib/dashboard";

interface Respondido extends Projeto {
  qtd: number;
  canais: string;
}

const ordenar = (a: { cliente: string | null; projeto: string | null }, b: typeof a) =>
  `${a.cliente || ""}${a.projeto || ""}`.localeCompare(`${b.cliente || ""}${b.projeto || ""}`);

function Seta() {
  return (
    <svg
      className="incidencia-accordion-arrow"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function Incidencia({
  projetosEscopo,
  respostas,
}: {
  projetosEscopo: Projeto[];
  respostas: Resposta[];
}) {
  const [aberto, setAberto] = useState<"resp" | "nao" | null>(null);

  // Mapa de respondidos, indexado pela chave de contagem do projeto vinculado
  // — nunca pela chave da resposta crua.
  const porChave = new Map<string, { qtd: number; canais: Set<string> }>();
  for (const r of respostas) {
    if (!r.respostaValida || !r.projetoContagemKey) continue;
    const atual = porChave.get(r.projetoContagemKey) || { qtd: 0, canais: new Set<string>() };
    atual.qtd += 1;
    if (r.canal) atual.canais.add(r.canal);
    porChave.set(r.projetoContagemKey, atual);
  }

  const unicos = new Map<string, Projeto>();
  for (const p of projetosEscopo) {
    const chave = chaveDoProjeto(p);
    if (chaveValida(chave) && !unicos.has(chave)) unicos.set(chave, p);
  }

  const respondidos: Respondido[] = [];
  const naoRespondidos: Projeto[] = [];
  unicos.forEach((p, chave) => {
    const rm = porChave.get(chave);
    if (rm) {
      respondidos.push({
        ...p,
        qtd: rm.qtd,
        canais: [...rm.canais].map(rotuloDoCanal).join(", ") || "-",
      });
    } else {
      naoRespondidos.push(p);
    }
  });
  respondidos.sort(ordenar);
  naoRespondidos.sort(ordenar);

  return (
    <div className="incidencia-accordion">
      <div className={`incidencia-accordion-item respondido ${aberto === "resp" ? "open" : ""}`}>
        <div
          className="incidencia-accordion-header"
          role="button"
          tabIndex={0}
          aria-expanded={aberto === "resp"}
          onClick={() => setAberto((a) => (a === "resp" ? null : "resp"))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setAberto((a) => (a === "resp" ? null : "resp"));
            }
          }}
        >
          <Seta />
          <span className="incidencia-accordion-title">Responderam</span>
          <span className="incidencia-accordion-count">
            {respondidos.length} projeto{respondidos.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="incidencia-accordion-body">
          {aberto === "resp" ? (
            <div className="table-wrapper">
              <table className="incidencia-table">
                <thead>
                  <tr>
                    <th>Ciclo</th>
                    <th>Cliente</th>
                    <th>Projeto</th>
                    <th>Líder</th>
                    <th>Classe</th>
                    <th>Tipo Serviço</th>
                    <th>Cod. Clockify</th>
                    <th>Respostas</th>
                    <th>Canal</th>
                  </tr>
                </thead>
                <tbody>
                  {respondidos.length ? (
                    respondidos.map((r) => (
                      <tr key={chaveDoProjeto(r)}>
                        <td>{r.ciclo || "-"}</td>
                        <td title={r.cliente || ""}>{r.cliente || "-"}</td>
                        <td title={r.projeto || ""}>{r.projeto || "-"}</td>
                        <td title={r.lider || ""}>{r.lider || "-"}</td>
                        <td title={r.classe_contratual || ""}>{r.classe_contratual || "-"}</td>
                        <td title={r.tipo_servico || ""}>{r.tipo_servico || "-"}</td>
                        <td>{r.codigo_clockify || "-"}</td>
                        <td>{r.qtd}</td>
                        <td>{r.canais}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="empty-state" style={{ padding: ".8rem" }}>
                        Nenhum projeto respondeu.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={`incidencia-accordion-item nao-respondido ${aberto === "nao" ? "open" : ""}`}
      >
        <div
          className="incidencia-accordion-header"
          role="button"
          tabIndex={0}
          aria-expanded={aberto === "nao"}
          onClick={() => setAberto((a) => (a === "nao" ? null : "nao"))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setAberto((a) => (a === "nao" ? null : "nao"));
            }
          }}
        >
          <Seta />
          <span className="incidencia-accordion-title">Não responderam</span>
          <span className="incidencia-accordion-count">
            {naoRespondidos.length} projeto{naoRespondidos.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="incidencia-accordion-body">
          {aberto === "nao" ? (
            <div className="table-wrapper">
              <table className="incidencia-table">
                <thead>
                  <tr>
                    <th>Ciclo</th>
                    <th>Cliente</th>
                    <th>Projeto</th>
                    <th>Líder</th>
                    <th>Classe</th>
                    <th>Tipo Serviço</th>
                    <th>Cod. Clockify</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {naoRespondidos.length ? (
                    naoRespondidos.map((p) => (
                      <tr key={chaveDoProjeto(p)}>
                        <td>{p.ciclo || "-"}</td>
                        <td title={p.cliente || ""}>{p.cliente || "-"}</td>
                        <td title={p.projeto || ""}>{p.projeto || "-"}</td>
                        <td title={p.lider || ""}>{p.lider || "-"}</td>
                        <td title={p.classe_contratual || ""}>{p.classe_contratual || "-"}</td>
                        <td title={p.tipo_servico || ""}>{p.tipo_servico || "-"}</td>
                        <td>{p.codigo_clockify || "-"}</td>
                        <td>
                          <span className="badge-nao-resp">Não respondeu</span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="empty-state" style={{ padding: ".8rem" }}>
                        Todos os projetos responderam!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
