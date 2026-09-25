"use client";

// Modal e confirmacao.
//
// A versao anterior criava o overlay com `document.createElement` e vigiava o
// DOM com um MutationObserver para descobrir se a pessoa tinha cancelado. Em
// React o estado e do componente que abriu, e "cancelar" e simplesmente nao
// resolver como confirmado.

import { useCallback, useEffect, useRef } from "react";
import { Aviso } from "@/componentes/Estados";

export interface AcaoModal {
  rotulo: string;
  classe?: string;
  onClick: () => void;
  desabilitado?: boolean;
}

export function Modal({
  titulo,
  subtitulo,
  largo = false,
  aoFechar,
  acoes = [],
  children,
}: {
  titulo: string;
  subtitulo?: string;
  largo?: boolean;
  aoFechar: () => void;
  acoes?: AcaoModal[];
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);

  // ESC fecha. O listener e do documento porque o foco pode estar em qualquer
  // campo do formulario dentro do modal.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  // Foco no primeiro campo: quem abre um modal de cadastro quer digitar, nao
  // procurar onde clicar.
  useEffect(() => {
    const primeiro = box.current?.querySelector<HTMLElement>("input, select, textarea");
    primeiro?.focus();
  }, []);

  const aoClicarNoFundo = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) aoFechar();
    },
    [aoFechar]
  );

  return (
    <div className="modal-modulo" onClick={aoClicarNoFundo}>
      <div
        ref={box}
        className={`modal-modulo-box ${largo ? "largo" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
      >
        <div className="modal-modulo-head">
          <div>
            <h2>{titulo}</h2>
            {subtitulo ? <p>{subtitulo}</p> : null}
          </div>
          <button type="button" className="modal-modulo-fechar" aria-label="Fechar" onClick={aoFechar}>
            &times;
          </button>
        </div>
        <div className="modal-modulo-body">{children}</div>
        {acoes.length ? (
          <div className="modal-modulo-foot">
            {acoes.map((a) => (
              <button
                key={a.rotulo}
                type="button"
                className={a.classe || "btn-secondary"}
                onClick={a.onClick}
                disabled={a.desabilitado}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Confirmacao de acoes destrutivas e de inativacao. */
export function Confirmacao({
  titulo,
  mensagem,
  detalhe,
  rotuloConfirmar = "Confirmar",
  perigo = true,
  aoConfirmar,
  aoCancelar,
  ocupado = false,
}: {
  titulo: string;
  mensagem: string;
  detalhe?: string;
  rotuloConfirmar?: string;
  perigo?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  ocupado?: boolean;
}) {
  return (
    <Modal
      titulo={titulo}
      aoFechar={aoCancelar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoCancelar },
        {
          rotulo: ocupado ? "Aguarde..." : rotuloConfirmar,
          classe: "btn-primary",
          onClick: aoConfirmar,
          desabilitado: ocupado,
        },
      ]}
    >
      <Aviso tipo={perigo ? "atencao" : "info"}>{mensagem}</Aviso>
      {detalhe ? (
        <p style={{ fontSize: ".84rem", color: "var(--text-muted)" }}>{detalhe}</p>
      ) : null}
    </Modal>
  );
}
