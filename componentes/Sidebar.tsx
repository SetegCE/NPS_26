"use client";

// Barra lateral.
//
// O menu e montado a partir do perfil, mas isso e apenas conveniencia: o
// middleware barra a rota e cada rota de API revalida a permissao por conta
// propria. Esconder um item nunca foi, e nao e, o que protege a tela.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BotaoSair } from "@/componentes/BotaoSair";
import { Icone, type NomeIcone } from "@/componentes/Icone";
import type { Sessao } from "@/lib/cliente/tipos";

interface ItemMenu {
  rota: string;
  rotulo: string;
  icone: NomeIcone;
}
type Entrada = { secao: string } | ItemMenu;

const MENU_PMO: Entrada[] = [
  { secao: "Acompanhamento" },
  { rota: "/dashboard", rotulo: "Dashboard", icone: "dashboard" },
  { rota: "/operacao-ciclo", rotulo: "Operacao do Ciclo", icone: "operacao" },
  { rota: "/isc", rotulo: "ISC", icone: "isc" },
  { secao: "Cadastros" },
  { rota: "/projetos", rotulo: "Projetos", icone: "projetos" },
  { rota: "/respondentes", rotulo: "Respondentes", icone: "respondentes" },
  { rota: "/pesquisas", rotulo: "Pesquisas", icone: "pesquisas" },
  { rota: "/ciclos", rotulo: "Ciclos", icone: "ciclos" },
  { rota: "/clientes", rotulo: "Clientes", icone: "clientes" },
  { rota: "/lideres", rotulo: "Lideres", icone: "lideres" },
  { secao: "Registro" },
  { rota: "/historico", rotulo: "Historico / Auditoria", icone: "historico" },
];

// O lider nao ve nenhum item administrativo.
const MENU_LIDER: Entrada[] = [
  { secao: "Meu painel" },
  { rota: "/dashboard", rotulo: "Dashboard", icone: "dashboard" },
  { rota: "/meus-projetos", rotulo: "Meus Projetos", icone: "projetos" },
  { rota: "/pesquisas", rotulo: "Pesquisas", icone: "pesquisas" },
  { rota: "/isc", rotulo: "ISC", icone: "isc" },
  { rota: "/resultados", rotulo: "Resultados", icone: "resultados" },
];

export function menuDoPerfil(perfil: string): Entrada[] {
  return perfil === "pmo" ? MENU_PMO : MENU_LIDER;
}

export function Sidebar({
  sessao,
  aberta,
  aoNavegar,
}: {
  sessao: Sessao;
  aberta: boolean;
  aoNavegar: () => void;
}) {
  const pathname = usePathname();
  const inicial = (sessao.nome || "?").trim().charAt(0).toUpperCase();

  return (
      <aside
        className={`sidebar ${aberta ? "aberta" : ""}`}
        id="sidebar"
        aria-label="Navegacao principal"
      >
        <div className="sidebar-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/imagens/logo.png" alt="Seteg" className="sidebar-logo" />
        </div>

        <nav className="sidebar-nav">
          {menuDoPerfil(sessao.perfil).map((item, i) =>
            "secao" in item ? (
              <div key={`s-${i}`} className="sidebar-secao">
                {item.secao}
              </div>
            ) : (
              <Link
                key={item.rota}
                href={item.rota}
                className={`sidebar-link ${pathname === item.rota || pathname.startsWith(`${item.rota}/`) ? "ativo" : ""}`}
                aria-current={pathname === item.rota ? "page" : undefined}
                onClick={aoNavegar}
              >
                <Icone nome={item.icone} tamanho={17} />
                <span>{item.rotulo}</span>
              </Link>
            )
          )}
        </nav>

        <div className="sidebar-rodape">
          <div className="sidebar-usuario">
            <div className="sidebar-avatar">{inicial}</div>
            <div className="sidebar-usuario-dados">
              <strong>{sessao.nome || "—"}</strong>
              <span>{sessao.perfil === "pmo" ? "PMO" : "Lider"}</span>
            </div>
            <BotaoSair className="sidebar-sair" titulo="Sair do sistema" aoAbrir={aoNavegar}>
              <Icone nome="sair" tamanho={17} />
            </BotaoSair>
          </div>
        </div>
    </aside>
  );
}
