// Relatorio PDF do dashboard NPS.
//
// ── O que mudou neste arquivo, e so isto ─────────────────────────────────
//
// O corpo (paleta, layout, tabelas, quebra de pagina — ~1.780 linhas) e o
// mesmo de pdf-export.js e nao foi reescrito: e codigo estavel, testado
// contra o relatorio impresso, e reescreve-lo em TypeScript seria churn sem
// ganho. O que mudou foram as bordas:
//
//  1. Era um IIFE que rodava no carregamento da pagina. Agora e um modulo ES
//     importado sob demanda — ver o `import()` em DashboardClient.tsx. Os
//     ~60 KB deste arquivo saem do caminho critico: so quem clica em
//     "Exportar PDF" os baixa.
//
//  2. O jsPDF vinha de cdnjs.cloudflare.com, injetado por <script> em tempo
//     de execucao. A CSP nova (next.config.js) so aceita script do proprio
//     site, entao a biblioteca passou a ser dependencia do projeto e chega
//     pelo mesmo `import()` preguicoso. Beneficio colateral: o relatorio
//     funciona com a rede da Seteg bloqueando CDN, que era uma falha
//     silenciosa antes.
//
//  3. Lia `window.dashboardAPI` e `localStorage`. As duas coisas sumiram:
//     os dados chegam por parametro, e a sessao vem do servidor. As chaves
//     que ele lia (`nps_tipo_acesso`, `nps_lider_logado`) ja eram residuo —
//     o proprio app/api.js as apagava como "versao anterior", de modo que o
//     PDF vinha tratando todo mundo como lider sem nome desde entao.
//
// Este arquivo continua em JavaScript de proposito (tsconfig tem allowJs).

/** Fonte de dados, injetada por exportarPDF. Substitui window.dashboardAPI. */
var _api = null;

/** Construtor do jsPDF, injetado por exportarPDF. */
var _jsPDF = null;

/** Os dois ciclos comparados, injetados por exportarPDF.
 *
 *  Eram as strings '2025.2' e '2026.1' escritas ao longo do arquivo, em
 *  titulo E em logica de filtro. O relatorio continuaria comparando esses
 *  dois semestres para sempre — no dia em que o 2026.2 entrou, a secao
 *  comparativa do PDF passou a mostrar um recorte velho sem avisar. */
var _cicloAnterior = "";
var _cicloAtual = "";


/* ============================================================
   PALETA E CONSTANTES
============================================================ */
var C = {
  azulEscuro:  [7,   29,  73],
  azulMedio:   [44,  86,  151],
  azulClaro:   [91,  155, 213],
  laranja:     [255, 130, 0],
  verde:       [108, 194, 74],
  amarelo:     [190, 165, 0],
  vermelho:    [215, 70,  70],
  branco:      [255, 255, 255],
  offWhite:    [243, 246, 251],
  cinzaClaro:  [215, 225, 238],
  cinzaMedio:  [130, 150, 175],
  cinzaEscuro: [45,  60,  85]
};

var PG = { w: 210, h: 297, ml: 14, mr: 14 };
PG.cw = PG.w - PG.ml - PG.mr;

var _pNum = 0;
var _projetosFiltrados = null; /* projetos_nps já filtrados pelos mesmos filtros da tela */

/* ============================================================
   SANITIZACAO — apenas para valores vindos dos dados
   Textos fixos podem usar acentos diretamente (Latin-1 OK)
============================================================ */
function S(v) {
  if (v == null) return '';
  return String(v)
    .replace(/[–—―−]/g, '-')
    .replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/×/g, 'x').replace(/÷/g, '/')
    .replace(/[✓✔✅☑]/g, 'OK').replace(/[✗✘❌☒]/g, 'X')
    .replace(/[★☆✴✪]/g, '*').replace(/[•‣▪●○◦]/g, '-')
    .replace(/[''ʼ`]/g, "'").replace(/[""«»]/g, '"')
    .replace(/…/g, '...').replace(/®/g, '(R)')
    .replace(/©/g, '(C)').replace(/™/g, '(TM)')
    .replace(/[^\x00-\xFF]/g, '');
}

/* ============================================================
   HELPERS DE COR E TEXTO
============================================================ */
function fc(doc, c, tipo) {
  if (tipo === 'draw') doc.setDrawColor(c[0], c[1], c[2]);
  else if (tipo === 'text') doc.setTextColor(c[0], c[1], c[2]);
  else doc.setFillColor(c[0], c[1], c[2]);
}

function labelNPS(n) {
  if (n >= 75) return 'Excelência';
  if (n >= 50) return 'Qualidade';
  if (n >= 1)  return 'Aperfeiçoamento';
  return 'Zona Crítica';
}

function labelScore(s) {
  if (s >= 9) return 'Excelente';
  if (s >= 8) return 'Muito Bom';
  if (s >= 7) return 'Bom';
  if (s >= 6) return 'Regular';
  return 'Crítico';
}

function corNPS(n) {
  if (n >= 75) return C.verde;
  if (n >= 50) return C.azulClaro;
  if (n >= 0)  return C.amarelo;
  return C.vermelho;
}

function dataBR() {
  return new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Normalização canônica — idêntica ao dashboard.js
function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normP(s) { return normalizar(s); }
function normC(s) { return normalizar(s); }

// Chave única de projeto: ciclo||clockify (idêntica ao dashboard.js)
// Usada tanto para projetos_nps quanto para respostas_nps
function projetoKey(item) {
  return normalizar(item.ciclo) + '||' + normalizar(item.codigo_clockify);
}

// Resposta válida: nota_q4 presente, numérica e entre 0–10
function pRespValida(d) {
  var q4 = d.nota_q4;
  if (q4 === null || q4 === undefined || q4 === '') return false;
  var n = parseFloat(q4);
  return !isNaN(n) && n >= 0 && n <= 10;
}

/* ============================================================
   PRIMITIVAS DE DESENHO
============================================================ */
function barra(doc, x, y, w, h, pct, cor) {
  fc(doc, C.cinzaClaro);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
  var fw = Math.max(0, Math.min((pct / 100) * w, w));
  if (fw > 0) {
    fc(doc, cor);
    doc.roundedRect(x, y, fw, h, h / 2, h / 2, 'F');
  }
}

function kpiBox(doc, x, y, w, h, label, valor, sub, cor, metaOK) {
  fc(doc, C.offWhite);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'F');
  fc(doc, cor);
  doc.roundedRect(x, y, 3, h, 1.5, 1.5, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  fc(doc, C.cinzaMedio, 'text');
  doc.text(S(label).toUpperCase(), x + 6, y + 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  fc(doc, cor, 'text');
  doc.text(S(String(valor)), x + 6, y + 14);

  if (sub) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    fc(doc, C.cinzaMedio, 'text');
    doc.text(S(sub), x + 6, y + 18.5);
  }

  if (metaOK !== undefined) {
    var bc = metaOK ? C.verde : C.vermelho;
    fc(doc, metaOK ? [213, 245, 200] : [255, 228, 228]);
    doc.roundedRect(x + 5, y + h - 8, 26, 5.5, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    fc(doc, bc, 'text');
    doc.text(metaOK ? 'META OK' : 'ABAIXO', x + 18, y + h - 4.2, { align: 'center' });
  }
}

/* ============================================================
   CABECALHO, RODAPE E NOVA PAGINA
============================================================ */
function cabecalho(doc, titulo) {
  _pNum++;
  fc(doc, C.azulEscuro);
  doc.rect(0, 0, PG.w, 11, 'F');
  fc(doc, C.laranja);
  doc.rect(0, 0, 3, 11, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  fc(doc, [170, 190, 215], 'text');
  doc.text('SETEG - RELATORIO NPS', PG.ml + 4, 7);
  doc.text(titulo.toUpperCase(), PG.w / 2, 7, { align: 'center' });
  doc.text('Pag. ' + _pNum, PG.w - PG.mr, 7, { align: 'right' });
}

function rodape(doc) {
  fc(doc, C.azulEscuro);
  doc.rect(0, PG.h - 9, PG.w, 9, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  fc(doc, [100, 130, 165], 'text');
  doc.text(
    'Seteg Soluções Ambientais Ltda - Relatório NPS - Documento de uso interno',
    PG.w / 2, PG.h - 3.5, { align: 'center' }
  );
}

function novaPagina(doc, titulo) {
  doc.addPage();
  cabecalho(doc, titulo);
  rodape(doc);
  return 17;
}

/* Garante espaço suficiente; se não, abre nova página */
function checkY(doc, y, needed, titulo) {
  return (y + needed > PG.h - 14) ? novaPagina(doc, titulo) : y;
}

/* ============================================================
   COMPONENTES REUTILIZÁVEIS
============================================================ */
function secao(doc, y, label, cor) {
  cor = cor || C.azulMedio;
  fc(doc, cor);
  doc.roundedRect(PG.ml, y, 3.5, 7, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  fc(doc, cor, 'text');
  doc.text(label.toUpperCase(), PG.ml + 7, y + 5.2);
  fc(doc, cor, 'draw');
  doc.setLineWidth(0.2);
  doc.line(PG.ml, y + 8.2, PG.w - PG.mr, y + 8.2);
  return y + 13;
}

/* Caixa de texto com altura automática e borda lateral */
function pilula(doc, y, texto, cor, titulo_pg) {
  cor = cor || C.azulMedio;
  var maxW = PG.cw - 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  var lines = doc.splitTextToSize(S(String(texto)), maxW);
  var h = lines.length * 4.3 + 10;
  y = checkY(doc, y, h + 4, titulo_pg || 'Relatorio');
  fc(doc, C.offWhite);
  doc.roundedRect(PG.ml, y, PG.cw, h, 2, 2, 'F');
  fc(doc, cor);
  doc.roundedRect(PG.ml, y, 3, h, 1.5, 1.5, 'F');
  fc(doc, C.cinzaEscuro, 'text');
  doc.text(lines, PG.ml + 7, y + 5.8);
  return y + h + 5;
}

/* Tabela genérica com paginação automática e quebra de texto por célula.
   opts: { fontSize }  (padrão 7) */
function tabela(doc, y, headers, rows, titulo_pg, colWidths, opts) {
  opts = opts || {};
  var fontSize = opts.fontSize !== undefined ? opts.fontSize : 7;
  var lineH  = fontSize * 0.61;  /* altura de linha em mm (empírico jsPDF) */
  var hdrH   = 8;
  var pad    = 2;                /* padding horizontal interno */

  var cols   = headers.length;
  var totalW = PG.cw;
  var cw = colWidths ? colWidths.slice() : [];
  if (!cw.length) {
    for (var i = 0; i < cols; i++) cw.push(Math.floor(totalW / cols));
  }

  /* linhas resultantes do wrap para uma célula */
  function cellLines(cell, ci) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    return doc.splitTextToSize(S(String(cell != null ? cell : '-')), cw[ci] - pad * 2);
  }

  /* altura da linha = max(nLinhas de cada célula) * lineH + padding vertical */
  function calcRowH(row) {
    var maxL = 1;
    row.forEach(function(cell, ci) {
      var n = cellLines(cell, ci).length;
      if (n > maxL) maxL = n;
    });
    return Math.max(6, maxL * lineH + 4);
  }

  function drawHeader(doc, y) {
    fc(doc, C.azulEscuro);
    doc.roundedRect(PG.ml, y, totalW, hdrH, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Math.max(5.5, fontSize - 0.5));
    fc(doc, [195, 215, 235], 'text');
    var x = PG.ml;
    headers.forEach(function(h, i) {
      doc.text(S(h).toUpperCase(), x + cw[i] / 2, y + 5.5, { align: 'center' });
      x += cw[i];
    });
    return y + hdrH;
  }

  y = checkY(doc, y, hdrH + 12, titulo_pg);
  y = drawHeader(doc, y);

  rows.forEach(function(row, ri) {
    var rh = calcRowH(row);

    if (y + rh > PG.h - 14) {
      y = novaPagina(doc, titulo_pg);
      y = drawHeader(doc, y);
    }

    /* fundo zebrado */
    fc(doc, ri % 2 === 0 ? C.offWhite : C.branco);
    doc.rect(PG.ml, y, totalW, rh, 'F');

    /* texto de cada célula: wrap + centralização vertical do bloco */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    fc(doc, C.cinzaEscuro, 'text');
    var x = PG.ml;
    row.forEach(function(cell, ci) {
      var lines  = cellLines(cell, ci);
      /* baseline da 1ª linha centrada verticalmente no bloco */
      var firstY = y + rh / 2 - (lines.length - 1) * lineH / 2;
      lines.forEach(function(line, li) {
        doc.text(line, x + cw[ci] / 2, firstY + li * lineH, { align: 'center' });
      });
      x += cw[ci];
    });

    /* linha divisória */
    fc(doc, C.cinzaClaro, 'draw');
    doc.setLineWidth(0.1);
    doc.line(PG.ml, y + rh, PG.ml + totalW, y + rh);
    y += rh;
  });

  return y + 4;
}

function labelCanal(c) {
  if (c === 'EMAIL (PMO)') return 'EMAIL';
  if (c === 'VIA LÍDER')   return 'WHATSAPP';
  return c || '-';
}

/* ============================================================
   CALCULO DE METRICAS
============================================================ */
function calcMetricas(data, liderFiltro) {
  var api = _api;
  var projetos = _projetosFiltrados !== null ? _projetosFiltrados : (api ? api.getDadosProjetos() : []);
  var mapping  = api ? api.getMAPPING()       : [];

  var totalPU;
  var universoKeys = null;
  if (projetos.length) {
    var pf = liderFiltro ? projetos.filter(function(p){ return normalizar(p.lider_atual || p.lider) === normalizar(liderFiltro); }) : projetos;
    var pfKeys = pf.map(function(p){ return projetoKey(p); }).filter(function(k){ return k && k !== '||'; });
    universoKeys = new Set(pfKeys);
    totalPU = universoKeys.size;
  } else {
    var mf = liderFiltro ? mapping.filter(function(m){ return m.lider === liderFiltro; }) : mapping;
    totalPU = new Set(mf.map(function(m){ return normalizar(m.cliente) + '||' + normalizar(m.projeto); })).size;
  }

  var totalEmail    = (data || []).filter(function(d){ var c = d.canal || d.origem; return c === 'EMAIL (PMO)' || c === 'EMAIL';    }).length;
  var totalWhatsApp = (data || []).filter(function(d){ var c = d.canal || d.origem; return c === 'VIA LÍDER'  || c === 'WHATSAPP'; }).length;

  // Apenas respostas válidas entram no NPS e nas médias
  var validData = (data || []).filter(pRespValida);
  var total = validData.length;

  // Projetos respondidos: _projetoContagemKey herdado do projeto vinculado no dashboard
  var projResp = new Set(
    validData
      .filter(function(d){ return d._projetoContagemKey && (universoKeys ? universoKeys.has(d._projetoContagemKey) : true); })
      .map(function(d){ return d._projetoContagemKey; })
  ).size;
  var pctProj = totalPU > 0 ? Math.round((projResp / totalPU) * 100) : 0;

  if (!total) {
    return {
      nps: 0, promotores: 0, neutros: 0, detratores: 0, mediaGeral: '0.00',
      porPergunta: { Q1: '0.00', Q2: '0.00', Q3: '0.00', Q4: '0.00' },
      totalProjetosUnicos: totalPU, projetosRespondidos: projResp, percentualProjetos: pctProj,
      totalEmail: totalEmail, totalWhatsApp: totalWhatsApp
    };
  }

  var s1 = 0, s2 = 0, s3 = 0, s4 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0;
  var prom = 0, det = 0, neut = 0;
  validData.forEach(function (d) {
    var q1 = parseFloat(d.nota_q1), q2 = parseFloat(d.nota_q2);
    var q3 = parseFloat(d.nota_q3), q4 = parseFloat(d.nota_q4);
    if (!isNaN(q1)) { s1 += q1; c1++; }
    if (!isNaN(q2)) { s2 += q2; c2++; }
    if (!isNaN(q3)) { s3 += q3; c3++; }
    if (!isNaN(q4)) { s4 += q4; c4++; }
    if (d.categoria === 'PROMOTOR') prom++;
    else if (d.categoria === 'DETRATOR') det++;
    else neut++;
  });
  var nps = Math.round((prom / total) * 100 - (det / total) * 100);
  var somaT = s1 + s2 + s3 + s4;
  var cntT  = c1 + c2 + c3 + c4;
  return {
    nps: nps, promotores: prom, neutros: neut, detratores: det,
    mediaGeral: cntT > 0 ? (somaT / cntT).toFixed(2) : '0.00',
    porPergunta: {
      Q1: c1 > 0 ? (s1 / c1).toFixed(2) : '0.00',
      Q2: c2 > 0 ? (s2 / c2).toFixed(2) : '0.00',
      Q3: c3 > 0 ? (s3 / c3).toFixed(2) : '0.00',
      Q4: c4 > 0 ? (s4 / c4).toFixed(2) : '0.00'
    },
    totalProjetosUnicos: totalPU, projetosRespondidos: projResp, percentualProjetos: pctProj,
    totalEmail: totalEmail, totalWhatsApp: totalWhatsApp
  };
}

/* ============================================================
   1. CAPA
============================================================ */
function pgCapa(doc, m, isFiltrado, filtros, totalResp, liderLogado) {
  _pNum++;
  fc(doc, C.azulEscuro);
  doc.rect(0, 0, PG.w, PG.h, 'F');
  fc(doc, [12, 40, 95]);
  doc.circle(188, 55, 50, 'F');
  fc(doc, [5, 22, 58]);
  doc.circle(22, 245, 55, 'F');
  fc(doc, C.laranja);
  doc.rect(0, 95, 5, 100, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(42);
  fc(doc, C.branco, 'text');
  doc.text('SETEG', PG.w / 2, 74, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  fc(doc, [175, 200, 225], 'text');
  doc.text('Soluções Ambientais Ltda', PG.w / 2, 83, { align: 'center' });

  fc(doc, C.laranja, 'draw');
  doc.setLineWidth(1.2);
  doc.line(50, 90, 160, 90);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  fc(doc, C.branco, 'text');
  doc.text('RELATÓRIO NPS', PG.w / 2, 122, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  fc(doc, [175, 200, 225], 'text');
  doc.text('Net Promoter Score - Análise de Satisfação', PG.w / 2, 133, { align: 'center' });

  var cicloLabel = 'Ciclos: ' + _cicloAnterior + ' e ' + _cicloAtual;
  filtros.forEach(function(f){ if (f.indexOf('Ciclo:') === 0) cicloLabel = f; });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  fc(doc, [230, 210, 20], 'text');
  doc.text(S(cicloLabel), PG.w / 2, 148, { align: 'center' });

  var bLabel = liderLogado ? 'RELATÓRIO DO LÍDER'
             : (isFiltrado ? 'RELATÓRIO FILTRADO' : 'RELATÓRIO GERAL');
  fc(doc, liderLogado ? C.laranja : (isFiltrado ? C.laranja : C.verde));
  doc.roundedRect(PG.w / 2 - 28, 155, 56, 9, 2.5, 2.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  fc(doc, C.branco, 'text');
  doc.text(bLabel, PG.w / 2, 161, { align: 'center' });

  var cy;
  if (liderLogado) {
    fc(doc, C.laranja);
    doc.roundedRect(PG.w / 2 - 40, 168, 80, 10, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    fc(doc, C.branco, 'text');
    doc.text('Relatório do Líder: ' + S(liderLogado), PG.w / 2, 174.5, { align: 'center' });
    cy = 186;
  } else {
    cy = 174;
  }

  /* Filtros extras (exclui Líder: quando há badge dedicado) */
  var exibirFiltros = filtros.filter(function (f) {
    return liderLogado ? f.indexOf('Líder:') !== 0 : true;
  });
  if (isFiltrado && exibirFiltros.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    fc(doc, [195, 215, 235], 'text');
    doc.text('Filtros aplicados:', PG.w / 2, cy, { align: 'center' });
    cy += 7;
    exibirFiltros.forEach(function (f) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      fc(doc, [230, 210, 20], 'text');
      doc.text(S(f), PG.w / 2, cy, { align: 'center' });
      cy += 5.5;
    });
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  fc(doc, [120, 148, 178], 'text');
  doc.text('Gerado em: ' + dataBR(), PG.w / 2, 240, { align: 'center' });

  fc(doc, [4, 14, 44]);
  doc.rect(0, PG.h - 16, PG.w, 16, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  fc(doc, [90, 130, 170], 'text');
  doc.text('Dashboard NPS - Seteg Soluções Ambientais Ltda', PG.w / 2, PG.h - 8, { align: 'center' });
  doc.setFontSize(6);
  fc(doc, [65, 100, 140], 'text');
  doc.text('Documento de uso interno. Gerado automaticamente.', PG.w / 2, PG.h - 3.5, { align: 'center' });
}

/* ============================================================
   2. SUMÁRIO
============================================================ */
function pgSumario(doc, isLider) {
  var y = novaPagina(doc, 'Sumário');
  y = secao(doc, y, 'Sumário do Relatório');

  /* itens: [numero, texto, recuo(true=subitem)] */
  var itens;
  if (isLider) {
    itens = [
      ['1.',  'Apresentação e Metodologia NPS',             false],
      ['2.',  'Resumo Executivo',                            false],
      ['3.',  'Clientes que responderam e não responderam', false],
      ['4.',  'Quadro de NPS de Clientes e Respostas',      false],
      ['5.',  'Metas e Performance',                         false],
      ['6.',  'Detalhamento por Dimensão',                   false],
      ['7.',  'Análise Geral',                               false]
    ];
  } else {
    itens = [
      ['1.',  'Apresentação e Metodologia NPS',              false],
      ['2.',  'Resumo Executivo',                             false],
      ['3.',  'Comparativo entre Ciclos dos Indicadores',    false],
      ['4.',  'Incidência Comparativa de Respostas',         false],
      ['',    '4.1  Comparação ' + _cicloAtual + ' × ' + _cicloAnterior + ' por Clockify', true],
      ['5.',  'Segmentações',                                false],
      ['',    '5.1  Por Classe Contratual (Curva A / B / C)', true],
      ['',    '5.2  Por Tipo de Serviço e Segmento',          true],
      ['',    '5.3  Análise de Incidência de Resposta',      true],
      ['6.',  'Clientes que responderam e não responderam',  false],
      ['7.',  'Análise de Canais e Momentos de Resposta',    false],
      ['',    '7.1  E-mail (via PMO)',                       true],
      ['',    '7.2  WhatsApp (via Líderes)',                 true],
      ['8.',  'Quadro de NPS de Clientes e Respostas',       false],
      ['9.',  'Metas e Performance',                         false],
      ['10.', 'Detalhamento por Dimensão',                   false],
      ['11.', 'Análise Geral',                               false]
    ];
  }

  itens.forEach(function (it, idx) {
    var subitem = it[2];
    var rowH = subitem ? 7.5 : 9;
    fc(doc, idx % 2 === 0 ? C.offWhite : C.branco);
    doc.roundedRect(PG.ml, y, PG.cw, rowH, 1, 1, 'F');
    if (subitem) {
      /* linha vertical de recuo */
      fc(doc, C.cinzaClaro);
      doc.rect(PG.ml + 12, y, 1.5, rowH, 'F');
    }
    if (it[0]) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      fc(doc, C.azulMedio, 'text');
      doc.text(it[0], PG.ml + 5, y + rowH * 0.67);
    }
    doc.setFont('helvetica', subitem ? 'normal' : 'normal');
    doc.setFontSize(subitem ? 7.5 : 8.5);
    fc(doc, subitem ? C.cinzaMedio : C.cinzaEscuro, 'text');
    doc.text(it[1], subitem ? PG.ml + 17 : PG.ml + 15, y + rowH * 0.67);
    fc(doc, C.cinzaClaro, 'draw');
    doc.setLineWidth(0.1);
    doc.line(PG.ml, y + rowH, PG.ml + PG.cw, y + rowH);
    y += rowH;
  });
}

/* ============================================================
   3. APRESENTAÇÃO E METODOLOGIA
============================================================ */
function pgMetodologia(doc) {
  var y = novaPagina(doc, 'Apresentação e Metodologia');
  y = secao(doc, y, 'Apresentação e Metodologia NPS');

  y = pilula(doc, y,
    'Este relatório apresenta os resultados do ciclo de pesquisa de satisfação de clientes ' +
    'da Seteg Soluções Ambientais Ltda, baseado na metodologia Net Promoter Score (NPS). ' +
    'O objetivo é mensurar o nível de satisfação, fidelização e propensão à recomendação ' +
    'dos clientes ativos, fornecendo subsídios para decisões estratégicas de melhoria contínua.',
    C.azulMedio, 'Metodologia');

  y = checkY(doc, y, 12, 'Metodologia');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  fc(doc, C.azulMedio, 'text');
  doc.text('Metodologia NPS', PG.ml, y + 5);
  y += 10;

  y = pilula(doc, y,
    'O NPS é calculado a partir da pergunta de indicação (Q4): "De 0 a 10, o quanto você nos ' +
    'indicaria a um amigo, familiar ou parceiro de negócios?" Os respondentes são classificados ' +
    'em três categorias: Promotores (notas 9-10), Neutros/Passivos (notas 7-8) e Detratores ' +
    '(notas 0-6). Fórmula: NPS = % Promotores - % Detratores. Escala de -100 a +100 pontos.',
    C.azulMedio, 'Metodologia');

  // Classificação
  y = checkY(doc, y, 12, 'Metodologia');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  fc(doc, C.azulMedio, 'text');
  doc.text('Classificação dos Respondentes', PG.ml, y + 5);
  y += 10;

  var cats = [
    { nome: 'Promotores', faixa: 'Notas 9 - 10', desc: 'Alta satisfação, fidelização e propensão à recomendação.', cor: C.verde,    bg: [235, 250, 228] },
    { nome: 'Neutros / Passivos', faixa: 'Notas 7 - 8', desc: 'Satisfeitos, porém com menor engajamento e suscetíveis à concorrência.', cor: C.amarelo,  bg: [252, 248, 220] },
    { nome: 'Detratores', faixa: 'Notas 0 - 6', desc: 'Insatisfeitos ou com percepção negativa — risco reputacional.', cor: C.vermelho, bg: [255, 230, 230] }
  ];

  cats.forEach(function (c) {
    y = checkY(doc, y, 18, 'Metodologia');
    fc(doc, c.bg);
    doc.roundedRect(PG.ml, y, PG.cw, 14, 2, 2, 'F');
    fc(doc, c.cor);
    doc.roundedRect(PG.ml, y, 3, 14, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    fc(doc, c.cor, 'text');
    doc.text(c.nome, PG.ml + 7, y + 5.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    fc(doc, C.cinzaMedio, 'text');
    doc.text(c.faixa, PG.ml + 7, y + 10.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    fc(doc, C.cinzaEscuro, 'text');
    var ls = doc.splitTextToSize(c.desc, PG.cw - 60);
    doc.text(ls, PG.w - PG.mr - 5, y + 5.5, { align: 'right' });
    y += 17;
  });

  // Fórmula
  y = checkY(doc, y, 22, 'Metodologia');
  y += 3;
  fc(doc, [235, 240, 252]);
  doc.roundedRect(PG.ml, y, PG.cw, 16, 2, 2, 'F');
  fc(doc, C.azulMedio, 'draw');
  doc.setLineWidth(0.3);
  doc.roundedRect(PG.ml, y, PG.cw, 16, 2, 2, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  fc(doc, C.azulMedio, 'text');
  doc.text('NPS = % Promotores - % Detratores', PG.w / 2, y + 10, { align: 'center' });
  y += 20;

  // Faixas NPS
  y = checkY(doc, y, 35, 'Metodologia');
  var faixas = [
    { faixa: '-100 a 0',  cls: 'Zona Crítica',     cor: C.vermelho },
    { faixa: '1 a 49',    cls: 'Aperfeiçoamento',   cor: C.amarelo },
    { faixa: '50 a 74',   cls: 'Qualidade',          cor: C.azulClaro },
    { faixa: '75 a 100',  cls: 'Excelência',         cor: C.verde }
  ];
  y = tabela(doc, y,
    ['Faixa de NPS', 'Classificação', 'Interpretação'],
    [
      ['-100 a 0',  'Zona Crítica',   'Alta insatisfação e risco de perda de clientes'],
      ['1 a 49',    'Aperfeiçoamento','Satisfação moderada, fidelização instável'],
      ['50 a 74',   'Qualidade',      'Desempenho consistente e clientes leais'],
      ['75 a 100',  'Excelência',     'Altíssima lealdade e forte advocacia da marca']
    ],
    'Metodologia', null);

  // Metas
  y = checkY(doc, y, 12, 'Metodologia');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  fc(doc, C.azulMedio, 'text');
  doc.text('Metas Estratégicas Seteg', PG.ml, y + 5);
  y += 10;

  [
    { label: 'Meta NPS: >= 90 pontos', desc: 'O índice NPS deve atingir no mínimo 90 pontos por ciclo avaliativo.', cor: C.laranja },
    { label: 'Meta de Resposta: >= 75%', desc: 'No mínimo 75% dos projetos únicos do universo devem responder ao ciclo. ' +
      'Projetos com grafia diferente (acentos, espaços, maiúsculas) são normalizados e contados apenas uma vez.', cor: C.azulMedio }
  ].forEach(function (mt) {
    y = checkY(doc, y, 22, 'Metodologia');
    fc(doc, C.offWhite);
    doc.roundedRect(PG.ml, y, PG.cw, 16, 2, 2, 'F');
    fc(doc, mt.cor);
    doc.roundedRect(PG.ml, y, 3, 16, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    fc(doc, mt.cor, 'text');
    doc.text(mt.label, PG.ml + 7, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    fc(doc, C.cinzaEscuro, 'text');
    var ls = doc.splitTextToSize(mt.desc, PG.cw - 12);
    doc.text(ls, PG.ml + 7, y + 11.5);
    y += 20;
  });
}

/* ============================================================
   4. COMPARATIVO ENTRE CICLOS
============================================================ */
function pgComparativoCiclos(doc, data, filtros) {
  var y = novaPagina(doc, 'Comparativo entre Ciclos');
  y = secao(doc, y, 'Comparativo entre Ciclos dos Indicadores');

  var api = _api;
  /* Usa TODOS os ciclos independente do filtro de ciclo ativo — regra especial desta seção */
  var projetos = api ? api.getDadosProjetos()    : [];
  var dataComp = api ? api.getDadosProcessados() : [];
  /* Aplica todos os filtros ativos EXCETO o de ciclo */
  (filtros || []).filter(function(f){ return f.indexOf('Ciclo:') !== 0; }).forEach(function(f) {
    var sep = f.indexOf(': '); if (sep < 0) return;
    var key = f.slice(0, sep).trim();
    var val = f.slice(sep + 2).trim();
    if (key === 'Líder' || key === 'Lider') {
      projetos  = projetos.filter(function(p){ return normalizar(p.lider_atual||p.lider) === normalizar(val); });
      dataComp  = dataComp.filter(function(d){ return normalizar(d.lider_atual||d.lider) === normalizar(val); });
    } else if (key === 'Cliente') {
      projetos  = projetos.filter(function(p){ return normalizar(p.cliente) === normalizar(val); });
      dataComp  = dataComp.filter(function(d){ return normalizar(d.cliente) === normalizar(val); });
    } else if (key === 'Classe') {
      projetos  = projetos.filter(function(p){ return p.classe_contratual === val; });
      dataComp  = dataComp.filter(function(d){ return d.classe_contratual === val; });
    } else if (key === 'Tipo Serviço' || key === 'Tipo Servico') {
      projetos  = projetos.filter(function(p){ return p.tipo_servico === val; });
      dataComp  = dataComp.filter(function(d){ return d.tipo_servico === val; });
    }
  });
  var todosCiclos = Array.from(new Set(
    projetos.map(function(p){ return p.ciclo; }).filter(Boolean).concat(
      dataComp.map(function(d){ return d.ciclo; }).filter(Boolean)
    )
  )).sort();

  var porCiclo = [];
  todosCiclos.forEach(function(ciclo) {
    var rd = dataComp.filter(function(x){ return x.ciclo === ciclo; });
    var pd = projetos.filter(function(p){ return p.ciclo === ciclo; });
    var projKeys = new Set(pd.map(function(p){ return projetoKey(p); }).filter(function(k){ return k && k !== '||'; }));
    var totalPU  = projKeys.size;
    // Apenas respostas válidas entram no NPS e na contagem de respondidos
    var validRd = rd.filter(pRespValida);
    var total = validRd.length;
    if (!total && !totalPU) return;
    var prom = validRd.filter(function(x){ return x.categoria === 'PROMOTOR'; }).length;
    var det  = validRd.filter(function(x){ return x.categoria === 'DETRATOR'; }).length;
    var neut = total - prom - det;
    var nps  = total > 0 ? Math.round((prom / total) * 100 - (det / total) * 100) : 0;
    // Respondidos: chave de contagem do projeto vinculado (campo _projetoContagemKey)
    var projResp = new Set(
      validRd
        .filter(function(d){ return d._projetoContagemKey && (projKeys.size > 0 ? projKeys.has(d._projetoContagemKey) : true); })
        .map(function(d){ return d._projetoContagemKey; })
    ).size;
    var taxa = totalPU > 0 ? Math.round((projResp / totalPU) * 100) : 0;
    porCiclo.push({ ciclo: ciclo, nps: nps, total: total, prom: prom, det: det, neut: neut,
      totalPU: totalPU, projResp: projResp, taxa: taxa });
  });

  if (!porCiclo.length) {
    y = pilula(doc, y,
      'Nao ha dados suficientes para comparacao entre ciclos. ' +
      'Esta secao sera preenchida quando houver registros nos ciclos ' + _cicloAnterior + ' e ' + _cicloAtual + '.',
      C.cinzaMedio, 'Comparativo');
    return;
  }

  y = tabela(doc, y,
    ['Ciclo', 'Projetos', 'Respondidos', 'Taxa%', 'NPS', 'Respostas', 'Promotores', 'Neutros', 'Detratores'],
    porCiclo.map(function(c){
      return [S(c.ciclo), String(c.totalPU), String(c.projResp), c.taxa+'%',
              String(c.nps), String(c.total), String(c.prom), String(c.neut), String(c.det)];
    }),
    'Comparativo', [22, 20, 22, 18, 16, 20, 20, 22, 22]);

  if (porCiclo.length === 2) {
    var dif  = porCiclo[1].nps  - porCiclo[0].nps;
    var difT = porCiclo[1].taxa - porCiclo[0].taxa;
    var sinal = dif > 0 ? '+' : '';
    var textoEvo = 'Evolucao ' + _cicloAnterior + ' -> ' + _cicloAtual + ': NPS ' + sinal + dif + ' pontos (' +
      (dif > 0 ? 'melhora' : dif < 0 ? 'queda' : 'estavel') + '). ' +
      'Taxa de resposta: ' + (difT > 0 ? '+' : '') + difT + ' pontos percentuais.';
    y = pilula(doc, y, textoEvo, dif > 0 ? C.verde : dif < 0 ? C.vermelho : C.cinzaMedio, 'Comparativo');
  }

  y = checkY(doc, y, 15, 'Comparativo');
  y += 5;
  porCiclo.forEach(function (c) {
    var npsPct = Math.max(0, Math.min(((c.nps + 100) / 200) * 100, 100));
    y = checkY(doc, y, 12, 'Comparativo');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    fc(doc, C.cinzaEscuro, 'text');
    doc.text(S(c.ciclo), PG.ml, y + 3.5);
    fc(doc, corNPS(c.nps), 'text');
    doc.text('NPS: ' + c.nps, PG.w - PG.mr, y + 3.5, { align: 'right' });
    barra(doc, PG.ml, y + 5, PG.cw, 5, npsPct, corNPS(c.nps));
    y += 13;
  });
}

/* ============================================================
   4.1 INCIDÊNCIA COMPARATIVA DE RESPOSTAS
============================================================ */
function pgIncidenciaComparativa(doc, filtros) {
  var titulo = 'Incidência Comparativa de Respostas';
  var y = novaPagina(doc, titulo);
  y = secao(doc, y, titulo + ' · ' + _cicloAtual + ' × ' + _cicloAnterior);

  var api = _api;
  if (!api) { return; }

  /* Projetos sem filtro de ciclo + filtros não-ciclo */
  var projetos = api.getDadosProjetos();
  var dados    = api.getDadosProcessados();

  (filtros || []).filter(function(f){ return f.indexOf('Ciclo:') !== 0; }).forEach(function(f) {
    var sep = f.indexOf(': ');
    if (sep < 0) return;
    var key = f.slice(0, sep).trim();
    var val = f.slice(sep + 2).trim();
    if (key === 'Líder' || key === 'Lider') {
      projetos = projetos.filter(function(p){ return normalizar(p.lider_atual||p.lider) === normalizar(val); });
      dados    = dados.filter(function(d){ return normalizar(d.lider_atual||d.lider) === normalizar(val); });
    } else if (key === 'Cliente') {
      projetos = projetos.filter(function(p){ return normalizar(p.cliente) === normalizar(val); });
      dados    = dados.filter(function(d){ return normalizar(d.cliente) === normalizar(val); });
    } else if (key === 'Classe') {
      projetos = projetos.filter(function(p){ return p.classe_contratual === val; });
      dados    = dados.filter(function(d){ return d.classe_contratual === val; });
    } else if (key === 'Tipo Serviço' || key === 'Tipo Servico') {
      projetos = projetos.filter(function(p){ return p.tipo_servico === val; });
      dados    = dados.filter(function(d){ return d.tipo_servico === val; });
    }
  });

  /* Verifica se há dados do ciclo anterior */
  var has252 = projetos.some(function(p){ return p.ciclo === _cicloAnterior; });
  if (!has252) {
    y = pilula(doc, y, 'Sem ciclo anterior disponível para comparação.', C.cinzaMedio, titulo);
    return;
  }

  /* Indexação por codigo_clockify */
  var proj252 = {}, proj261 = {};
  projetos.forEach(function(p) {
    var ck = normalizar(p.codigo_clockify);
    if (!ck) return;
    if (p.ciclo === _cicloAnterior && !proj252[ck]) proj252[ck] = p;
    else if (p.ciclo === _cicloAtual && !proj261[ck]) proj261[ck] = p;
  });

  var resp252 = {}, resp261 = {};
  dados.filter(pRespValida).forEach(function(d) {
    if (!d.codigo_clockify) return;
    var ck = normalizar(d.codigo_clockify);
    if (d.ciclo === _cicloAnterior) resp252[ck] = true;
    else if (d.ciclo === _cicloAtual) resp261[ck] = true;
  });

  /* União de chaves */
  var allCkObj = {};
  Object.keys(proj252).forEach(function(k){ allCkObj[k] = true; });
  Object.keys(proj261).forEach(function(k){ allCkObj[k] = true; });
  var allCk = Object.keys(allCkObj);

  if (!allCk.length) {
    y = pilula(doc, y, 'Sem dados para comparação entre ciclos.', C.cinzaMedio, titulo);
    return;
  }

  var rows = [];
  var cAmbos = 0, cNunca = 0, cNovos = 0, cEnc = 0;
  allCk.forEach(function(ck) {
    var p252 = proj252[ck], p261 = proj261[ck];
    var ref  = p261 || p252;
    var eleg252 = !!p252, eleg261 = !!p261;
    var res252 = !!resp252[ck], res261 = !!resp261[ck];

    var analise;
    if (eleg252 && eleg261) {
      if      (res252 && res261) { analise = 'Respondeu nos dois ciclos';   cAmbos++; }
      else if (res252)           { analise = 'Respondeu apenas em ' + _cicloAnterior; }
      else if (res261)           { analise = 'Respondeu apenas em ' + _cicloAtual; }
      else                       { analise = 'Nunca respondeu';             cNunca++; }
    } else if (eleg261 && !eleg252) {
      analise = 'Novo projeto em ' + _cicloAtual; cNovos++;
    } else {
      analise = 'Encerrado apos ' + _cicloAnterior; cEnc++;
    }

    rows.push([
      S(ref.cliente||'-'), S(ref.projeto||'-'), S(ck),
      S(ref.lider_atual||ref.lider||'-'),
      eleg252?'Sim':'Nao', eleg261?'Sim':'Nao',
      res252 ?'Sim':'Nao', res261 ?'Sim':'Nao',
      S(analise)
    ]);
  });

  rows.sort(function(a, b){ return (a[0]+a[1]).localeCompare(b[0]+b[1]); });

  /* Boxes de resumo */
  var kw3 = (PG.cw - 10) / 3;
  y = checkY(doc, y, 24, titulo);
  kpiBox(doc, PG.ml,             y, kw3, 22, 'Ambos os ciclos',  cAmbos,      'Respondeu ' + _cicloAnterior + ' e ' + _cicloAtual,    C.verde,    undefined);
  kpiBox(doc, PG.ml+kw3+5,      y, kw3, 22, 'Nunca respondeu',  cNunca,      'Elegivel em ambos, sem resp.',  C.vermelho, undefined);
  kpiBox(doc, PG.ml+(kw3+5)*2,  y, kw3, 22, 'Novos / Encerr.',  cNovos+cEnc, 'Novos ' + _cicloAtual + ' + Enc. ' + _cicloAnterior,   C.azulClaro,undefined);
  y += 28;

  y = tabela(doc, y,
    ['Cliente', 'Projeto', 'Cod.Clockify', 'Lider', 'El.2025', 'El.2026', 'Res.2025', 'Res.2026', 'Analise da Resposta'],
    rows, titulo,
    [24, 36, 22, 22, 13, 13, 14, 14, 24],
    { fontSize: 6 }
  );
}

/* ============================================================
   5. SEGMENTAÇÕES
============================================================ */
function pgSegmentacoes(doc, data, m) {
  var y = novaPagina(doc, 'Segmentações');
  y = secao(doc, y, 'Segmentações');

  /* 5.1 Por Classe Contratual */
  y = checkY(doc, y, 12, 'Segmentações');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  fc(doc, C.azulMedio, 'text');
  doc.text('5.1 Por Classe Contratual', PG.ml, y + 5);
  y += 10;

  var temClasse = data.some(function (d) { return d.classe_contratual || d.curva; });
  if (!temClasse) {
    y = pilula(doc, y,
      'A segmentação por classe contratual (Curva A, B, C) depende da inclusão desse campo ' +
      'na base de dados. Atualmente, o campo "classe contratual" não está disponível nas ' +
      'respostas coletadas. Para habilitar esta análise, inclua a classificação contratual ' +
      'no cadastro de projetos do sistema.',
      C.cinzaMedio, 'Segmentações');
  } else {
    var curvas = {};
    data.forEach(function (d) {
      var c = ((d.classe_contratual || d.curva || '')).toUpperCase().trim();
      if (!curvas[c]) curvas[c] = [];
      curvas[c].push(d);
    });
    Object.keys(curvas).sort().forEach(function (curva) {
      var cd = curvas[curva];
      var prom = cd.filter(function (x) { return x.categoria === 'PROMOTOR'; }).length;
      var det = cd.filter(function (x) { return x.categoria === 'DETRATOR'; }).length;
      var nps = cd.length > 0 ? Math.round((prom / cd.length) * 100 - (det / cd.length) * 100) : 0;
      y = checkY(doc, y, 14, 'Segmentações');
      fc(doc, C.offWhite);
      doc.roundedRect(PG.ml, y, PG.cw, 11, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      fc(doc, C.azulMedio, 'text');
      doc.text('Curva ' + curva + ':  ' + cd.length + ' respostas  |  NPS: ' + nps, PG.ml + 5, y + 7);
      y += 14;
    });
  }

  /* 5.2 Por Tipo de Serviço e Segmento */
  y = checkY(doc, y, 12, 'Segmentações');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  fc(doc, C.azulMedio, 'text');
  doc.text('5.2 Por Tipo de Serviço e Segmento', PG.ml, y + 5);
  y += 10;

  /* Função interna: monta tabela de NPS por campo de segmentação */
  function renderSegmentacao(campo, subTitulo) {
    y = checkY(doc, y, 12, 'Segmentações');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    fc(doc, C.azulMedio, 'text');
    doc.text(subTitulo, PG.ml, y + 5);
    y += 9;

    var grupos = {};
    data.filter(pRespValida).forEach(function(d) {
      var val = (d[campo] || '').trim() || 'Nao informado';
      if (!grupos[val]) grupos[val] = [];
      grupos[val].push(d);
    });

    var groupList = Object.keys(grupos).filter(function(g){ return g !== 'Nao informado'; }).sort();

    if (!groupList.length) {
      y = pilula(doc, y, 'Campo não disponível para segmentação neste escopo.', C.cinzaMedio, 'Segmentações');
      return;
    }

    var rows = groupList.map(function(g) {
      var resps = grupos[g];
      var total = resps.length;
      var prom  = resps.filter(function(x){ return x.categoria === 'PROMOTOR';  }).length;
      var det   = resps.filter(function(x){ return x.categoria === 'DETRATOR';  }).length;
      var neut  = total - prom - det;
      var nps   = total > 0 ? Math.round((prom/total)*100 - (det/total)*100) : 0;
      return [S(g), String(total), String(prom), String(neut), String(det), String(nps)];
    });

    rows.sort(function(a, b){ return (parseInt(b[1])||0) - (parseInt(a[1])||0); });

    /* Cols somam PG.cw = 182 mm */
    y = tabela(doc, y,
      ['Grupo', 'Respostas', 'Promotores', 'Neutros', 'Detratores', 'NPS'],
      rows, 'Segmentações',
      [76, 22, 22, 20, 22, 20]);
  }

  renderSegmentacao('tipo_servico',    '5.2.1  NPS por Tipo de Servico');
  y += 6;
  renderSegmentacao('segmento_cliente', '5.2.2  NPS por Segmento');

  /* 5.3 Incidência de Resposta */
  y = checkY(doc, y, 12, 'Segmentações');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  fc(doc, C.azulMedio, 'text');
  doc.text('5.3 Análise de Incidência de Resposta', PG.ml, y + 5);
  y += 10;

  var resp = m.projetosRespondidos;
  var totalU = m.totalProjetosUnicos;
  var naoResp = totalU - resp;
  var pct = m.percentualProjetos;
  var faltou = 75 - pct;

  var textoResp = 'De ' + totalU + ' projetos únicos mapeados, ' + resp + ' responderam ao ciclo (' +
    pct + '%). ' + naoResp + ' projetos não responderam. ' +
    (pct >= 75
      ? 'A meta de 75% foi atingida, demonstrando boa adesão ao ciclo avaliativo.'
      : 'A meta de 75% não foi atingida — faltaram ' + faltou + ' pontos percentuais. ' +
        'Os ' + naoResp + ' projetos pendentes devem ser priorizados no próximo ciclo.');

  y = pilula(doc, y, textoResp, pct >= 75 ? C.verde : C.vermelho, 'Segmentações');

  y = checkY(doc, y, 25, 'Segmentações');
  var bw2 = (PG.cw - 6) / 2;
  [
    { l: 'Projetos Respondidos', n: resp,    pct: pct,                                         cor: C.verde },
    { l: 'Projetos Pendentes',   n: naoResp, pct: totalU > 0 ? Math.round((naoResp / totalU) * 100) : 0, cor: C.vermelho }
  ].forEach(function (item, i) {
    var bx = PG.ml + i * (bw2 + 6);
    y = checkY(doc, y, 20, 'Segmentações');
    fc(doc, C.offWhite);
    doc.roundedRect(bx, y, bw2, 18, 2, 2, 'F');
    fc(doc, item.cor);
    doc.roundedRect(bx, y, 3, 18, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    fc(doc, item.cor, 'text');
    doc.text(String(item.n), bx + 7, y + 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    fc(doc, C.cinzaMedio, 'text');
    doc.text(item.l + ' (' + item.pct + '%)', bx + 7, y + 15.5);
  });
}

/* ============================================================
   6. CLIENTES QUE RESPONDERAM E NÃO RESPONDERAM
============================================================ */
function pgClientesResposta(doc, data, liderLogado) {
  var titulo = 'Clientes que responderam e não responderam';
  var y = novaPagina(doc, titulo);
  y = secao(doc, y, titulo);

  var api = _api;
  var projetos = _projetosFiltrados !== null ? _projetosFiltrados : (api ? api.getDadosProjetos() : []);
  var mapping  = api ? api.getMAPPING()       : [];

  /* Universo de projetos: projetos_nps > MAPPING (fallback) */
  var universo = [];
  if (projetos.length) {
    universo = liderLogado
      ? projetos.filter(function(p){ return normalizar(p.lider_atual || p.lider) === normalizar(liderLogado); })
      : projetos;
  } else {
    var mSrc = liderLogado ? mapping.filter(function(m){ return normalizar(m.lider) === normalizar(liderLogado); }) : mapping;
    universo = mSrc.map(function(m){ return { ciclo: '', cliente: m.cliente, projeto: m.projeto, lider: m.lider, classe_contratual: '', tipo_servico: '', codigo_clockify: '' }; });
  }

  /* Respondidos: keyed pela chave de contagem herdada do projeto vinculado */
  var respondidosMap = {};
  data.filter(pRespValida).forEach(function (d) {
    var key = d._projetoContagemKey;
    if (!key) return;
    if (!respondidosMap[key]) {
      respondidosMap[key] = {
        ciclo: d.ciclo || '-', cliente: d.cliente || '-', projeto: d.projeto || '-',
        lider: d.lider || '-', classe_contratual: d.classe_contratual || '-',
        tipo_servico: d.tipo_servico || '-', codigo_clockify: d.codigo_clockify || '-',
        qtd: 0
      };
    }
    respondidosMap[key].qtd++;
  });

  /* Universo único keyed por projetoKey (ciclo||clockify) */
  var universoUnicos = {};
  universo.forEach(function(p) {
    var key = projetoKey(p);
    if (!key || key === '||') return;
    if (!universoUnicos[key]) universoUnicos[key] = {
      ciclo: p.ciclo || '-', cliente: p.cliente || '-', projeto: p.projeto || '-',
      lider: p.lider || '-', classe_contratual: p.classe_contratual || '-',
      tipo_servico: p.tipo_servico || '-', codigo_clockify: p.codigo_clockify || '-'
    };
  });

  var sortFn = function(a,b){ return (a.cliente+'|'+a.projeto).localeCompare(b.cliente+'|'+b.projeto); };

  var respondidosList = Object.keys(respondidosMap)
    .map(function(k){ return respondidosMap[k]; }).sort(sortFn);

  var naoRespondidosList = Object.keys(universoUnicos)
    .filter(function(k){ return !respondidosMap[k]; })
    .map(function(k){ return universoUnicos[k]; }).sort(sortFn);

  /* --- Bloco A: Respondidos --- */
  y = checkY(doc, y, 14, titulo);
  fc(doc, [213, 245, 200]);
  doc.roundedRect(PG.ml, y, PG.cw, 10, 2, 2, 'F');
  fc(doc, C.verde);
  doc.roundedRect(PG.ml, y, 3, 10, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  fc(doc, C.verde, 'text');
  doc.text('A) Projetos que responderam (' + respondidosList.length + ')', PG.ml + 8, y + 6.8);
  y += 14;

  if (respondidosList.length) {
    if (liderLogado) {
      y = tabela(doc, y,
        ['Ciclo', 'Cliente', 'Projeto', 'Líder', 'Cod. Clockify', 'Respostas'],
        respondidosList.map(function(r){
          return [S(r.ciclo), S(r.cliente), S(r.projeto), S(r.lider), S(r.codigo_clockify), String(r.qtd)];
        }),
        titulo, [16, 38, 58, 34, 22, 14]);
    } else {
      y = tabela(doc, y,
        ['Ciclo', 'Cliente', 'Projeto', 'Líder', 'Classe', 'Respostas'],
        respondidosList.map(function(r){
          return [S(r.ciclo), S(r.cliente), S(r.projeto), S(r.lider), S(r.classe_contratual), String(r.qtd)];
        }),
        titulo, [16, 34, 56, 34, 18, 24]);
    }
  } else {
    y = pilula(doc, y, 'Nenhum projeto respondeu neste ciclo.', C.cinzaMedio, titulo);
  }

  /* --- Bloco B: Não respondidos --- */
  y = checkY(doc, y, 18, titulo);
  y += 4;
  fc(doc, [255, 228, 228]);
  doc.roundedRect(PG.ml, y, PG.cw, 10, 2, 2, 'F');
  fc(doc, C.vermelho);
  doc.roundedRect(PG.ml, y, 3, 10, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  fc(doc, C.vermelho, 'text');
  doc.text('B) Projetos que não responderam (' + naoRespondidosList.length + ')', PG.ml + 8, y + 6.8);
  y += 14;

  if (naoRespondidosList.length) {
    if (liderLogado) {
      y = tabela(doc, y,
        ['Ciclo', 'Cliente', 'Projeto', 'Líder', 'Cod. Clockify', 'Status'],
        naoRespondidosList.map(function(r){
          return [S(r.ciclo), S(r.cliente), S(r.projeto), S(r.lider), S(r.codigo_clockify), 'Nao respondeu'];
        }),
        titulo, [16, 38, 58, 34, 22, 14]);
    } else {
      y = tabela(doc, y,
        ['Ciclo', 'Cliente', 'Projeto', 'Líder', 'Classe', 'Status'],
        naoRespondidosList.map(function(r){
          return [S(r.ciclo), S(r.cliente), S(r.projeto), S(r.lider), S(r.classe_contratual), 'Nao respondeu'];
        }),
        titulo, [16, 34, 56, 34, 18, 24]);
    }
  } else {
    y = pilula(doc, y, 'Todos os projetos do universo responderam neste ciclo!', C.verde, titulo);
  }
}

/* ============================================================
   7. CANAIS
============================================================ */
function pgCanais(doc, data, m) {
  var y = novaPagina(doc, 'Análise de Canais e Momentos de Resposta');
  y = secao(doc, y, 'Análise de Canais e Momentos de Resposta');

  var total = m.totalEmail + m.totalWhatsApp;

  if (!total) {
    y = pilula(doc, y,
      'Não há informação de canal de resposta disponível na base atual. ' +
      'Para habilitar esta análise, o campo "origem" deve estar preenchido ' +
      'nas respostas (valores esperados: EMAIL ou WHATSAPP).',
      C.cinzaMedio, 'Canais');
    return;
  }

  var pctEmail = total > 0 ? Math.round((m.totalEmail / total) * 100) : 0;
  var pctWA    = total > 0 ? Math.round((m.totalWhatsApp / total) * 100) : 0;

  var kw = (PG.cw - 6) / 2;
  kpiBox(doc, PG.ml,       y, kw, 26, 'Email',     m.totalEmail,    'Respostas via PMO - envio centralizado', C.azulMedio,    undefined);
  kpiBox(doc, PG.ml + kw + 6, y, kw, 26, 'WhatsApp', m.totalWhatsApp, 'Respostas via Líderes de projeto',       [37, 211, 102], undefined);
  y += 32;

  y = secao(doc, y, 'Distribuição por Canal');
  [
    { l: 'Email',     n: m.totalEmail,    pct: pctEmail, cor: C.azulMedio    },
    { l: 'WhatsApp', n: m.totalWhatsApp, pct: pctWA,    cor: [37, 211, 102] }
  ].forEach(function (ch) {
    y = checkY(doc, y, 16, 'Canais');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    fc(doc, C.cinzaEscuro, 'text');
    doc.text(ch.l, PG.ml, y + 3.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    fc(doc, C.cinzaMedio, 'text');
    doc.text(ch.n + ' respostas (' + ch.pct + '%)', PG.w - PG.mr, y + 3.5, { align: 'right' });
    barra(doc, PG.ml, y + 5.5, PG.cw, 5.5, ch.pct, ch.cor);
    y += 14;
  });

  y += 4;
  var textoCanal = 'O ciclo contou com ' + total + ' respostas coletadas por dois canais: ' +
    m.totalEmail + ' via Email (' + pctEmail + '%), envios centralizados pelo PMO, e ' +
    m.totalWhatsApp + ' WhatsApp (' + pctWA + '%), pelos líderes de projeto. ' +
    (pctWA > pctEmail
      ? 'O canal WhatsApp foi predominante neste ciclo, indicando maior engajamento dos líderes no processo de coleta.'
      : pctEmail > pctWA
        ? 'O canal Email foi o principal meio de coleta neste ciclo.'
        : 'Os dois canais apresentaram volumes similares de coleta.') +
    ' A diversificação de canais amplia o alcance e a representatividade da pesquisa.';
  y = pilula(doc, y, textoCanal, C.azulMedio, 'Canais');
}

/* ============================================================
   7. QUADRO DE NPS DE CLIENTES E RESPOSTAS
============================================================ */
function pgQuadroRespostas(doc, data) {
  var titulo = 'Quadro de NPS de Clientes e Respostas';
  var y = novaPagina(doc, titulo);
  y = secao(doc, y, 'Quadro de NPS de Clientes e Respostas');

  /* Widths somam PG.cw = 182mm: Nome 32, Cliente 26, Líder 20, Projeto 36,
     Q1–Q4 8 cada, Categoria 20, Canal 16 */
  y = tabela(doc, y,
    ['Nome', 'Cliente', 'Líder', 'Projeto', 'Q1', 'Q2', 'Q3', 'Q4', 'Categoria', 'Canal'],
    data.map(function(d) {
      return [
        S(d.identificador || '-'),
        S(d.cliente || '-'),
        S(d.lider || '-'),
        S(d.projeto || '-'),
        String(d.nota_q1 != null ? d.nota_q1 : '-'),
        String(d.nota_q2 != null ? d.nota_q2 : '-'),
        String(d.nota_q3 != null ? d.nota_q3 : '-'),
        String(d.nota_q4 != null ? d.nota_q4 : '-'),
        S(d.categoria || '-'),
        S(labelCanal(d.origem))
      ];
    }),
    titulo,
    [32, 26, 20, 36, 8, 8, 8, 8, 20, 16],
    { fontSize: 6 }
  );
}

/* ============================================================
   8. METAS E PERFORMANCE
============================================================ */
function pgMetas(doc, m) {
  var y = novaPagina(doc, 'Metas e Performance');
  y = secao(doc, y, 'Metas e Performance Estratégica');

  var kw = (PG.cw - 6) / 2;
  kpiBox(doc, PG.ml,         y, kw, 27, 'NPS Atual',         m.nps,                      labelNPS(m.nps),                                    corNPS(m.nps),  m.nps >= 90);
  kpiBox(doc, PG.ml + kw + 6, y, kw, 27, 'Taxa de Resposta', m.percentualProjetos + '%', m.projetosRespondidos + '/' + m.totalProjetosUnicos + ' proj.', C.azulMedio, m.percentualProjetos >= 75);
  y += 33;

  /* ----------------------------------------------------------------
     Função interna: desenha um card de meta com altura DINÂMICA
     para que o texto de análise nunca extrapole a caixa.
  ---------------------------------------------------------------- */
  function cardMeta(doc, y, titulo, badgeOK, badgeCor, infoTxt, barPct, goalPct, analysisTxt, cor) {
    var innerW = PG.cw - 20; /* largura disponível para textos internos */

    /* pré-calcula as linhas para saber a altura necessária */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    var infoLines = doc.splitTextToSize(infoTxt, innerW);
    var anlLines  = doc.splitTextToSize(analysisTxt, innerW);

    /* layout fixo interno:
       8  = título
       4  = espaço após título
       infoLines.h = info (wrapped)
       4  = espaço
       6  = barra
       8  = label META abaixo da barra
       4  = espaço
       anlLines.h = análise (wrapped)
       7  = padding inferior */
    var lhInfo = infoLines.length * 4.3;
    var lhAnl  = anlLines.length  * 4.3;
    var cardH  = 8 + 4 + lhInfo + 4 + 6 + 8 + 4 + lhAnl + 7;
    cardH = Math.max(cardH, 50); /* altura mínima */

    y = checkY(doc, y, cardH + 8, 'Metas');

    /* fundo e borda lateral */
    fc(doc, C.offWhite);
    doc.roundedRect(PG.ml, y, PG.cw, cardH, 2.5, 2.5, 'F');
    fc(doc, cor);
    doc.roundedRect(PG.ml, y, 3.5, cardH, 2, 2, 'F');

    /* título */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    fc(doc, C.cinzaEscuro, 'text');
    doc.text(titulo, PG.ml + 8, y + 8);

    /* badge */
    fc(doc, badgeOK ? [213, 245, 200] : [255, 228, 228]);
    doc.roundedRect(PG.w - PG.mr - 42, y + 3, 42, 7.5, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    fc(doc, badgeCor, 'text');
    doc.text(badgeOK ? 'META ATINGIDA' : 'ABAIXO DA META', PG.w - PG.mr - 21, y + 7.8, { align: 'center' });

    /* info (com wrap) */
    var cy = y + 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    fc(doc, C.cinzaMedio, 'text');
    doc.text(infoLines, PG.ml + 8, cy);
    cy += lhInfo + 4;

    /* barra de progresso */
    barra(doc, PG.ml + 8, cy, PG.cw - 16, 6, barPct, cor);
    var gxMeta = PG.ml + 8 + (goalPct / 100) * (PG.cw - 16);
    fc(doc, C.branco, 'draw');
    doc.setLineWidth(1);
    doc.line(gxMeta, cy - 1, gxMeta, cy + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5);
    fc(doc, C.cinzaMedio, 'text');
    doc.text('META', gxMeta, cy + 11, { align: 'center' });
    cy += 6 + 8 + 4;

    /* texto de análise (com wrap, dentro da caixa) */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    fc(doc, C.cinzaEscuro, 'text');
    doc.text(anlLines, PG.ml + 8, cy);

    return y + cardH + 8;
  }

  /* Meta NPS */
  var npsOK  = m.nps >= 90;
  var npsCol = npsOK ? C.verde : C.laranja;

  var textoNPS = npsOK
    ? 'NPS de ' + m.nps + ' pontos supera a meta de 90 (' + labelNPS(m.nps) + '). ' +
      'Alta lealdade e forte propensão à recomendação entre os clientes pesquisados.'
    : 'NPS de ' + m.nps + ' pontos esta ' + (90 - m.nps) + ' pontos abaixo da meta de 90 (' +
      labelNPS(m.nps) + '). Recomenda-se estruturar plano de ação focado nas dimensões ' +
      'de menor desempenho para elevar o índice no próximo ciclo.';

  var npsPct = Math.max(0, Math.min(((m.nps + 100) / 200) * 100, 100));
  /* marcador da meta de 90 na escala -100..+100 */
  var npsGoalPct = (190 / 200) * 100;

  y = cardMeta(doc, y,
    'Meta 1 - Indice NPS >= 90 pontos',
    npsOK, npsCol,
    'Escala: -100 a +100   |   Atual: ' + m.nps + '   |   Meta: 90   |   Diferença: ' + (m.nps - 90),
    npsPct, npsGoalPct,
    textoNPS, npsCol);

  /* Meta Taxa */
  var respOK  = m.percentualProjetos >= 75;
  var respCol = respOK ? C.verde : C.vermelho;

  var textoTaxa = respOK
    ? 'Taxa de resposta de ' + m.percentualProjetos + '% supera a meta de 75%. ' +
      m.projetosRespondidos + ' dos ' + m.totalProjetosUnicos + ' projetos únicos participaram, demonstrando boa adesão ao ciclo.'
    : 'A taxa de resposta atual foi de ' + m.percentualProjetos + '%, ficando ' +
      (75 - m.percentualProjetos) + ' pontos percentuais abaixo da meta de 75%. De ' +
      m.totalProjetosUnicos + ' projetos únicos, ' + m.projetosRespondidos + ' responderam. Os ' +
      (m.totalProjetosUnicos - m.projetosRespondidos) + ' projetos restantes precisam ser contactados para ampliar a representatividade do ciclo.';

  y = cardMeta(doc, y,
    'Meta 2 - Taxa de Resposta >= 75% dos Projetos Unicos',
    respOK, respCol,
    'Atual: ' + m.percentualProjetos + '%   |   Meta: 75%   |   ' +
      m.projetosRespondidos + '/' + m.totalProjetosUnicos + ' projetos   |   Diferença: ' + (m.percentualProjetos - 75) + '%',
    m.percentualProjetos, 75,
    textoTaxa, respCol);
}

/* ============================================================
   9. DETALHAMENTO POR DIMENSÃO
============================================================ */
function pgDimensoes(doc, m) {
  var y = novaPagina(doc, 'Detalhamento por Dimensão');
  y = secao(doc, y, 'Detalhamento por Dimensão');

  var dims = [
    { q: 'Q1', nome: 'Nota Técnica / Desempenho',  desc: 'Avalia a qualidade técnica do trabalho entregue pela Seteg. Reflete o domínio técnico, precisão e resultado das entregas.', k: 'Q1' },
    { q: 'Q2', nome: 'Relacionamento',               desc: 'Mede o nível de satisfação com o relacionamento com a equipe Seteg. Inclui proatividade, atenção e responsividade.', k: 'Q2' },
    { q: 'Q3', nome: 'Comunicação',                  desc: 'Avalia a efetividade da comunicação e dos canais de acesso à Seteg. Clareza, frequência e qualidade das informações.', k: 'Q3' },
    { q: 'Q4', nome: 'Indicação (NPS)',               desc: 'Pergunta-chave para o cálculo do índice NPS. Propensão do cliente a recomendar a Seteg. Base de todo o índice NPS.', k: 'Q4' }
  ];

  dims.forEach(function (d) {
    var score = parseFloat(m.porPergunta[d.k]);
    var pct   = (score / 10) * 100;
    var cor   = score >= 8 ? C.verde : score >= 6 ? C.amarelo : C.vermelho;
    var lbl   = labelScore(score);

    y = checkY(doc, y, 36, 'Dimensões');
    fc(doc, C.offWhite);
    doc.roundedRect(PG.ml, y, PG.cw, 31, 2, 2, 'F');
    fc(doc, cor);
    doc.roundedRect(PG.ml, y, 3, 31, 1.5, 1.5, 'F');

    fc(doc, cor);
    doc.roundedRect(PG.w - PG.mr - 30, y + 3, 30, 7, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    fc(doc, C.branco, 'text');
    doc.text(lbl.toUpperCase(), PG.w - PG.mr - 15, y + 7.5, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    fc(doc, C.cinzaEscuro, 'text');
    doc.text(d.q + ' - ' + d.nome, PG.ml + 7, y + 7);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    fc(doc, cor, 'text');
    doc.text(score.toFixed(1) + '/10', PG.ml + 7, y + 17);

    barra(doc, PG.ml + 7, y + 19.5, PG.cw - 14, 4.5, pct, cor);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    fc(doc, C.cinzaMedio, 'text');
    var dls = doc.splitTextToSize(d.desc, PG.cw - 20);
    doc.text(dls, PG.ml + 7, y + 27);

    y += 35;
  });

  /* Análise textual */
  var scores = dims.map(function (d) { return { nome: d.nome, v: parseFloat(m.porPergunta[d.k]) }; });
  var melhor = scores.reduce(function (a, b) { return a.v >= b.v ? a : b; });
  var pior   = scores.reduce(function (a, b) { return a.v <= b.v ? a : b; });
  var textoD = 'A melhor dimensão do ciclo foi "' + melhor.nome + '" com score ' + melhor.v.toFixed(1) + '/10 (' + labelScore(melhor.v) + '). ' +
    'A dimensão que mais necessita de atenção é "' + pior.nome + '" com score ' + pior.v.toFixed(1) + '/10 (' + labelScore(pior.v) + '). ' +
    (pior.v < 6 ? 'Resultado crítico — ação imediata recomendada para elevar este indicador.' :
     pior.v < 8 ? 'Há margem significativa de melhoria nesta dimensão.' :
     'O desempenho geral das dimensões está dentro do esperado.');
  y = pilula(doc, y, textoD, C.azulMedio, 'Dimensões');

  /* Tabela resumo */
  y = tabela(doc, y,
    ['Dimensão', 'Questão', 'Score', 'Classificação'],
    [
      ['Nota Técnica',      'Q1', parseFloat(m.porPergunta.Q1).toFixed(1) + '/10', labelScore(parseFloat(m.porPergunta.Q1))],
      ['Relacionamento',    'Q2', parseFloat(m.porPergunta.Q2).toFixed(1) + '/10', labelScore(parseFloat(m.porPergunta.Q2))],
      ['Comunicação',       'Q3', parseFloat(m.porPergunta.Q3).toFixed(1) + '/10', labelScore(parseFloat(m.porPergunta.Q3))],
      ['Indicação (NPS)',   'Q4', parseFloat(m.porPergunta.Q4).toFixed(1) + '/10', labelScore(parseFloat(m.porPergunta.Q4))]
    ],
    'Dimensões', null);
}

/* ============================================================
   10. ANÁLISE GERAL
============================================================ */
function pgAnaliseGeral(doc, data, m, isFiltrado, filtros, liderLogado) {
  var y = novaPagina(doc, 'Análise Geral');
  y = secao(doc, y, 'Análise Geral do Ciclo');

  var total = m.promotores + m.neutros + m.detratores;
  var pp    = total > 0 ? Math.round((m.promotores / total) * 100) : 0;
  var pd    = total > 0 ? Math.round((m.detratores / total) * 100) : 0;
  var pn    = 100 - pp - pd;

  var cicloTexto = 'Ciclos ' + _cicloAnterior + ' e ' + _cicloAtual;
  filtros.forEach(function(f){ if (f.indexOf('Ciclo:') === 0) cicloTexto = f; });
  var textoGeral =
    cicloTexto + ': ' + total + ' respostas de ' +
    m.projetosRespondidos + ' projetos únicos, representando ' + m.percentualProjetos +
    '% dos ' + m.totalProjetosUnicos + ' projetos do universo. ' +
    (isFiltrado && filtros.length ? 'Análise segmentada com filtros: ' + filtros.join(', ') + '. ' : '') +
    'O NPS apurado foi ' + m.nps + ' pontos (' + labelNPS(m.nps) + '), ' +
    (m.nps >= 90 ? 'atingindo' : 'abaixo de') + ' a meta de 90 pontos. ' +
    'Composição: ' + pp + '% Promotores, ' + pn + '% Neutros, ' + pd + '% Detratores. ' +
    'Média geral: ' + m.mediaGeral + '/10. ' +
    'Médias: Q1 ' + parseFloat(m.porPergunta.Q1).toFixed(1) +
    ', Q2 ' + parseFloat(m.porPergunta.Q2).toFixed(1) +
    ', Q3 ' + parseFloat(m.porPergunta.Q3).toFixed(1) +
    ', Q4 ' + parseFloat(m.porPergunta.Q4).toFixed(1) + ' (escala 0-10).';

  y = pilula(doc, y, textoGeral, C.azulMedio, 'Análise');

  /* Distribuição */
  y = checkY(doc, y, 15, 'Análise');
  y = secao(doc, y, 'Distribuição dos Respondentes');
  [
    { l: 'Promotores (notas 9-10)',         n: m.promotores, cor: C.verde,    pct: pp },
    { l: 'Neutros / Passivos (notas 7-8)',  n: m.neutros,    cor: C.amarelo,  pct: pn },
    { l: 'Detratores (notas 0-6)',           n: m.detratores, cor: C.vermelho, pct: pd }
  ].forEach(function (cat) {
    y = checkY(doc, y, 14, 'Análise');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    fc(doc, cat.cor, 'text');
    doc.text(cat.l, PG.ml, y + 3.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    fc(doc, C.cinzaMedio, 'text');
    doc.text(cat.n + ' (' + cat.pct + '%)', PG.w - PG.mr, y + 3.5, { align: 'right' });
    barra(doc, PG.ml, y + 5.5, PG.cw, 5, cat.pct, cat.cor);
    y += 13;
  });

  /* Por líder — colunas: Líder, Projetos, Responderam, Não Responderam, Taxa%, NPS */
  var api2     = _api;
  var projLid  = _projetosFiltrados !== null ? _projetosFiltrados : (api2 ? api2.getDadosProjetos() : []);

  var lideresObj = {};
  projLid.forEach(function(p){ if (p.lider_atual && p.lider_atual !== 'N/A') lideresObj[p.lider_atual] = true; });
  data.filter(function(d){ return d.lider && d.lider !== 'N/A'; }).forEach(function(d){ lideresObj[d.lider_atual||d.lider] = true; });
  var lideres = Object.keys(lideresObj).sort();

  if (lideres.length) {
    y = checkY(doc, y, 15, 'Análise');
    y += 5;
    y = secao(doc, y, liderLogado ? 'Resultado do Líder' : 'Resultado por Líder');

    var lRawRows = lideres.map(function(l) {
      var normL    = normalizar(l);
      var projsL   = projLid.filter(function(p){ return normalizar(p.lider_atual||p.lider) === normL; });
      var projKeys = new Set(projsL.map(function(p){ return projetoKey(p); }).filter(function(k){ return k && k !== '||'; }));
      var totalProj = projKeys.size;

      var respL = data.filter(pRespValida).filter(function(d){
        return normalizar(d.lider_atual||d.lider) === normL && d._projetoContagemKey && projKeys.has(d._projetoContagemKey);
      });
      var respKeys  = new Set(respL.map(function(d){ return d._projetoContagemKey; }));
      var responderam    = respKeys.size;
      var naoResponderam = totalProj - responderam;
      var taxa = totalProj > 0 ? Math.round((responderam / totalProj) * 100) : 0;
      var t   = respL.length;
      var lp  = respL.filter(function(d){ return d.categoria === 'PROMOTOR'; }).length;
      var ld2 = respL.filter(function(d){ return d.categoria === 'DETRATOR'; }).length;
      var nps = t > 0 ? Math.round((lp / t) * 100 - (ld2 / t) * 100) : 0;
      return { lider: l, totalProj: totalProj, responderam: responderam, naoResponderam: naoResponderam, taxa: taxa, nps: nps };
    }).sort(function(a, b){ return b.taxa !== a.taxa ? b.taxa - a.taxa : a.lider.localeCompare(b.lider); });

    var lRows = lRawRows.map(function(r){
      return [S(r.lider), String(r.totalProj), String(r.responderam), String(r.naoResponderam), r.taxa + '%', String(r.nps)];
    });

    y = tabela(doc, y,
      ['Lider', 'Projetos', 'Responderam', 'Nao Responderam', 'Taxa%', 'NPS'],
      lRows, 'Análise', null) + 3;

    /* Cards melhor/pior — somente líderes com ao menos 1 resposta válida */
    var comRespostas = lRawRows.filter(function(r){ return r.responderam > 0; });
    if (comRespostas.length >= 1) {
      var melhorRaw = comRespostas.slice().sort(function(a, b){
        return b.nps !== a.nps ? b.nps - a.nps : b.taxa - a.taxa;
      })[0];
      var piorRaw = comRespostas.slice().sort(function(a, b){
        return a.nps !== b.nps ? a.nps - b.nps : a.taxa - b.taxa;
      })[0];

      var hw = (PG.cw - 5) / 2;
      y = checkY(doc, y, 20, 'Análise');

      fc(doc, [213, 245, 200]);
      doc.roundedRect(PG.ml, y, hw, 15, 2, 2, 'F');
      fc(doc, C.verde);
      doc.roundedRect(PG.ml, y, 3, 15, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      fc(doc, C.verde, 'text');
      doc.text('MELHOR RESULTADO', PG.ml + 6, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      fc(doc, C.cinzaEscuro, 'text');
      doc.text(S(melhorRaw.lider) + ' - NPS: ' + melhorRaw.nps + ' / Taxa: ' + melhorRaw.taxa + '%', PG.ml + 6, y + 11.5);

      if (piorRaw.lider !== melhorRaw.lider) {
        var ax = PG.ml + hw + 5;
        fc(doc, [255, 228, 228]);
        doc.roundedRect(ax, y, hw, 15, 2, 2, 'F');
        fc(doc, C.vermelho);
        doc.roundedRect(ax, y, 3, 15, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        fc(doc, C.vermelho, 'text');
        doc.text('PONTO DE ATENÇÃO', ax + 6, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        fc(doc, C.cinzaEscuro, 'text');
        doc.text(S(piorRaw.lider) + ' - NPS: ' + piorRaw.nps + ' / Taxa: ' + piorRaw.taxa + '%', ax + 6, y + 11.5);
      }
      y += 20;
    }

    /* Líderes sem adesão — apenas relatório geral */
    if (!liderLogado) {
      var semAdesao = lRawRows.filter(function(r){ return r.responderam === 0 && r.totalProj > 0; });
      if (semAdesao.length) {
        y = checkY(doc, y, 20, 'Análise');
        y += 5;
        y = secao(doc, y, 'Líderes sem Adesão', C.vermelho);
        var semRows = semAdesao.map(function(r){
          return [S(r.lider), String(r.totalProj), '0', '0%'];
        });
        y = tabela(doc, y,
          ['Lider', 'Projetos', 'Respostas', 'Taxa'],
          semRows, 'Análise', null);
      }
    }
  }
}

/* ============================================================
   11. RESUMO EXECUTIVO FINAL
============================================================ */
function pgResumo(doc, m, isFiltrado, filtros, isLider) {
  var y = novaPagina(doc, 'Resumo Executivo');
  y = secao(doc, y, 'Resumo Executivo');

  var npsOK  = m.nps >= 90;
  var respOK = m.percentualProjetos >= 75;
  var ambos  = npsOK && respOK;
  var nenhum = !npsOK && !respOK;
  var sitCol = ambos ? C.verde : nenhum ? C.vermelho : C.laranja;
  var sitLbl = ambos  ? 'CICLO DENTRO DAS METAS' :
               nenhum ? 'CICLO ABAIXO DAS METAS' :
                        'CICLO PARCIALMENTE DENTRO DAS METAS';

  fc(doc, sitCol);
  doc.roundedRect(PG.ml, y, PG.cw, 13, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  fc(doc, C.branco, 'text');
  doc.text(sitLbl, PG.w / 2, y + 9, { align: 'center' });
  y += 19;

  var total = m.promotores + m.neutros + m.detratores;

  var secs = [
    {
      titulo: 'Situação Geral',
      cor: C.azulMedio,
      itens: [
        (function(){ var cl='Ciclos: ' + _cicloAnterior + ' e ' + _cicloAtual; filtros.forEach(function(f){ if(f.indexOf('Ciclo:')===0) cl=f; }); return cl; })() +
          (isFiltrado && filtros.length ? '. Análise segmentada: ' + filtros.join(', ') + '.' : '. Análise completa de todos os projetos.'),
        total + ' respostas coletadas de ' + m.projetosRespondidos + ' projetos únicos (' + m.percentualProjetos + '% de participação).',
        'NPS apurado: ' + m.nps + ' pontos (' + labelNPS(m.nps) + '). Meta: >= 90 pontos.'
      ]
    },
    {
      titulo: 'Metas Atingidas',
      cor: C.verde,
      itens: [
        npsOK ? 'NPS de ' + m.nps + ' supera a meta de 90 - excelente nível de lealdade dos clientes.' : null
      ].filter(Boolean)
    },
    {
      titulo: 'Metas Não Atingidas',
      cor: C.vermelho,
      itens: [
        !npsOK  ? 'NPS de ' + m.nps + ' abaixo da meta de 90 (diferença: ' + (90 - m.nps) + ' pontos).' : null,
        !respOK ? 'Taxa de resposta ' + m.percentualProjetos + '% abaixo de 75% (' + (m.totalProjetosUnicos - m.projetosRespondidos) + ' projetos pendentes).' : null
      ].filter(Boolean)
    },
    {
      titulo: 'Principais Achados',
      cor: C.azulMedio,
      itens: [
        'Composição dos respondentes: ' + Math.round((m.promotores / Math.max(total, 1)) * 100) + '% Promotores, ' +
          Math.round((m.neutros / Math.max(total, 1)) * 100) + '% Neutros, ' +
          Math.round((m.detratores / Math.max(total, 1)) * 100) + '% Detratores.',
        m.totalEmail + ' respostas via Email e ' + m.totalWhatsApp + ' WhatsApp.'
      ]
    },
    {
      titulo: 'Recomendações',
      cor: C.laranja,
      itens: [
        'Realizar reuniões de devolutiva com líderes dos projetos com NPS abaixo de 50.',
        'Estabelecer plano de ação para os clientes classificados como Detratores, com acompanhamento em 30 dias.',
        !respOK ? 'Priorizar contato com os ' + (m.totalProjetosUnicos - m.projetosRespondidos) + ' projetos que não responderam antes do fechamento do ciclo.' :
          'Manter o esforço de coleta para sustentar a taxa acima de 75% nos próximos ciclos.',
        'Incorporar a análise de NPS na rotina de gestão de projetos como indicador de desempenho.'
      ]
    }
  ];

  /* Líder não vê recomendações gerenciais */
  if (isLider) {
    secs = secs.filter(function(sec) { return sec.titulo !== 'Recomendações'; });
  }

  secs.forEach(function (sec) {
    if (!sec.itens || !sec.itens.length) return;
    y = checkY(doc, y, 15 + sec.itens.length * 9, 'Resumo');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    fc(doc, sec.cor, 'text');
    doc.text(sec.titulo, PG.ml, y + 4.5);
    y += 9;
    sec.itens.forEach(function (item) {
      if (!item) return;
      y = checkY(doc, y, 10, 'Resumo');
      fc(doc, sec.cor);
      doc.circle(PG.ml + 2.5, y + 2.2, 1.3, 'F');
      var ls = doc.splitTextToSize(item, PG.cw - 11);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      fc(doc, C.cinzaEscuro, 'text');
      doc.text(ls, PG.ml + 7.5, y + 3.8);
      y += ls.length * 4.5 + 2.5;
    });
    y += 5;
  });

  y = checkY(doc, y, 20, 'Resumo');
  fc(doc, C.cinzaClaro, 'draw');
  doc.setLineWidth(0.3);
  doc.line(PG.ml, y, PG.w - PG.mr, y);
  y += 7;
  var disc = 'Este relatório foi gerado automaticamente pelo Dashboard NPS - Seteg Soluções Ambientais Ltda. ' +
    'Os dados refletem as informações disponíveis no momento da geração do documento.';
  var discLines = doc.splitTextToSize(disc, PG.cw);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  fc(doc, C.cinzaMedio, 'text');
  doc.text(discLines, PG.ml, y);
}

/* ============================================================
   PÁGINA FINAL — OBRIGADA
============================================================ */
function pgObrigada(doc) {
  doc.addPage();
  _pNum++;
  fc(doc, C.azulEscuro);
  doc.rect(0, 0, PG.w, PG.h, 'F');
  fc(doc, [12, 40, 95]);
  doc.circle(188, 55, 50, 'F');
  fc(doc, [5, 22, 58]);
  doc.circle(22, 245, 55, 'F');
  fc(doc, C.laranja);
  doc.rect(0, 100, 5, 97, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(52);
  fc(doc, C.branco, 'text');
  doc.text('Obrigada', PG.w / 2, 148, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  fc(doc, [175, 200, 225], 'text');
  doc.text('pela sua participação e confiança.', PG.w / 2, 163, { align: 'center' });
}

/* ============================================================
   MONTAGEM DO PDF
============================================================ */
function buildPDF(data, m, isFiltrado, filtros, liderLogado) {
  _pNum = 0;
  var doc = new _jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  var isLiderPDF = !!liderLogado;
  pgCapa(doc, m, isFiltrado, filtros, data.length, liderLogado);
  pgSumario(doc, isLiderPDF);
  pgMetodologia(doc);                                                        /* 1. Apresentação e Metodologia */
  pgResumo(doc, m, isFiltrado, filtros, isLiderPDF);                         /* 2. Resumo Executivo */
  if (!isLiderPDF) pgComparativoCiclos(doc, data, filtros);                  /* 3. Comparativo (gestão apenas) */
  if (!isLiderPDF) pgIncidenciaComparativa(doc, filtros);                    /* 4. Incidência Comparativa (gestão apenas) */
  if (!isLiderPDF) pgSegmentacoes(doc, data, m);                             /* 5. Segmentações (gestão apenas) */
  pgClientesResposta(doc, data, liderLogado);                                /* 5. Clientes respondidos e não respondidos */
  if (!isLiderPDF) pgCanais(doc, data, m);                                   /* 6. Canais (gestão apenas) */
  pgQuadroRespostas(doc, data);                                              /* 7. Quadro de Respostas */
  pgMetas(doc, m);                                                           /* 8. Metas e Performance */
  pgDimensoes(doc, m);                                                       /* 9. Detalhamento por Dimensão */
  pgAnaliseGeral(doc, data, m, isFiltrado, filtros, liderLogado);            /* 10. Análise Geral */
  pgObrigada(doc);                                                            /* Página final */

  var dateStr = new Date().toISOString().slice(0, 10);
  var sufixo = liderLogado
    ? 'lider_' + liderLogado.toLowerCase().replace(/\s+/g, '_')
    : (isFiltrado ? 'filtrado' : 'geral');
  doc.save('relatorio_nps_seteg_' + sufixo + '_' + dateStr + '.pdf');
}

/* ============================================================
   ENTRADA DO MODULO
============================================================ */

/**
 * Gera e baixa o relatorio PDF.
 *
 * @param {object} api            Fonte de dados do dashboard (ver DashboardClient).
 * @param {string[]} filtros      Filtros ativos, ja descritos em texto.
 * @param {string|null} lider     Nome do lider logado, ou null para o PMO.
 * @param {string[]} ciclos       [anterior, atual] — os dois ciclos comparados,
 *                                derivados dos dados. Nao ha ciclo fixo aqui.
 */
export async function exportarPDF(api, filtros, lider, ciclos) {
  _api = api;
  _cicloAnterior = (ciclos && ciclos[0]) || "";
  _cicloAtual = (ciclos && ciclos[ciclos.length - 1]) || "";

  // Importacao dinamica: o jsPDF (~350 KB) so e baixado no primeiro clique.
  const { jsPDF } = await import("jspdf");
  _jsPDF = jsPDF;

  try {
    var lista = filtros.slice();
    var dados;

    if (lider) {
      // Dupla garantia de que nada de outro lider entra no relatorio. O
      // recorte real ja veio do servidor; isto e cinto e suspensorio.
      dados = api.getDadosFiltrados().filter(function (d) {
        return normalizar(d.lider_atual || d.lider) === normalizar(lider);
      });
      lista = lista.filter(function (f) { return f.indexOf('Líder:') !== 0; });
      lista.unshift('Líder: ' + lider);
    } else {
      dados = lista.length ? api.getDadosFiltrados() : api.getDadosProcessados();
    }

    if (!dados || !dados.length) {
      throw new Error('Nenhum dado disponivel para exportar.');
    }

    // Aplica os mesmos filtros da tela ao universo de projetos, para que
    // totalPU, comparativo e respondidos/nao-respondidos batam com o painel.
    _projetosFiltrados = api.getDadosProjetos();
    lista.forEach(function (f) {
      var sep = f.indexOf(': ');
      if (sep < 0) return;
      var chave = f.slice(0, sep);
      var valor = f.slice(sep + 2).trim();
      if (chave === 'Ciclo') {
        _projetosFiltrados = _projetosFiltrados.filter(function (p) { return p.ciclo === valor; });
      } else if (chave === 'Líder') {
        _projetosFiltrados = _projetosFiltrados.filter(function (p) { return normalizar(p.lider_atual || p.lider) === normalizar(valor); });
      } else if (chave === 'Cliente') {
        _projetosFiltrados = _projetosFiltrados.filter(function (p) { return normalizar(p.cliente) === normalizar(valor); });
      } else if (chave === 'Classe') {
        _projetosFiltrados = _projetosFiltrados.filter(function (p) { return p.classe_contratual === valor; });
      } else if (chave === 'Tipo Serviço') {
        _projetosFiltrados = _projetosFiltrados.filter(function (p) { return p.tipo_servico === valor; });
      }
    });

    var m = calcMetricas(dados, lider || null);
    buildPDF(dados, m, lista.length > 0, lista, lider || null);
  } finally {
    // Sem isto, o recorte de um relatorio vazaria para o proximo.
    _projetosFiltrados = null;
    _api = null;
    _cicloAnterior = "";
    _cicloAtual = "";
  }
}
