// Cliente da API externa do Clockrview — a fonte de verdade dos projetos.
//
// O cadastro de projeto deixou de ser feito aqui: codigo, nome, cliente,
// lider e situacao (ativo/inativo) vem do Clockrview. O banco do NPS guarda
// um ESPELHO desses dados (projetos_mestre_nps), e nao por gosto: respostas,
// pesquisas, ciclos, ISC e historico de lideranca apontam para o id do
// projeto por chave estrangeira, e e isso que mantem o NPS historico ligado
// ao projeto certo. Quem mantem o espelho em dia e lib/sincronizarProjetos.ts.
//
// A chave da API so e lida no servidor. Sem prefixo NEXT_PUBLIC_.

import { erro } from "@/lib/validacao";

const URL_PADRAO = "https://clockrview.setegce.com/api/externo/projetos";

export interface ProjetoClockrview {
  codigo: string;
  nome: string;
  status: "ativo" | "inativo" | string;
  clienteNome: string | null;
  liderNome: string | null;
  liderEmail: string | null;
  coLiderNome: string | null;
  coLiderEmail: string | null;
}

/**
 * Chave de comparacao do codigo do projeto.
 *
 * O Clockrview escreve "0221-02-2025"; o cadastro antigo, vindo da planilha,
 * escrevia "#0221-2-2025". Sao o mesmo projeto. Compara-se numero a numero,
 * sem simbolos e sem zeros a esquerda.
 */
export function chaveCodigo(codigo: unknown): string {
  const partes = String(codigo ?? "")
    .replace(/[^0-9-]/g, "")
    .split("-")
    .filter(Boolean);
  return partes.map((p) => String(parseInt(p, 10))).join("-");
}

const textoOuNulo = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
};

export async function buscarProjetosClockrview(): Promise<ProjetoClockrview[]> {
  const url = process.env.CLOCKRVIEW_API_URL || URL_PADRAO;
  const chave = process.env.CLOCKRVIEW_API_KEY;
  if (!chave) {
    throw erro(500, "CONFIG_AUSENTE", "Falta configurar CLOCKRVIEW_API_KEY no servidor.");
  }

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      headers: { "x-api-key": chave, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error("[NPS][clockrview] falha de conexao:", e);
    throw erro(502, "CLOCKRVIEW_INDISPONIVEL", "Não foi possível falar com o Clockrview.");
  }

  if (!resposta.ok) {
    console.error("[NPS][clockrview] resposta", resposta.status);
    throw erro(
      502,
      "CLOCKRVIEW_INDISPONIVEL",
      resposta.status === 401 || resposta.status === 403
        ? "O Clockrview recusou a chave de acesso (CLOCKRVIEW_API_KEY)."
        : `O Clockrview respondeu com erro (${resposta.status}).`
    );
  }

  const corpo = (await resposta.json().catch(() => null)) as
    | { projetos?: unknown }
    | unknown[]
    | null;
  const lista = Array.isArray(corpo) ? corpo : corpo?.projetos;
  if (!Array.isArray(lista)) {
    throw erro(502, "CLOCKRVIEW_FORMATO", "O Clockrview devolveu um formato inesperado.");
  }

  const projetos: ProjetoClockrview[] = [];
  for (const bruto of lista as Record<string, unknown>[]) {
    const codigo = textoOuNulo(bruto?.codigo);
    const nome = textoOuNulo(bruto?.nome);
    // Sem codigo nao ha como casar com o espelho; sem nome nao ha o que
    // mostrar. Linha assim e descartada, nao vira projeto pela metade.
    if (!codigo || !nome || !chaveCodigo(codigo)) continue;
    projetos.push({
      codigo,
      nome,
      status: String(bruto.status || "").toLowerCase(),
      clienteNome: textoOuNulo(bruto.clienteNome),
      liderNome: textoOuNulo(bruto.liderNome),
      liderEmail: textoOuNulo(bruto.liderEmail)?.toLowerCase() ?? null,
      coLiderNome: textoOuNulo(bruto.coLiderNome),
      coLiderEmail: textoOuNulo(bruto.coLiderEmail)?.toLowerCase() ?? null,
    });
  }
  return projetos;
}
