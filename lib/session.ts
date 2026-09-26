// Sessao do lado do servidor: le o cookie, revalida a credencial no banco e
// oferece as guardas de autorizacao (exigirSessao / exigirPmo /
// exigirAcessoAoProjeto).
//
// ── Por que revalidar no banco a cada requisicao ──────────────────────────
//
// O JWT e imutavel ate expirar. Sem revalidacao, um lider desativado na tela
// de acessos continuaria entrando e escrevendo por ate 12 horas, e trocar a
// senha do PMO depois de uma suspeita de vazamento nao derrubaria ninguem.
// Era exatamente o caso da versao anterior deste sistema.
//
// Custo: uma leitura por requisicao autenticada, filtrada por id e limitada a
// uma linha. O mesmo que o SGA paga, e pelo mesmo motivo.
//
// Este modulo NAO pode ser importado pelo middleware: ele consulta o banco, e
// o middleware roda em Edge Runtime como primeira barreira barata. La so se
// confere a assinatura do token (lib/token.ts).

import { cache } from "react";
import { cookies } from "next/headers";
import { erro } from "@/lib/validacao";
import { selecionar, um } from "@/lib/db";
import { impressaoDaCredencial } from "@/lib/senha";
import {
  COOKIE_SESSAO,
  PERFIL_LIDER,
  PERFIL_PMO,
  type SessaoPayload,
  verificarToken,
} from "@/lib/token";

export { PERFIL_LIDER, PERFIL_PMO };
export type { SessaoPayload };

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  papel: "pmo" | "lider";
  lider_id: string | null;
  ativo: boolean;
  senha_hash: string;
}

// ── Cache curto da conta, ENTRE requisicoes ──────────────────────────────
//
// Cada chamada a API reconferia a conta no banco antes de fazer qualquer
// coisa. Com o banco a ~300ms daqui (Supabase em us-west-2), isso era uma
// ida e volta inteira de espera em TODA chamada — o dashboard faz de 2 a 3
// em sequencia. A conta muda raramente; por isso a linha fica 60s em memoria.
//
// O que continua valendo: editar a conta (desativar, trocar senha/papel)
// pela tela de Lideres chama esquecerConta() e derruba o cache na hora. So
// uma mudanca feita por fora do sistema (direto no banco) pode levar ate 60s
// para valer.
const TTL_CONTA_MS = 60_000;
const contasEmCache = new Map<string, { linha: LinhaUsuario; ate: number }>();

/** Descarta a conta do cache (chamar ao editar a conta). */
export function esquecerConta(usuarioId: string): void {
  contasEmCache.delete(usuarioId);
}

async function contaDoBanco(usuarioId: string): Promise<LinhaUsuario | null> {
  const guardada = contasEmCache.get(usuarioId);
  if (guardada && guardada.ate > Date.now()) return guardada.linha;
  const linha = await um<LinhaUsuario>(
    "usuarios_nps",
    { id: usuarioId },
    "id,nome,email,papel,lider_id,ativo,senha_hash"
  );
  if (linha) contasEmCache.set(usuarioId, { linha, ate: Date.now() + TTL_CONTA_MS });
  else contasEmCache.delete(usuarioId);
  return linha;
}

/**
 * Sessao vigente, ja reconferida no banco. `null` quando nao ha cookie, o
 * token nao confere, a credencial foi desativada ou a senha mudou.
 *
 * ── Por que `cache()` ─────────────────────────────────────────────────────
 *
 * A revalidacao custa UMA ida ao banco, e a mesma requisicao chamava esta
 * funcao mais de uma vez: o layout pergunta quem esta logado para montar o
 * menu, e a pagina pergunta de novo para decidir o que renderizar. Eram duas
 * consultas identicas, uma atras da outra, so para responder a mesma
 * pergunta — e com o banco a ~180ms daqui, isso e um terco de segundo de
 * espera por navegacao, sem nada em troca.
 *
 * `cache()` do React memoriza por REQUISICAO, nao entre requisicoes: a
 * segunda chamada dentro do mesmo pedido reaproveita a primeira, e o pedido
 * seguinte volta a consultar o banco. A garantia que motivou a revalidacao —
 * conta desativada ou senha trocada derrubam a sessao na proxima requisicao —
 * continua valendo exatamente como estava.
 */
export const getSessao = cache(async function getSessao(): Promise<SessaoPayload | null> {
  const cookie = cookies().get(COOKIE_SESSAO);
  if (!cookie) return null;

  const sessao = await verificarToken(cookie.value);
  if (!sessao) return null;

  try {
    const usuario = await contaDoBanco(sessao.usuarioId);
    if (!usuario || !usuario.ativo) return null;
    if (impressaoDaCredencial(usuario.senha_hash) !== sessao.cred) return null;

    // Nome, papel e escopo vem do BANCO, nao do token: rebaixar alguem de pmo
    // para lider, ou corrigir a qual lider a conta corresponde, precisa valer
    // na requisicao seguinte — nao no proximo login.
    return {
      ...sessao,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.papel === PERFIL_PMO ? PERFIL_PMO : PERFIL_LIDER,
      liderId: usuario.papel === PERFIL_PMO ? null : usuario.lider_id,
    };
  } catch (e) {
    // Banco fora do ar NAO e sessao invalida. Devolver `null` aqui expulsaria
    // todo mundo para a tela de login a cada solucao de continuidade do
    // Supabase, e a tela de login tambem precisa do banco — ou seja, a pessoa
    // ficaria presa. Deixar a requisicao seguir e seguro: a consulta seguinte
    // vai falhar do mesmo jeito e devolver erro de infraestrutura, que e a
    // verdade do que aconteceu.
    console.error("[NPS][sessao] nao foi possivel revalidar a credencial:", e);
    return sessao;
  }
});

/** Garante que existe sessao. 401 quando nao ha. */
export async function exigirSessao(): Promise<SessaoPayload> {
  const sessao = await getSessao();
  if (!sessao) {
    throw erro(401, "NAO_AUTENTICADO", "Sessao expirada ou invalida. Entre novamente.");
  }
  return sessao;
}

/** Somente PMO. Bloqueia o lider mesmo que ele chame o endpoint diretamente. */
export async function exigirPmo(): Promise<SessaoPayload> {
  const sessao = await exigirSessao();
  if (sessao.perfil !== PERFIL_PMO) {
    throw erro(403, "NAO_AUTORIZADO", "Esta acao e exclusiva do PMO.");
  }
  return sessao;
}

/**
 * Escopo do lider: devolve o lider_id quando o perfil for lider, ou null para
 * o PMO (que ve tudo).
 *
 * Um unico ponto de verdade para a regra "cada lider so ve os seus" — a mesma
 * razao pela qual o SGA concentrou isso em `podeVerTudo`. Espalhar
 * `perfil === 'lider'` por dez arquivos e como essa regra silenciosamente
 * deixa de valer num deles.
 */
export function escopoLider(sessao: SessaoPayload): string | null {
  return sessao.perfil === PERFIL_LIDER ? sessao.liderId : null;
}

/** Garante que o projeto pertence ao lider da sessao. */
export async function exigirAcessoAoProjeto(
  sessao: SessaoPayload,
  projetoId: string
): Promise<Record<string, unknown>> {
  const projeto = await um<{ id: string; lider_id: string | null; ativo: boolean }>(
    "projetos_mestre_nps",
    { id: projetoId },
    "id,lider_id,ativo"
  );
  if (!projeto) throw erro(404, "PROJETO_NAO_ENCONTRADO", "Projeto nao encontrado.");
  if (sessao.perfil === PERFIL_PMO) return projeto as unknown as Record<string, unknown>;
  if (!sessao.liderId || projeto.lider_id !== sessao.liderId) {
    throw erro(403, "NAO_AUTORIZADO", "Voce so tem acesso aos projetos sob sua responsabilidade.");
  }
  return projeto as unknown as Record<string, unknown>;
}

export interface EscopoDoLider {
  /** Projetos que ele pode ver: a uniao dos periodos dele. */
  projetoIds: string[];
  /** Pares `projeto_id|ciclo` que sao dele. */
  pares: Set<string>;
}

/**
 * O que um lider enxerga, recortado por PERIODO DE LIDERANCA. `null` = PMO,
 * que ve tudo.
 *
 * ── Por que nao basta filtrar por `projetos_mestre_nps.lider_id` ──────────
 *
 * Era o que esta funcao fazia, e estava errado nas duas pontas. `lider_id` no
 * mestre e o lider de HOJE, entao quando a PMO passa um projeto adiante:
 *
 *  - o lider NOVO herdava as respostas colhidas sob o lider anterior, que nao
 *    sao dele e entravam no NPS dele;
 *  - o lider ANTERIOR perdia de vista as respostas do proprio periodo, que
 *    sumiam da tela dele junto com o projeto.
 *
 * O recorte certo e por participacao no ciclo. `projetos_nps` guarda uma
 * linha por (projeto, ciclo) com o `lider_id` da epoca, e `nps_alterar_lider`
 * so mexe na linha do ciclo mais recente — "ciclos anteriores permanecem
 * intactos e as respostas NAO sao reatribuidas", diz a propria funcao. E o
 * mesmo principio que o README ja declarava; faltava quem lesse respeita-lo.
 *
 * Por isso o escopo tem duas partes: a lista de projetos (para a consulta ao
 * banco, que filtra por `projeto_id`) e o conjunto de pares projeto+ciclo,
 * que e o recorte fino — um projeto pode ser dele num ciclo e de outro no
 * seguinte, e so o par distingue os dois casos.
 */
export async function escopoDoLider(sessao: SessaoPayload): Promise<EscopoDoLider | null> {
  if (sessao.perfil !== PERFIL_LIDER) return null;
  // Lider ainda sem vinculo nao ve nada. `[]` e diferente de `null`: sem esta
  // distincao, uma conta sem lider_id enxergaria TODOS os projetos.
  if (!sessao.liderId) return { projetoIds: [], pares: new Set() };

  const { dados } = await selecionar<{ projeto_id: string | null; ciclo: string | null }[]>(
    "projetos_nps",
    { colunas: "projeto_id,ciclo", filtros: { lider_id: sessao.liderId } }
  );

  const projetoIds = new Set<string>();
  const pares = new Set<string>();
  for (const p of dados || []) {
    if (!p.projeto_id) continue;
    projetoIds.add(p.projeto_id);
    pares.add(chaveDoEscopo(p.projeto_id, p.ciclo));
  }

  return { projetoIds: [...projetoIds], pares };
}

/** Chave do par projeto+ciclo. Um lugar so, porque os dois lados precisam
 *  montar exatamente a mesma string. */
export function chaveDoEscopo(projetoId: unknown, ciclo: unknown): string {
  return `${String(projetoId ?? "")}|${String(ciclo ?? "")}`;
}
