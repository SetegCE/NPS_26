import { json, rotaApi } from "@/lib/http";
import { getSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Quem esta logado agora, segundo o BANCO — nao segundo o token.
 *
 * A interface usa esta rota para se recuperar sozinha quando a credencial
 * caiu no meio da navegacao (acesso desativado, senha trocada). Nunca devolve
 * o token, so o que a tela precisa desenhar.
 */
export async function GET() {
  return rotaApi(async () => {
    const sessao = await getSessao();
    if (!sessao) return json({ autenticado: false });
    return json({
      autenticado: true,
      perfil: sessao.perfil,
      nome: sessao.nome,
      email: sessao.email,
      liderId: sessao.liderId,
    });
  });
}
