"use client";

// Respostas dos ciclos: todas as respostas de NPS, com filtros por ciclo,
// cliente, lider (do periodo) e categoria, o resumo do recorte e o detalhe
// de cada resposta. Lider ve so as dos periodos em que liderou o projeto.

import { useMemo, useState } from "react";
import { ModalDetalhes } from "@/componentes/Detalhes";
import { BotaoAcao, type Coluna } from "@/componentes/Tabela";
import {
  BarraFiltros,
  CabecalhoTela,
  CorpoLista,
  FiltroBusca,
  FiltroSelect,
  Selo,
} from "@/componentes/Tela";
import { auxiliares, useAuxiliar } from "@/lib/cliente/auxiliares";
import { useLista } from "@/lib/cliente/useLista";
import { categoriaDaNota, formatarData, rotuloDoCanal } from "@/lib/formato";
import type { Sessao } from "@/lib/cliente/tipos";

interface Resposta extends Record<string, unknown> {
  id: string;
  identificador: string;
  respondente_nome: string | null;
  nota_q1: number | null;
  nota_q2: number | null;
  nota_q3: number | null;
  nota_q4: number | null;
  feedback: string | null;
  timestamp: string | null;
  ciclo: string | null;
  codigo_clockify: string | null;
  canal_resposta: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  lider_periodo: string | null;
  categoria: string | null;
}

interface Resumo {
  total: number;
  validas: number;
  promotores: number;
  neutros: number;
  detratores: number;
  nps: number | null;
}

const PERGUNTAS: { campo: keyof Resposta; titulo: string }[] = [
  { campo: "nota_q1", titulo: "De 0 a 10 qual nota você atribui ao trabalho da Seteg?" },
  { campo: "nota_q2", titulo: "De 0 a 10 o quanto você está satisfeito com o seu relacionamento com nossa equipe?" },
  { campo: "nota_q3", titulo: "De 0 a 10 o quão efetiva é a comunicação com os canais de acesso a Seteg?" },
  { campo: "nota_q4", titulo: "De 0 a 10 o quanto você nos indicaria a um amigo, familiar ou parceiro de negócios?" },
];

const CATEGORIA: Record<string, { rotulo: string; tom: "verde" | "amarelo" | "vermelho" }> = {
  PROMOTOR: { rotulo: "Promotor", tom: "verde" },
  NEUTRO: { rotulo: "Neutro", tom: "amarelo" },
  DETRATOR: { rotulo: "Detrator", tom: "vermelho" },
};

/** Nota com a cor da faixa do NPS (9-10 verde, 7-8 amarelo, 0-6 vermelho). */
function Nota({ valor }: { valor: number | null }) {
  if (valor === null || valor === undefined) return <span className="td-sub">—</span>;
  const cat = categoriaDaNota(valor);
  const tom = cat === "PROMOTOR" ? "verde" : cat === "NEUTRO" ? "amarelo" : "vermelho";
  return <Selo tom={tom}>{valor}</Selo>;
}

function SeloCategoria({ categoria }: { categoria: string | null }) {
  const c = categoria ? CATEGORIA[categoria] : null;
  return c ? <Selo tom={c.tom}>{c.rotulo}</Selo> : <span className="td-sub">—</span>;
}

const VAZIO = { ciclo: "", cliente: "", lider: "", categoria: "" };

export function TelaRespostas({ sessao }: { sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const ciclos = useAuxiliar(auxiliares.ciclos);
  const clientes = useAuxiliar(auxiliares.clientes);
  const lideres = useAuxiliar(auxiliares.lideres);

  const [f, setF] = useState(VAZIO);
  const [vendo, setVendo] = useState<Resposta | null>(null);
  const filtros = useMemo(() => f, [f]);
  const lista = useLista<Resposta>("respostas", {
    ordemInicial: { campo: "timestamp", ascending: false },
    filtros,
  });
  const resumo = lista.extra.resumo as Resumo | undefined;
  const mudar = (campo: keyof typeof VAZIO, valor: string) => setF((atual) => ({ ...atual, [campo]: valor }));

  const colunas: Coluna<Resposta>[] = [
    { chave: "timestamp", rotulo: "Data", ordenavel: true, render: (l) => formatarData(l.timestamp) },
    { chave: "ciclo", rotulo: "Ciclo", ordenavel: true, render: (l) => l.ciclo || "—" },
    {
      chave: "cliente_nome",
      rotulo: "Cliente / Projeto",
      ordenavel: true,
      render: (l) => (
        <>
          <span className="td-principal">{l.cliente_nome || "—"}</span>
          <span className="td-sub" style={{ display: "block" }}>
            {l.codigo_clockify ? `${l.codigo_clockify} · ` : ""}
            {l.projeto_nome || "—"}
          </span>
        </>
      ),
    },
    {
      chave: "respondente_nome",
      rotulo: "Respondente",
      ordenavel: true,
      render: (l) => l.respondente_nome || l.identificador || "—",
    },
    { chave: "lider_periodo", rotulo: "Líder", ordenavel: true, render: (l) => l.lider_periodo || "—" },
    { chave: "q1", rotulo: "Q1", classe: "td-centro", render: (l) => <Nota valor={l.nota_q1} /> },
    { chave: "q2", rotulo: "Q2", classe: "td-centro", render: (l) => <Nota valor={l.nota_q2} /> },
    { chave: "q3", rotulo: "Q3", classe: "td-centro", render: (l) => <Nota valor={l.nota_q3} /> },
    { chave: "nota_q4", rotulo: "Q4 (NPS)", ordenavel: true, classe: "td-centro", render: (l) => <Nota valor={l.nota_q4} /> },
    { chave: "categoria", rotulo: "Categoria", render: (l) => <SeloCategoria categoria={l.categoria} /> },
    { chave: "canal", rotulo: "Canal", render: (l) => (l.canal_resposta ? rotuloDoCanal(l.canal_resposta) : "—") },
    {
      chave: "acoes",
      rotulo: "Ações",
      classe: "td-acoes",
      render: (l) => <BotaoAcao icone="ver" titulo="Ver resposta completa" onClick={() => setVendo(l)} />,
    },
  ];

  return (
    <>
      <CabecalhoTela
        titulo="Respostas"
        descricao={
          ehPmo
            ? "Todas as respostas de NPS dos ciclos, com as notas, o comentário e o resumo do recorte."
            : "Respostas dos projetos nos períodos em que você foi o líder."
        }
      />

      <BarraFiltros>
        <FiltroBusca
          placeholder="Respondente, projeto, cliente ou comentário"
          valor={lista.busca}
          aoMudar={lista.setBusca}
        />
        <FiltroSelect
          id="f-ciclo"
          rotulo="Ciclo"
          valor={f.ciclo}
          aoMudar={(v) => mudar("ciclo", v)}
          opcoes={[{ valor: "", rotulo: "Todos" }, ...ciclos.map((c) => ({ valor: c.id, rotulo: c.codigo }))]}
        />
        <FiltroSelect
          id="f-cliente"
          rotulo="Cliente"
          valor={f.cliente}
          aoMudar={(v) => mudar("cliente", v)}
          opcoes={[{ valor: "", rotulo: "Todos" }, ...clientes.map((c) => ({ valor: c.id, rotulo: c.nome }))]}
        />
        {ehPmo ? (
          <FiltroSelect
            id="f-lider"
            rotulo="Líder"
            valor={f.lider}
            aoMudar={(v) => mudar("lider", v)}
            opcoes={[{ valor: "", rotulo: "Todos" }, ...lideres.map((l) => ({ valor: l.id, rotulo: l.nome }))]}
          />
        ) : null}
        <FiltroSelect
          id="f-categoria"
          rotulo="Categoria"
          valor={f.categoria}
          aoMudar={(v) => mudar("categoria", v)}
          opcoes={[
            { valor: "", rotulo: "Todas" },
            { valor: "PROMOTOR", rotulo: "Promotor" },
            { valor: "NEUTRO", rotulo: "Neutro" },
            { valor: "DETRATOR", rotulo: "Detrator" },
          ]}
        />
        <div className="filtro filtro-acoes">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setF(VAZIO);
              lista.setBusca("");
            }}
          >
            Limpar
          </button>
        </div>
      </BarraFiltros>

      {resumo ? (
        <div className="resumo-respostas">
          <div>
            <span>Respostas</span>
            <strong>{resumo.total}</strong>
          </div>
          <div>
            <span>NPS do recorte</span>
            <strong>{resumo.nps ?? "—"}</strong>
          </div>
          <div className="promotor">
            <span>Promotores</span>
            <strong>{resumo.promotores}</strong>
          </div>
          <div className="neutro">
            <span>Neutros</span>
            <strong>{resumo.neutros}</strong>
          </div>
          <div className="detrator">
            <span>Detratores</span>
            <strong>{resumo.detratores}</strong>
          </div>
        </div>
      ) : null}

      <div className="tabela-wrap">
        <CorpoLista
          lista={lista}
          colunas={colunas}
          chaveDaLinha={(l) => l.id}
          vazio="Nenhuma resposta no recorte selecionado."
        />
      </div>

      {vendo ? (
        <ModalDetalhes
          titulo="Resposta"
          subtitulo={`${vendo.cliente_nome || "—"} — ${vendo.projeto_nome || "—"}`}
          largo
          aoFechar={() => setVendo(null)}
          itens={[
            { rotulo: "Respondente", valor: vendo.respondente_nome || vendo.identificador },
            { rotulo: "Data", valor: formatarData(vendo.timestamp, true) },
            { rotulo: "Ciclo", valor: vendo.ciclo },
            { rotulo: "Líder do período", valor: vendo.lider_periodo },
            { rotulo: "Canal", valor: vendo.canal_resposta ? rotuloDoCanal(vendo.canal_resposta) : null },
            { rotulo: "Categoria", valor: <SeloCategoria categoria={vendo.categoria} /> },
          ]}
        >
          <div style={{ display: "grid", gap: 12, fontSize: ".88rem", lineHeight: 1.5 }}>
            {PERGUNTAS.map((p, i) => (
              <div
                key={p.campo}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}
              >
                <span>
                  {i + 1}. {p.titulo}
                </span>
                <Nota valor={vendo[p.campo] as number | null} />
              </div>
            ))}
            <div>
              <div style={{ marginBottom: 6 }}>5. Quais suas sugestões de melhorias, elogios e feedbacks gerais?</div>
              <div
                style={{
                  padding: "10px 12px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  whiteSpace: "pre-wrap",
                  color: vendo.feedback ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {vendo.feedback?.trim() || "Sem comentário."}
              </div>
            </div>
          </div>
        </ModalDetalhes>
      ) : null}
    </>
  );
}
