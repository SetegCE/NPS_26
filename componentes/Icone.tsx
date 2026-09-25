// Icones do sistema.
//
// Continuam sendo SVG inline, desenhados a mao, como eram em app/ui.js. Isso
// e o que permite a CSP nao precisar liberar nenhum CDN (ver next.config.js):
// nao ha folha de icones externa para bloquear, e nada some se a rede estiver
// ruim.

export type NomeIcone =
  | "dashboard"
  | "projetos"
  | "respondentes"
  | "pesquisas"
  | "ciclos"
  | "operacao"
  | "clientes"
  | "lideres"
  | "isc"
  | "historico"
  | "resultados"
  | "ver"
  | "editar"
  | "lider"
  | "inativar"
  | "reativar"
  | "link"
  | "status"
  | "sair"
  | "busca"
  | "alerta"
  | "info"
  | "check"
  | "x"
  | "menu"
  | "seta-baixo"
  | "baixar"
  | "chave"
  | "conta-nova";

const CAMINHOS: Record<NomeIcone, string> = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z"/>',
  projetos: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  respondentes:
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  pesquisas:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>',
  ciclos:
    '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  operacao: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clientes: '<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/>',
  lideres:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3 3-1.5-1.5"/>',
  isc: '<path d="M12 2l2.4 7.4H22l-6 4.5 2.3 7.1-6.3-4.6L5.7 21 8 13.9 2 9.4h7.6z"/>',
  historico: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  resultados: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  ver: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  editar:
    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  lider:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3 3-1.5-1.5"/>',
  inativar: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>',
  reativar: '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  link:
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  status:
    '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  busca: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  alerta:
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  "seta-baixo": '<polyline points="6 9 12 15 18 9"/>',
  baixar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  chave:
    '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l3 3"/>',
  "conta-nova":
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
};

export function Icone({
  nome,
  tamanho = 18,
  className,
}: {
  nome: NomeIcone;
  tamanho?: number;
  className?: string;
}) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      // O conteudo vem de CAMINHOS, uma constante deste arquivo — nunca de
      // dado do banco nem da URL. E a unica forma de manter os `d` dos paths
      // sem transformar cada icone num componente.
      dangerouslySetInnerHTML={{ __html: CAMINHOS[nome] }}
    />
  );
}
