import { redirect } from "next/navigation";
import { TelaPesquisas } from "@/componentes/telas/TelaPesquisas";
import { getSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pesquisas | NPS Seteg" };

export default async function Pagina() {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return (
    <TelaPesquisas sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }} />
  );
}
