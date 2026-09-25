import { redirect } from "next/navigation";
import { TelaOperacao } from "@/componentes/telas/TelaOperacao";
import { getSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operação do Ciclo | NPS Seteg" };

export default async function Pagina() {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return (
    <TelaOperacao sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }} />
  );
}
