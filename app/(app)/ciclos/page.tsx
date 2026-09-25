import { TelaCiclos } from "@/componentes/telas/TelaCiclos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ciclos | NPS Seteg" };

// Tela exclusiva do PMO — barrada pelo middleware e por cada rota de API que
// ela usa. Nao precisa do perfil em props porque nao ha variacao por perfil.
export default function Pagina() {
  return <TelaCiclos />;
}
