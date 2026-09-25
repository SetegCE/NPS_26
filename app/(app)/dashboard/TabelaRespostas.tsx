"use client";

// Respostas detalhadas, paginadas, com modal de detalhe.
//
// Toda celula aqui mostra texto vindo do banco. Na versao anterior isso era
// montado com `innerHTML` e interpolacao crua — inclusive dentro de
// `title="${r.cliente}"` —, de modo que um nome de projeto contendo aspas e
// uma tag executava script na tela de quem abrisse o painel. O React escapa
// tudo por construcao e essa classe inteira de problema desaparece.

import { useState } from "react";
import { formatarData } from "@/lib/formato";
import type { Categoria, Resposta } from "@/lib/dashboard";

function classeDaCategoria(c: Categoria): string {
  if (c === "DETRATOR") return "categoria-detrator";
  if (c === "NEUTRO") return "categoria-neutro";
  if (c === "PROMOTOR") return "categoria-promotor";
  return "";
}

const nota = (n: number | null) => (n !== null && n !== undefined ? n : "--");

function ModalDetalhes({ r, aoFechar }: { r: Resposta; aoFechar: () => void }) {
  return (
    <div
      className="modal active"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Detalhes da Resposta
          </h3>
          <button type="button" className="modal-close-btn" aria-label="Fechar" onClick={aoFechar}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="detalhes-grid">
            <div className="detalhes-item">
              <div className="detalhes-label">Nome</div>
              <div className="detalhes-value">{r.identificador}</div>
            </div>
            <div className="detalhes-item">
              <div className="detalhes-label">Cliente</div>
              <div className="detalhes-value">{r.cliente}</div>
            </div>
            <div className="detalhes-item">
              <div className="detalhes-label">Líder</div>
              <div className="detalhes-value">{r.lider}</div>
            </div>
            <div className="detalhes-item">
              <div className="detalhes-label">Projeto</div>
              <div className="detalhes-value">{r.projeto}</div>
            </div>
          </div>

          <div className="detalhes-label" style={{ marginBottom: 12 }}>
            Notas por Pergunta
          </div>
          <div className="detalhes-notas">
            {[
              ["Q1 - Nota Seteg", r.nota_q1],
              ["Q2 - Relacionamento", r.nota_q2],
              ["Q3 - Comunicação", r.nota_q3],
              ["Q4 - Indicação", r.nota_q4],
            ].map(([rotulo, valor]) => (
              <div className="nota-item" key={String(rotulo)}>
                <div className="nota-label">{rotulo}</div>
                <div className="nota-valor">{nota(valor as number | null)}</div>
              </div>
            ))}
          </div>

          <div className="detalhes-grid" style={{ marginTop: 16 }}>
            <div className="detalhes-item">
              <div className="detalhes-label">Média Geral</div>
              <div
                className="detalhes-value"
                style={{ color: "var(--seteg-medium-blue)", fontSize: "1.2rem" }}
              >
                {r.media.toFixed(1)}
              </div>
            </div>
            <div className="detalhes-item">
              <div className="detalhes-label">Categoria</div>
              <div className={`detalhes-value ${classeDaCategoria(r.categoria)}`}>
                {r.categoria || "--"}
              </div>
            </div>
          </div>

          <div className="detalhes-feedback">
            <div className="detalhes-label">Feedback Completo</div>
            <div className="detalhes-value">{r.feedback || "Sem feedback registrado"}</div>
          </div>

          <div
            className="detalhes-item"
            style={{ marginTop: 16, borderLeftColor: "var(--text-muted)" }}
          >
            <div className="detalhes-label">Data/Hora da Resposta</div>
            <div className="detalhes-value" style={{ fontSize: "0.95rem" }}>
              {formatarData(r.timestamp, true)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TabelaRespostas({ dados }: { dados: Resposta[] }) {
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [detalhe, setDetalhe] = useState<Resposta | null>(null);

  const totalPaginas = Math.max(1, Math.ceil(dados.length / porPagina));
  // Filtrar reduz a lista e pode deixar a pagina atual fora do intervalo;
  // grampear aqui evita a tela vazia que a versao anterior mostrava.
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const daPagina = dados.slice(inicio, inicio + porPagina);

  const numeros: number[] = [];
  const de = Math.max(1, paginaAtual - 2);
  const ate = Math.min(totalPaginas, de + 4);
  for (let i = de; i <= ate; i += 1) numeros.push(i);

  return (
    <>
      <div className="table-wrapper">
        <table id="tabela-respostas">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Cliente</th>
              <th>Líder</th>
              <th>Projeto</th>
              <th>Q1</th>
              <th>Q2</th>
              <th>Q3</th>
              <th>Q4</th>
              <th>Categoria</th>
              <th>Feedback</th>
              <th>Data</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {daPagina.length ? (
              daPagina.map((r, i) => (
                <tr key={`${r.id}-${i}`}>
                  <td>
                    <strong>{r.identificador}</strong>
                  </td>
                  <td>{r.cliente}</td>
                  <td>{r.lider}</td>
                  <td>{r.projeto}</td>
                  <td>{nota(r.nota_q1)}</td>
                  <td>{nota(r.nota_q2)}</td>
                  <td>{nota(r.nota_q3)}</td>
                  <td>{nota(r.nota_q4)}</td>
                  <td className={classeDaCategoria(r.categoria)}>{r.categoria || "--"}</td>
                  <td className="feedback-cell">
                    {r.feedback
                      ? r.feedback.slice(0, 25) + (r.feedback.length > 25 ? "..." : "")
                      : "-"}
                  </td>
                  <td>{formatarData(r.timestamp, true)}</td>
                  <td className="acoes-cell">
                    <button
                      type="button"
                      className="btn-acoes"
                      title="Ver detalhes completos"
                      aria-label="Ver detalhes completos"
                      onClick={() => setDetalhe(r)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={12} className="empty-state">
                  Nenhuma resposta encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination-container">
        <div className="pagination-info">
          {dados.length === 0 ? 0 : inicio + 1}-{Math.min(inicio + porPagina, dados.length)} de{" "}
          {dados.length}
        </div>
        <div className="pagination-controls">
          <button
            type="button"
            className="pagination-btn"
            title="Primeira página"
            disabled={paginaAtual === 1}
            onClick={() => setPagina(1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
            </svg>
          </button>
          <button
            type="button"
            className="pagination-btn"
            title="Página anterior"
            disabled={paginaAtual === 1}
            onClick={() => setPagina(paginaAtual - 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="pagination-numbers">
            {numeros.map((n) => (
              <button
                key={n}
                type="button"
                className={`pagination-btn ${n === paginaAtual ? "active" : ""}`}
                onClick={() => setPagina(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pagination-btn"
            title="Próxima página"
            disabled={paginaAtual >= totalPaginas}
            onClick={() => setPagina(paginaAtual + 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="pagination-btn"
            title="Última página"
            disabled={paginaAtual >= totalPaginas}
            onClick={() => setPagina(totalPaginas)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
        </div>
        <div className="pagination-per-page">
          <span>Por página</span>
          <select
            value={porPagina}
            onChange={(e) => {
              setPorPagina(Number(e.target.value));
              setPagina(1);
            }}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {detalhe ? <ModalDetalhes r={detalhe} aoFechar={() => setDetalhe(null)} /> : null}
    </>
  );
}
