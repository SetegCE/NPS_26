"use client";

import { useEffect, useState } from "react";

export function Paginacao({
  pagina,
  porPagina,
  total,
  aoMudar,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  aoMudar: (estado: { pagina: number; porPagina: number }) => void;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fim = Math.min(pagina * porPagina, total);

  // Janela de 5 numeros em torno da pagina atual: com 40 paginas, listar todas
  // empurraria o resto da barra para fora da tela.
  const de = Math.max(1, pagina - 2);
  const ate = Math.min(totalPaginas, de + 4);
  const numeros: number[] = [];
  for (let i = de; i <= ate; i += 1) numeros.push(i);

  const ir = (alvo: number) => {
    if (alvo >= 1 && alvo <= totalPaginas && alvo !== pagina) aoMudar({ pagina: alvo, porPagina });
  };

  return (
    <div className="paginacao-modulo">
      <span>
        {inicio}-{fim} de {total} registro{total === 1 ? "" : "s"}
      </span>

      <div className="paginacao-botoes">
        <button type="button" onClick={() => ir(1)} disabled={pagina === 1} title="Primeira">
          &laquo;
        </button>
        <button type="button" onClick={() => ir(pagina - 1)} disabled={pagina === 1} title="Anterior">
          &lsaquo;
        </button>
        {numeros.map((n) => (
          <button
            key={n}
            type="button"
            className={n === pagina ? "atual" : ""}
            onClick={() => ir(n)}
            aria-current={n === pagina ? "page" : undefined}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          onClick={() => ir(pagina + 1)}
          disabled={pagina >= totalPaginas}
          title="Proxima"
        >
          &rsaquo;
        </button>
        <button
          type="button"
          onClick={() => ir(totalPaginas)}
          disabled={pagina >= totalPaginas}
          title="Ultima"
        >
          &raquo;
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Por pagina
        <select
          value={porPagina}
          onChange={(e) => aoMudar({ pagina: 1, porPagina: Number(e.target.value) })}
          style={{
            height: 28,
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            background: "var(--glass-bg)",
            fontFamily: "inherit",
          }}
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Paginacao no navegador para listas que chegam inteiras. Devolve so as linhas
 * da pagina atual e a barra de paginas (null quando cabe tudo numa pagina).
 * Mudou a quantidade de linhas (filtro), volta para a pagina 1.
 */
export function usePaginacaoLocal<T>(linhas: T[], porPaginaInicial = 10) {
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(porPaginaInicial);
  useEffect(() => setPagina(1), [linhas.length]);

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / porPagina));
  const atual = Math.min(pagina, totalPaginas);
  const comPaginas = linhas.length > Math.min(porPagina, 10);
  const visiveis = comPaginas ? linhas.slice((atual - 1) * porPagina, atual * porPagina) : linhas;

  const barra = comPaginas ? (
    <Paginacao
      pagina={atual}
      porPagina={porPagina}
      total={linhas.length}
      aoMudar={(p) => {
        setPagina(p.pagina);
        setPorPagina(p.porPagina);
      }}
    />
  ) : null;

  return { visiveis, barra };
}
