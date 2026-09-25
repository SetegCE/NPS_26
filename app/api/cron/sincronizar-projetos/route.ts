// Sincronizacao diaria com o Clockrview, chamada pelo cron da Vercel
// (vercel.json → "crons").
//
// Nao ha sessao aqui: quem chama e a propria Vercel, que envia
// `Authorization: Bearer <CRON_SECRET>`. Por isso a rota e publica no
// middleware (lib/rotas.ts) e a checagem de verdade e esta, com comparacao
// em tempo constante. Sem CRON_SECRET configurado a rota fica fechada.

import { timingSafeEqual } from "node:crypto";
import { erro, json, rotaApi } from "@/lib/http";
import { sincronizarProjetos } from "@/lib/sincronizarProjetos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function autorizado(req: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  const recebido = Buffer.from(req.headers.get("authorization") || "");
  const esperado = Buffer.from(`Bearer ${segredo}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export async function GET(req: Request) {
  return rotaApi(async () => {
    if (!autorizado(req)) throw erro(401, "NAO_AUTENTICADO", "Nao autorizado.");
    const resumo = await sincronizarProjetos({
      aplicar: true,
      ator: "SINCRONIZACAO CLOCKRVIEW",
      atorTipo: "sistema",
    });
    return json({
      ok: resumo.falhas.length === 0,
      criados: resumo.projetosCriados.length,
      atualizados: resumo.projetosAtualizados.length,
      inativados: resumo.inativados.length,
      ativados: resumo.ativados.length,
      trocasLider: resumo.trocasLider.length,
      falhas: resumo.falhas,
    });
  });
}
