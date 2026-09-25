"use client";

// Peças comuns a todas as telas administrativas: cabeçalho, barra de filtros
// e o corpo de uma listagem (carregando / erro / tabela + paginacao).

import { EstadoCarregando, EstadoErro } from "@/componentes/Estados";
import { Paginacao } from "@/componentes/Paginacao";
import { Tabela, type Coluna } from "@/componentes/Tabela";
import type { Lista } from "@/lib/cliente/useLista";

export function CabecalhoTela({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="view-header">
      <div>
        <h1>{titulo}</h1>
        {descricao ? <p>{descricao}</p> : null}
      </div>
      {acoes ? <div className="view-acoes">{acoes}</div> : null}
    </div>
  );
}

export function BarraFiltros({ children }: { children: React.ReactNode }) {
  return <div className="filtros-modulo">{children}</div>;
}

export function Filtro({
  id,
  rotulo,
  children,
}: {
  id: string;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="filtro">
      <label htmlFor={id}>{rotulo}</label>
      {children}
    </div>
  );
}

export function FiltroBusca({
  id = "f-busca",
  rotulo = "Buscar",
  placeholder,
  valor,
  aoMudar,
}: {
  id?: string;
  rotulo?: string;
  placeholder?: string;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <Filtro id={id} rotulo={rotulo}>
      <input
        id={id}
        type="search"
        placeholder={placeholder}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
      />
    </Filtro>
  );
}

export function FiltroSelect({
  id,
  rotulo,
  valor,
  aoMudar,
  opcoes,
}: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
}) {
  return (
    <Filtro id={id} rotulo={rotulo}>
      <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)}>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </Filtro>
  );
}

/** Situacao ativo/inativo — o mesmo filtro em seis telas. */
export const OPCOES_SITUACAO = [
  { valor: "true", rotulo: "Ativos" },
  { valor: "false", rotulo: "Inativos" },
  { valor: "", rotulo: "Todos" },
];

/**
 * Corpo de uma listagem.
 *
 * Mantem a tabela montada enquanto recarrega, em vez de troca-la por
 * "Carregando...": trocar faz a tela piscar e perder a posicao de rolagem a
 * cada letra digitada na busca. O spinner so aparece na primeira carga.
 */
export function CorpoLista<T extends Record<string, unknown>>({
  lista,
  colunas,
  chaveDaLinha,
  vazio,
}: {
  lista: Lista<T>;
  colunas: Coluna<T>[];
  chaveDaLinha: (linha: T, indice: number) => string;
  vazio?: string;
}) {
  if (lista.erro) return <EstadoErro mensagem={lista.erro} />;
  if (lista.carregando && !lista.itens.length) return <EstadoCarregando />;

  return (
    <>
      <div style={{ opacity: lista.carregando ? 0.6 : 1, transition: "opacity .15s" }}>
        <Tabela
          colunas={colunas}
          linhas={lista.itens}
          ordem={lista.ordem}
          aoOrdenar={lista.ordenarPor}
          chaveDaLinha={chaveDaLinha}
          vazio={vazio}
          paginar={false}
        />
      </div>
      {lista.total > 0 ? (
        <Paginacao
          pagina={lista.pagina}
          porPagina={lista.porPagina}
          total={lista.total}
          aoMudar={lista.irParaPagina}
        />
      ) : null}
    </>
  );
}

/** Selo colorido de situacao/status, usado em todas as tabelas. */
export function Selo({
  tom,
  children,
}: {
  tom: "verde" | "neutro" | "laranja" | "azul" | "vermelho" | "amarelo";
  children: React.ReactNode;
}) {
  return <span className={`selo selo-${tom}`}>{children}</span>;
}
