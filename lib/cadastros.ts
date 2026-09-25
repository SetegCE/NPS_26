// Cadastros auxiliares — clientes e lideres.
//
// As duas telas sao a mesma tela com outro nome de tabela, entao a logica vive
// aqui e /api/clientes e /api/lideres sao so tres linhas cada. Sem isto, as
// regras de auditoria e de permissao existiriam em duas copias, e a segunda
// seria a que esquecem de atualizar.

import { NextResponse } from "next/server";
import {
  booleano,
  erro,
  json,
  lerCorpo,
  ordenacao,
  paginacao,
  texto,
  textoObrigatorio,
  uuid,
} from "@/lib/http";
import { atualizar, auditar, type FiltroValor, inserir, selecionar, termoBusca, um } from "@/lib/db";
import { exigirPmo, exigirSessao } from "@/lib/session";

export type TipoCadastro = "clientes" | "lideres";

interface Config {
  tabela: string;
  entidade: string;
  ordenaveis: readonly string[];
}

const CONFIG: Record<TipoCadastro, Config> = {
  clientes: {
    tabela: "clientes_nps",
    entidade: "cliente",
    ordenaveis: ["nome", "segmento", "created_at"],
  },
  lideres: {
    tabela: "lideres_nps",
    entidade: "lider",
    ordenaveis: ["nome", "email", "created_at"],
  },
};

/** Listagem — qualquer sessao autenticada le, porque os selects de todas as
 *  telas dependem destas listas. */
export async function listarCadastro(
  req: Request,
  tipo: TipoCadastro
): Promise<NextResponse> {
  await exigirSessao();
  const cfg = CONFIG[tipo];
  const query = new URL(req.url).searchParams;

  const { pagina, porPagina, de, ate } = paginacao(query);
  const ordem = ordenacao(query, cfg.ordenaveis, "nome");

  const filtros: Record<string, FiltroValor> = {};
  const ativo = booleano(query.get("ativo"), null);
  if (ativo !== null) filtros.ativo = ativo;

  const busca = termoBusca(query.get("busca"));
  const ou = busca ? `nome.ilike.${busca}` : null;

  const { dados, total } = await selecionar(cfg.tabela, {
    colunas: "*",
    filtros,
    ou,
    ordem,
    de,
    ate,
    contar: true,
  });

  return json({ itens: dados || [], total: total ?? 0, pagina, porPagina });
}

/** Cadastro — escrita e exclusiva do PMO. */
export async function criarCadastro(req: Request, tipo: TipoCadastro): Promise<NextResponse> {
  const sessao = await exigirPmo();
  const cfg = CONFIG[tipo];
  const corpo = await lerCorpo(req);

  const nome = textoObrigatorio(corpo.nome, "nome", 200);

  const registro: Record<string, unknown> = { nome };
  if (tipo === "clientes") registro.segmento = texto(corpo.segmento, "segmento", { max: 160 });
  if (tipo === "lideres") registro.email = texto(corpo.email, "email", { max: 200 });

  let criado: Record<string, unknown>;
  try {
    [criado] = await inserir<Record<string, unknown>[]>(cfg.tabela, registro);
  } catch (e) {
    // O banco tem indice unico no nome normalizado. Traduzir aqui evita que a
    // tela mostre a mensagem crua do Postgres.
    if (e instanceof Error && e.message.includes("Ja existe")) {
      throw erro(409, "NOME_DUPLICADO", `Ja existe um ${cfg.entidade} com este nome.`);
    }
    throw e;
  }

  await auditar({
    acao: "criar",
    entidade: cfg.entidade,
    registroId: criado.id as string,
    descricao: `${cfg.entidade} ${nome} cadastrado`,
    atorTipo: "pmo",
    atorNome: sessao.nome,
    depois: registro,
  });

  return json({ item: criado }, 201);
}

/** Edicao — escrita e exclusiva do PMO. */
export async function editarCadastro(req: Request, tipo: TipoCadastro): Promise<NextResponse> {
  const sessao = await exigirPmo();
  const cfg = CONFIG[tipo];
  const corpo = await lerCorpo(req);
  const id = uuid(corpo.id, "id");

  const antes = await um<Record<string, unknown>>(cfg.tabela, { id });
  if (!antes) throw erro(404, "NAO_ENCONTRADO", `${cfg.entidade} nao encontrado.`);

  const campos: Record<string, unknown> = {};
  if ("nome" in corpo) campos.nome = textoObrigatorio(corpo.nome, "nome", 200);
  if ("ativo" in corpo) campos.ativo = booleano(corpo.ativo, true);
  if (tipo === "clientes" && "segmento" in corpo) {
    campos.segmento = texto(corpo.segmento, "segmento", { max: 160 });
  }
  if (tipo === "lideres" && "email" in corpo) {
    campos.email = texto(corpo.email, "email", { max: 200 });
  }

  if (!Object.keys(campos).length) {
    throw erro(400, "NADA_A_ALTERAR", "Nenhum campo informado.");
  }

  const [depois] = await atualizar<Record<string, unknown>[]>(cfg.tabela, { id }, campos);

  await auditar({
    acao: "editar",
    entidade: cfg.entidade,
    registroId: id,
    descricao: `${cfg.entidade} ${antes.nome} editado`,
    atorTipo: "pmo",
    atorNome: sessao.nome,
    antes: Object.fromEntries(Object.keys(campos).map((k) => [k, antes[k]])),
    depois: campos,
  });

  return json({ item: depois });
}
