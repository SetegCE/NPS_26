"use client";

// Visualizacao somente leitura de um registro: o "olho" da coluna Acoes.
//
// Um componente so para todas as telas, para que ver os dados de um cliente,
// de um ciclo ou de uma pesquisa tenha a mesma cara. Quem chama decide os
// campos; conteudo extra (lista de projetos, resposta da pesquisa) entra como
// children, abaixo da grade.

import type { ReactNode } from "react";
import { Modal } from "@/componentes/Modal";

export interface ItemDetalhe {
  rotulo: string;
  valor: ReactNode;
  /** Ocupa a linha inteira (textos longos, como observacoes). */
  largo?: boolean;
}

export function ModalDetalhes({
  titulo,
  subtitulo,
  itens,
  largo = false,
  aoFechar,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  itens: ItemDetalhe[];
  largo?: boolean;
  aoFechar: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      titulo={titulo}
      subtitulo={subtitulo}
      largo={largo}
      aoFechar={aoFechar}
      acoes={[{ rotulo: "Fechar", classe: "btn-primary", onClick: aoFechar }]}
    >
      <GradeDetalhes itens={itens} />
      {children ? <div style={{ marginTop: 16 }}>{children}</div> : null}
    </Modal>
  );
}

export function GradeDetalhes({ itens }: { itens: ItemDetalhe[] }) {
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: "12px 20px",
        margin: 0,
      }}
    >
      {itens.map((i) => (
        <div key={i.rotulo} style={i.largo ? { gridColumn: "1 / -1" } : undefined}>
          <dt
            style={{
              fontSize: ".72rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              color: "var(--text-muted)",
              marginBottom: 3,
            }}
          >
            {i.rotulo}
          </dt>
          <dd style={{ margin: 0, fontSize: ".88rem", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {i.valor === null || i.valor === undefined || i.valor === "" ? "—" : i.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}
