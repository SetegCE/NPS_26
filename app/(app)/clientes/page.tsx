import { redirect } from "next/navigation";
import { TelaCadastro } from "@/componentes/telas/TelaCadastro";
import { getSessao } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes | NPS Seteg" };

export default async function Pagina() {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return (
    <TelaCadastro
      recurso="clientes"
      sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }}
    />
  );
}
