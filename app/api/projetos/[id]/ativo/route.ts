// Ativar/inativar projeto pela tela foi desligado: a situacao do projeto vem
// do Clockrview (status ativo/inativo) e a sincronizacao aplica a mudanca por
// nps_definir_ativo_projeto, que continua auditando e sem apagar nada.

import { erro, rotaApi } from "@/lib/http";
import { exigirPmo } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return rotaApi(async () => {
    await exigirPmo();
    throw erro(
      409,
      "PROJETO_VEM_DO_CLOCKRVIEW",
      "A situacao do projeto vem do Clockrview. Altere la e sincronize."
    );
  });
}
