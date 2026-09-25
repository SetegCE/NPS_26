"use client";

// Avisos passageiros no canto da tela.
//
// Virou contexto do React porque agora qualquer tela precisa dele e nenhuma
// deve criar a propria area de notificacao — era o que a versao anterior
// fazia, inserindo um <div id="toast-area"> no body sob demanda.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icone, type NomeIcone } from "@/componentes/Icone";

export type TipoToast = "sucesso" | "erro" | "aviso" | "info";

interface Aviso {
  id: number;
  mensagem: string;
  tipo: TipoToast;
}

const ICONE: Record<TipoToast, NomeIcone> = {
  sucesso: "check",
  erro: "x",
  aviso: "alerta",
  info: "info",
};

type Emitir = (mensagem: string, tipo?: TipoToast, duracao?: number) => void;

const ContextoToast = createContext<Emitir | null>(null);

export function ProvedorToast({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const proximoId = useRef(1);

  const toast = useCallback<Emitir>((mensagem, tipo = "info", duracao = 4200) => {
    const id = proximoId.current++;
    setAvisos((atuais) => [...atuais, { id, mensagem, tipo }]);
    // Sem limpeza no unmount de proposito: o provedor vive enquanto a
    // aplicacao vive, e um timer de 4 segundos que sobreviva a uma troca de
    // rota so apaga um aviso que ja nao esta na tela.
    setTimeout(() => {
      setAvisos((atuais) => atuais.filter((a) => a.id !== id));
    }, duracao);
  }, []);

  const valor = useMemo(() => toast, [toast]);

  return (
    <ContextoToast.Provider value={valor}>
      {children}
      <div className="toast-area" id="toast-area" role="status" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`toast ${a.tipo}`}>
            <Icone nome={ICONE[a.tipo]} tamanho={16} />
            <span>{a.mensagem}</span>
          </div>
        ))}
      </div>
    </ContextoToast.Provider>
  );
}

export function useToast(): Emitir {
  const ctx = useContext(ContextoToast);
  if (!ctx) {
    throw new Error("useToast precisa estar dentro de <ProvedorToast>.");
  }
  return ctx;
}
