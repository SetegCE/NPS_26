"use client";

// Tabela e paginacao das telas administrativas.

import { EstadoVazio } from "@/componentes/Estados";
import { Icone, type NomeIcone } from "@/componentes/Icone";
import type { Ordem } from "@/lib/cliente/tipos";

export interface Coluna<T> {
  chave: string;
  rotulo: string;
  ordenavel?: boolean;
  classe?: string;
  render?: (linha: T) => React.ReactNode;
}

export function Tabela<T extends Record<string, unknown>>({
  colunas,
  linhas,
  ordem,
  aoOrdenar,
  chaveDaLinha,
  vazio = "Nenhum registro encontrado.",
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  ordem?: Ordem;
  aoOrdenar?: (campo: string) => void;
  chaveDaLinha: (linha: T, indice: number) => string;
  vazio?: string;
}) {
  if (!linhas.length) return <EstadoVazio titulo={vazio} />;

  return (
    <div className="tabela-scroll">
      <table className="tabela-modulo">
        <thead>
          <tr>
            {colunas.map((c) => {
              const ativo = ordem && ordem.campo === c.chave;
              const podeOrdenar = Boolean(c.ordenavel && aoOrdenar);
              return (
                <th
                  key={c.chave}
                  className={`${podeOrdenar ? "ordenavel" : ""} ${c.classe || ""}`}
                  onClick={podeOrdenar ? () => aoOrdenar!(c.chave) : undefined}
                  aria-sort={ativo ? (ordem!.ascending ? "ascending" : "descending") : undefined}
                >
                  {c.rotulo}
                  {ativo ? <span className="seta">{ordem!.ascending ? "▲" : "▼"}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => (
            <tr key={chaveDaLinha(linha, i)}>
              {colunas.map((c) => (
                // `data-rotulo` alimenta o layout de cartao no mobile, onde as
                // celulas empilham e precisam mostrar o nome da coluna.
                <td key={c.chave} className={c.classe || ""} data-rotulo={c.rotulo}>
                  {c.render ? c.render(linha) : ((linha[c.chave] as React.ReactNode) ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Botao de acao em linha de tabela: so icone, com tooltip. */
export function BotaoAcao({
  icone,
  titulo,
  onClick,
  perigo = false,
  desabilitado = false,
}: {
  icone: NomeIcone;
  titulo: string;
  onClick: () => void;
  perigo?: boolean;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn-acoes ${perigo ? "perigo" : ""}`}
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      disabled={desabilitado}
    >
      <Icone nome={icone} tamanho={16} />
    </button>
  );
}
