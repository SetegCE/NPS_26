// Calendario do ISC: todos os projetos ativos x os 12 meses de um ano, numa
// consulta so. E a visao que o lider usa para ir preenchendo mes a mes e que o
// PMO usa como tabela global. O lider so recebe os proprios projetos.

import { erro, json, rotaApi, uuidOpcional } from "@/lib/http";
import { type FiltroValor, selecionar } from "@/lib/db";
import { exigirSessao, PERFIL_LIDER } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Projeto {
  id: string;
  nome: string;
  codigo_clockify: string;
  cliente_nome: string | null;
  lider_id: string | null;
  lider_nome: string | null;
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    const sessao = await exigirSessao();
    const query = new URL(req.url).searchParams;

    const anoAtual = new Date().getUTCFullYear();
    const ano = Number(query.get("ano") || anoAtual);
    if (!Number.isInteger(ano) || ano < 2000 || ano > anoAtual) {
      throw erro(400, "ANO_INVALIDO", "Informe um ano válido.");
    }
    const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}-01`);
    const vazio = json({ ano, meses, projetos: [], registros: [] });

    const filtros: Record<string, FiltroValor> = { ativo: true };
    if (sessao.perfil === PERFIL_LIDER) {
      if (!sessao.liderId) return vazio;
      filtros.lider_id = sessao.liderId;
    } else {
      const lider = uuidOpcional(query.get("lider"), "lider");
      if (lider) filtros.lider_id = lider;
      const cliente = uuidOpcional(query.get("cliente"), "cliente");
      if (cliente) filtros.cliente_id = cliente;
    }

    const { dados: projetos } = await selecionar<Projeto[]>("vw_projetos_admin", {
      colunas: "id,nome,codigo_clockify,cliente_nome,lider_id,lider_nome",
      filtros,
      ordem: { campo: "nome", ascending: true },
    });
    const ids = (projetos || []).map((p) => p.id);
    if (!ids.length) return vazio;

    const { dados: registros } = await selecionar("isc_nps", {
      colunas: "id,projeto_id,competencia,nota,observacao,lider_nome,registrado_por,created_at",
      filtros: { projeto_id: ids, competencia: meses },
    });

    return json({ ano, meses, projetos: projetos || [], registros: registros || [] });
  });
}
