// Painel de gestao dos projetos: listagem com busca/filtro/ordenacao/paginacao
// e edicao dos campos que sao do NPS.
//
// O CADASTRO saiu daqui: codigo, nome, cliente e ativo/inativo vem do
// Clockrview (lib/sincronizarProjetos.ts). Aceitar esses campos por esta rota
// faria o NPS divergir da fonte ate a proxima sincronizacao desfazer a edicao.
// O lider e excecao — editavel, mas pelo fluxo com historico em
// POST /api/projetos/:id/lider.

import {
  booleano,
  erro,
  json,
  lerCorpo,
  ordenacao,
  paginacao,
  rotaApi,
  texto,
  umDe,
  uuid,
  uuidOpcional,
} from "@/lib/http";
import { atualizar, auditar, type FiltroValor, selecionar, termoBusca, um } from "@/lib/db";
import { STATUS_PROJETO } from "@/lib/listas";
import { exigirPmo, exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORDENAVEIS = [
  "nome",
  "codigo_clockify",
  "cliente_nome",
  "lider_nome",
  "categoria",
  "classe_contratual",
  "tipo_servico",
  "segmento_cliente",
  "status",
  "ciclo_atual",
  "total_respostas",
  "updated_at",
] as const;

// ---------- Listagem ----------

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const { pagina, porPagina, de, ate } = paginacao(query);
    const ordem = ordenacao(query, ORDENAVEIS, "nome");
    const vazio = json({ itens: [], total: 0, pagina, porPagina });

    const filtros: Record<string, FiltroValor> = {};

    // O lider so enxerga os projetos sob sua responsabilidade atual.
    if (sessao.perfil === PERFIL_LIDER) {
      if (!sessao.liderId) return vazio;
      filtros.lider_id = sessao.liderId;
    } else {
      const lider = uuidOpcional(query.get("lider"), "lider");
      if (lider) filtros.lider_id = lider;
    }

    const cliente = uuidOpcional(query.get("cliente"), "cliente");
    if (cliente) filtros.cliente_id = cliente;

    const ciclo = uuidOpcional(query.get("ciclo"), "ciclo");
    if (ciclo) filtros.ciclo_atual_id = ciclo;

    const status = umDe(query.get("status"), STATUS_PROJETO, "status");
    if (status) filtros.status = status;

    const ativo = booleano(query.get("ativo"), null);
    if (ativo !== null) filtros.ativo = ativo;

    const elegivel = booleano(query.get("elegivel"), null);
    if (elegivel !== null) filtros.elegivel = elegivel;

    for (const campo of ["categoria", "classe_contratual", "tipo_servico", "segmento_cliente"]) {
      const v = texto(query.get(campo), campo, { max: 120 });
      if (v) filtros[campo] = v;
    }

    const busca = termoBusca(query.get("busca"));
    const ou = busca
      ? `nome.ilike.${busca},codigo_clockify.ilike.${busca},cliente_nome.ilike.${busca}`
      : null;

    const { dados, total } = await selecionar("vw_projetos_admin", {
      colunas: "*",
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

// ---------- Cadastro ----------

export async function POST() {
  return rotaApi(async () => {
    await exigirPmo();
    throw erro(
      410,
      "PROJETO_VEM_DO_CLOCKRVIEW",
      "Projetos sao cadastrados no Clockrview. Use \"Sincronizar com Clockrview\" na tela de Projetos."
    );
  });
}

// ---------- Edicao ----------

export async function PATCH(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    const corpo = await lerCorpo(req);
    const id = uuid(corpo.id, "id");

    const antes = await um<Record<string, unknown>>("projetos_mestre_nps", { id });
    if (!antes) throw erro(404, "PROJETO_NAO_ENCONTRADO", "Projeto nao encontrado.");

    // O lider NAO e alterado por aqui: exige o fluxo com historico, em
    // POST /api/projetos/:id/lider, para que a troca fique registrada.
    // O lider NAO e alterado por aqui: exige o fluxo com historico, em
    // POST /api/projetos/:id/lider, para que a troca fique registrada.
    if ("lider_id" in corpo) {
      throw erro(
        400,
        "USE_ENDPOINT_DE_LIDER",
        "Use POST /api/projetos/:id/lider para trocar o lider."
      );
    }

    const doClockrview = ["codigo_clockify", "nome", "cliente_id", "ativo"].filter(
      (k) => k in corpo
    );
    if (doClockrview.length) {
      throw erro(
        400,
        "CAMPO_DO_CLOCKRVIEW",
        `${doClockrview.join(", ")} vem do Clockrview e nao e editado no NPS.`
      );
    }

    const campos: Record<string, unknown> = {};
    if ("categoria" in corpo) campos.categoria = texto(corpo.categoria, "categoria", { max: 120 });
    if ("classe_contratual" in corpo)
      campos.classe_contratual = texto(corpo.classe_contratual, "classe_contratual", { max: 60 });
    if ("tipo_servico" in corpo)
      campos.tipo_servico = texto(corpo.tipo_servico, "tipo_servico", { max: 160 });
    if ("segmento_cliente" in corpo)
      campos.segmento_cliente = texto(corpo.segmento_cliente, "segmento_cliente", { max: 160 });
    if ("escopo_geral" in corpo)
      campos.escopo_geral = texto(corpo.escopo_geral, "escopo_geral", { max: 2000 });
    if ("vendedor" in corpo) campos.vendedor = texto(corpo.vendedor, "vendedor", { max: 160 });
    if ("acesso" in corpo) campos.acesso = texto(corpo.acesso, "acesso", { max: 60 });
    if ("status" in corpo)
      campos.status = umDe(corpo.status, STATUS_PROJETO, "status", { obrigatorio: true });

    if (!Object.keys(campos).length) {
      throw erro(400, "NADA_A_ALTERAR", "Nenhum campo valido foi informado.");
    }

    const [depois] = await atualizar<Record<string, unknown>[]>(
      "projetos_mestre_nps",
      { id },
      campos
    );

    await auditar({
      acao: "editar",
      entidade: "projeto",
      registroId: id,
      descricao: `Projeto ${antes.codigo_clockify} editado`,
      atorTipo: "pmo",
      atorNome: sessao.nome,
      antes: Object.fromEntries(Object.keys(campos).map((k) => [k, antes[k]])),
      depois: campos,
    });

    return json({ projeto: depois });
  });
}
