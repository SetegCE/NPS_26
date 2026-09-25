"use client";

// Detalhe do projeto, com as abas que reunem tudo o que existe sobre ele:
// respondentes, pesquisas, respostas, participacao em ciclos, historico de
// lideranca e auditoria.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EstadoCarregando, EstadoErro, EstadoVazio } from "@/componentes/Estados";
import { Tabela } from "@/componentes/Tabela";
import { SeloCategoria } from "@/componentes/telas/TelaHistorico";
import { SeloStatusPesquisa } from "@/componentes/telas/TelaPesquisas";
import {
  FormularioProjeto,
  ROTULO_STATUS,
  TrocaLider,
  type Projeto,
} from "@/componentes/telas/TelaProjetos";
import { api, ErroApi } from "@/lib/cliente/api";
import { formatarCompetencia, formatarData } from "@/lib/formato";
import type { Sessao } from "@/lib/cliente/tipos";

type Aba = "geral" | "respondentes" | "pesquisas" | "respostas" | "ciclos" | "lideranca" | "historico";

interface Linha extends Record<string, unknown> {}

interface Detalhe {
  projeto: Projeto & {
    nps_projeto: number | null;
    isc_atual: number | null;
    isc_competencia: string | null;
  };
  respondentes: Linha[];
  pesquisas: Linha[];
  respostas: Linha[];
  lideranca: Linha[];
  ciclos: Linha[];
  transicoes: Linha[];
  auditoria: Linha[];
}

function Cartao({
  rotulo,
  valor,
  detalhe,
  ehIsc = false,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe: string;
  ehIsc?: boolean;
}) {
  return (
    <div className={`kpi-card-modulo ${ehIsc ? "isc" : ""}`}>
      <div className="rotulo">{rotulo}</div>
      <div className="valor">{valor}</div>
      <div className="detalhe">{detalhe}</div>
    </div>
  );
}

function LinhaInfo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        padding: "7px 0",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <span
        style={{
          minWidth: 150,
          fontSize: ".74rem",
          textTransform: "uppercase",
          letterSpacing: ".05em",
          color: "var(--text-muted)",
          fontWeight: 700,
        }}
      >
        {rotulo}
      </span>
      <span style={{ color: "var(--text-primary)" }}>{valor || "—"}</span>
    </div>
  );
}

export function TelaProjetoDetalhe({ id, sessao }: { id: string; sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("geral");
  const [editando, setEditando] = useState(false);
  const [trocandoLider, setTrocandoLider] = useState(false);

  const carregar = useCallback(() => {
    setErro(null);
    api
      .get<Detalhe>(`projetos/${id}`)
      .then(setD)
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Falha ao carregar o projeto."));
  }, [id]);

  useEffect(carregar, [carregar]);

  if (erro) return <EstadoErro mensagem={erro} />;
  if (!d) return <EstadoCarregando mensagem="Carregando projeto..." />;

  const p = d.projeto;
  const abas: { chave: Aba; rotulo: string; contador?: number }[] = [
    { chave: "geral", rotulo: "Visão geral" },
    { chave: "respondentes", rotulo: "Respondentes", contador: d.respondentes.length },
    { chave: "pesquisas", rotulo: "Pesquisas", contador: d.pesquisas.length },
    { chave: "respostas", rotulo: "Respostas", contador: d.respostas.length },
    { chave: "ciclos", rotulo: "Ciclos", contador: d.ciclos.length },
    { chave: "lideranca", rotulo: "Liderança", contador: d.lideranca.length },
    { chave: "historico", rotulo: "Histórico", contador: d.auditoria.length },
  ];

  return (
    <>
      <div className="view-header">
        <div>
          <Link href="/projetos" className="btn-mini">
            &larr; Projetos
          </Link>
          <h1 style={{ marginTop: 8 }}>{p.nome}</h1>
          <p>
            {p.codigo_clockify} · {p.cliente_nome || "Sem cliente"} · Líder:{" "}
            {p.lider_nome || "—"}
          </p>
        </div>
        {ehPmo ? (
          <div className="view-acoes">
            <button type="button" className="btn-secondary" onClick={() => setTrocandoLider(true)}>
              Alterar líder
            </button>
            <button type="button" className="btn-primary" onClick={() => setEditando(true)}>
              Editar
            </button>
          </div>
        ) : null}
      </div>

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
            {a.contador !== undefined ? <span className="contador">{a.contador}</span> : null}
          </button>
        ))}
      </div>

      <div>
        {aba === "geral" ? <AbaGeral d={d} /> : null}
        {aba === "respondentes" ? <AbaRespondentes d={d} /> : null}
        {aba === "pesquisas" ? <AbaPesquisas d={d} /> : null}
        {aba === "respostas" ? <AbaRespostas d={d} /> : null}
        {aba === "ciclos" ? <AbaCiclos d={d} /> : null}
        {aba === "lideranca" ? <AbaLideranca d={d} /> : null}
        {aba === "historico" ? <AbaAuditoria d={d} /> : null}
      </div>

      {editando ? (
        <FormularioProjeto
          projeto={p}
          aoFechar={() => setEditando(false)}
          aoSalvar={() => {
            setEditando(false);
            carregar();
          }}
        />
      ) : null}


      {trocandoLider ? (
        <TrocaLider
          projeto={p}
          aoFechar={() => setTrocandoLider(false)}
          aoSalvar={() => {
            setTrocandoLider(false);
            carregar();
          }}
        />
      ) : null}
    </>
  );
}

function AbaGeral({ d }: { d: Detalhe }) {
  const p = d.projeto;
  const responderam = d.respondentes.filter((r) => r.respondeu).length;
  const validas = d.respostas.filter((r) => r.resposta_valida).length;
  const respondidas = d.pesquisas.filter((s) => s.status === "respondida").length;

  return (
    <>
      <div className="kpi-modulo">
        <Cartao
          rotulo="NPS do projeto"
          valor={p.nps_projeto ?? "—"}
          detalhe={`${validas} respostas válidas`}
        />
        <Cartao
          rotulo="Respondentes"
          valor={d.respondentes.length}
          detalhe={`${responderam} responderam`}
        />
        <Cartao
          rotulo="Pesquisas"
          valor={d.pesquisas.length}
          detalhe={`${respondidas} respondidas`}
        />
        <Cartao
          ehIsc
          rotulo="ISC atual"
          valor={p.isc_atual ?? "—"}
          detalhe={p.isc_competencia ? formatarCompetencia(p.isc_competencia) : "Sem registro"}
        />
      </div>

      <div className="tabela-wrap">
        <div style={{ padding: 16 }}>
          <LinhaInfo rotulo="Cliente" valor={p.cliente_nome} />
          <LinhaInfo rotulo="Líder atual" valor={p.lider_nome} />
          <LinhaInfo rotulo="Categoria" valor={p.categoria} />
          <LinhaInfo rotulo="Classe contratual" valor={p.classe_contratual} />
          <LinhaInfo rotulo="Serviço" valor={p.tipo_servico} />
          <LinhaInfo rotulo="Segmento" valor={p.segmento_cliente} />
          <LinhaInfo rotulo="Vendedor" valor={p.vendedor} />
          <LinhaInfo rotulo="Acesso" valor={p.acesso} />
          <LinhaInfo
            rotulo="Status"
            valor={p.ativo ? ROTULO_STATUS[p.status] || p.status : "Inativo"}
          />
          <LinhaInfo rotulo="Ciclo atual" valor={p.ciclo_atual} />
          <LinhaInfo rotulo="Elegível" valor={p.elegivel ? "Sim" : "Não"} />
          <LinhaInfo rotulo="Escopo" valor={p.escopo_geral} />
        </div>
      </div>
    </>
  );
}

function AbaRespondentes({ d }: { d: Detalhe }) {
  if (!d.respondentes.length) {
    return (
      <EstadoVazio
        titulo="Nenhum respondente vinculado."
        descricao="Vincule respondentes para gerar pesquisas."
      />
    );
  }

  return (
    <div className="tabela-wrap">
      <Tabela
        colunas={[
          {
            chave: "nome",
            rotulo: "Nome",
            render: (l) => (
              <span className="td-principal">
                {(l.respondentes_nps as { nome?: string })?.nome || "—"}
              </span>
            ),
          },
          {
            chave: "email",
            rotulo: "E-mail",
            render: (l) => (l.respondentes_nps as { email?: string })?.email || "—",
          },
          {
            chave: "telefone",
            rotulo: "Telefone",
            render: (l) => (l.respondentes_nps as { telefone?: string })?.telefone || "—",
          },
          {
            chave: "respondeu",
            rotulo: "Respondeu",
            render: (l) => (
              <span className={`selo ${l.respondeu ? "selo-verde" : "selo-neutro"}`}>
                {l.respondeu ? "Sim" : "Não"}
              </span>
            ),
          },
          {
            chave: "ativo",
            rotulo: "Vínculo",
            render: (l) => (
              <span className={`selo ${l.ativo ? "selo-azul" : "selo-neutro"}`}>
                {l.ativo ? "Ativo" : "Inativo"}
              </span>
            ),
          },
        ]}
        linhas={d.respondentes}
        chaveDaLinha={(l, i) => String(l.id ?? i)}
      />
    </div>
  );
}

function AbaPesquisas({ d }: { d: Detalhe }) {
  if (!d.pesquisas.length) return <EstadoVazio titulo="Nenhuma pesquisa gerada." />;

  return (
    <div className="tabela-wrap">
      <Tabela
        colunas={[
          {
            chave: "respondente_nome",
            rotulo: "Respondente",
            render: (l) => <span className="td-principal">{String(l.respondente_nome ?? "—")}</span>,
          },
          {
            chave: "tipo",
            rotulo: "Tipo",
            render: (l) => (l.tipo === "finalizacao" ? "Finalização" : "Ciclo semestral"),
          },
          { chave: "ciclo_codigo", rotulo: "Ciclo", render: (l) => String(l.ciclo_codigo ?? "—") },
          {
            chave: "status",
            rotulo: "Situação",
            render: (l) => <SeloStatusPesquisa status={String(l.status)} />,
          },
          {
            chave: "data_geracao",
            rotulo: "Gerada",
            render: (l) => formatarData(l.data_geracao as string),
          },
          {
            chave: "data_resposta",
            rotulo: "Respondida",
            render: (l) => formatarData(l.data_resposta as string),
          },
        ]}
        linhas={d.pesquisas}
        chaveDaLinha={(l, i) => String(l.id ?? i)}
      />
    </div>
  );
}

function AbaRespostas({ d }: { d: Detalhe }) {
  if (!d.respostas.length) return <EstadoVazio titulo="Nenhuma resposta recebida." />;

  return (
    <div className="tabela-wrap">
      <Tabela
        colunas={[
          {
            chave: "identificador",
            rotulo: "Respondente",
            render: (l) => (
              <span className="td-principal">
                {String(l.respondente_nome ?? l.identificador ?? "—")}
              </span>
            ),
          },
          { chave: "ciclo", rotulo: "Ciclo", render: (l) => String(l.ciclo ?? "—") },
          { chave: "nota_q1", rotulo: "Q1", classe: "td-num", render: (l) => (l.nota_q1 ?? "—") as React.ReactNode },
          { chave: "nota_q2", rotulo: "Q2", classe: "td-num", render: (l) => (l.nota_q2 ?? "—") as React.ReactNode },
          { chave: "nota_q3", rotulo: "Q3", classe: "td-num", render: (l) => (l.nota_q3 ?? "—") as React.ReactNode },
          {
            chave: "nota_q4",
            rotulo: "Q4 (NPS)",
            classe: "td-num",
            render: (l) => <strong>{(l.nota_q4 ?? "—") as React.ReactNode}</strong>,
          },
          {
            chave: "categoria",
            rotulo: "Categoria",
            render: (l) => <SeloCategoria categoria={(l.categoria as string) || null} />,
          },
          {
            chave: "lider_periodo",
            rotulo: "Líder no período",
            render: (l) => String(l.lider_periodo ?? "—"),
          },
          {
            chave: "feedback",
            rotulo: "Feedback",
            render: (l) => {
              const f = (l.feedback as string) || "";
              return <span title={f}>{f ? f.slice(0, 60) + (f.length > 60 ? "..." : "") : "—"}</span>;
            },
          },
          {
            chave: "timestamp",
            rotulo: "Data",
            render: (l) => formatarData(l.timestamp as string, true),
          },
        ]}
        linhas={d.respostas}
        chaveDaLinha={(l, i) => String(l.id ?? i)}
      />
    </div>
  );
}

function AbaCiclos({ d }: { d: Detalhe }) {
  return (
    <>
      <div className="tabela-wrap">
        <Tabela
          colunas={[
            {
              chave: "ciclo",
              rotulo: "Ciclo",
              render: (l) => <span className="td-principal">{String(l.ciclo)}</span>,
            },
            { chave: "lider", rotulo: "Líder no ciclo", render: (l) => String(l.lider ?? "—") },
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
              chave: "ativo",
              rotulo: "Participação",
              render: (l) => (
                <span className={`selo ${l.ativo ? "selo-azul" : "selo-neutro"}`}>
                  {l.ativo ? "Ativa" : "Retirado"}
                </span>
              ),
            },
          ]}
          linhas={d.ciclos}
          chaveDaLinha={(l, i) => String(l.id ?? i)}
          vazio="Projeto ainda não participa de nenhum ciclo."
        />
      </div>

      {d.transicoes.length ? (
        <>
          <h3 style={{ margin: "18px 0 10px", fontSize: ".92rem" }}>
            Decisões de passagem de ciclo
          </h3>
          <div className="tabela-wrap">
            <Tabela
              colunas={[
                { chave: "decisao", rotulo: "Decisão", render: (l) => String(l.decisao) },
                { chave: "motivo", rotulo: "Motivo", render: (l) => String(l.motivo ?? "—") },
                {
                  chave: "observacao",
                  rotulo: "Observação",
                  render: (l) => String(l.observacao ?? "—"),
                },
                { chave: "decidido_por", rotulo: "Por", render: (l) => String(l.decidido_por) },
                {
                  chave: "created_at",
                  rotulo: "Data",
                  render: (l) => formatarData(l.created_at as string, true),
                },
              ]}
              linhas={d.transicoes}
              chaveDaLinha={(l, i) => String(l.id ?? i)}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

/** Linha do tempo da lideranca — o registro de quem respondia pelo projeto e
 *  quando. E o que garante que trocar o lider nao reescreve o passado. */
function AbaLideranca({ d }: { d: Detalhe }) {
  if (!d.lideranca.length) {
    return <EstadoVazio titulo="Nenhum período de liderança registrado." />;
  }

  return (
    <div className="tabela-wrap">
      <div style={{ padding: 18 }}>
        <div className="linha-tempo">
          {d.lideranca.map((h, i) => (
            <div key={String(h.id ?? i)} className={`tempo-item ${h.encerrado_em ? "" : "atual"}`}>
              <div className="tempo-marca" />
              <div className="tempo-conteudo">
                <div className="tempo-titulo">
                  {String(h.lider_nome)}
                  {h.encerrado_em ? null : <span className="selo selo-laranja">Atual</span>}
                </div>
                <div className="tempo-data">
                  {formatarData(h.iniciado_em as string)} &rarr;{" "}
                  {h.encerrado_em ? formatarData(h.encerrado_em as string) : "atual"}
                </div>
                {h.observacao ? <div className="tempo-desc">{String(h.observacao)}</div> : null}
                <div
                  className="tempo-desc"
                  style={{ color: "var(--text-muted)", fontSize: ".74rem" }}
                >
                  Registrado por {String(h.alterado_por ?? "—")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AbaAuditoria({ d }: { d: Detalhe }) {
  if (!d.auditoria.length) {
    return <EstadoVazio titulo="Sem registros de auditoria para este projeto." />;
  }

  return (
    <div className="tabela-wrap">
      <Tabela
        colunas={[
          {
            chave: "created_at",
            rotulo: "Quando",
            render: (l) => formatarData(l.created_at as string, true),
          },
          {
            chave: "acao",
            rotulo: "Ação",
            render: (l) => <span className="selo selo-neutro">{String(l.acao)}</span>,
          },
          { chave: "descricao", rotulo: "Descrição", render: (l) => String(l.descricao ?? "—") },
          { chave: "ator_nome", rotulo: "Usuário", render: (l) => String(l.ator_nome) },
        ]}
        linhas={d.auditoria}
        chaveDaLinha={(l, i) => String(l.id ?? i)}
      />
    </div>
  );
}
