import { redirect } from "next/navigation";
import { TelaIsc } from "@/componentes/telas/TelaIsc";
import { getSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "ISC | NPS Seteg" };

export default async function Pagina() {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return <TelaIsc sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }} />;
}
