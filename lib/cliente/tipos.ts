// Tipos compartilhados pelas telas.

export interface Ordem {
  campo: string;
  ascending: boolean;
}

export interface EstadoLista {
  pagina: number;
  porPagina: number;
  ordem: Ordem;
  busca: string;
}

export const LISTA_INICIAL = (campo: string, ascending = true): EstadoLista => ({
  pagina: 1,
  porPagina: 25,
  ordem: { campo, ascending },
  busca: "",
});

/** Parametros de listagem no formato que as rotas esperam. */
export function paramsDaLista(estado: EstadoLista): Record<string, string | number> {
  return {
    pagina: estado.pagina,
    porPagina: estado.porPagina,
    ordenarPor: estado.ordem.campo,
    ordem: estado.ordem.ascending ? "asc" : "desc",
    ...(estado.busca ? { busca: estado.busca } : {}),
  };
}

/** Alterna a ordenacao ao clicar num cabecalho: mesmo campo inverte o sentido,
 *  campo novo comeca ascendente. */
export function alternarOrdem(atual: Ordem, campo: string): Ordem {
  if (atual.campo === campo) return { campo, ascending: !atual.ascending };
  return { campo, ascending: true };
}

// ── Perfis ────────────────────────────────────────────────────────────────

export type Perfil = "pmo" | "lider";

export interface Sessao {
  perfil: Perfil;
  nome: string;
  email: string;
  liderId: string | null;
}

export const ehPmo = (s: Sessao) => s.perfil === "pmo";

// ── Entidades usadas em mais de uma tela ──────────────────────────────────

export interface Cliente {
  id: string;
  nome: string;
  segmento: string | null;
  ativo: boolean;
}

export interface Lider {
  id: string;
  nome: string;
  email: string | null;
  ativo: boolean;
}

export interface Ciclo {
  id: string;
  codigo: string;
  descricao: string | null;
  status: "planejamento" | "aberto" | "encerrado";
  data_inicio: string | null;
  data_fim: string | null;
  /** Corte entre os canais: ate ele e e-mail, dali ate `data_fim` e WhatsApp
   *  (migrations 17 e 18). */
  canal_email_ate?: string | null;
  total_projetos?: number;
  total_elegiveis?: number;
}
