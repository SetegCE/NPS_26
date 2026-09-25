// Filtros da tela de operacao do ciclo, compartilhados entre a listagem
// (/api/operacao) e os indicadores (/api/operacao/indicadores).
//
// Vivem fora das duas rotas para que nenhuma importe a outra — ver o
// comentario em lib/listas.ts. E, principalmente, para que o recorte do lider
// seja escrito uma vez so: duas copias da regra "o lider so ve os seus" sao
// duas chances de ela divergir.

import { booleano, umDe, uuidOpcional } from "@/lib/validacao";
import type { FiltroValor } from "@/lib/db";
import { SITUACOES_OPERACAO } from "@/lib/listas";
import { PERFIL_LIDER, type SessaoPayload } from "@/lib/token";

/**
 * Monta os filtros da vw_operacao_ciclo a partir da query e da sessao.
 *
 * Devolve `null` quando a sessao e de um lider sem vinculo: nesse caso o
 * resultado correto e lista vazia, e nao "todos os projetos".
 */
export function montarFiltrosOperacao(
  query: URLSearchParams,
  sessao: SessaoPayload
): Record<string, FiltroValor> | null {
  const filtros: Record<string, FiltroValor> = { projeto_ativo: true };

  if (sessao.perfil === PERFIL_LIDER) {
    if (!sessao.liderId) return null;
    filtros.lider_id = sessao.liderId;
  } else {
    const lider = uuidOpcional(query.get("lider"), "lider");
    if (lider) filtros.lider_id = lider;
  }

  const ciclo = uuidOpcional(query.get("ciclo"), "ciclo");
  if (ciclo) filtros.ciclo_id = ciclo;
  const cliente = uuidOpcional(query.get("cliente"), "cliente");
  if (cliente) filtros.cliente_id = cliente;

  const elegivel = booleano(query.get("elegivel"), null);
  if (elegivel !== null) filtros.elegivel = elegivel;

  const situacao = umDe(query.get("situacao"), SITUACOES_OPERACAO, "situacao");
  if (situacao) filtros.situacao = situacao;

  const comPesquisa = booleano(query.get("comPesquisa"), null);
  if (comPesquisa === true) filtros.pesquisas = { op: "gt", valor: 0 };
  if (comPesquisa === false) filtros.pesquisas = { op: "eq", valor: 0 };

  const comResposta = booleano(query.get("comResposta"), null);
  if (comResposta === true) filtros.respostas = { op: "gt", valor: 0 };
  if (comResposta === false) filtros.respostas = { op: "eq", valor: 0 };

  return filtros;
}
