"use client";

// O dashboard NPS.
//
// ── Onde cada coisa acontece agora ───────────────────────────────────────
//
// Servidor (lib/dashboard.ts): buscar, casar resposta com projeto, resolver
// canal/cliente/lider, decidir o lider atual. Roda uma vez por carga.
//
// Cliente (este arquivo): filtrar e somar. Roda a cada clique num select e
// por isso precisa ser instantaneo — mandar isso para o servidor custaria
// uma ida e volta de rede por filtro mexido.
//
// A divisao importa: antes TUDO era aqui, inclusive o casamento, que era
// refeito do zero sempre que os ciclos antigos chegavam em segundo plano.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BotaoSair } from "@/componentes/BotaoSair";
import { Icone } from "@/componentes/Icone";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi } from "@/lib/cliente/api";
import { cicloInicial } from "@/lib/cicloInicial";
import { calcularMetricas, rotuloDoCanal, type Projeto, type Resposta } from "@/lib/dashboard";
import type { Sessao } from "@/lib/cliente/tipos";
import { Comparativo } from "./Comparativo";
import { descreverFiltros, filtrarProjetos, filtrarRespostas, FILTROS_VAZIOS, montarOpcoes, type Filtros } from "./filtros";
import { Incidencia } from "./Incidencia";
import { IncidenciaComparativa } from "./IncidenciaComparativa";
import { Kpis } from "./Kpis";
import { LideresAdmin } from "./LideresAdmin";
import { Metas, Origem, Termometros } from "./Paineis";
import { ModalMetodologia } from "./ModalMetodologia";
import { TabelaRespostas } from "./TabelaRespostas";

type Conexao = "carregando" | "ok" | "erro";

interface RespostaProjetos {
  projetos: Projeto[];
  ciclos: { id: string; codigo: string; data_inicio: string | null }[];
  /** Quantas respostas existem em cada ciclo, no escopo de quem perguntou. */
  respostasPorCiclo: Record<string, number>;
}


interface RespostaRespostas {
  respostas: Resposta[];
}
interface Indicadores {
  isc_medio: number | null;
}

function Painel({
  titulo,
  icone,
  children,
  recolhivel = false,
  extra,
}: {
  titulo: React.ReactNode;
  icone: React.ReactNode;
  children: React.ReactNode;
  recolhivel?: boolean;
  extra?: React.ReactNode;
}) {
  const [recolhido, setRecolhido] = useState(false);
  const alternar = () => recolhivel && setRecolhido((r) => !r);

  return (
    <section
      className={`table-panel ${recolhivel ? "panel-collapsible" : ""} ${recolhido ? "panel-collapsed" : ""}`}
    >
      <div
        className={`table-header ${recolhivel ? "panel-header-toggle" : ""}`}
        role={recolhivel ? "button" : undefined}
        tabIndex={recolhivel ? 0 : undefined}
        aria-expanded={recolhivel ? !recolhido : undefined}
        onClick={alternar}
        onKeyDown={(e) => {
          if (recolhivel && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            alternar();
          }
        }}
      >
        <h2>
          <span className="section-icon">{icone}</span>
          {titulo}
        </h2>
        {extra}
        {recolhivel ? (
          <svg
            className="panel-collapse-arrow"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        ) : null}
      </div>
      {recolhivel ? (
        <div className="panel-collapsible-body">{recolhido ? null : children}</div>
      ) : (
        children
      )}
    </section>
  );
}

export function DashboardClient({ sessao }: { sessao: Sessao }) {
  const toast = useToast();
  const ehPmo = sessao.perfil === "pmo";

  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [conexao, setConexao] = useState<Conexao>("carregando");
  const [erroDados, setErroDados] = useState<string | null>(null);
  const [isc, setIsc] = useState<{ valor: number | null; carregado: boolean }>({
    valor: null,
    carregado: false,
  });
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [metodologiaAberta, setMetodologiaAberta] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  // ── Carregamento em tres fases ──────────────────────────────────────────
  //
  // 1. projetos       — leve, e o que define o universo e os filtros;
  // 2. ciclo recente  — a tela ja fica utilizavel com o que interessa hoje;
  // 3. ciclos antigos — em segundo plano, para o comparativo histórico.
  //
  // Sem a fase 3 separada, a primeira pintura esperaria o historico inteiro.
  //
  // ── Nao coloque uma trava `useRef` aqui ───────────────────────────────
  //
  // Ja houve uma, para "evitar a busca dupla do StrictMode", e ela travava a
  // tela em "Conectando..." com tudo zerado, em desenvolvimento:
  //
  //   monta    -> ref=true, ativo=true, a busca comeca
  //   desmonta -> cleanup: ativo=false            (StrictMode)
  //   remonta  -> a ref ja e true, o efeito retorna sem buscar
  //               e a busca da 1a montagem aborta em todo `if (!ativo)`
  //
  // Resultado: ninguem chama setConexao("ok"). A flag `ativo` abaixo ja e o
  // cancelamento correto — na segunda montagem ela e `true` de novo e a
  // busca conclui. A dupla execucao so acontece em desenvolvimento e custa
  // uma requisicao; travar a tela custa a tela.
  useEffect(() => {
    let ativo = true;

    (async () => {
      try {
        const {
          projetos: ps,
          ciclos: cadastroDeCiclos,
          respostasPorCiclo,
        } = await api.get<RespostaProjetos>("dashboard", { fase: "projetos" });
        if (!ativo) return;
        setProjetos(ps || []);

        const ciclos = [
          ...new Set((ps || []).map((p) => p.ciclo).filter((c): c is string => Boolean(c))),
        ].sort();

        // O código do ciclo vive nas participações; a data de início, no
        // cadastro. É por `codigo` que os dois se encontram.
        const inicioPorCiclo: Record<string, string | null> = {};
        for (const c of cadastroDeCiclos || []) inicioPorCiclo[c.codigo] = c.data_inicio;

        const cicloRecente = cicloInicial(ciclos, inicioPorCiclo, respostasPorCiclo || {});

        const { respostas: rs } = await api.get<RespostaRespostas>("dashboard", {
          fase: "respostas",
          ciclo: cicloRecente,
        });
        if (!ativo) return;

        setRespostas(rs || []);
        // O filtro de Ciclo abre em "Todos", e nao no ciclo corrente: o
        // painel deve mostrar tambem o que veio do ciclo anterior. Quem quer
        // olhar um semestre isolado usa o filtro.
        //
        // `cicloRecente` continua definindo a ORDEM do carregamento — as
        // respostas que mais interessam chegam primeiro, o histórico vem
        // logo atrás. Escolher o ciclo e escolher o que mostrar sao duas
        // decisoes diferentes, e antes estavam grudadas.
        setConexao("ok");
        setAtualizadoEm(new Date());

        // Fase 3, em segundo plano. Falhar aqui nao quebra a tela: so o
        // comparativo entre ciclos fica sem o historico.
        if (cicloRecente) {
          api
            .get<RespostaRespostas>("dashboard", {
              fase: "respostas",
              cicloExcluir: cicloRecente,
            })
            .then(({ respostas: antigas }) => {
              if (!ativo || !antigas?.length) return;
              setRespostas((atuais) => {
                const vistos = new Set(atuais.map((r) => r.id));
                const novas = antigas.filter((r) => !vistos.has(r.id));
                return novas.length ? [...atuais, ...novas] : atuais;
              });
            })
            .catch((e) => {
              console.warn("[NPS] ciclos anteriores indisponiveis:", e);
            });
        }
      } catch (e) {
        if (!ativo) return;
        setConexao("erro");
        setErroDados(e instanceof ErroApi ? e.message : "Falha ao carregar os dados.");
      }
    })();

    // ISC nao deriva das respostas: e o registro mensal do lider, buscado a
    // parte, e nunca entra no calculo do NPS.
    api
      .get<Indicadores>("operacao/indicadores")
      .then((ind) => {
        if (ativo) setIsc({ valor: ind?.isc_medio ?? null, carregado: true });
      })
      .catch(() => {
        if (ativo) setIsc({ valor: null, carregado: true });
      });

    return () => {
      ativo = false;
    };
  }, []);

  // ── Derivacoes ──────────────────────────────────────────────────────────

  const opcoes = useMemo(() => montarOpcoes(projetos, respostas), [projetos, respostas]);

  // Os dois ciclos mais recentes que existem nos dados. Alimentam os dois
  // paineis comparativos, que antes tinham "2025.2" e "2026.1" escritos no
  // codigo — e passariam a comparar dois semestres velhos assim que o ciclo
  // seguinte entrasse.
  const ciclosComparados = useMemo(() => opcoes.ciclos.slice(-2), [opcoes.ciclos]);
  const [cicloAnterior, cicloAtual] = [
    ciclosComparados[0] ?? "",
    ciclosComparados[ciclosComparados.length - 1] ?? "",
  ];

  const respostasFiltradas = useMemo(
    () => filtrarRespostas(respostas, filtros),
    [respostas, filtros]
  );
  const projetosEscopo = useMemo(() => filtrarProjetos(projetos, filtros), [projetos, filtros]);
  const metricas = useMemo(
    () => calcularMetricas(respostasFiltradas, projetosEscopo),
    [respostasFiltradas, projetosEscopo]
  );

  const mudar = useCallback((campo: keyof Filtros, valor: string) => {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  }, []);

  // ── Exportacoes ─────────────────────────────────────────────────────────

  function exportarCsv() {
    if (!respostasFiltradas.length) {
      toast("Nenhum dado para exportar.", "aviso");
      return;
    }

    const cabecalho = [
      "Nome", "Cliente", "Líder", "Projeto", "Q1", "Q2", "Q3", "Q4",
      "Categoria", "Ciclo", "Origem", "Feedback", "Data",
    ];
    // Aspas duplicadas: e assim que se escapa aspa dentro de campo em CSV.
    const campo = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const linhas = respostasFiltradas.map((r) =>
      [
        campo(r.identificador), campo(r.cliente), campo(r.lider), campo(r.projeto),
        r.nota_q1, r.nota_q2, r.nota_q3, r.nota_q4, r.categoria,
        campo(r.ciclo), rotuloDoCanal(r.canal), campo(r.feedback), r.timestamp,
      ].join(",")
    );

    // O BOM inicial faz o Excel abrir o arquivo em UTF-8; sem ele, acento vira
    // caractere estranho na maquina de quem recebe.
    const conteudo = `﻿${[cabecalho.join(","), ...linhas].join("\n")}`;
    const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `nps_seteg_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportarPdf() {
    if (!respostasFiltradas.length) {
      toast("Nenhum dado para exportar.", "aviso");
      return;
    }
    setGerandoPdf(true);
    try {
      // Importacao dinamica: o relatorio e o jsPDF juntos passam de 400 KB e
      // so sao baixados por quem clica aqui.
      const { exportarPDF } = await import("@/lib/cliente/pdfExport");
      await exportarPDF(
        {
          getDadosFiltrados: () => respostasFiltradas,
          getDadosProcessados: () => respostas,
          getDadosProjetos: () => projetos,
          // O relatorio herdou este parametro de quando havia uma tabela de
          // projetos embutida no codigo. Ela nao existe mais: projeto,
          // cliente e lider vem todos do banco. O PDF so o usava como
          // universo de reserva quando nao havia NENHUM projeto carregado,
          // situacao que nao ocorre.
          getMAPPING: () => [],
        },
        descreverFiltros(filtros),
        ehPmo ? null : sessao.nome,
        // Os mesmos dois ciclos dos paineis comparativos. O relatorio tinha
        // "2025.2" e "2026.1" escritos no codigo, inclusive na logica de
        // filtro — e seguiria comparando esses dois semestres para sempre.
        ciclosComparados
      );
    } catch (e) {
      console.error("[NPS] falha ao gerar PDF:", e);
      toast(e instanceof Error ? e.message : "Erro ao gerar o PDF.", "erro");
    } finally {
      setGerandoPdf(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const Select = ({
    id,
    rotulo,
    campo,
    itens,
    titulo,
    somentePmo = false,
    fixos,
  }: {
    id: string;
    rotulo: string;
    campo: keyof Filtros;
    itens?: string[];
    titulo?: string;
    somentePmo?: boolean;
    fixos?: { valor: string; rotulo: string }[];
  }) => {
    if (somentePmo && !ehPmo) return null;
    return (
      <div className="filter-group">
        <label htmlFor={id} title={titulo}>
          {rotulo}
        </label>
        <select id={id} value={filtros[campo]} onChange={(e) => mudar(campo, e.target.value)}>
          <option value="">Todos</option>
          {(fixos ?? (itens || []).map((i) => ({ valor: i, rotulo: i }))).map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div className="dashboard-content active">
      <header className="dashboard-header">
        <div className="header-left">
          <div className="header-title">
            <h1>Net Promoter Score - NPS</h1>
            <p>Monitoramento em tempo real</p>
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="btn-metodologia"
            onClick={() => setMetodologiaAberta(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 0 3-3h7z" />
            </svg>
            Metodologia
          </button>

          <div className="status-info">
            <span
              className="status-dot"
              style={{
                background:
                  conexao === "ok"
                    ? "var(--seteg-green)"
                    : conexao === "erro"
                      ? "var(--danger)"
                      : "var(--text-muted)",
              }}
            />
            <span
              style={{
                color:
                  conexao === "ok"
                    ? "var(--seteg-green)"
                    : conexao === "erro"
                      ? "var(--danger)"
                      : undefined,
              }}
            >
              {conexao === "ok" ? "Conectado" : conexao === "erro" ? "Erro de conexão" : "Conectando..."}
            </span>
          </div>

          <div className="last-update">
            <span className="update-label">Atualizado</span>
            <span>
              {atualizadoEm
                ? atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                : "--:--"}
            </span>
            <span>
              {atualizadoEm
                ? atualizadoEm.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
                : "--/--"}
            </span>
          </div>

          <BotaoSair className="btn-logout" titulo="Sair">
            <Icone nome="sair" tamanho={18} />
          </BotaoSair>
        </div>
      </header>

      <main className="dashboard-container">
        {erroDados ? (
          <div className="aviso-box perigo" style={{ marginBottom: 16 }}>
            <Icone nome="alerta" tamanho={16} />
            <div>{erroDados}</div>
          </div>
        ) : null}

        {!ehPmo ? <div className="welcome-lider">Bem-vindo, {sessao.nome}</div> : null}

        <section className={`filters-panel ${ehPmo ? "" : "filters-centered"}`}>
          <Select id="filter-ciclo" rotulo="Ciclo" campo="ciclo" itens={opcoes.ciclos} />
          <Select id="filter-cliente" rotulo="Cliente" campo="cliente" itens={opcoes.clientes} />
          {/* O lider nao escolhe lider: ele so tem a si proprio. */}
          {ehPmo ? (
            <Select id="filter-lider" rotulo="Líder" campo="lider" itens={opcoes.lideres} />
          ) : null}
          <Select id="filter-projeto" rotulo="Projeto" campo="projeto" itens={opcoes.projetos} />
          <Select
            id="filter-categoria"
            rotulo="Categoria"
            campo="categoria"
            fixos={[
              { valor: "PROMOTOR", rotulo: "Promotor" },
              { valor: "NEUTRO", rotulo: "Neutro" },
              { valor: "DETRATOR", rotulo: "Detrator" },
            ]}
          />
          <Select
            id="filter-classe"
            rotulo="Classe"
            campo="classe"
            somentePmo
            titulo="Classe Contratual — C ≤ R$50K · B ≤ R$250K · A > R$250K"
            fixos={[
              { valor: "A", rotulo: "A (acima de R$ 250 mil)" },
              { valor: "B", rotulo: "B (R$ 50 mil a R$ 250 mil)" },
              { valor: "C", rotulo: "C (até R$ 50 mil)" },
            ]}
          />
          <Select
            id="filter-tipo-servico"
            rotulo="Serviço"
            campo="tipoServico"
            somentePmo
            titulo="Tipo de Serviço"
            itens={opcoes.tiposServico}
          />
          <Select
            id="filter-segmento"
            rotulo="Segmento"
            campo="segmento"
            somentePmo
            titulo="Segmento do Cliente"
            itens={opcoes.segmentos}
          />
          <Select
            id="filter-canal"
            rotulo="Canal"
            campo="canal"
            titulo="Canal de Resposta"
            fixos={[
              { valor: "EMAIL (PMO)", rotulo: "Email" },
              { valor: "VIA LÍDER", rotulo: "WhatsApp" },
              { valor: "EMAIL", rotulo: "Email (legado)" },
              { valor: "WHATSAPP", rotulo: "WhatsApp (legado)" },
            ]}
          />

          <div className="filter-actions">
            <button
              type="button"
              className="btn-secondary"
              title="Limpar filtros"
              onClick={() => setFiltros(FILTROS_VAZIOS)}
            >
              <Icone nome="x" tamanho={13} />
              Limpar
            </button>
          </div>
        </section>

        <Kpis m={metricas} isc={isc} />

        <section className="analytics-row">
          <div className="analytics-card">
            <h2 className="panel-title">
              <span className="section-icon">
                <Icone nome="dashboard" tamanho={14} />
              </span>
              Metas Estratégicas
            </h2>
            <Metas m={metricas} />
          </div>

          <div className="analytics-card">
            <h2 className="panel-title">
              <span className="section-icon">
                <Icone nome="pesquisas" tamanho={14} />
              </span>
              Origem das Respostas
            </h2>
            <Origem m={metricas} />
          </div>

          <div className="analytics-card">
            <h2 className="panel-title">
              <span className="section-icon">
                <Icone nome="operacao" tamanho={14} />
              </span>
              Desempenho por Pergunta
            </h2>
            <Termometros m={metricas} />
          </div>
        </section>

        <Painel
          titulo={`Comparativo de Ciclos${
            ciclosComparados.length === 2 ? ` · ${cicloAnterior} → ${cicloAtual}` : ""
          }`}
          icone={<Icone nome="ciclos" tamanho={14} />}
        >
          <Comparativo
            respostas={respostas}
            projetos={projetos}
            ciclosComparados={ciclosComparados}
          />
        </Painel>

        {ehPmo ? (
          <Painel
            recolhivel
            titulo="Incidência Comparativa de Respostas"
            icone={<Icone nome="resultados" tamanho={14} />}
            extra={
              <span className="incidencia-comp-ciclos">
                {cicloAtual} × {cicloAnterior}
              </span>
            }
          >
            <IncidenciaComparativa
              respostas={respostas}
              projetos={projetos}
              filtros={filtros}
              anterior={cicloAnterior}
              atual={cicloAtual}
            />
          </Painel>
        ) : null}

        <Painel
          titulo="Incidência de Resposta · Respondidos e Não Respondidos"
          icone={<Icone nome="check" tamanho={14} />}
        >
          <Incidencia projetosEscopo={projetosEscopo} respostas={respostasFiltradas} />
        </Painel>

        {ehPmo ? (
          <Painel recolhivel titulo="Análise por Líder" icone={<Icone nome="lideres" tamanho={14} />}>
            <LideresAdmin projetosEscopo={projetosEscopo} respostas={respostasFiltradas} />
          </Painel>
        ) : null}

        <section className="table-panel">
          <div className="table-header">
            <h2>
              <span className="section-icon">
                <Icone nome="historico" tamanho={14} />
              </span>
              Respostas Detalhadas
            </h2>
            <div className="table-actions">
              <button type="button" className="btn-pdf" onClick={exportarPdf} disabled={gerandoPdf}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                {gerandoPdf ? "Gerando..." : "Exportar PDF"}
              </button>
              <button type="button" className="btn-primary" onClick={exportarCsv}>
                <Icone nome="baixar" tamanho={18} />
                Exportar CSV
              </button>
            </div>
          </div>

          {!respostasFiltradas.length && respostas.length ? (
            // Sem isto, "nenhuma resposta" e indistinguivel de "o sistema nao
            // leu o banco" — foi exatamente a leitura que o painel provocou
            // quando abriu num ciclo recem-criado.
            <div className="aviso-box info" style={{ margin: "14px 16px" }}>
              <Icone nome="info" tamanho={16} />
              <div>
                Nenhuma resposta neste recorte, mas há <strong>{respostas.length}</strong> no
                período carregado. Ajuste os filtros — o de <strong>Ciclo</strong> costuma ser o
                que esconde.
              </div>
            </div>
          ) : null}

          <TabelaRespostas dados={respostasFiltradas} />
        </section>
      </main>

      {metodologiaAberta ? (
        <ModalMetodologia aoFechar={() => setMetodologiaAberta(false)} />
      ) : null}
    </div>
  );
}
