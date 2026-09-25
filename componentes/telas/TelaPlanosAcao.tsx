"use client";

// Planos de acao (modelo 5W2H da planilha do PMO).
//
// PMO: decide, projeto a projeto, se ele e passivel de plano de acao (so
// aparece depois da primeira resposta no ciclo) e, quando sim, escreve o
// contexto (Assunto e Objetivo). Lider: preenche as acoes dos projetos que
// lidera e atualiza a situacao de cada uma. A regra vive no banco
// (supabase/migrations/20_plano_de_acao.sql); a tela so conduz.

import { useCallback, useEffect, useState } from "react";
import { CampoArea, CampoSelect, CampoTexto } from "@/componentes/Campo";
import { Aviso, EstadoCarregando, EstadoErro } from "@/componentes/Estados";
import { Confirmacao, Modal } from "@/componentes/Modal";
import { usePaginacaoLocal } from "@/componentes/Paginacao";
import { BotaoAcao, Tabela, type Coluna } from "@/componentes/Tabela";
import { BarraFiltros, CabecalhoTela, FiltroSelect, Selo } from "@/componentes/Tela";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi } from "@/lib/cliente/api";
import { auxiliares, useAuxiliar } from "@/lib/cliente/auxiliares";
import { formatarData } from "@/lib/formato";
import type { Sessao } from "@/lib/cliente/tipos";

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface Plano extends Record<string, unknown> {
  id: string;
  projeto_id: string;
  ciclo_id: string;
  ciclo_codigo: string;
  passivel: boolean;
  numero: string | null;
  assunto: string | null;
  objetivo: string | null;
  responsavel_nome: string | null;
  inicio: string | null;
  encerrado_em: string | null;
  decidido_por: string;
  codigo_clockify: string;
  projeto_nome: string;
  cliente_nome: string | null;
  lider_nome: string | null;
  total_acoes: number;
  acoes_concluidas: number;
  acoes_atrasadas: number;
  situacao: string;
}

interface Pendente extends Record<string, unknown> {
  projeto_id: string;
  ciclo_id: string;
  ciclo: string;
  codigo_clockify: string;
  projeto_nome: string;
  cliente_nome: string | null;
  lider_ciclo: string | null;
  respostas: number;
}

interface Acao extends Record<string, unknown> {
  id: string;
  ordem: number;
  o_que: string;
  por_que: string | null;
  onde: string | null;
  quem: string | null;
  quanto: number | null;
  prazo: string | null;
  situacao: string;
  situacao_efetiva: string;
  observacao: string | null;
  atualizado_por: string;
}

/** O que a decisao precisa saber do projeto, venha de um pendente ou de um plano. */
interface AlvoDecisao {
  projeto_id: string;
  ciclo_id: string;
  ciclo: string;
  projeto: string;
  codigo: string;
  cliente: string | null;
  lider: string | null;
  atual?: Plano;
}

// ─── Rotulos e cores (as da planilha: verde, amarelo, vermelho) ────────────

const SITUACAO_PLANO: Record<string, { rotulo: string; tom: Parameters<typeof Selo>[0]["tom"] }> = {
  aguardando_acoes: { rotulo: "Aguardando ações", tom: "azul" },
  em_andamento: { rotulo: "Em andamento", tom: "amarelo" },
  com_atraso: { rotulo: "Com atraso", tom: "vermelho" },
  concluido: { rotulo: "Ações concluídas", tom: "verde" },
  encerrado: { rotulo: "Encerrado", tom: "neutro" },
  sem_plano: { rotulo: "Sem plano de ação", tom: "neutro" },
};

const SITUACAO_ACAO: Record<string, { rotulo: string; tom: Parameters<typeof Selo>[0]["tom"] }> = {
  no_prazo: { rotulo: "No prazo", tom: "amarelo" },
  concluido: { rotulo: "Concluído", tom: "verde" },
  atrasado: { rotulo: "Atrasado", tom: "vermelho" },
};

const OPCOES_SITUACAO_ACAO = [
  { valor: "no_prazo", rotulo: "No prazo" },
  { valor: "concluido", rotulo: "Concluído" },
  { valor: "atrasado", rotulo: "Atrasado" },
];

const reais = (v: number | null) =>
  v === null || v === undefined
    ? "—"
    : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function SeloPlano({ situacao }: { situacao: string }) {
  const s = SITUACAO_PLANO[situacao] || { rotulo: situacao, tom: "neutro" as const };
  return <Selo tom={s.tom}>{s.rotulo}</Selo>;
}

// ─── Tela ──────────────────────────────────────────────────────────────────

export function TelaPlanosAcao({ sessao }: { sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const ciclos = useAuxiliar(auxiliares.ciclos);

  const [ciclo, setCiclo] = useState("");
  const [situacao, setSituacao] = useState("");
  const [dados, setDados] = useState<{ itens: Plano[]; pendentes: Pendente[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [decidindo, setDecidindo] = useState<AlvoDecisao | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setErro(null);
    api
      .get<{ itens: Plano[]; pendentes: Pendente[] }>("planos-acao", { ciclo, situacao })
      .then(setDados)
      .catch((e) => {
        setDados(null);
        setErro(e instanceof ErroApi ? e.message : "Falha ao carregar os planos de ação.");
      });
  }, [ciclo, situacao]);

  useEffect(carregar, [carregar]);

  const colunasPendentes: Coluna<Pendente>[] = [
    {
      chave: "projeto",
      rotulo: "Projeto",
      render: (l) => (
        <>
          <span className="td-principal">{l.projeto_nome}</span>
          <span className="td-sub" style={{ display: "block" }}>
            {l.codigo_clockify}
          </span>
        </>
      ),
    },
    { chave: "cliente", rotulo: "Cliente", render: (l) => l.cliente_nome || "—" },
    { chave: "lider", rotulo: "Líder", render: (l) => l.lider_ciclo || "—" },
    { chave: "ciclo", rotulo: "Ciclo", render: (l) => l.ciclo },
    { chave: "respostas", rotulo: "Respostas", classe: "td-num", render: (l) => l.respostas },
    {
      chave: "acoes",
      rotulo: "Ações",
      classe: "td-acoes",
      render: (l) => (
        <BotaoAcao
          icone="plano"
          titulo="Decidir: é passível de plano de ação?"
          onClick={() =>
            setDecidindo({
              projeto_id: l.projeto_id,
              ciclo_id: l.ciclo_id,
              ciclo: l.ciclo,
              projeto: l.projeto_nome,
              codigo: l.codigo_clockify,
              cliente: l.cliente_nome,
              lider: l.lider_ciclo,
            })
          }
        />
      ),
    },
  ];

  const colunasPlanos: Coluna<Plano>[] = [
    { chave: "numero", rotulo: "Nº", render: (l) => (l.passivel ? l.numero : "—") },
    {
      chave: "projeto",
      rotulo: "Projeto",
      render: (l) => (
        <>
          <span className="td-principal">{l.projeto_nome}</span>
          <span className="td-sub" style={{ display: "block" }}>
            {l.codigo_clockify} · {l.cliente_nome || "—"}
          </span>
        </>
      ),
    },
    { chave: "lider", rotulo: "Responsável", render: (l) => l.lider_nome || l.responsavel_nome || "—" },
    { chave: "ciclo", rotulo: "Ciclo", render: (l) => l.ciclo_codigo },
    {
      chave: "assunto",
      rotulo: "Assunto",
      render: (l) => (l.passivel ? l.assunto : <span className="td-sub">—</span>),
    },
    {
      chave: "progresso",
      rotulo: "Ações",
      render: (l) =>
        l.passivel ? (
          <>
            {l.acoes_concluidas}/{l.total_acoes} concluídas
            {Number(l.acoes_atrasadas) ? (
              <span className="td-sub" style={{ display: "block", color: "var(--red-text)" }}>
                {l.acoes_atrasadas} atrasada(s)
              </span>
            ) : null}
          </>
        ) : (
          "—"
        ),
    },
    { chave: "situacao", rotulo: "Situação", render: (l) => <SeloPlano situacao={l.situacao} /> },
    {
      chave: "acoes",
      rotulo: "Ações",
      classe: "td-acoes",
      render: (l) => (
        <>
          {l.passivel ? (
            <BotaoAcao icone="ver" titulo="Ver e preencher o plano" onClick={() => setAbertoId(l.id)} />
          ) : null}
          {ehPmo ? (
            <BotaoAcao
              icone="editar"
              titulo="Alterar decisão / contexto"
              onClick={() =>
                setDecidindo({
                  projeto_id: l.projeto_id,
                  ciclo_id: l.ciclo_id,
                  ciclo: l.ciclo_codigo,
                  projeto: l.projeto_nome,
                  codigo: l.codigo_clockify,
                  cliente: l.cliente_nome,
                  lider: l.lider_nome || l.responsavel_nome,
                  atual: l,
                })
              }
            />
          ) : null}
        </>
      ),
    },
  ];

  const pendentes = dados?.pendentes || [];
  const planos = dados?.itens || [];

  return (
    <>
      <CabecalhoTela
        titulo="Planos de Ação"
        descricao={
          ehPmo
            ? "Ao fim da coleta, decida se cada projeto elegível é passível de plano de ação. Quando for, o líder preenche as ações."
            : "Planos de ação dos seus projetos: preencha as ações e mantenha a situação de cada uma em dia."
        }
      />

      <BarraFiltros>
        <FiltroSelect
          id="f-ciclo"
          rotulo="Ciclo"
          valor={ciclo}
          aoMudar={setCiclo}
          opcoes={[{ valor: "", rotulo: "Todos" }, ...ciclos.map((c) => ({ valor: c.id, rotulo: c.codigo }))]}
        />
        <FiltroSelect
          id="f-situacao"
          rotulo="Situação"
          valor={situacao}
          aoMudar={setSituacao}
          opcoes={[
            { valor: "", rotulo: "Todas" },
            ...Object.entries(SITUACAO_PLANO).map(([valor, s]) => ({ valor, rotulo: s.rotulo })),
          ]}
        />
      </BarraFiltros>

      {erro ? <EstadoErro mensagem={erro} /> : null}
      {!dados && !erro ? <EstadoCarregando mensagem="Carregando planos de ação..." /> : null}

      {dados && ehPmo && pendentes.length ? (
        <section style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: ".95rem", fontWeight: 700, margin: "4px 0 10px" }}>
            Aguardando decisão ({pendentes.length})
          </h3>
          <p style={{ fontSize: ".82rem", color: "var(--text-muted)", marginBottom: 10 }}>
            Projetos elegíveis que já receberam resposta no ciclo. É passível de plano de ação?
          </p>
          <div className="tabela-wrap">
            <Tabela
              colunas={colunasPendentes}
              linhas={pendentes}
              chaveDaLinha={(l) => `${l.projeto_id}|${l.ciclo_id}`}
            />
          </div>
        </section>
      ) : null}

      {dados ? (
        <section>
          {ehPmo ? (
            <h3 style={{ fontSize: ".95rem", fontWeight: 700, margin: "4px 0 10px" }}>
              Decisões e planos ({planos.length})
            </h3>
          ) : null}
          <div className="tabela-wrap">
            <Tabela
              colunas={colunasPlanos}
              linhas={planos}
              chaveDaLinha={(l) => l.id}
              vazio={
                ehPmo
                  ? "Nenhuma decisão registrada ainda."
                  : "Nenhum plano de ação para os seus projetos."
              }
            />
          </div>
        </section>
      ) : null}

      {decidindo ? (
        <ModalDecisao
          alvo={decidindo}
          aoFechar={() => setDecidindo(null)}
          aoSalvar={(planoCriado) => {
            setDecidindo(null);
            carregar();
            // "Sim": abre o plano ja no formato da planilha, pronto para as acoes.
            if (planoCriado) setAbertoId(planoCriado);
          }}
        />
      ) : null}

      {abertoId ? (
        <ModalPlano
          planoId={abertoId}
          ehPmo={ehPmo}
          aoFechar={() => setAbertoId(null)}
          aoAlterar={carregar}
        />
      ) : null}
    </>
  );
}

// ─── Decisao do PMO ────────────────────────────────────────────────────────

function ModalDecisao({
  alvo,
  aoFechar,
  aoSalvar,
}: {
  alvo: AlvoDecisao;
  aoFechar: () => void;
  aoSalvar: (planoCriado?: string) => void;
}) {
  const toast = useToast();
  const [passivel, setPassivel] = useState<"" | "sim" | "nao">(
    alvo.atual ? (alvo.atual.passivel ? "sim" : "nao") : ""
  );
  const [assunto, setAssunto] = useState(alvo.atual?.assunto || "");
  const [objetivo, setObjetivo] = useState(alvo.atual?.objetivo || "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!passivel) {
      setErro("Escolha Sim ou Não.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const r = await api.post<{ id: string; numero: string | null }>("planos-acao", {
        projeto_id: alvo.projeto_id,
        ciclo_id: alvo.ciclo_id,
        passivel: passivel === "sim",
        assunto,
        objetivo,
      });
      toast(
        passivel === "sim"
          ? `Plano de ação ${r.numero} criado. O líder já pode preencher as ações.`
          : "Registrado: sem plano de ação.",
        "sucesso"
      );
      aoSalvar(passivel === "sim" ? r.id : undefined);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo="É passível de plano de ação?"
      subtitulo={`${alvo.codigo} — ${alvo.projeto} · ciclo ${alvo.ciclo}`}
      largo
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Salvando..." : "Salvar",
          classe: "btn-primary",
          onClick: salvar,
          desabilitado: salvando,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {(["sim", "nao"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={passivel === v ? "btn-primary" : "btn-secondary"}
            onClick={() => setPassivel(v)}
            style={{ flex: 1 }}
          >
            {v === "sim" ? "Sim — precisa de plano de ação" : "Não — sem plano de ação"}
          </button>
        ))}
      </div>

      {passivel === "sim" ? (
        // Mesmo quadro da planilha modelo: o PMO preenche Assunto e Objetivo
        // direto na folha; o resto vem sozinho.
        <div className="plano-folha">
          <div className="plano-folha-topo">
            <div className="plano-folha-logo">
              <span role="img" aria-label="Seteg" />
            </div>
            <div className="plano-folha-titulo">PLANO DE AÇÃO</div>
          </div>
          <div className="plano-folha-cab">
            <div className="rot">Assunto:</div>
            <div className="val">
              <input
                aria-label="Assunto"
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                maxLength={200}
                placeholder="Ex.: Comunicação com o cliente"
              />
            </div>
            <div className="rot">Responsável:</div>
            <div className="rot centro">Início:</div>
            <div className="rot centro">Encerrado:</div>
            <div className="rot centro">Nº Plano:</div>

            <div className="rot">Objetivo:</div>
            <div className="val">
              <textarea
                aria-label="Objetivo"
                rows={5}
                value={objetivo}
                onChange={(e) => setObjetivo(e.target.value)}
                maxLength={4000}
                placeholder="O que motivou o plano e onde está a oportunidade de melhoria. O líder lê isto antes de preencher as ações."
              />
            </div>
            <div className="val">{alvo.lider || "—"}</div>
            <div className="val centro">
              {alvo.atual?.inicio ? formatarData(alvo.atual.inicio) : formatarData(new Date().toISOString().slice(0, 10))}
            </div>
            <div className="val centro">{alvo.atual?.encerrado_em ? formatarData(alvo.atual.encerrado_em) : "—"}</div>
            <div className="val centro">
              {alvo.atual?.numero || <span className="td-sub">gerado ao salvar</span>}
            </div>

            <div className="rot ultima">Projeto:</div>
            <div className="val ultima">
              {alvo.codigo} — {alvo.projeto}
            </div>
            <div className="val ultima">Cliente: {alvo.cliente || "—"}</div>
            <div className="val centro ultima">Ciclo {alvo.ciclo}</div>
            <div className="val centro ultima" style={{ gridColumn: "span 2" }} />
          </div>
        </div>
      ) : null}

      {passivel === "nao" && alvo.atual?.passivel && alvo.atual.total_acoes ? (
        <Aviso tipo="atencao">
          Este plano já tem ações lançadas. Remova as ações antes de marcar como não passível.
        </Aviso>
      ) : null}
    </Modal>
  );
}

// ─── Plano: cabecalho + acoes ──────────────────────────────────────────────

function ModalPlano({
  planoId,
  ehPmo,
  aoFechar,
  aoAlterar,
}: {
  planoId: string;
  ehPmo: boolean;
  aoFechar: () => void;
  aoAlterar: () => void;
}) {
  const toast = useToast();
  const [dados, setDados] = useState<{ plano: Plano; acoes: Acao[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Acao | null | undefined>(undefined);
  const [removendo, setRemovendo] = useState<Acao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api
      .get<{ plano: Plano; acoes: Acao[] }>(`planos-acao/${planoId}`)
      .then(setDados)
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível abrir o plano."));
  }, [planoId]);

  useEffect(carregar, [carregar]);

  const recarregarTudo = () => {
    carregar();
    aoAlterar();
  };

  async function encerrar(encerrarPlano: boolean) {
    setOcupado(true);
    try {
      await api.post(`planos-acao/${planoId}/encerrar`, { encerrar: encerrarPlano });
      toast(encerrarPlano ? "Plano encerrado." : "Plano reaberto.", "sucesso");
      recarregarTudo();
    } catch (e) {
      toast(e instanceof ErroApi ? e.message : "Não foi possível alterar o plano.", "erro");
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    if (!removendo) return;
    setOcupado(true);
    try {
      await api.post(`planos-acao/${planoId}/acoes`, { remover: true, item_id: removendo.id });
      toast("Ação removida.", "sucesso");
      setRemovendo(null);
      recarregarTudo();
    } catch (e) {
      toast(e instanceof ErroApi ? e.message : "Não foi possível remover.", "erro");
    } finally {
      setOcupado(false);
    }
  }

  const plano = dados?.plano;
  const aberto = plano ? !plano.encerrado_em : false;

  // Acoes paginadas de 10 em 10, como as demais tabelas.
  const paginaAcoes = usePaginacaoLocal(dados?.acoes || []);

  const acoesModal = [
    ...(ehPmo && plano
      ? [
          {
            rotulo: aberto ? "Encerrar plano" : "Reabrir plano",
            classe: "btn-secondary",
            onClick: () => encerrar(aberto),
            desabilitado: ocupado,
          },
        ]
      : []),
    { rotulo: "Fechar", classe: "btn-primary", onClick: aoFechar },
  ];

  return (
    <>
      <Modal
        titulo={plano ? `Plano de ação ${plano.numero}` : "Plano de ação"}
        subtitulo={plano ? `${plano.codigo_clockify} — ${plano.projeto_nome}` : undefined}
        largo
        aoFechar={aoFechar}
        acoes={acoesModal}
      >
        {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}
        {!dados && !erro ? <EstadoCarregando /> : null}

        {plano ? (
          <>
            {/* Formato da planilha modelo do PMO (images/): faixa de titulo,
                quadro do cabecalho e tabela 5W2H com a situacao colorida. */}
            <div className="plano-folha">
              <div className="plano-folha-topo">
                <div className="plano-folha-logo">
                  <span role="img" aria-label="Seteg" />
                </div>
                <div className="plano-folha-titulo">PLANO DE AÇÃO</div>
              </div>
              <div className="plano-folha-cab">
                <div className="rot">Assunto:</div>
                <div className="val">{plano.assunto}</div>
                <div className="rot">Responsável:</div>
                <div className="rot centro">Início:</div>
                <div className="rot centro">Encerrado:</div>
                <div className="rot centro">Nº Plano:</div>

                <div className="rot">Objetivo:</div>
                <div className="val">{plano.objetivo}</div>
                <div className="val">{plano.lider_nome || plano.responsavel_nome || "—"}</div>
                <div className="val centro">{formatarData(plano.inicio)}</div>
                <div className="val centro">{plano.encerrado_em ? formatarData(plano.encerrado_em) : "—"}</div>
                <div className="val centro">{plano.numero}</div>

                <div className="rot ultima">Projeto:</div>
                <div className="val ultima">
                  {plano.codigo_clockify} — {plano.projeto_nome}
                </div>
                <div className="val ultima">Cliente: {plano.cliente_nome || "—"}</div>
                <div className="val centro ultima">Ciclo {plano.ciclo_codigo}</div>
                <div className="val centro ultima" style={{ gridColumn: "span 2" }}>
                  <SeloPlano situacao={plano.situacao} />
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                margin: "20px 0 10px",
              }}
            >
              <strong style={{ fontSize: ".92rem" }}>Ações ({dados?.acoes.length || 0})</strong>
              {aberto ? (
                <button type="button" className="btn-primary" onClick={() => setEditando(null)}>
                  + Adicionar ação
                </button>
              ) : null}
            </div>

            {!aberto ? (
              <Aviso tipo="info">Plano encerrado: as ações ficam só para consulta.</Aviso>
            ) : null}

            {dados?.acoes.length ? (
              <>
                <div className="tabela-scroll">
                  <table className="plano-tabela">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>O que fazer?<small>"What"</small></th>
                        <th>Por que fazer?<small>"Why"</small></th>
                        <th>Onde fazer?<small>"Where"</small></th>
                        <th>Quem vai fazer?<small>"Who"</small></th>
                        <th>Quanto vai custar?<small>"How Much"</small></th>
                        <th>Prazo<small>"When"</small></th>
                        <th>Situação<small>"Status"</small></th>
                        {aberto ? <th>Ações</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {paginaAcoes.visiveis.map((a) => {
                        const s = SITUACAO_ACAO[a.situacao_efetiva] || SITUACAO_ACAO.no_prazo;
                        const automatico = a.situacao_efetiva === "atrasado" && a.situacao !== "atrasado";
                        return (
                          <tr key={a.id}>
                            <td className="item">{a.ordem}</td>
                            <td>
                              <span className="td-principal">{a.o_que}</span>
                              {a.observacao ? (
                                <span className="td-sub" style={{ display: "block" }}>
                                  {a.observacao}
                                </span>
                              ) : null}
                            </td>
                            <td>{a.por_que || "—"}</td>
                            <td>{a.onde || "—"}</td>
                            <td>{a.quem || "—"}</td>
                            <td className="num">{reais(a.quanto)}</td>
                            <td className="data">{formatarData(a.prazo)}</td>
                            <td
                              className={`status ${a.situacao_efetiva}`}
                              title={automatico ? "Prazo vencido e ação não concluída" : undefined}
                            >
                              {s.rotulo}
                            </td>
                            {aberto ? (
                              <td className="acoes">
                                <BotaoAcao icone="editar" titulo="Editar ação" onClick={() => setEditando(a)} />
                                <BotaoAcao
                                  icone="inativar"
                                  titulo="Remover ação"
                                  perigo
                                  onClick={() => setRemovendo(a)}
                                />
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {paginaAcoes.barra}
              </>
            ) : (
              <p style={{ fontSize: ".85rem", color: "var(--text-muted)", padding: "10px 0" }}>
                Nenhuma ação lançada ainda.
              </p>
            )}
          </>
        ) : null}
      </Modal>

      {editando !== undefined && plano ? (
        <ModalAcao
          planoId={planoId}
          acao={editando}
          aoFechar={() => setEditando(undefined)}
          aoSalvar={() => {
            setEditando(undefined);
            recarregarTudo();
          }}
        />
      ) : null}

      {removendo ? (
        <Confirmacao
          titulo="Remover ação?"
          mensagem={`"${removendo.o_que}" sairá do plano. O registro fica na auditoria.`}
          rotuloConfirmar="Remover"
          ocupado={ocupado}
          aoConfirmar={remover}
          aoCancelar={() => setRemovendo(null)}
        />
      ) : null}
    </>
  );
}

// ─── Acao (criar/editar) ───────────────────────────────────────────────────

function ModalAcao({
  planoId,
  acao,
  aoFechar,
  aoSalvar,
}: {
  planoId: string;
  acao: Acao | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [oQue, setOQue] = useState(acao?.o_que || "");
  const [porQue, setPorQue] = useState(acao?.por_que || "");
  const [onde, setOnde] = useState(acao?.onde || "");
  const [quem, setQuem] = useState(acao?.quem || "");
  const [quanto, setQuanto] = useState(
    acao?.quanto !== null && acao?.quanto !== undefined ? String(acao.quanto).replace(".", ",") : ""
  );
  const [prazo, setPrazo] = useState(acao?.prazo || "");
  const [situacao, setSituacao] = useState(acao?.situacao || "no_prazo");
  const [observacao, setObservacao] = useState(acao?.observacao || "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await api.post(`planos-acao/${planoId}/acoes`, {
        item_id: acao?.id,
        o_que: oQue,
        por_que: porQue,
        onde,
        quem,
        quanto,
        prazo,
        situacao,
        observacao,
      });
      toast(acao ? "Ação atualizada." : "Ação adicionada.", "sucesso");
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar a ação.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={acao ? `Editar ação ${acao.ordem}` : "Nova ação"}
      largo
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Salvando..." : "Salvar",
          classe: "btn-primary",
          onClick: salvar,
          desabilitado: salvando,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}
      <div className="form-grade">
        <CampoArea
          nome="o_que"
          rotulo='O que fazer? ("What")'
          obrigatorio
          larguraTotal
          linhas={2}
          valor={oQue}
          aoMudar={setOQue}
          maxLength={1000}
        />
        <CampoArea
          nome="por_que"
          rotulo='Por que fazer? ("Why")'
          larguraTotal
          linhas={2}
          valor={porQue}
          aoMudar={setPorQue}
          maxLength={1000}
        />
        <CampoTexto nome="onde" rotulo='Onde fazer? ("Where")' valor={onde} aoMudar={setOnde} maxLength={300} />
        <CampoTexto nome="quem" rotulo='Quem vai fazer? ("Who")' valor={quem} aoMudar={setQuem} maxLength={300} />
        <CampoTexto
          nome="quanto"
          rotulo='Quanto vai custar? ("How much")'
          valor={quanto}
          aoMudar={setQuanto}
          placeholder="Ex.: 200,00"
          maxLength={20}
        />
        <CampoTexto nome="prazo" rotulo="Prazo" tipo="date" valor={prazo} aoMudar={setPrazo} />
        <CampoSelect
          nome="situacao"
          rotulo='Situação ("Status")'
          valor={situacao}
          aoMudar={setSituacao}
          vazio={null}
          opcoes={OPCOES_SITUACAO_ACAO}
          ajuda="Com o prazo vencido e sem marcar Concluído, a ação aparece como Atrasada sozinha."
        />
        <CampoArea
          nome="observacao"
          rotulo="Observação / evidência"
          larguraTotal
          linhas={2}
          valor={observacao}
          aoMudar={setObservacao}
          maxLength={2000}
        />
      </div>
    </Modal>
  );
}
