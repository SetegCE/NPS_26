// Formatacao compartilhada entre servidor e telas.
//
// Nao ha mais a funcao `esc()` da versao anterior: escapar HTML a mao so era
// necessario porque as telas montavam `innerHTML` com strings. O React escapa
// todo conteudo interpolado por construcao, e foi justamente essa classe
// inteira de XSS que o porte eliminou.

export function formatarData(iso: string | null | undefined, comHora = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const data = d.toLocaleDateString("pt-BR");
  if (!comHora) return data;
  return `${data} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** AAAA-MM-DD -> MM/AAAA */
export function formatarCompetencia(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [ano, mes] = String(iso).split("-");
  return `${mes}/${ano}`;
}

export function formatarNumero(valor: number | string | null | undefined, casas = 0): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// ── Classificacao NPS ──────────────────────────────────────────────────────
// Mesmas faixas do modal de Metodologia e do resto do sistema. Um unico lugar
// para nao haver duas verdades sobre o que e "Excelencia".

export type CategoriaNps = "PROMOTOR" | "NEUTRO" | "DETRATOR" | null;

export function categoriaDaNota(q4: number | null | undefined): CategoriaNps {
  if (q4 === null || q4 === undefined) return null;
  const n = Number(q4);
  if (!Number.isFinite(n)) return null;
  if (n >= 9) return "PROMOTOR";
  if (n >= 7) return "NEUTRO";
  return "DETRATOR";
}

export function classeDaCategoria(categoria: CategoriaNps): string {
  if (categoria === "PROMOTOR") return "promotor";
  if (categoria === "NEUTRO") return "neutro";
  if (categoria === "DETRATOR") return "detrator";
  return "";
}

export function classificacaoNps(nps: number | null): string {
  if (nps === null || !Number.isFinite(nps)) return "Aguardando";
  if (nps >= 75) return "Excelencia";
  if (nps >= 50) return "Qualidade";
  if (nps >= 1) return "Aperfeicoamento";
  return "Zona Critica";
}

export function corDoNps(nps: number | null): string {
  if (nps === null || !Number.isFinite(nps)) return "var(--text-muted)";
  if (nps >= 75) return "var(--green-text)";
  if (nps >= 50) return "var(--blue-text)";
  if (nps >= 1) return "var(--yellow-text)";
  return "var(--red-text)";
}

/** Cor do termometro por nota media de 0 a 10 (Q1..Q4). */
export function corDoTermometro(media: number | null): string {
  if (media === null || !Number.isFinite(media)) return "var(--text-muted)";
  if (media >= 9) return "var(--success)";
  if (media >= 7) return "var(--warning)";
  return "var(--danger)";
}

/**
 * Rotulo do canal de resposta.
 *
 * Os valores legados ("EMAIL", "WHATSAPP") convivem com os atuais
 * ("EMAIL (PMO)", "VIA LIDER") porque as respostas antigas nao foram
 * reescritas — reescrever historico para arrumar rotulo e pior que traduzir
 * na exibicao.
 */
export function rotuloDoCanal(canal: string | null | undefined): string {
  const c = String(canal || "").toUpperCase();
  if (c.includes("LIDER") || c.includes("LÍDER") || c.includes("WHATS")) return "WhatsApp";
  if (c.includes("EMAIL") || c.includes("MAIL")) return "Email";
  return canal || "—";
}
