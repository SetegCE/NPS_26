import { redirect } from "next/navigation";
import { TelaProjetos } from "@/componentes/telas/TelaProjetos";
import { getSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meus Projetos | NPS Seteg" };

// Mesma tela de /projetos com o recorte do lider. O recorte real e do
// servidor: a API so devolve os projetos sob responsabilidade da sessao.
export default async function Pagina() {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return (
    <TelaProjetos
      somenteMeus
      sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }}
    />
  );
}
