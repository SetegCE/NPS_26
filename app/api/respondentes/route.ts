// Cadastro de respondentes. O vinculo N:N com projetos vive em
// /api/respondentes/[id]/projetos.

import {
  booleano,
  erro,
  json,
  lerCorpo,
  ordenacao,
  paginacao,
  rotaApi,
  texto,
  textoObrigatorio,
  uuid,
  uuidOpcional,
} from "@/lib/http";
import {
  atualizar,
  auditar,
  type FiltroValor,
  inserir,
  normalizar,
  selecionar,
  termoBusca,
  um,
} from "@/lib/db";
import { exigirPmo, exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORDENAVEIS = ["nome", "email", "created_at", "updated_at"] as const;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validarEmail(valor: unknown): string | null {
  const email = texto(valor, "email", { max: 200 });
  if (email && !RE_EMAIL.test(email)) {
    throw erro(400, "EMAIL_INVALIDO", "Informe um e-mail valido.");
  }
  return email ? email.toLowerCase() : null;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const { pagina, porPagina, de, ate } = paginacao(query);
    const ordem = ordenacao(query, ORDENAVEIS, "nome");
    const vazio = json({ itens: [], total: 0, pagina, porPagina });

    const filtros: Record<string, FiltroValor> = {};
    const cliente = uuidOpcional(query.get("cliente"), "cliente");
    if (cliente) filtros.cliente_id = cliente;
    const ativo = booleano(query.get("ativo"), null);
    if (ativo !== null) filtros.ativo = ativo;

    // Filtro por projeto: devolve so os vinculados aquele projeto.
    const projeto = uuidOpcional(query.get("projeto"), "projeto");
    if (projeto) {
      const { dados: vinculos } = await selecionar<{ respondente_id: string }[]>(
        "projeto_respondentes_nps",
        { colunas: "respondente_id", filtros: { projeto_id: projeto, ativo: true } }
      );
      const ids = (vinculos || []).map((v) => v.respondente_id);
      if (!ids.length) return vazio;
      filtros.id = ids;
    }

    // O lider so consulta respondentes dos seus projetos.
    if (sessao.perfil === PERFIL_LIDER) {
      if (!sessao.liderId) return vazio;
      const { dados: meus } = await selecionar<{ id: string }[]>("projetos_mestre_nps", {
        colunas: "id",
        filtros: { lider_id: sessao.liderId },
      });
      const meusIds = (meus || []).map((p) => p.id);
      if (!meusIds.length) return vazio;

      const { dados: vinculos } = await selecionar<{ respondente_id: string }[]>(
        "projeto_respondentes_nps",
        { colunas: "respondente_id", filtros: { projeto_id: meusIds, ativo: true } }
      );
      const permitidos = new Set((vinculos || []).map((v) => v.respondente_id));
      const jaFiltrados = filtros.id as string[] | undefined;
      const atuais = jaFiltrados
        ? jaFiltrados.filter((i) => permitidos.has(i))
        : [...permitidos];
      if (!atuais.length) return vazio;
      filtros.id = atuais;
    }

    const busca = termoBusca(query.get("busca"));
    const ou = busca
      ? `nome.ilike.${busca},email.ilike.${busca},telefone.ilike.${busca}`
      : null;

    const { dados, total } = await selecionar("respondentes_nps", {
      colunas: "*,clientes_nps(id,nome)",
      filtros,
      ou,
      ordem,
      de,
      ate,
      contar: true,
    });

    return json({ itens: dados || [], total: total ?? 0, pagina, porPagina });
  });
}

export async function POST(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);

    const nome = textoObrigatorio(corpo.nome, "nome", 200);
    const email = validarEmail(corpo.email);
    const clienteId = uuidOpcional(corpo.cliente_id, "cliente_id");

    // Reaproveita o respondente existente em vez de duplicar: a mesma pessoa
    // costuma avaliar varios projetos, e duas fichas para ela quebrariam a
    // contagem de "respondentes distintos".
    let existente: Record<string, unknown> | null = null;
    if (email) existente = await um("respondentes_nps", { email_norm: email });
    if (!existente) {
      const { dados } = await selecionar<Record<string, unknown>[]>("respondentes_nps", {
        colunas: "*",
        filtros: {
          nome_norm: normalizar(nome),
          ...(clienteId ? { cliente_id: clienteId } : {}),
        },
        limite: 1,
      });
      existente = dados && dados.length ? dados[0] : null;
    }

    if (existente) {
      return json({
        reaproveitado: true,
        respondente: existente,
        mensagem:
          "Ja existe um respondente com estes dados. O cadastro existente foi reaproveitado.",
      });
    }

    const [criado] = await inserir<Record<string, unknown>[]>("respondentes_nps", {
      nome,
      email,
      telefone: texto(corpo.telefone, "telefone", { max: 40 }),
      cliente_id: clienteId,
    });

    await auditar({
      acao: "criar",
      entidade: "respondente",
      registroId: criado.id as string,
      descricao: `Respondente ${nome} cadastrado`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
      depois: { nome, email },
    });

    return json({ reaproveitado: false, respondente: criado }, 201);
  });
}

export async function PATCH(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);
    const id = uuid(corpo.id, "id");

    const antes = await um<Record<string, unknown>>("respondentes_nps", { id });
    if (!antes) throw erro(404, "RESPONDENTE_NAO_ENCONTRADO", "Respondente nao encontrado.");

    const campos: Record<string, unknown> = {};
    if ("nome" in corpo) campos.nome = textoObrigatorio(corpo.nome, "nome", 200);
    if ("email" in corpo) campos.email = validarEmail(corpo.email);
    if ("telefone" in corpo) campos.telefone = texto(corpo.telefone, "telefone", { max: 40 });
    if ("cliente_id" in corpo) campos.cliente_id = uuidOpcional(corpo.cliente_id, "cliente_id");
    if ("ativo" in corpo) campos.ativo = booleano(corpo.ativo, true);

    if (!Object.keys(campos).length) {
      throw erro(400, "NADA_A_ALTERAR", "Nenhum campo informado.");
    }

    const [depois] = await atualizar<Record<string, unknown>[]>(
      "respondentes_nps",
      { id },
      campos
    );

    await auditar({
      acao: "editar",
      entidade: "respondente",
      registroId: id,
      descricao: `Respondente ${antes.nome} editado`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
      antes: Object.fromEntries(Object.keys(campos).map((k) => [k, antes[k]])),
      depois: campos,
    });

    return json({ respondente: depois });
  });
}
