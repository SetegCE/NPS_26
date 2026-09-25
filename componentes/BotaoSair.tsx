"use client";

// Botao de sair com confirmacao.
//
// Existe como componente porque a saida aparece em dois lugares: no rodape da
// barra lateral e no cabecalho do dashboard. Na versao anterior o botao da
// barra lateral disparava um `.click()` no botao do cabecalho para reaproveitar
// o modal — o que amarrava a barra a existencia de uma tela especifica.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Confirmacao } from "@/componentes/Modal";
import { api } from "@/lib/cliente/api";

export function BotaoSair({
  className,
  titulo = "Sair",
  children,
  aoAbrir,
}: {
  className?: string;
  titulo?: string;
  children: React.ReactNode;
  /** Chamado antes de abrir o modal — a barra lateral usa para se fechar. */
  aoAbrir?: () => void;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    try {
      await api.sair();
    } catch {
      // Mesmo que a chamada falhe, o destino e o login: la o cookie invalido
      // e descartado de qualquer forma.
    }
    // `replace` e nao `push`: depois de sair, o botao "voltar" do navegador
    // nao deve recolocar a pessoa numa tela interna vinda do cache.
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className={className}
        title={titulo}
        aria-label={titulo}
        onClick={() => {
          aoAbrir?.();
          setConfirmando(true);
        }}
      >
        {children}
      </button>

      {confirmando ? (
        <Confirmacao
          titulo="Sair do dashboard?"
          mensagem="Tem certeza que deseja encerrar sua sessao?"
          rotuloConfirmar="Sair"
          ocupado={saindo}
          aoConfirmar={sair}
          aoCancelar={() => setConfirmando(false)}
        />
      ) : null}
    </>
  );
}
