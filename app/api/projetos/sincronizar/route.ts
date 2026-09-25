// Sincronizacao manual com o Clockrview, disparada pelo PMO na tela de
// Projetos. GET simula (mostra o que mudaria, nao grava); POST aplica.
//
// A mesma sincronizacao roda sozinha uma vez por dia pelo cron da Vercel
// (app/api/cron/sincronizar-projetos). Este botao existe para quando o PMO
// acabou de cadastrar algo no Clockrview e nao quer esperar.

import { json, rotaApi } from "@/lib/http";
import { exigirPmo } from "@/lib/session";
import { sincronizarProjetos } from "@/lib/sincronizarProjetos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A primeira sincronizacao mexe em dezenas de projetos, cada um com sua
// chamada ao banco. O limite padrao da funcao e curto demais para ela.
export const maxDuration = 60;

export async function GET() {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    return json(await sincronizarProjetos({ aplicar: false, ator: sessao.nome, atorTipo: "pmo" }));
  });
}

export async function POST() {
  return rotaApi(async () => {
    const sessao = await exigirPmo();
    return json(await sincronizarProjetos({ aplicar: true, ator: sessao.nome, atorTipo: "pmo" }));
  });
}
