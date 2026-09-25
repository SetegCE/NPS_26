// Formulario publico da pesquisa.
//
// Unica tela do sistema alcancavel sem conta: quem responde e o cliente. O
// token do link E a credencial, e tudo — projeto, cliente, lider, ciclo,
// identificacao — vem dele. O respondente nao escolhe nada disso.
//
// ── O que mudou em relacao a versao anterior ─────────────────────────────
//
// Era um HTML estatico que abria mostrando "Carregando pesquisa...", pedia o
// contexto a /api/responder e so entao desenhava o formulario. Ou seja: duas
// idas ao servidor antes de a pessoa ver qualquer coisa, e um piscar de tela
// vazia no meio — justamente para o publico com a pior conexao e a menor
// paciencia, que abre o link pelo celular.
//
// Agora o contexto e lido aqui, no servidor, e a pagina chega pronta. A
// unica chamada de rede que sobra e o envio das notas.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { um } from "@/lib/db";
import { FormularioPesquisa, MensagemFinal } from "./FormularioPesquisa";
import "./pesquisa.css";

export const dynamic = "force-dynamic";

const TITULO = "Pesquisa de Satisfação | Seteg";
const DESCRICAO = "Sua opinião nos ajuda a evoluir. Leva menos de 1 minuto.";

/**
 * Prévia do link no WhatsApp/e-mail (Open Graph). O WhatsApp so aceita imagem
 * com URL absoluta, e a base sai dos cabecalhos pelo mesmo motivo de
 * lib/link.ts: preview aponta para preview, producao para producao.
 * A URL da pagina (og:url) fica de fora de proposito — ela carrega o token.
 */
export function generateMetadata(): Metadata {
  const h = headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = h.get("x-forwarded-proto") || (local ? "http" : "https");
  const imagem = `${proto}://${host}/imagens/pesquisa-preview.jpg`;

  return {
    title: TITULO,
    description: DESCRICAO,
    // Link de pesquisa nao deve aparecer em busca: ele e uma credencial.
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: "Seteg",
      title: "Pesquisa de Satisfação",
      description: DESCRICAO,
      locale: "pt_BR",
      images: [{ url: imagem, width: 1200, height: 630, alt: "Seteg — Pesquisa de Satisfação" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Pesquisa de Satisfação",
      description: DESCRICAO,
      images: [imagem],
    },
  };
}

// O token e gerado pelo banco com 32 bytes em base64url. A faixa larga
// acomoda tokens antigos sem abrir a porta para qualquer string.
const RE_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

interface Pesquisa {
  ativo: boolean;
  status: string;
  respondente_nome: string | null;
}

function Pagina({ children }: { children: React.ReactNode }) {
  return (
    <div className="pq-pagina">
      {/* O logo.png e branco (feito para fundo escuro): aqui ele entra como
          mascara pintada de azul-marinho, ver .pq-logo no CSS. */}
      <main className="pq-container">
        <div className="pq-logo" role="img" aria-label="Seteg" />
        <h1>Pesquisa de Satisfação</h1>
        {children}
      </main>
    </div>
  );
}

export default async function PaginaPesquisa({ params }: { params: { token: string } }) {
  const token = String(params.token || "").trim();

  if (!RE_TOKEN.test(token)) {
    return (
      <Pagina>
        <MensagemFinal
          tipo="erro"
          titulo="Não foi possível abrir a pesquisa"
          texto="O link está incompleto ou inválido. Verifique o endereço recebido."
        />
      </Pagina>
    );
  }

  let pesquisa: Pesquisa | null = null;
  try {
    pesquisa = await um<Pesquisa>("vw_pesquisas", { token });
  } catch (e) {
    console.error("[NPS][pesquisa] falha ao carregar o contexto:", e);
    return (
      <Pagina>
        <MensagemFinal
          tipo="erro"
          titulo="Não foi possível abrir a pesquisa"
          texto="Estamos com uma instabilidade momentânea. Tente novamente em alguns instantes."
        />
      </Pagina>
    );
  }

  // Mesma resposta para "nao existe" e "formato ate valido, mas nao e de
  // ninguem": nao ha motivo para informar a diferenca a quem tenta adivinhar.
  if (!pesquisa) {
    return (
      <Pagina>
        <MensagemFinal
          tipo="erro"
          titulo="Não foi possível abrir a pesquisa"
          texto="Link de pesquisa inválido ou expirado."
        />
      </Pagina>
    );
  }

  if (!pesquisa.ativo) {
    return (
      <Pagina>
        <MensagemFinal
          tipo="erro"
          titulo="Pesquisa encerrada"
          texto="Esta pesquisa foi encerrada e não aceita mais respostas."
        />
      </Pagina>
    );
  }

  if (pesquisa.status === "respondida") {
    return (
      <Pagina>
        <MensagemFinal
          tipo="ok"
          titulo="Esta pesquisa já foi respondida"
          texto="Sua avaliação já foi registrada. Obrigado pela participação!"
        />
      </Pagina>
    );
  }

  return (
    <Pagina>
      <FormularioPesquisa
        token={token}
        contexto={{ respondente: pesquisa.respondente_nome || "" }}
      />
    </Pagina>
  );
}
