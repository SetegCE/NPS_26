import { redirect } from "next/navigation";
import { TelaRespondentes } from "@/componentes/telas/TelaRespondentes";
import { getSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Respondentes | NPS Seteg" };

export default async function Pagina() {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return (
    <TelaRespondentes
      sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }}
    />
  );
}
