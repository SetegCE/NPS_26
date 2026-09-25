// Cadastro de lideres. A logica esta em lib/cadastros.ts, compartilhada com
// a outra tela de cadastro — ver o comentario de la.

import { rotaApi } from "@/lib/http";
import { criarCadastro, editarCadastro, listarCadastro } from "@/lib/cadastros";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return rotaApi(() => listarCadastro(req, "lideres"));
}

export async function POST(req: Request) {
  return rotaApi(() => criarCadastro(req, "lideres"));
}

export async function PATCH(req: Request) {
  return rotaApi(() => editarCadastro(req, "lideres"));
}
