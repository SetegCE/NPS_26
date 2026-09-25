"use client";

// Casca das telas internas: barra lateral, barra do mobile e area da rota.

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Icone } from "@/componentes/Icone";
import { Sidebar } from "@/componentes/Sidebar";
import { ProvedorToast } from "@/componentes/Toast";
import type { Sessao } from "@/lib/cliente/tipos";

export function Shell({ sessao, children }: { sessao: Sessao; children: React.ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const rota = usePathname();

  // O respiro das telas mora AQUI, e nao dentro de cada tela, por dois
  // motivos: as telas tambem devolvem 'Carregando...' e mensagens de erro
  // antes de montar o conteudo, e essas voltas antecipadas ficavam grudadas
  // na barra lateral; e uma tela nova nasce espacada sem precisar lembrar.
  //
  // O dashboard e a excecao: ele traz o proprio .dashboard-container, com o
  // mesmo respiro. Paginar duas vezes so afastaria tudo do resto do sistema.
  const temContainerProprio = rota === "/dashboard";

  return (
    <ProvedorToast>
      <div className="app-shell">
        <div
          className={`sidebar-overlay ${menuAberto ? "ativo" : ""}`}
          onClick={() => setMenuAberto(false)}
        />

        <Sidebar sessao={sessao} aberta={menuAberto} aoNavegar={() => setMenuAberto(false)} />

        <div className="app-main">
          {/* Fica fora da tela da rota porque precisa existir em todas elas,
              nao so no dashboard. */}
          <div className="barra-mobile">
            <button
              type="button"
              className="sidebar-toggle"
              aria-label="Abrir menu"
              aria-controls="sidebar"
              aria-expanded={menuAberto}
              onClick={() => setMenuAberto((a) => !a)}
            >
              <Icone nome="menu" tamanho={20} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/imagens/logo.png" alt="Seteg" />
            <span>NPS</span>
          </div>

          {temContainerProprio ? children : <div className="view-container">{children}</div>}
        </div>
      </div>
    </ProvedorToast>
  );
}
