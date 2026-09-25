import { DashboardClient } from "./DashboardClient";
import { getSessao } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard | NPS Seteg" };

/**
 * O perfil chega ao cliente por props, vindo do banco.
 *
 * Na versao anterior a tela lia `localStorage.getItem('nps_perfil')` para
 * decidir o que mostrar — um valor que qualquer pessoa editava no DevTools
 * para ver a visao de PMO. Escondia-se menos do que parecia. Aqui o valor e o
 * que lib/session.ts acabou de reconferir no banco, e mesmo assim ele so
 * decide o que DESENHAR: cada rota de API confere a permissao de novo.
 */
export default async function PaginaDashboard() {
  const sessao = await getSessao();
  if (!sessao) redirect("/login?sessao=invalida");

  return (
    <DashboardClient
      sessao={{ perfil: sessao.perfil, nome: sessao.nome, email: sessao.email, liderId: sessao.liderId }}
    />
  );
}
