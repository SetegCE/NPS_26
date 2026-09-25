"use client";

// Operacao do ciclo: o painel do dia a dia do PMO — o que esta previsto, o
// que ja tem pesquisa gerada, o que ja respondeu.

import { useEffect, useMemo, useState } from "react";
import { opcoesDe } from "@/componentes/Campo";
import { type Coluna } from "@/componentes/Tabela";
import {
  BarraFiltros,
  CabecalhoTela,
  CorpoLista,
  FiltroBusca,
  FiltroSelect,
} from "@/componentes/Tela";
import { api } from "@/lib/cliente/api";
import { auxiliares, cicloAberto, useAuxiliar } from "@/lib/cliente/auxiliares";
import type { Sessao } from "@/lib/cliente/tipos";
import { useLista } from "@/lib/cliente/useLista";

interface LinhaOperacao extends Record<string, unknown> {
  projeto_id: string;
  projeto_nome: string;
  codigo_clockify: string;
  cliente_nome: string | null;
  lider_ciclo: string | null;
  elegivel: boolean;
  respondentes: number;
  pesquisas: number;
  pesquisas_enviadas: number;
  respostas: number;
  situacao: string;
}

interface Indicadores {
  vazio?: boolean;
  nps: number;
  promotores: number;
  neutros: number;
  detratores: number;
  projetos_com_resposta: number;
  projetos_elegiveis: number;
  cobertura: number;
  respondentes: number;
  respostas: number;
  isc_medio: number | null;
}

const SITUACOES = [
  { valor: "respondido", rotulo: "Respondido", selo: "selo-verde" },
  { valor: "aguardando_resposta", rotulo: "Aguardando resposta", selo: "selo-amarelo" },
  { valor: "pesquisa_gerada", rotulo: "Pesquisa gerada", selo: "selo-azul" },
  { valor: "sem_pesquisa", rotulo: "Sem pesquisa", selo: "selo-laranja" },
  { valor: "nao_elegivel", rotulo: "Não elegível", selo: "selo-neutro" },
];

function SeloSituacao({ situacao }: { situacao: string }) {
  const s = SITUACOES.find((x) => x.valor === situacao);
  return <span className={`selo ${s?.selo || "selo-neutro"}`}>{s?.rotulo || situacao}</span>;
}

const VAZIO = {
  ciclo: "",
  cliente: "",
  lider: "",
  elegivel: "",
  situacao: "",
  comPesquisa: "",
  comResposta: "",
};

export function TelaOperacao({ sessao }: { sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const clientes = useAuxiliar(auxiliares.clientes);
  const lideres = useAuxiliar(auxiliares.lideres);
  const ciclos = useAuxiliar(auxiliares.ciclos);

  const [f, setF] = useState(VAZIO);
  const [indicadores, setIndicadores] = useState<Indicadores | null>(null);

  // O ciclo aberto e o recorte padrao: e nele que o trabalho esta acontecendo.
  // Roda uma vez, quando a lista de ciclos chega.
  const [cicloInicializado, setCicloInicializado] = useState(false);
  useEffect(() => {
    if (cicloInicializado || !ciclos.length) return;
    const aberto = cicloAberto(ciclos);
    if (aberto) setF((atual) => ({ ...atual, ciclo: aberto.id }));
    setCicloInicializado(true);
  }, [ciclos, cicloInicializado]);

  const filtros = useMemo(() => ({ ...f, lider: ehPmo ? f.lider : "" }), [f, ehPmo]);

  const lista = useLista<LinhaOperacao>("operacao", {
    ordemInicial: { campo: "projeto_nome", ascending: true },
    filtros,
  });

  // Os indicadores acompanham os mesmos filtros da tabela. Falhar aqui apaga
  // os cartoes e so — a tabela continua.
  useEffect(() => {
    let ativo = true;
    api
      .get<Indicadores>("operacao/indicadores", filtros)
      .then((i) => {
        if (ativo) setIndicadores(i && !i.vazio ? i : null);
      })
      .catch(() => {
        if (ativo) setIndicadores(null);
      });
    return () => {
      ativo = false;
    };
  }, [filtros]);

  const mudar = (campo: keyof typeof VAZIO, valor: string) =>
    setF((atual) => ({ ...atual, [campo]: valor }));

  const colunas: Coluna<LinhaOperacao>[] = [
    {
      chave: "projeto_nome",
      rotulo: "Projeto",
      ordenavel: true,
      render: (l) => (
        <>
          <span className="td-principal">{l.projeto_nome}</span>
          <span className="td-sub" style={{ display: "block" }}>
            {l.codigo_clockify}
          </span>
        </>
      ),
    },
    {
      chave: "cliente_nome",
      rotulo: "Cliente",
      ordenavel: true,
      render: (l) => l.cliente_nome || "—",
    },
    { chave: "lider_ciclo", rotulo: "Líder", ordenavel: true, render: (l) => l.lider_ciclo || "—" },
    {
      chave: "elegivel",
      rotulo: "Elegível",
      render: (l) => (
        <span className={`selo ${l.elegivel ? "selo-verde" : "selo-neutro"}`}>
          {l.elegivel ? "Sim" : "Não"}
        </span>
      ),
    },
    {
      chave: "respondentes",
      rotulo: "Respondentes",
      classe: "td-num",
      ordenavel: true,
      render: (l) => l.respondentes,
    },
    {
      chave: "pesquisas",
      rotulo: "Pesquisas",
      classe: "td-num",
      ordenavel: true,
      render: (l) => (
        <>
          {l.pesquisas}
          {Number(l.pesquisas_enviadas) ? (
            <span className="td-sub"> ({l.pesquisas_enviadas} env.)</span>
          ) : null}
        </>
      ),
    },
    {
      chave: "respostas",
      rotulo: "Respostas",
      classe: "td-num",
      ordenavel: true,
      render: (l) => l.respostas,
    },
    {
      chave: "situacao",
      rotulo: "Status",
      ordenavel: true,
      render: (l) => <SeloSituacao situacao={l.situacao} />,
    },
  ];

  return (
    <>
      <CabecalhoTela
        titulo="Operação do Ciclo"
        descricao="Acompanhe projetos previstos, elegíveis, respondentes vinculados, pesquisas geradas e respostas recebidas."
      />

      {indicadores ? <Indicadoresk i={indicadores} /> : null}

      <BarraFiltros>
        <FiltroBusca
          placeholder="Projeto, código ou cliente"
          valor={lista.busca}
          aoMudar={lista.setBusca}
        />
        <FiltroSelect
          id="f-ciclo"
          rotulo="Ciclo"
          valor={f.ciclo}
          aoMudar={(v) => mudar("ciclo", v)}
          opcoes={[
            { valor: "", rotulo: "Todos" },
            ...ciclos.map((c) => ({ valor: c.id, rotulo: c.codigo })),
          ]}
        />
        <FiltroSelect
          id="f-cliente"
          rotulo="Cliente"
          valor={f.cliente}
          aoMudar={(v) => mudar("cliente", v)}
          opcoes={[{ valor: "", rotulo: "Todos" }, ...opcoesDe(clientes)]}
        />
        {ehPmo ? (
          <FiltroSelect
            id="f-lider"
            rotulo="Líder"
            valor={f.lider}
            aoMudar={(v) => mudar("lider", v)}
            opcoes={[{ valor: "", rotulo: "Todos" }, ...opcoesDe(lideres)]}
          />
        ) : null}
        <FiltroSelect
          id="f-elegivel"
          rotulo="Elegibilidade"
          valor={f.elegivel}
          aoMudar={(v) => mudar("elegivel", v)}
          opcoes={[
            { valor: "", rotulo: "Todas" },
            { valor: "true", rotulo: "Elegível" },
            { valor: "false", rotulo: "Não elegível" },
          ]}
        />
        <FiltroSelect
          id="f-situacao"
          rotulo="Status"
          valor={f.situacao}
          aoMudar={(v) => mudar("situacao", v)}
          opcoes={[
            { valor: "", rotulo: "Todos" },
            ...SITUACOES.map((s) => ({ valor: s.valor, rotulo: s.rotulo })),
          ]}
        />
        <FiltroSelect
          id="f-pesquisa"
          rotulo="Pesquisa"
          valor={f.comPesquisa}
          aoMudar={(v) => mudar("comPesquisa", v)}
          opcoes={[
            { valor: "", rotulo: "Todas" },
            { valor: "true", rotulo: "Com pesquisa" },
            { valor: "false", rotulo: "Sem pesquisa" },
          ]}
        />
        <FiltroSelect
          id="f-resposta"
          rotulo="Resposta"
          valor={f.comResposta}
          aoMudar={(v) => mudar("comResposta", v)}
          opcoes={[
            { valor: "", rotulo: "Todas" },
            { valor: "true", rotulo: "Com resposta" },
            { valor: "false", rotulo: "Sem resposta" },
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

      <div className="tabela-wrap">
        <CorpoLista
          lista={lista}
          colunas={colunas}
          chaveDaLinha={(l, i) => `${l.projeto_id}-${i}`}
          vazio="Nenhum projeto encontrado neste recorte."
        />
      </div>
    </>
  );
}

/**
 * Cada cartao significa uma coisa diferente, e a distincao e o ponto:
 * projetos elegiveis != projetos respondidos != respondentes != respostas.
 */
function Indicadoresk({ i }: { i: Indicadores }) {
  const cartoes: { rotulo: string; valor: React.ReactNode; detalhe: string; classe?: string }[] = [
    {
      rotulo: "NPS",
      valor: i.nps,
      detalhe: `${i.promotores} prom. / ${i.neutros} neu. / ${i.detratores} detr.`,
    },
    {
      rotulo: "Projetos com resposta",
      valor: `${i.projetos_com_resposta}/${i.projetos_elegiveis}`,
      detalhe: "projetos únicos com ao menos 1 resposta",
    },
    {
      rotulo: "Cobertura",
      valor: `${i.cobertura}%`,
      detalhe: "projetos respondidos / elegíveis",
    },
    {
      rotulo: "Respondentes",
      valor: i.respondentes,
      detalhe: "pessoas distintas que participaram",
    },
    { rotulo: "Respostas", valor: i.respostas, detalhe: "avaliações de projeto recebidas" },
    {
      rotulo: "ISC",
      valor: i.isc_medio ?? "—",
      detalhe: "percepção interna do líder (não compõe o NPS)",
      classe: "isc",
    },
  ];

  return (
    <div className="kpi-modulo">
      {cartoes.map((c) => (
        <div className={`kpi-card-modulo ${c.classe || ""}`} key={c.rotulo}>
          <div className="rotulo">{c.rotulo}</div>
          <div className="valor">{c.valor}</div>
          <div className="detalhe">{c.detalhe}</div>
        </div>
      ))}
    </div>
  );
}
