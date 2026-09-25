import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard NPS | Seteg",
  description: "Net Promoter Score — acompanhamento por ciclo, projeto e lider.",
  icons: { icon: "/imagens/logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Layout raiz: so o documento.
 *
 * A barra lateral NAO mora aqui. Ela vive em app/(app)/layout.tsx, o grupo de
 * rotas das telas internas — assim a tela de login e o formulario publico da
 * pesquisa (que o cliente abre sem conta) nao herdam menu nenhum.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
