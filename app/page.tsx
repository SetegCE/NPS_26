import { redirect } from "next/navigation";

// A raiz nao tem tela propria: quem chega logado vai para o dashboard, quem
// chega deslogado e desviado para /login pelo middleware antes disto rodar.
export default function Raiz() {
  redirect("/dashboard");
}
