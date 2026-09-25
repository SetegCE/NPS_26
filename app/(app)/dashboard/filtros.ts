// Filtros do dashboard: estado, aplicacao e opcoes dos selects.
//
// Estao fora do componente porque o recorte precisa valer igual em cinco
// lugares (tabela, KPIs, incidencia, comparativa, analise por lider). Quando
// isso morava dentro de `applyFilters()` lendo `element.value`, cada painel
// relia os selects por conta propria — e a incidencia comparativa chegou a
// ter a sua propria copia das regras.

import { normalizar, type Projeto, type Resposta } from "@/lib/dashboard";

export interface Filtros {
  ciclo: string;
  cliente: string;
  lider: string;
  projeto: string;
  categoria: string;
  classe: string;
  tipoServico: string;
  segmento: string;
  canal: string;
}

export const FILTROS_VAZIOS: Filtros = {
  ciclo: "",
  cliente: "",
  lider: "",
  projeto: "",
  categoria: "",
  classe: "",
  tipoServico: "",
  segmento: "",
  canal: "",
};

/** Respostas que passam pelo recorte atual. */
export function filtrarRespostas(respostas: Resposta[], f: Filtros): Resposta[] {
  return respostas.filter((d) => {
    if (f.cliente && d.cliente !== f.cliente) return false;
    if (f.lider && normalizar(d.lider_atual) !== normalizar(f.lider)) return false;
    if (f.projeto && d.projeto !== f.projeto) return false;
    if (f.categoria && d.categoria !== f.categoria) return false;
    if (f.ciclo && d.ciclo !== f.ciclo) return false;
    if (f.classe && d.classe_contratual !== f.classe) return false;
    if (f.tipoServico && d.tipo_servico !== f.tipoServico) return false;
    if (f.canal && d.canal !== f.canal) return false;
    if (f.segmento && d.segmento_cliente !== f.segmento) return false;
    return true;
  });
}

/**
 * Universo de projetos do recorte atual — o DENOMINADOR da taxa de cobertura.
 *
 * Nao aplica o filtro de categoria nem o de canal: os dois sao propriedades
 * de uma RESPOSTA, e um projeto que nao respondeu nao tem nenhuma das duas.
 * Aplica-los aqui esvaziaria o denominador e faria a cobertura dar 100%
 * sempre que houvesse ao menos uma resposta.
 */
export function filtrarProjetos(projetos: Projeto[], f: Filtros): Projeto[] {
  return projetos.filter((p) => {
    if (f.lider && normalizar(p.lider_atual) !== normalizar(f.lider)) return false;
    if (f.ciclo && p.ciclo !== f.ciclo) return false;
    if (f.classe && p.classe_contratual !== f.classe) return false;
    if (f.tipoServico && p.tipo_servico !== f.tipoServico) return false;
    if (f.segmento && p.segmento_cliente !== f.segmento) return false;
    if (f.cliente && normalizar(p.cliente) !== normalizar(f.cliente)) return false;
    if (f.projeto && normalizar(p.projeto) !== normalizar(f.projeto)) return false;
    return true;
  });
}

export interface OpcoesFiltro {
  ciclos: string[];
  clientes: string[];
  lideres: string[];
  projetos: string[];
  tiposServico: string[];
  segmentos: string[];
}

const unicosOrdenados = (valores: (string | null | undefined)[]): string[] =>
  [...new Set(valores.filter((v): v is string => Boolean(v)))].sort();

/**
 * Opcoes dos selects.
 *
 * A fonte oficial e projetos_nps, nao as respostas: um projeto que ainda nao
 * respondeu precisa aparecer no filtro, senao nao ha como procurar por ele.
 */
export function montarOpcoes(projetos: Projeto[], respostas: Resposta[]): OpcoesFiltro {
  return {
    ciclos: unicosOrdenados([
      ...projetos.map((p) => p.ciclo),
      ...respostas.map((d) => d.ciclo),
    ]),
    clientes: unicosOrdenados(projetos.map((p) => p.cliente)),
    lideres: unicosOrdenados(projetos.map((p) => p.lider_atual)),
    projetos: unicosOrdenados(projetos.map((p) => p.projeto)),
    tiposServico: unicosOrdenados(projetos.map((p) => p.tipo_servico)),
    segmentos: unicosOrdenados(projetos.map((p) => p.segmento_cliente)),
  };
}

/** Resumo textual dos filtros ativos — usado no cabecalho do PDF exportado. */
export function descreverFiltros(f: Filtros): string[] {
  const rotulos: [keyof Filtros, string][] = [
    ["cliente", "Cliente"],
    ["lider", "Líder"],
    ["projeto", "Projeto"],
    ["categoria", "Categoria"],
    ["ciclo", "Ciclo"],
    ["classe", "Classe"],
    ["tipoServico", "Tipo Serviço"],
    ["segmento", "Segmento"],
    ["canal", "Canal"],
  ];
  return rotulos.filter(([chave]) => f[chave]).map(([chave, rotulo]) => `${rotulo}: ${f[chave]}`);
}
