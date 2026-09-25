"use client";

// Hook das telas de listagem.
//
// Todas as oito telas administrativas faziam a mesma coisa a mao: montar os
// parametros, chamar a API, trocar o conteudo por "carregando", tratar erro,
// religar a ordenacao do cabecalho e recriar a paginacao. Eram ~40 linhas
// repetidas oito vezes, e cada copia tinha uma diferenca pequena — uma nao
// zerava a pagina ao filtrar, outra nao cancelava a busca anterior.
//
// Aqui isso existe uma vez, com dois cuidados que nenhuma das copias tinha:
//
//  - a requisicao anterior e ABORTADA quando outra comeca, entao uma resposta
//    lenta nao sobrescreve o resultado de um filtro mais novo;
//  - a busca por texto e debounced, entao digitar "petrobras" nao dispara
//    nove consultas.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErroApi, type Pagina, type Params } from "@/lib/cliente/api";
import { alternarOrdem, type Ordem } from "@/lib/cliente/tipos";

export interface Lista<T> {
  itens: T[];
  total: number;
  pagina: number;
  porPagina: number;
  ordem: Ordem;
  carregando: boolean;
  erro: string | null;
  /** Busca digitada, ja no estado (o debounce e interno). */
  busca: string;
  setBusca: (v: string) => void;
  ordenarPor: (campo: string) => void;
  irParaPagina: (p: { pagina: number; porPagina: number }) => void;
  /** Recarrega mantendo filtros e pagina — use depois de salvar. */
  recarregar: () => void;
}

const DEBOUNCE_MS = 320;

export function useLista<T>(
  recurso: string,
  {
    ordemInicial,
    filtros = {},
    porPaginaInicial = 25,
  }: {
    ordemInicial: Ordem;
    /** Filtros da tela. Passe um objeto memoizado ou estavel. */
    filtros?: Params;
    porPaginaInicial?: number;
  }
): Lista<T> {
  const [itens, setItens] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(porPaginaInicial);
  const [ordem, setOrdem] = useState<Ordem>(ordemInicial);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gatilho, setGatilho] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  // Debounce da busca. O valor so vira parametro depois que a pessoa para de
  // digitar.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [busca]);

  // Serializado para poder entrar nas dependencias do efeito sem que um
  // objeto novo a cada render dispare recarga infinita.
  const filtrosChave = JSON.stringify(filtros);

  // Qualquer mudanca de recorte volta para a primeira pagina: continuar na
  // pagina 7 de um resultado que agora tem 2 paginas mostra a tela vazia.
  useEffect(() => {
    setPagina(1);
  }, [filtrosChave, buscaAplicada]);

  useEffect(() => {
    abortRef.current?.abort();
    const controlador = new AbortController();
    abortRef.current = controlador;

    setCarregando(true);
    setErro(null);

    const params: Params = {
      ...(JSON.parse(filtrosChave) as Params),
      pagina,
      porPagina,
      ordenarPor: ordem.campo,
      ordem: ordem.ascending ? "asc" : "desc",
      ...(buscaAplicada ? { busca: buscaAplicada } : {}),
    };

    api
      .get<Pagina<T>>(recurso, params, controlador.signal)
      .then((r) => {
        setItens(r.itens || []);
        setTotal(r.total ?? 0);
        setCarregando(false);
      })
      .catch((e) => {
        // Aborto nao e erro: e a tela dizendo que aquela resposta nao
        // interessa mais.
        if (e instanceof DOMException && e.name === "AbortError") return;
        setErro(e instanceof ErroApi ? e.message : "Falha ao carregar os dados.");
        setItens([]);
        setTotal(0);
        setCarregando(false);
      });

    return () => controlador.abort();
  }, [recurso, filtrosChave, buscaAplicada, pagina, porPagina, ordem, gatilho]);

  const ordenarPor = useCallback((campo: string) => {
    setOrdem((atual) => alternarOrdem(atual, campo));
  }, []);

  const irParaPagina = useCallback((p: { pagina: number; porPagina: number }) => {
    setPagina(p.pagina);
    setPorPagina(p.porPagina);
  }, []);

  const recarregar = useCallback(() => setGatilho((g) => g + 1), []);

  return useMemo(
    () => ({
      itens,
      total,
      pagina,
      porPagina,
      ordem,
      carregando,
      erro,
      busca,
      setBusca,
      ordenarPor,
      irParaPagina,
      recarregar,
    }),
    [itens, total, pagina, porPagina, ordem, carregando, erro, busca, ordenarPor, irParaPagina, recarregar]
  );
}
