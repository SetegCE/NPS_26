import { redirect } from "next/navigation";
import { TelaProjetoDetalhe } from "@/componentes/telas/TelaProjetoDetalhe";
import { getSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projeto | NPS Seteg" };

export default async function Pagina({ params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return (
    <TelaProjetoDetalhe
      id={params.id}
      sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }}
    />
  );
}
