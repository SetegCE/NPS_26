import { redirect } from "next/navigation";
import { Shell } from "@/componentes/Shell";
import { getSessao } from "@/lib/session";

// Toda tela interna e dinamica: depende do cookie de sessao e de dados que
// mudam a cada resposta de pesquisa. Nada aqui pode ser pre-renderizado.
export const dynamic = "force-dynamic";

/**
 * Layout das telas internas.
 *
 * A checagem aqui e a AUTORITATIVA: o middleware ja barrou quem nao tem
 * cookie assinado, mas so este layout consulta o banco e descobre que o
 * acesso foi desativado ou que a senha mudou (lib/session.ts).
 *
 * O `?sessao=invalida` quebra um laco real: o middleware, que nao le o banco,
 * veria o mesmo cookie como valido ao receber /login e mandaria a pessoa de
 * volta para ca — ping-pong infinito. Com o parametro, ele deixa a tela de
 * login renderizar, e ela mesma limpa o cookie.
 */
export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return (
    <Shell sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }}>
      {children}
    </Shell>
  );
}
