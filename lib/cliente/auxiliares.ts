"use client";

// Listas auxiliares dos selects: clientes, lideres e ciclos.
//
// Sao as mesmas listas em quase toda tela e mudam raramente, entao ficam em
// cache de modulo — abrir cinco modais nao dispara quinze consultas. O cache
// guarda a PROMESSA, nao o resultado: duas telas montando ao mesmo tempo
// compartilham a mesma requisicao em vez de fazerem uma cada.

import { useEffect, useState } from "react";
import { api, type Pagina } from "@/lib/cliente/api";
import type { Ciclo, Cliente, Lider } from "@/lib/cliente/tipos";

type Chave = "clientes" | "lideres" | "ciclos";

const cache = new Map<Chave, Promise<unknown>>();

function carregar<T>(chave: Chave, carregador: () => Promise<T>): Promise<T> {
  if (!cache.has(chave)) {
    cache.set(
      chave,
      carregador().catch((e) => {
        // Falhou: tira do cache para que a proxima tentativa nao herde o erro
        // para sempre.
        cache.delete(chave);
        throw e;
      })
    );
  }
  return cache.get(chave) as Promise<T>;
}

export const auxiliares = {
  clientes: () =>
    carregar("clientes", async () => {
      const r = await api.get<Pagina<Cliente>>("clientes", { porPagina: 200, ativo: true });
      return r.itens || [];
    }),

  lideres: () =>
    carregar("lideres", async () => {
      const r = await api.get<Pagina<Lider>>("lideres", { porPagina: 200, ativo: true });
      return r.itens || [];
    }),

  ciclos: () =>
    carregar("ciclos", async () => {
      const r = await api.get<{ itens: Ciclo[] }>("ciclos");
      return r.itens || [];
    }),

  /** Invalida depois de cadastrar ou editar. Sem chave, limpa tudo. */
  invalidar(...chaves: Chave[]) {
    if (!chaves.length) cache.clear();
    else chaves.forEach((c) => cache.delete(c));
  },
};

/** Carrega uma lista auxiliar dentro de um componente. */
export function useAuxiliar<T>(carregador: () => Promise<T[]>): T[] {
  const [itens, setItens] = useState<T[]>([]);

  useEffect(() => {
    let ativo = true;
    carregador()
      .then((l) => {
        if (ativo) setItens(l);
      })
      .catch(() => {
        // Lista auxiliar indisponivel deixa o select vazio, e so. Quebrar a
        // tela inteira por causa de um filtro seria pior.
        if (ativo) setItens([]);
      });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return itens;
}

/** Ciclo aberto — o padrao dos formularios. */
export function cicloAberto(ciclos: Ciclo[]): Ciclo | null {
  return ciclos.find((c) => c.status === "aberto") || ciclos[0] || null;
}
