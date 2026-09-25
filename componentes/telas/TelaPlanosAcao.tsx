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
import { GradeDetalhes } from "@/componentes/Detalhes";
import { Aviso, EstadoCarregando, EstadoErro } from "@/componentes/Estados";
import { Confirmacao, Modal } from "@/componentes/Modal";
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

function SeloAcao({ acao }: { acao: Acao }) {
  const s = SITUACAO_ACAO[acao.situacao_efetiva] || SITUACAO_ACAO.no_prazo;
  // Marcada "no prazo" mas vencida: explica por que aparece atrasada.
  const automatico = acao.situacao_efetiva === "atrasado" && acao.situacao !== "atrasado";
  return (
    <span title={automatico ? "Prazo vencido e ação não concluída" : undefined}>
      <Selo tom={s.tom}>{s.rotulo}</Selo>
    </span>
  );
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
          aoSalvar={() => {
            setDecidindo(null);
            carregar();
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
  aoSalvar: () => void;
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
      const r = await api.post<{ numero: string | null }>("planos-acao", {
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
      aoSalvar();
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
        <div className="form-grade">
          <CampoTexto
            nome="assunto"
            rotulo="Assunto"
            obrigatorio
            larguraTotal
            valor={assunto}
            aoMudar={setAssunto}
            maxLength={200}
            placeholder="Ex.: Comunicação com o cliente"
          />
          <CampoArea
            nome="objetivo"
            rotulo="Objetivo / contexto geral"
            obrigatorio
            larguraTotal
            linhas={5}
            valor={objetivo}
            aoMudar={setObjetivo}
            maxLength={4000}
            ajuda="O que motivou o plano e onde está a oportunidade de melhoria. O líder lê isto antes de preencher as ações."
          />
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

  const colunas: Coluna<Acao>[] = [
    { chave: "ordem", rotulo: "Item", classe: "td-num", render: (a) => a.ordem },
    {
      chave: "o_que",
      rotulo: "O que fazer?",
      render: (a) => (
        <>
          <span className="td-principal">{a.o_que}</span>
          {a.observacao ? (
            <span className="td-sub" style={{ display: "block" }}>
              {a.observacao}
            </span>
          ) : null}
        </>
      ),
    },
    { chave: "por_que", rotulo: "Por que fazer?", render: (a) => a.por_que || "—" },
    { chave: "onde", rotulo: "Onde fazer?", render: (a) => a.onde || "—" },
    { chave: "quem", rotulo: "Quem vai fazer?", render: (a) => a.quem || "—" },
    { chave: "quanto", rotulo: "Quanto vai custar?", render: (a) => reais(a.quanto) },
    { chave: "prazo", rotulo: "Prazo", render: (a) => formatarData(a.prazo) },
    { chave: "situacao", rotulo: "Situação", render: (a) => <SeloAcao acao={a} /> },
    ...(aberto
      ? [
          {
            chave: "acoes",
            rotulo: "Ações",
            classe: "td-acoes",
            render: (a: Acao) => (
              <>
                <BotaoAcao icone="editar" titulo="Editar ação" onClick={() => setEditando(a)} />
                <BotaoAcao icone="inativar" titulo="Remover ação" perigo onClick={() => setRemovendo(a)} />
              </>
            ),
          },
        ]
      : []),
  ];

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
            <GradeDetalhes
              itens={[
                { rotulo: "Assunto", valor: plano.assunto, largo: true },
                { rotulo: "Objetivo", valor: plano.objetivo, largo: true },
                { rotulo: "Responsável", valor: plano.lider_nome || plano.responsavel_nome },
                { rotulo: "Cliente", valor: plano.cliente_nome },
                { rotulo: "Ciclo", valor: plano.ciclo_codigo },
                { rotulo: "Início", valor: formatarData(plano.inicio) },
                { rotulo: "Encerrado", valor: plano.encerrado_em ? formatarData(plano.encerrado_em) : null },
                { rotulo: "Nº do plano", valor: plano.numero },
                { rotulo: "Situação", valor: <SeloPlano situacao={plano.situacao} /> },
              ]}
            />

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

            <div className="tabela-scroll">
              <Tabela
                colunas={colunas}
                linhas={dados?.acoes || []}
                chaveDaLinha={(a) => a.id}
                vazio="Nenhuma ação lançada ainda."
              />
            </div>
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
