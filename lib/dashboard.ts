// Motor de dados do dashboard NPS.
//
// ── O que mudou de lugar, e por que ──────────────────────────────────────
//
// Todo este processamento rodava no navegador (dashboard.js). O navegador
// baixava as respostas cruas e os projetos, casava um com o outro, resolvia
// canal, cliente, lider e projeto e so entao desenhava. Tres problemas:
//
//  1. O mapeamento legado com ~55 nomes de contato de cliente ia junto no
//     bundle, legivel por qualquer um que abrisse o codigo-fonte da pagina.
//  2. O casamento era refeito do zero a cada carga e a cada chegada dos
//     ciclos antigos, num laco sobre todas as respostas.
//  3. A regra de negocio (o que e "respondido", qual e o canal, qual e o
//     lider atual) vivia so no cliente, onde ninguem podia testa-la.
//
// Agora o processamento acontece aqui, no servidor, e o navegador recebe as
// linhas ja resolvidas. O que continua no cliente e apenas o que precisa
// responder ao clique — filtrar e somar — porque isso tem que ser instantaneo.
//
// Este modulo e puro: nao toca banco, nao le cookie. As rotas buscam os dados
// e chamam as funcoes daqui. E isso que permite testa-lo em tests/.

// ── Normalizacao ──────────────────────────────────────────────────────────

/** Normalizacao canonica — usada em TODAS as comparacoes de chave.
 *  Espelha public.nps_norm() no banco. */
export function normalizar(valor: unknown): string {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Igual a `normalizar`, mas descarta pontuacao. Usada para contar
 *  respondentes distintos quando a resposta nao tem `respondente_id`: assim
 *  "JOSE D'AVILA" e "JOSE DAVILA" contam como uma pessoa so, e nao duas. */
function normalizarNome(nome: unknown): string {
  if (!nome) return "";
  return String(nome)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim();
}

// ── Tipos ────────────────────────────────────────────────────────────────

export interface ProjetoBruto {
  ciclo: string | null;
  codigo_clockify: string | null;
  cliente: string | null;
  projeto: string | null;
  lider: string | null;
  classe_contratual?: string | null;
  tipo_servico?: string | null;
  segmento_cliente?: string | null;
  [chave: string]: unknown;
}

export interface Projeto extends ProjetoBruto {
  /** Lider do ciclo mais recente daquele codigo_clockify. */
  lider_atual: string;
}

export interface RespostaBruta {
  id?: string | number | null;
  identificador?: string | null;
  ciclo?: string | null;
  codigo_clockify?: string | null;
  cliente?: string | null;
  lider?: string | null;
  projeto?: string | null;
  nota_q1?: unknown;
  nota_q2?: unknown;
  nota_q3?: unknown;
  nota_q4?: unknown;
  feedback?: string | null;
  timestamp?: string | null;
  canal_resposta?: string | null;
  respondente_id?: string | null;
  [chave: string]: unknown;
}

export type Categoria = "PROMOTOR" | "NEUTRO" | "DETRATOR" | null;

export interface Resposta {
  id: string;
  identificador: string;
  cliente: string;
  lider: string;
  lider_atual: string;
  projeto: string;
  ciclo: string;
  codigo_clockify: string;
  classe_contratual: string;
  tipo_servico: string;
  segmento_cliente: string;
  nota_q1: number | null;
  nota_q2: number | null;
  nota_q3: number | null;
  nota_q4: number | null;
  media: number;
  categoria: Categoria;
  respostaValida: boolean;
  canal: string;
  feedback: string | null;
  timestamp: string | null;
  respondente_id: string | null;
  semProjeto: boolean;
  /** Chave de contagem herdada do projeto vinculado — NUNCA da resposta crua.
   *  E ela que decide o que conta como "projeto respondido". */
  projetoContagemKey: string | null;
}

// ── Chaves e categorias ──────────────────────────────────────────────────

/**
 * Chave unica de projeto: ciclo + codigo_clockify.
 *
 * 1 codigo_clockify = 1 projeto naquele ciclo, independente de quantas
 * respostas ou de quantos lideres passaram por ele. Serve tanto para
 * projetos_nps quanto para respostas_nps, que tem os dois campos.
 */
export function chaveDoProjeto(item: {
  ciclo?: string | null;
  codigo_clockify?: string | null;
}): string {
  return `${normalizar(item.ciclo)}||${normalizar(item.codigo_clockify)}`;
}

export const chaveValida = (k: string) => Boolean(k) && k !== "||";

function paraNota(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function categoriaDaNota(q4: unknown): Categoria {
  const nota = paraNota(q4);
  if (nota === null || nota < 0 || nota > 10) return null;
  if (nota >= 9) return "PROMOTOR";
  if (nota >= 7) return "NEUTRO";
  return "DETRATOR";
}

/**
 * Lider atual de cada projeto = lider do ciclo mais recente daquele
 * codigo_clockify.
 *
 * A identidade de um projeto ao longo dos ciclos e EXCLUSIVAMENTE o
 * codigo_clockify: o nome muda, o cliente pode ser grafado diferente, mas o
 * codigo nao. Sem isto, trocar o lider em 2026.1 faria o painel continuar
 * atribuindo os projetos de 2025.2 ao lider antigo.
 */
export function comLiderAtual(projetos: ProjetoBruto[]): Projeto[] {
  if (!projetos.length) return [];

  const porCodigo = new Map<string, ProjetoBruto[]>();
  for (const p of projetos) {
    const ck = normalizar(p.codigo_clockify);
    if (!ck || ck === "NULL" || ck === "UNDEFINED") continue;
    const lista = porCodigo.get(ck);
    if (lista) lista.push(p);
    else porCodigo.set(ck, [p]);
  }

  const liderAtualPorCodigo = new Map<string, string>();
  porCodigo.forEach((ps, ck) => {
    const maisRecente = [...ps].sort((a, b) =>
      normalizar(b.ciclo).localeCompare(normalizar(a.ciclo))
    )[0];
    liderAtualPorCodigo.set(ck, maisRecente.lider || "N/A");
  });

  return projetos.map((p) => {
    const ck = normalizar(p.codigo_clockify);
    const temCodigo = ck && ck !== "NULL" && ck !== "UNDEFINED";
    return {
      ...p,
      lider_atual: temCodigo
        ? liderAtualPorCodigo.get(ck) || p.lider || "N/A"
        : p.lider || "N/A",
    };
  });
}

/**
 * Canal pelo qual a resposta chegou. Vem do banco, e so do banco.
 *
 * ── O que existia aqui ───────────────────────────────────────────────────
 *
 * Uma regra fixa: "no ciclo 2026.1, ate 11/05/2026 o envio foi por e-mail do
 * PMO; dali em diante, pelos lideres". Ela DESCARTAVA o `canal_resposta`
 * gravado e recalculava tudo por data — 36 valores reais do banco eram
 * ignorados a cada carga.
 *
 * Conferido antes de remover: a regra concordava com o banco em 100% das
 * linhas (EMAIL <-> e-mail do PMO, WHATSAPP <-> via lider). As 4 respostas
 * daquele ciclo que estavam sem canal foram preenchidas pela migration 16,
 * usando a mesma regra. Nada mudou de valor; mudou de lugar.
 *
 * Importa porque um ciclo novo com outra logistica de envio nao tem como
 * entrar numa regra escrita em codigo — mas entra numa coluna.
 */
export function canalDaResposta(resposta: {
  ciclo?: string | null;
  timestamp?: string | null;
  canal_resposta?: string | null;
}): string {
  return resposta.canal_resposta || "NÃO INFORMADO";
}

/**
 * Classificacao do canal para o painel de origem.
 *
 * Por conteudo, e nao por igualdade a uma lista: o banco ja tem "EMAIL",
 * "WHATSAPP", "LINK" e as formas antigas "EMAIL (PMO)" e "VIA LÍDER". Uma
 * lista fechada faria todo valor novo virar zero silenciosamente — foi o que
 * aconteceu com "LINK", que nao era contado por nenhum dos dois tubos.
 */
export function classificarCanal(canal: string | null | undefined): "email" | "whatsapp" | "outro" {
  const c = normalizar(canal);
  if (!c) return "outro";
  if (c.includes("MAIL")) return "email";
  if (c.includes("WHATS") || c.includes("LIDER")) return "whatsapp";
  return "outro";
}

/** Rotulo curto do canal, usado em tabela e exportacao. */
export function rotuloDoCanal(canal: string | null | undefined): string {
  const tipo = classificarCanal(canal);
  if (tipo === "email") return "EMAIL";
  if (tipo === "whatsapp") return "WHATSAPP";
  return canal || "-";
}

// ── Processamento ────────────────────────────────────────────────────────

/**
 * Liga cada resposta ao seu projeto e resolve os campos oficiais.
 *
 * Os campos de exibicao (cliente, projeto, lider, classe, tipo, segmento) vem
 * SEMPRE de projetos_nps quando ha vinculo — nunca do que foi digitado na
 * resposta. A resposta so e a fonte para as notas, o feedback e a data.
 */
export function processarRespostas(
  brutas: RespostaBruta[],
  projetos: Projeto[]
): Resposta[] {
  const indice = new Map<string, Projeto>();
  for (const p of projetos) {
    const chave = chaveDoProjeto(p);
    if (chaveValida(chave) && !indice.has(chave)) indice.set(chave, p);
  }

  return brutas.map((row) => {
    // O ciclo vem do banco. Havia aqui uma inferencia por data ("antes de
    // 2026 e 2025.2, senao 2026.1") que chutava codigos de ciclo fixos no
    // codigo — e que nunca dispara, porque toda resposta gravada tem ciclo.
    // Sem ciclo, a resposta fica com string vazia e nao casa com projeto
    // nenhum: aparece como orfa em vez de ser atribuida a um ciclo adivinhado.
    const ciclo = row.ciclo || "";

    const canal = canalDaResposta({ canal_resposta: row.canal_resposta });

    const chave = chaveDoProjeto({ ciclo, codigo_clockify: row.codigo_clockify });
    const pm = row.codigo_clockify && chaveValida(chave) ? indice.get(chave) || null : null;

    // Resposta sem vinculo com projeto cai no que a propria linha de
    // respostas_nps trouxer. Tambem e banco — nao ha mais nenhuma tabela de
    // projeto, cliente ou lider embutida no codigo.
    //
    // Havia: lib/mapeamentoLegado.ts, com ~55 linhas de nome de contato ->
    // cliente/lider/projeto, para as respostas de 2025.2 colhidas antes de
    // projetos_mestre_nps existir. Depois da importacao da planilha, as 78
    // respostas passaram a casar por codigo_clockify e o arquivo ficou sem
    // uso. Manter dado cadastral em codigo significa que corrigir um nome
    // exige deploy — e o cadastro e do PMO, na tela.
    const clienteFallback = row.cliente || null;
    const liderFallback = row.lider || null;
    const projetoFallback = row.projeto || null;

    const q1 = paraNota(row.nota_q1);
    const q2 = paraNota(row.nota_q2);
    const q3 = paraNota(row.nota_q3);
    const q4 = paraNota(row.nota_q4);
    const validas = [q1, q2, q3, q4].filter((n): n is number => n !== null);
    const media = validas.length ? validas.reduce((a, b) => a + b, 0) / validas.length : 0;

    const liderOficial = pm ? pm.lider || "N/A" : liderFallback || "N/A";

    return {
      id: String(row.id ?? row.identificador ?? ""),
      identificador: row.identificador || "—",
      // Campos oficiais de projetos_nps (sobrescrevem o que veio na resposta)
      cliente: pm ? pm.cliente || "OUTROS" : clienteFallback || "OUTROS",
      lider: liderOficial,
      lider_atual: pm ? pm.lider_atual || liderOficial : liderOficial,
      projeto: pm ? pm.projeto || "N/A" : projetoFallback || "N/A",
      ciclo: pm ? pm.ciclo || ciclo : ciclo,
      codigo_clockify: pm
        ? pm.codigo_clockify || row.codigo_clockify || ""
        : row.codigo_clockify || "",
      classe_contratual: pm ? pm.classe_contratual || "" : "",
      tipo_servico: pm ? pm.tipo_servico || "" : "",
      segmento_cliente: pm ? pm.segmento_cliente || "" : "",
      // Campos exclusivos da resposta
      nota_q1: q1,
      nota_q2: q2,
      nota_q3: q3,
      nota_q4: q4,
      media: Number(media.toFixed(1)),
      categoria: categoriaDaNota(row.nota_q4),
      // Uma resposta so vale para o NPS se tiver Q4 entre 0 e 10.
      respostaValida: q4 !== null && q4 >= 0 && q4 <= 10,
      canal,
      feedback: row.feedback ?? null,
      timestamp: row.timestamp ?? null,
      respondente_id: row.respondente_id ?? null,
      semProjeto: !pm,
      projetoContagemKey: pm ? chaveDoProjeto(pm) : null,
    };
  });
}

// ── Metricas ─────────────────────────────────────────────────────────────

export interface Metricas {
  nps: number;
  promotores: number;
  neutros: number;
  detratores: number;
  mediaGeral: number;
  porPergunta: { Q1: number; Q2: number; Q3: number; Q4: number };
  totalProjetos: number;
  projetosRespondidos: number;
  percentualProjetos: number;
  totalEmail: number;
  totalWhatsApp: number;
  /** Respostas cujo canal nao e e-mail nem WhatsApp. */
  totalOutroCanal: number;
  respondentesDistintos: number;
  respostasValidas: number;
}



/**
 * Consolida as metricas do painel.
 *
 * As tres grandezas abaixo sao DIFERENTES e nunca devem ser confundidas:
 *   - respostasValidas       : avaliacoes individuais
 *   - respondentesDistintos  : pessoas
 *   - projetosRespondidos    : projetos que receberam ao menos uma avaliacao
 *
 * Uma pessoa pode avaliar varios projetos; um projeto pode receber varias
 * avaliacoes. Trocar uma pela outra e o erro que faz a taxa de cobertura
 * passar de 100%.
 */
export function calcularMetricas(respostas: Resposta[], projetosEscopo: Projeto[]): Metricas {
  const universo = new Set(
    projetosEscopo.map((p) => chaveDoProjeto(p)).filter(chaveValida)
  );
  const totalProjetos = universo.size;

  // Canal conta TODAS as respostas, inclusive as sem Q4: a pergunta "por onde
  // chegou" independe de a avaliacao ser valida para o NPS.
  const totalEmail = respostas.filter((d) => classificarCanal(d.canal) === "email").length;
  const totalWhatsApp = respostas.filter((d) => classificarCanal(d.canal) === "whatsapp").length;
  // Nem e-mail nem WhatsApp: "LINK", "NAO INFORMADO", ou um canal novo que o
  // banco passe a gravar. Antes essas respostas sumiam da conta sem deixar
  // rastro, e o "Total" do painel de origem ficava menor que o real.
  const totalOutroCanal = respostas.length - totalEmail - totalWhatsApp;

  // NPS, medias e categorias usam APENAS respostas com Q4 valida.
  const validas = respostas.filter((d) => d.respostaValida);
  const total = validas.length;

  const vazio: Metricas = {
    nps: 0,
    promotores: 0,
    neutros: 0,
    detratores: 0,
    mediaGeral: 0,
    porPergunta: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
    totalProjetos,
    projetosRespondidos: 0,
    percentualProjetos: 0,
    totalEmail,
    totalWhatsApp,
    totalOutroCanal,
    respondentesDistintos: 0,
    respostasValidas: 0,
  };
  if (!total) return vazio;

  let somaQ1 = 0;
  let somaQ2 = 0;
  let somaQ3 = 0;
  let somaQ4 = 0;
  let cntQ1 = 0;
  let cntQ2 = 0;
  let cntQ3 = 0;
  let cntQ4 = 0;
  let promotores = 0;
  let neutros = 0;
  let detratores = 0;

  for (const d of validas) {
    if (d.nota_q1 !== null) {
      somaQ1 += d.nota_q1;
      cntQ1 += 1;
    }
    if (d.nota_q2 !== null) {
      somaQ2 += d.nota_q2;
      cntQ2 += 1;
    }
    if (d.nota_q3 !== null) {
      somaQ3 += d.nota_q3;
      cntQ3 += 1;
    }
    if (d.nota_q4 !== null) {
      somaQ4 += d.nota_q4;
      cntQ4 += 1;
    }
    if (d.categoria === "PROMOTOR") promotores += 1;
    else if (d.categoria === "DETRATOR") detratores += 1;
    else if (d.categoria === "NEUTRO") neutros += 1;
  }

  const nps = Math.round((promotores / total) * 100 - (detratores / total) * 100);

  const respondidos = new Set(
    validas
      .map((d) => d.projetoContagemKey)
      .filter((k): k is string => Boolean(k) && (totalProjetos === 0 || universo.has(k!)))
  );

  const respondentesDistintos = new Set(
    validas.map((d) => d.respondente_id || normalizarNome(d.identificador)).filter(Boolean)
  ).size;

  const somaTotal = somaQ1 + somaQ2 + somaQ3 + somaQ4;
  const cntTotal = cntQ1 + cntQ2 + cntQ3 + cntQ4;
  const media = (soma: number, cnt: number) => (cnt > 0 ? Number((soma / cnt).toFixed(2)) : 0);

  return {
    nps,
    promotores,
    neutros,
    detratores,
    mediaGeral: media(somaTotal, cntTotal),
    porPergunta: {
      Q1: media(somaQ1, cntQ1),
      Q2: media(somaQ2, cntQ2),
      Q3: media(somaQ3, cntQ3),
      Q4: media(somaQ4, cntQ4),
    },
    totalProjetos,
    projetosRespondidos: respondidos.size,
    percentualProjetos: totalProjetos > 0 ? Math.round((respondidos.size / totalProjetos) * 100) : 0,
    totalEmail,
    totalWhatsApp,
    totalOutroCanal,
    respondentesDistintos,
    respostasValidas: total,
  };
}

/** Metas estrategicas da Seteg. Um so lugar — aparecem no KPI, no termometro
 *  e no modal de metodologia. */
export const META_NPS = 90;
export const META_COBERTURA = 75;

export const PERGUNTAS = [
  "Q1: Nota Tecnica",
  "Q2: Relacionamento",
  "Q3: Comunicacao",
  "Q4: Indicacao",
] as const;
