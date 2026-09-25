// Contas de acesso. A logica esta em lib/acessos.ts — ver o comentario de la
// para a diferenca entre desativar a CONTA e inativar o CADASTRO do lider.

import { rotaApi } from "@/lib/http";
import { criarConta, editarConta, listarContas } from "@/lib/acessos";

export const dynamic = "force-dynamic";
// nodejs, e nao edge: derivar a senha usa `node:crypto` (lib/senha.ts).
export const runtime = "nodejs";

export async function GET(req: Request) {
  return rotaApi(() => listarContas(req));
}

export async function POST(req: Request) {
  return rotaApi(() => criarConta(req));
}

export async function PATCH(req: Request) {
  return rotaApi(() => editarConta(req));
}
