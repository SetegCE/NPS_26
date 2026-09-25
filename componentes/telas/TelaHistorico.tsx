"use client";

// Historico por cliente, por lider e trilha de auditoria.
//
// Para o lider a tela e "Resultados" e tem uma aba so — a dele. Para o PMO
// sao tres. E a mesma tela porque e a mesma consulta, com recortes
// diferentes que o servidor aplica.

import { useEffect, useMemo, useState } from "react";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/componentes/Estados";
import { opcoesDe } from "@/componentes/Campo";
import { Tabela, type Coluna } from "@/componentes/Tabela";
import {
  BarraFiltros,
  CabecalhoTela,
  CorpoLista,
  Filtro,
  FiltroBusca,
  FiltroSelect,
} from "@/componentes/Tela";
import { api, ErroApi } from "@/lib/cliente/api";
import { auxiliares, useAuxiliar } from "@/lib/cliente/auxiliares";
import { formatarCompetencia, formatarData } from "@/lib/formato";
import type { Sessao } from "@/lib/cliente/tipos";
import { useLista } from "@/lib/cliente/useLista";
import type { Resumo } from "@/lib/resumo";

type Aba = "cliente" | "lider" | "auditoria";

interface RespostaLinha extends Record<string, unknown> {
  id?: string;
  respondente_nome: string | null;
  identificador?: string | null;
  projeto_nome: string | null;
  ciclo: string | null;
  lider_periodo: string | null;
  nota_q1: number | null;
  nota_q2: number | null;
  nota_q3: number | null;
  nota_q4: number | null;
  categoria: string | null;
  feedback: string | null;
  timestamp: string | null;
}

const TOM_CATEGORIA: Record<string, string> = {
  PROMOTOR: "selo-verde",
  NEUTRO: "selo-amarelo",
  DETRATOR: "selo-vermelho",
};

export function SeloCategoria({ categoria }: { categoria: string | null }) {
  if (!categoria) return <>—</>;
  return <span className={`selo ${TOM_CATEGORIA[categoria] || "selo-neutro"}`}>{categoria}</span>;
}

export function TelaHistorico({ sessao }: { sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const abas: { chave: Aba; rotulo: string }[] = ehPmo
    ? [
        { chave: "cliente", rotulo: "Por cliente" },
        { chave: "lider", rotulo: "Por líder" },
        { chave: "auditoria", rotulo: "Auditoria" },
      ]
    : [{ chave: "lider", rotulo: "Meus resultados" }];

  const [aba, setAba] = useState<Aba>(abas[0].chave);

  return (
    <>
      <CabecalhoTela
        titulo={ehPmo ? "Histórico / Auditoria" : "Resultados"}
        descricao={
          ehPmo
            ? "Consulta histórica por cliente e por líder, e rastreabilidade das alterações administrativas."
            : "Resultados dos projetos sob sua responsabilidade, respeitando o período de cada liderança."
        }
      />

      <div className="abas" role="tablist">
        {abas.map((a) => (
          <button
            key={a.chave}
            type="button"
            role="tab"
            aria-selected={aba === a.chave}
            className={`aba ${aba === a.chave ? "ativa" : ""}`}
            onClick={() => setAba(a.chave)}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === "cliente" ? <AbaCliente /> : null}
      {aba === "lider" ? <AbaLider ehPmo={ehPmo} /> : null}
      {aba === "auditoria" ? <AbaAuditoria /> : null}
    </>
  );
}

// ─── Indicadores ───────────────────────────────────────────────────────────

/**
 * Os cinco numeros com a separacao que importa: projetos com resposta,
 * respondentes e respostas sao grandezas diferentes e aparecem separadas de
 * proposito.
 */
function Indicadores({ resumo }: { resumo?: Resumo | null }) {
  if (!resumo) return null;
  return (
    <div className="kpi-modulo">
      <div className="kpi-card-modulo">
        <div className="rotulo">NPS</div>
        <div className="valor">{resumo.nps}</div>
        <div className="detalhe">
          {resumo.promotores} prom. / {resumo.detratores} detr.
        </div>
      </div>
      <div className="kpi-card-modulo">
        <div className="rotulo">Projetos com resposta</div>
        <div className="valor">{resumo.projetos_com_resposta}</div>
        <div className="detalhe">projetos únicos</div>
      </div>
      <div className="kpi-card-modulo">
        <div className="rotulo">Respondentes</div>
        <div className="valor">{resumo.respondentes}</div>
        <div className="detalhe">pessoas distintas</div>
      </div>
      <div className="kpi-card-modulo">
        <div className="rotulo">Respostas</div>
        <div className="valor">{resumo.respostas}</div>
        <div className="detalhe">avaliações recebidas</div>
      </div>
      <div className="kpi-card-modulo">
        <div className="rotulo">Médias Q1-Q4</div>
        <div className="valor" style={{ fontSize: "1.05rem" }}>
          {resumo.medias.Q1 ?? "—"} / {resumo.medias.Q2 ?? "—"} / {resumo.medias.Q3 ?? "—"} /{" "}
          {resumo.medias.Q4 ?? "—"}
        </div>
        <div className="detalhe">técnica / relacionamento / comunicação / indicação</div>
      </div>
    </div>
  );
}

const COLUNAS_RESPOSTAS: Coluna<RespostaLinha>[] = [
  {
    chave: "respondente_nome",
    rotulo: "Respondente",
    render: (l) => (
      <span className="td-principal">{l.respondente_nome || l.identificador || "—"}</span>
    ),
  },
  { chave: "projeto_nome", rotulo: "Projeto", render: (l) => l.projeto_nome || "—" },
  { chave: "ciclo", rotulo: "Ciclo", render: (l) => l.ciclo || "—" },
  { chave: "lider_periodo", rotulo: "Líder no período", render: (l) => l.lider_periodo || "—" },
  { chave: "nota_q1", rotulo: "Q1", classe: "td-num", render: (l) => l.nota_q1 ?? "—" },
  { chave: "nota_q2", rotulo: "Q2", classe: "td-num", render: (l) => l.nota_q2 ?? "—" },
  { chave: "nota_q3", rotulo: "Q3", classe: "td-num", render: (l) => l.nota_q3 ?? "—" },
  {
    chave: "nota_q4",
    rotulo: "Q4",
    classe: "td-num",
    render: (l) => <strong>{l.nota_q4 ?? "—"}</strong>,
  },
  {
    chave: "categoria",
    rotulo: "Categoria",
    render: (l) => <SeloCategoria categoria={l.categoria} />,
  },
  { chave: "feedback", rotulo: "Feedback", render: (l) => l.feedback || "—" },
  { chave: "timestamp", rotulo: "Data", render: (l) => formatarData(l.timestamp) },
];

function TabelaRespostas({ respostas }: { respostas: RespostaLinha[] }) {
  return (
    <Tabela
      colunas={COLUNAS_RESPOSTAS}
      linhas={respostas}
      chaveDaLinha={(l, i) => String(l.id ?? i)}
      vazio="Nenhuma resposta no recorte selecionado."
    />
  );
}

// ─── Por cliente ───────────────────────────────────────────────────────────

interface ProjetoHistorico extends Record<string, unknown> {
  id: string;
  nome: string;
  codigo_clockify: string;
  lider_nome: string | null;
  ciclo_atual: string | null;
  total_respostas: number;
  nps_projeto: number | null;
  isc_atual: number | null;
}

interface HistoricoCliente {
  projetos: ProjetoHistorico[];
  respostas: RespostaLinha[];
  resumo?: Resumo;
}

function AbaCliente() {
  const clientes = useAuxiliar(auxiliares.clientes);
  const ciclos = useAuxiliar(auxiliares.ciclos);

  const [cliente, setCliente] = useState("");
  const [ciclo, setCiclo] = useState("");
  const [dados, setDados] = useState<HistoricoCliente | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!cliente) {
      setDados(null);
      return;
    }
    let ativo = true;
    setCarregando(true);
    setErro(null);
    api
      .get<HistoricoCliente>("historico/cliente", { cliente, ciclo })
      .then((r) => {
        if (ativo) setDados(r);
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ErroApi ? e.message : "Falha ao carregar o histórico.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [cliente, ciclo]);

  return (
    <>
      <BarraFiltros>
        <FiltroSelect
          id="hc-cliente"
          rotulo="Cliente"
          valor={cliente}
          aoMudar={setCliente}
          opcoes={[{ valor: "", rotulo: "Selecione um cliente..." }, ...opcoesDe(clientes)]}
        />
        <FiltroSelect
          id="hc-ciclo"
          rotulo="Ciclo"
          valor={ciclo}
          aoMudar={setCiclo}
          opcoes={[
            { valor: "", rotulo: "Todos" },
            ...ciclos.map((c) => ({ valor: c.id, rotulo: c.codigo })),
          ]}
        />
      </BarraFiltros>

      {erro ? (
        <EstadoErro mensagem={erro} />
      ) : !cliente ? (
        <EstadoVazio titulo="Selecione um cliente para ver o histórico." />
      ) : carregando || !dados ? (
        <EstadoCarregando />
      ) : (
        <>
          <Indicadores resumo={dados.resumo} />

          <h2 style={{ fontSize: "1rem", margin: "20px 0 10px" }}>Projetos</h2>
          <div className="tabela-wrap">
            <Tabela
              colunas={[
                {
                  chave: "nome",
                  rotulo: "Projeto",
                  render: (l) => (
                    <>
                      <span className="td-principal">{l.nome}</span>
                      <span className="td-sub" style={{ display: "block" }}>
                        {l.codigo_clockify}
                      </span>
                    </>
                  ),
                },
                { chave: "lider_nome", rotulo: "Líder atual", render: (l) => l.lider_nome || "—" },
                { chave: "ciclo_atual", rotulo: "Ciclo", render: (l) => l.ciclo_atual || "—" },
                {
                  chave: "total_respostas",
                  rotulo: "Respostas",
                  classe: "td-num",
                  render: (l) => l.total_respostas,
                },
                {
                  chave: "nps_projeto",
                  rotulo: "NPS",
                  classe: "td-num",
                  render: (l) => l.nps_projeto ?? "—",
                },
                {
                  chave: "isc_atual",
                  rotulo: "ISC",
                  classe: "td-num",
                  render: (l) => l.isc_atual ?? "—",
                },
              ]}
              linhas={dados.projetos}
              chaveDaLinha={(l) => l.id}
              vazio="Nenhum projeto para este cliente."
            />
          </div>

          <h2 style={{ fontSize: "1rem", margin: "20px 0 10px" }}>Respostas</h2>
          <div className="tabela-wrap">
            <TabelaRespostas respostas={dados.respostas} />
          </div>
        </>
      )}
    </>
  );
}

// ─── Por lider ─────────────────────────────────────────────────────────────

interface Periodo extends Record<string, unknown> {
  id?: string;
  iniciado_em: string;
  encerrado_em: string | null;
  projetos_mestre_nps?: {
    nome?: string;
    codigo_clockify?: string;
    clientes_nps?: { nome?: string } | null;
  } | null;
}

interface RegistroIsc extends Record<string, unknown> {
  competencia: string;
  nota: number | string;
  observacao: string | null;
}

interface HistoricoLider {
  periodos: Periodo[];
  respostas: RespostaLinha[];
  respostas_fora_do_periodo?: number;
  isc?: RegistroIsc[];
  resumo?: Resumo;
  aviso?: string;
}

function AbaLider({ ehPmo }: { ehPmo: boolean }) {
  const lideres = useAuxiliar(ehPmo ? auxiliares.lideres : async () => []);
  const [lider, setLider] = useState("");
  const [dados, setDados] = useState<HistoricoLider | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // O lider consulta a si proprio e nao escolhe ninguem: o servidor ignora
    // o parametro e usa a sessao.
    if (ehPmo && !lider) {
      setDados(null);
      return;
    }
    let ativo = true;
    setCarregando(true);
    setErro(null);
    api
      .get<HistoricoLider>("historico/lider", lider ? { lider } : {})
      .then((r) => {
        if (ativo) setDados(r);
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ErroApi ? e.message : "Falha ao carregar o histórico.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [lider, ehPmo]);

  return (
    <>
      {ehPmo ? (
        <BarraFiltros>
          <FiltroSelect
            id="hl-lider"
            rotulo="Líder"
            valor={lider}
            aoMudar={setLider}
            opcoes={[{ valor: "", rotulo: "Selecione um líder..." }, ...opcoesDe(lideres)]}
          />
        </BarraFiltros>
      ) : null}

      {erro ? (
        <EstadoErro mensagem={erro} />
      ) : ehPmo && !lider ? (
        <EstadoVazio titulo="Selecione um líder." />
      ) : carregando || !dados ? (
        <EstadoCarregando />
      ) : (
        <>
          <div className="aviso-box info" style={{ marginBottom: 14 }}>
            <div>
              {dados.aviso}
              {dados.respostas_fora_do_periodo && dados.respostas_fora_do_periodo > 0
                ? ` ${dados.respostas_fora_do_periodo} resposta(s) destes projetos pertencem a períodos de outros líderes e não entram neste resultado.`
                : ""}
            </div>
          </div>

          <Indicadores resumo={dados.resumo} />

          <h2 style={{ fontSize: "1rem", margin: "20px 0 10px" }}>Períodos de responsabilidade</h2>
          <div className="tabela-wrap">
            <Tabela
              colunas={[
                {
                  chave: "projeto",
                  rotulo: "Projeto",
                  render: (l) => (
                    <>
                      <span className="td-principal">
                        {l.projetos_mestre_nps?.nome || "—"}
                      </span>
                      <span className="td-sub" style={{ display: "block" }}>
                        {l.projetos_mestre_nps?.codigo_clockify || ""}
                      </span>
                    </>
                  ),
                },
                {
                  chave: "cliente",
                  rotulo: "Cliente",
                  render: (l) => l.projetos_mestre_nps?.clientes_nps?.nome || "—",
                },
                { chave: "iniciado_em", rotulo: "Início", render: (l) => formatarData(l.iniciado_em) },
                {
                  chave: "encerrado_em",
                  rotulo: "Fim",
                  render: (l) =>
                    l.encerrado_em ? (
                      formatarData(l.encerrado_em)
                    ) : (
                      <span className="selo selo-laranja">Atual</span>
                    ),
                },
              ]}
              linhas={dados.periodos}
              chaveDaLinha={(l, i) => String(l.id ?? i)}
              vazio="Nenhum período de liderança registrado."
            />
          </div>

          <h2 style={{ fontSize: "1rem", margin: "20px 0 10px" }}>Respostas do período</h2>
          <div className="tabela-wrap">
            <TabelaRespostas respostas={dados.respostas} />
          </div>

          {dados.isc?.length ? (
            <>
              <h2 style={{ fontSize: "1rem", margin: "20px 0 10px" }}>ISC registrado</h2>
              <div className="tabela-wrap">
                <Tabela
                  colunas={[
                    {
                      chave: "competencia",
                      rotulo: "Competência",
                      render: (l) => formatarCompetencia(l.competencia),
                    },
                    {
                      chave: "nota",
                      rotulo: "Nota",
                      classe: "td-num",
                      render: (l) => <strong>{l.nota}</strong>,
                    },
                    { chave: "observacao", rotulo: "Observação", render: (l) => l.observacao || "—" },
                  ]}
                  linhas={dados.isc}
                  chaveDaLinha={(l, i) => `${l.competencia}-${i}`}
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

// ─── Auditoria ─────────────────────────────────────────────────────────────

interface LinhaAuditoria extends Record<string, unknown> {
  id: string;
  created_at: string;
  acao: string;
  entidade: string;
  descricao: string | null;
  ator_nome: string;
  ator_tipo: string;
  valores_anteriores: unknown;
  valores_novos: unknown;
}

const ENTIDADES = ["projeto", "pesquisa", "respondente", "ciclo", "cliente", "lider", "isc", "sessao"];

function AbaAuditoria() {
  const [entidade, setEntidade] = useState("");
  const [desde, setDesde] = useState("");

  const filtros = useMemo(() => ({ entidade, desde }), [entidade, desde]);
  const lista = useLista<LinhaAuditoria>("auditoria", {
    ordemInicial: { campo: "created_at", ascending: false },
    filtros,
  });

  return (
    <>
      <BarraFiltros>
        <FiltroBusca
          id="ha-busca"
          placeholder="Descrição ou usuário"
          valor={lista.busca}
          aoMudar={lista.setBusca}
        />
        <FiltroSelect
          id="ha-entidade"
          rotulo="Entidade"
          valor={entidade}
          aoMudar={setEntidade}
          opcoes={[
            { valor: "", rotulo: "Todas" },
            ...ENTIDADES.map((e) => ({ valor: e, rotulo: e })),
          ]}
        />
        <Filtro id="ha-desde" rotulo="Desde">
          <input
            id="ha-desde"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </Filtro>
      </BarraFiltros>

      <div className="tabela-wrap">
        <CorpoLista
          lista={lista}
          chaveDaLinha={(l) => l.id}
          vazio="Nenhum registro de auditoria."
          colunas={[
            {
              chave: "created_at",
              rotulo: "Quando",
              ordenavel: true,
              render: (l) => formatarData(l.created_at, true),
            },
            {
              chave: "acao",
              rotulo: "Ação",
              ordenavel: true,
              render: (l) => <span className="selo selo-neutro">{l.acao}</span>,
            },
            { chave: "entidade", rotulo: "Entidade", ordenavel: true },
            { chave: "descricao", rotulo: "Descrição", render: (l) => l.descricao || "—" },
            {
              chave: "ator_nome",
              rotulo: "Usuário",
              ordenavel: true,
              render: (l) => (
                <>
                  {l.ator_nome} <span className="td-sub">({l.ator_tipo})</span>
                </>
              ),
            },
            {
              chave: "valores",
              rotulo: "Alteração",
              render: (l) =>
                l.valores_anteriores || l.valores_novos ? (
                  <span
                    className="td-sub"
                    title={JSON.stringify({
                      antes: l.valores_anteriores,
                      depois: l.valores_novos,
                    })}
                  >
                    ver detalhes
                  </span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </div>
    </>
  );
}
