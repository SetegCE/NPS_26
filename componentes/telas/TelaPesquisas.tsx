"use client";

// Pesquisas: cada combinacao projeto + respondente gera uma pesquisa
// individual, com link proprio.

import { useEffect, useMemo, useState } from "react";
import { CampoSelect } from "@/componentes/Campo";
import { GradeDetalhes } from "@/componentes/Detalhes";
import { Aviso } from "@/componentes/Estados";
import { Modal } from "@/componentes/Modal";
import { BotaoAcao, type Coluna } from "@/componentes/Tabela";
import {
  BarraFiltros,
  CabecalhoTela,
  CorpoLista,
  FiltroBusca,
  FiltroSelect,
} from "@/componentes/Tela";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi, type Pagina } from "@/lib/cliente/api";
import { auxiliares, cicloAberto, useAuxiliar } from "@/lib/cliente/auxiliares";
import { copiarTexto } from "@/lib/cliente/copiar";
import { categoriaDaNota, formatarData, rotuloDoCanal } from "@/lib/formato";
import type { Sessao } from "@/lib/cliente/tipos";
import { useLista } from "@/lib/cliente/useLista";

export interface Pesquisa extends Record<string, unknown> {
  id: string;
  projeto_id: string;
  projeto_nome: string;
  codigo_clockify: string;
  cliente_nome: string | null;
  respondente_nome: string;
  tipo: string;
  ciclo_codigo: string | null;
  status: string;
  data_geracao: string | null;
  data_envio: string | null;
  data_resposta: string | null;
}

const TIPOS = [
  { valor: "ciclo_semestral", rotulo: "Pesquisa de Ciclo Semestral" },
  { valor: "finalizacao", rotulo: "Pesquisa de Finalização" },
];

const STATUS = [
  { valor: "gerada", rotulo: "Gerada" },
  { valor: "enviada", rotulo: "Enviada" },
  { valor: "respondida", rotulo: "Respondida" },
  { valor: "pendente", rotulo: "Pendente" },
  { valor: "encerrada", rotulo: "Encerrada" },
];

// "Enviada" nao e mais escolhivel (nao ha controle de envio), mas o rotulo
// fica para exibir registros antigos que tenham essa situacao.
const STATUS_ESCOLHIVEIS = STATUS.filter((s) => s.valor !== "enviada");

const TOM_STATUS: Record<string, string> = {
  gerada: "selo-azul",
  enviada: "selo-laranja",
  respondida: "selo-verde",
  pendente: "selo-amarelo",
  encerrada: "selo-neutro",
};

export function SeloStatusPesquisa({ status }: { status: string }) {
  const rotulo = STATUS.find((s) => s.valor === status)?.rotulo || status;
  return <span className={`selo ${TOM_STATUS[status] || "selo-neutro"}`}>{rotulo}</span>;
}

const VAZIO = { ciclo: "", tipo: "", status: "" };

export function TelaPesquisas({ sessao }: { sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const toast = useToast();
  const ciclos = useAuxiliar(auxiliares.ciclos);

  const [f, setF] = useState(VAZIO);
  // "escolha" abre o seletor Ciclo/Finalizacao; "finalizacao" abre o
  // formulario individual. O ciclo nao tem formulario: gera em lote direto.
  const [gerando, setGerando] = useState<null | "escolha" | "finalizacao">(null);
  const [resumoLote, setResumoLote] = useState<ResumoLote | null>(null);
  const [alterandoStatus, setAlterandoStatus] = useState<Pesquisa | null>(null);
  const [vendoResposta, setVendoResposta] = useState<Pesquisa | null>(null);
  const [linkGerado, setLinkGerado] = useState<string | null>(null);
  const [copiandoId, setCopiandoId] = useState<string | null>(null);

  // `ativo: true` e fixo: pesquisa encerrada some da operacao do dia a dia,
  // mas continua no historico do projeto.
  const filtros = useMemo(() => ({ ...f, ativo: "true" }), [f]);
  const lista = useLista<Pesquisa>("pesquisas", {
    ordemInicial: { campo: "data_geracao", ascending: false },
    filtros,
  });

  /** Busca o link sob demanda: o token nunca vem na listagem. */
  async function copiarLink(id: string) {
    setCopiandoId(id);
    try {
      const { link } = await api.get<{ link: string }>(`pesquisas/${id}/link`);
      await copiarTexto(link);
      toast("Link copiado para a área de transferência.", "sucesso");
    } catch (e) {
      toast(e instanceof ErroApi ? e.message : "Não foi possível copiar o link.", "erro");
    } finally {
      setCopiandoId(null);
    }
  }

  const colunas: Coluna<Pesquisa>[] = [
    {
      chave: "projeto_nome",
      rotulo: "Projeto",
      ordenavel: true,
      render: (l) => (
        <>
          <span className="td-principal">{l.projeto_nome}</span>
          <span className="td-sub" style={{ display: "block" }}>
            {l.codigo_clockify} · {l.cliente_nome || "—"}
          </span>
        </>
      ),
    },
    { chave: "respondente_nome", rotulo: "Respondente", ordenavel: true },
    {
      chave: "tipo",
      rotulo: "Tipo",
      render: (l) => (l.tipo === "finalizacao" ? "Finalização" : "Ciclo semestral"),
    },
    { chave: "ciclo_codigo", rotulo: "Ciclo", render: (l) => l.ciclo_codigo || "—" },
    {
      chave: "status",
      rotulo: "Situação",
      ordenavel: true,
      render: (l) => <SeloStatusPesquisa status={l.status} />,
    },
    {
      chave: "data_geracao",
      rotulo: "Gerada",
      ordenavel: true,
      render: (l) => formatarData(l.data_geracao),
    },
    { chave: "data_resposta", rotulo: "Respondida", render: (l) => formatarData(l.data_resposta) },
    {
      chave: "acoes",
      rotulo: "Ações",
      classe: "td-acoes",
      render: (l) => (
        <>
          <BotaoAcao
            icone="ver"
            titulo={l.status === "respondida" ? "Ver pesquisa e resposta" : "Ver pesquisa"}
            onClick={() => setVendoResposta(l)}
          />
          <BotaoAcao
            icone="link"
            titulo="Copiar link da pesquisa"
            onClick={() => copiarLink(l.id)}
            desabilitado={copiandoId === l.id}
          />
          {ehPmo && l.status !== "respondida" ? (
            <BotaoAcao
              icone="status"
              titulo="Alterar situação"
              onClick={() => setAlterandoStatus(l)}
            />
          ) : null}
        </>
      ),
    },
  ];

  const mudar = (campo: keyof typeof VAZIO, valor: string) =>
    setF((atual) => ({ ...atual, [campo]: valor }));

  return (
    <>
      <CabecalhoTela
        titulo="Pesquisas"
        descricao="Cada combinação projeto + respondente gera uma pesquisa individual, com link próprio."
        acoes={
          ehPmo ? (
            <button type="button" className="btn-primary" onClick={() => setGerando("escolha")}>
              + Gerar Pesquisa
            </button>
          ) : null
        }
      />

      <BarraFiltros>
        <FiltroBusca
          placeholder="Projeto, respondente ou cliente"
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
          id="f-tipo"
          rotulo="Tipo"
          valor={f.tipo}
          aoMudar={(v) => mudar("tipo", v)}
          opcoes={[{ valor: "", rotulo: "Todos" }, ...TIPOS]}
        />
        <FiltroSelect
          id="f-status"
          rotulo="Situação"
          valor={f.status}
          aoMudar={(v) => mudar("status", v)}
          opcoes={[{ valor: "", rotulo: "Todas" }, ...STATUS_ESCOLHIVEIS]}
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
          chaveDaLinha={(l) => l.id}
          vazio="Nenhuma pesquisa encontrada."
        />
      </div>

      {gerando === "escolha" ? (
        <EscolhaGeracao
          aoFechar={() => setGerando(null)}
          aoEscolherFinalizacao={() => setGerando("finalizacao")}
          aoGerarLote={(resumo) => {
            setGerando(null);
            setResumoLote(resumo);
            lista.recarregar();
          }}
        />
      ) : null}

      {gerando === "finalizacao" ? (
        <Geracao
          tipoFixo="finalizacao"
          aoFechar={() => setGerando(null)}
          aoGerar={(link) => {
            setGerando(null);
            setLinkGerado(link);
            lista.recarregar();
          }}
        />
      ) : null}

      {resumoLote ? <ResumoGeracaoLote resumo={resumoLote} aoFechar={() => setResumoLote(null)} /> : null}

      {linkGerado ? (
        <LinkGerado
          link={linkGerado}
          titulo="Pesquisa gerada com sucesso."
          aoFechar={() => setLinkGerado(null)}
        />
      ) : null}

      {vendoResposta ? (
        <VerResposta pesquisa={vendoResposta} aoFechar={() => setVendoResposta(null)} />
      ) : null}

      {alterandoStatus ? (
        <AlterarStatus
          pesquisa={alterandoStatus}
          aoFechar={() => setAlterandoStatus(null)}
          aoSalvar={() => {
            setAlterandoStatus(null);
            lista.recarregar();
            toast("Situação atualizada.", "sucesso");
          }}
        />
      ) : null}
    </>
  );
}

// ─── Escolha do tipo + geracao em lote do ciclo ────────────────────────────

interface ResumoLote {
  ciclo: string;
  projetos: number;
  geradas: number;
  existentes: number;
  falhas: number;
  sem_respondente: number;
}

const STATUS_CICLO: Record<string, string> = {
  aberto: "Aberto",
  planejamento: "Em planejamento",
};

/**
 * Primeiro passo do "Gerar Pesquisa". Finalizacao segue para o formulario
 * individual (projeto + respondente). Ciclo nao pede mais nada: clicar no
 * ciclo gera de uma vez as pesquisas de todos os projetos elegiveis dele.
 */
function EscolhaGeracao({
  aoFechar,
  aoEscolherFinalizacao,
  aoGerarLote,
}: {
  aoFechar: () => void;
  aoEscolherFinalizacao: () => void;
  aoGerarLote: (resumo: ResumoLote) => void;
}) {
  const ciclos = useAuxiliar(auxiliares.ciclos);
  const disponiveis = ciclos.filter((c) => c.status !== "encerrado");
  const [gerandoCiclo, setGerandoCiclo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function gerarCiclo(cicloId: string) {
    setErro(null);
    setGerandoCiclo(cicloId);
    try {
      aoGerarLote(await api.post<ResumoLote>("pesquisas/lote", { ciclo_id: cicloId }));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível gerar as pesquisas do ciclo.");
      setGerandoCiclo(null);
    }
  }

  const ocupado = gerandoCiclo !== null;

  return (
    <Modal
      titulo="Gerar pesquisa"
      subtitulo="Escolha o tipo de pesquisa."
      aoFechar={ocupado ? () => undefined : aoFechar}
      acoes={[{ rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar, desabilitado: ocupado }]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      <div className="escolha-geracao">
        <div>
          <div className="escolha-grupo-titulo">Pesquisa de ciclo</div>
          <div className="escolha-opcoes">
            {disponiveis.length ? (
              disponiveis.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="escolha-opcao"
                  disabled={ocupado}
                  onClick={() => gerarCiclo(c.id)}
                >
                  <span>
                    <strong>Ciclo {c.codigo}</strong>
                    <small>
                      {gerandoCiclo === c.id
                        ? "Gerando pesquisas..."
                        : `${STATUS_CICLO[c.status] || c.status} · ${c.total_elegiveis ?? 0} projetos elegíveis — gera todas automaticamente`}
                    </small>
                  </span>
                  <span className="escolha-seta">›</span>
                </button>
              ))
            ) : (
              <small style={{ color: "var(--text-muted)" }}>
                Nenhum ciclo aberto ou em planejamento.
              </small>
            )}
          </div>
        </div>

        <div>
          <div className="escolha-grupo-titulo">Pesquisa de finalização</div>
          <button
            type="button"
            className="escolha-opcao"
            disabled={ocupado}
            onClick={aoEscolherFinalizacao}
          >
            <span>
              <strong>Finalização de projeto</strong>
              <small>Escolha o projeto e o respondente.</small>
            </span>
            <span className="escolha-seta">›</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ResumoGeracaoLote({ resumo, aoFechar }: { resumo: ResumoLote; aoFechar: () => void }) {
  return (
    <Modal
      titulo={`Pesquisas do ciclo ${resumo.ciclo}`}
      aoFechar={aoFechar}
      acoes={[{ rotulo: "Fechar", classe: "btn-primary", onClick: aoFechar }]}
    >
      {resumo.falhas ? (
        <Aviso tipo="atencao">
          {resumo.falhas} pesquisa(s) não puderam ser geradas. Tente novamente; as já geradas
          não serão duplicadas.
        </Aviso>
      ) : null}
      <div style={{ fontSize: ".88rem", lineHeight: 1.8 }}>
        <div>
          Projetos elegíveis: <strong>{resumo.projetos}</strong>
        </div>
        <div>
          Pesquisas geradas agora: <strong>{resumo.geradas}</strong>
        </div>
        <div>
          Já existiam (mantidas): <strong>{resumo.existentes}</strong>
        </div>
        {resumo.sem_respondente ? (
          <div>
            Projetos sem respondente vinculado: <strong>{resumo.sem_respondente}</strong>
          </div>
        ) : null}
      </div>
      <p style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: 10 }}>
        Os links ficam na lista de pesquisas, no botão de copiar link de cada linha.
      </p>
    </Modal>
  );
}

// ─── Geracao ───────────────────────────────────────────────────────────────

interface ProjetoOpcao {
  id: string;
  nome: string;
  codigo_clockify: string;
}

interface Duplicada {
  pesquisa: Partial<Pesquisa>;
  link: string;
}

export function Geracao({
  projetoPre,
  tipoFixo,
  aoFechar,
  aoGerar,
}: {
  projetoPre?: string;
  /** Tipo ja escolhido antes de abrir: esconde os campos de tipo e ciclo. */
  tipoFixo?: "ciclo_semestral" | "finalizacao";
  aoFechar: () => void;
  aoGerar: (link: string) => void;
}) {
  const toast = useToast();
  const ciclos = useAuxiliar(auxiliares.ciclos);
  const aberto = cicloAberto(ciclos.filter((c) => c.status === "aberto"));

  const [projetos, setProjetos] = useState<ProjetoOpcao[]>([]);
  const [projetoId, setProjetoId] = useState(projetoPre || "");
  const [respondentes, setRespondentes] = useState<{ id: string; nome: string }[]>([]);
  const [carregandoResp, setCarregandoResp] = useState(false);
  const [respondenteId, setRespondenteId] = useState("");
  const [tipo, setTipo] = useState<string>(tipoFixo || "ciclo_semestral");
  const [cicloId, setCicloId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [duplicada, setDuplicada] = useState<Duplicada | null>(null);

  useEffect(() => {
    api
      .get<Pagina<ProjetoOpcao>>("projetos", { porPagina: 200, ativo: true })
      .then((r) => setProjetos(r.itens || []))
      .catch(() => setProjetos([]));
  }, []);

  // O ciclo aberto e o padrao, mas so depois que a lista chega.
  useEffect(() => {
    if (aberto && !cicloId && tipo !== "finalizacao") setCicloId(aberto.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // Respondentes dependem do projeto: a pesquisa so pode ir para quem esta
  // vinculado aquele projeto.
  useEffect(() => {
    setRespondenteId("");
    if (!projetoId) {
      setRespondentes([]);
      return;
    }
    let ativo = true;
    setCarregandoResp(true);
    api
      .get<Pagina<{ id: string; nome: string }>>("respondentes", {
        projeto: projetoId,
        porPagina: 200,
        ativo: true,
      })
      .then((r) => {
        if (ativo) setRespondentes(r.itens || []);
      })
      .catch(() => {
        if (ativo) setRespondentes([]);
      })
      .finally(() => {
        if (ativo) setCarregandoResp(false);
      });
    return () => {
      ativo = false;
    };
  }, [projetoId]);

  // Pesquisa de finalizacao nao pertence a ciclo nenhum.
  const finalizacao = tipo === "finalizacao";
  useEffect(() => {
    if (finalizacao) setCicloId("");
    else if (!cicloId && aberto) setCicloId(aberto.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalizacao]);

  async function gerar(forcar = false) {
    if (!projetoId || !respondenteId) {
      setErro("Selecione o projeto e o respondente.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const r = await api.post<{ link: string }>("pesquisas", {
        projeto_id: projetoId,
        respondente_id: respondenteId,
        tipo,
        ciclo_id: cicloId,
        forcar,
      });
      aoGerar(r.link);
    } catch (e) {
      setSalvando(false);
      if (e instanceof ErroApi && e.status === 409) {
        const corpo = e.corpo as { pesquisa?: Partial<Pesquisa>; link?: string } | null;
        if (corpo?.link) {
          setDuplicada({ pesquisa: corpo.pesquisa || {}, link: corpo.link });
          return;
        }
      }
      setErro(e instanceof ErroApi ? e.message : "Não foi possível gerar a pesquisa.");
    }
  }

  const rotuloRespondentes = !projetoId
    ? "Selecione o projeto primeiro..."
    : carregandoResp
      ? "Carregando..."
      : respondentes.length
        ? "Selecione..."
        : "Nenhum respondente vinculado a este projeto";

  return (
    <>
      <Modal
        titulo={tipoFixo === "finalizacao" ? "Gerar pesquisa de finalização" : "Gerar pesquisa"}
        subtitulo="Projeto + respondente = uma pesquisa individual."
        aoFechar={aoFechar}
        acoes={[
          { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
          {
            rotulo: salvando ? "Gerando..." : "Gerar pesquisa",
            classe: "btn-primary",
            onClick: () => gerar(false),
            desabilitado: salvando,
          },
        ]}
      >
        {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

        <div className="form-grade">
          <CampoSelect
            nome="projeto_id"
            rotulo="Projeto"
            obrigatorio
            larguraTotal
            valor={projetoId}
            aoMudar={setProjetoId}
            vazio="Selecione o projeto..."
            opcoes={projetos.map((p) => ({
              valor: p.id,
              rotulo: `${p.codigo_clockify} — ${p.nome}`,
            }))}
          />
          <CampoSelect
            nome="respondente_id"
            rotulo="Respondente"
            obrigatorio
            larguraTotal
            valor={respondenteId}
            aoMudar={setRespondenteId}
            vazio={rotuloRespondentes}
            opcoes={respondentes.map((r) => ({ valor: r.id, rotulo: r.nome }))}
            ajuda="Lista os respondentes vinculados ao projeto escolhido."
          />
          {tipoFixo ? null : (
            <>
              <CampoSelect
                nome="tipo"
                rotulo="Tipo de pesquisa"
                obrigatorio
                valor={tipo}
                aoMudar={setTipo}
                vazio={null}
                opcoes={TIPOS}
              />
              <CampoSelect
                nome="ciclo_id"
                rotulo="Ciclo"
                valor={cicloId}
                aoMudar={setCicloId}
                desabilitado={finalizacao}
                vazio="Não se aplica"
                opcoes={ciclos
                  .filter((c) => c.status !== "encerrado")
                  .map((c) => ({ valor: c.id, rotulo: c.codigo }))}
                ajuda="Obrigatório para pesquisa de ciclo semestral."
              />
            </>
          )}
        </div>
      </Modal>

      {duplicada ? (
        <Modal
          titulo="Pesquisa já existente"
          aoFechar={() => setDuplicada(null)}
          acoes={[
            { rotulo: "Cancelar", classe: "btn-secondary", onClick: () => setDuplicada(null) },
            {
              rotulo: "Copiar link existente",
              classe: "btn-secondary",
              onClick: async () => {
                await copiarTexto(duplicada.link);
                toast("Link da pesquisa existente copiado.", "sucesso");
                setDuplicada(null);
                aoFechar();
              },
            },
            {
              rotulo: "Gerar nova mesmo assim",
              classe: "btn-primary",
              onClick: () => {
                setDuplicada(null);
                gerar(true);
              },
            },
          ]}
        >
          <Aviso tipo="atencao">
            <strong>Já existe uma pesquisa para este projeto e respondente.</strong>
          </Aviso>
          <div style={{ fontSize: ".85rem", lineHeight: 1.7 }}>
            <div>
              Situação: <strong>{duplicada.pesquisa.status || "—"}</strong>
            </div>
            <div>
              Gerada em: <strong>{formatarData(duplicada.pesquisa.data_geracao)}</strong>
            </div>
            {duplicada.pesquisa.data_resposta ? (
              <div>
                Respondida em: <strong>{formatarData(duplicada.pesquisa.data_resposta)}</strong>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function LinkGerado({
  link,
  titulo,
  aoFechar,
}: {
  link: string;
  titulo: string;
  aoFechar: () => void;
}) {
  const toast = useToast();

  return (
    <Modal
      titulo={titulo}
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Fechar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: "Copiar link",
          classe: "btn-primary",
          onClick: async () => {
            await copiarTexto(link);
            toast("Link copiado.", "sucesso");
          },
        },
      ]}
    >
      <p style={{ fontSize: ".85rem", color: "var(--text-muted)", marginBottom: 10 }}>
        Envie este link ao respondente. Ele identifica automaticamente o projeto, o cliente e o
        próprio respondente.
      </p>
      <input
        type="text"
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
        style={{
          width: "100%",
          padding: "9px 10px",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-sm)",
          background: "var(--surface-2)",
          fontFamily: "inherit",
          fontSize: ".82rem",
        }}
      />
    </Modal>
  );
}

// ─── Ver resposta ──────────────────────────────────────────────────────────

interface Resposta {
  nota_q1: number | null;
  nota_q2: number | null;
  nota_q3: number | null;
  nota_q4: number | null;
  feedback: string | null;
  timestamp: string | null;
  canal_resposta: string | null;
}

// Enunciados identicos aos do formulario publico (app/pesquisa/[token]).
const PERGUNTAS_RESPOSTA: { campo: keyof Resposta; titulo: string }[] = [
  { campo: "nota_q1", titulo: "De 0 a 10 qual nota você atribui ao trabalho da Seteg?" },
  {
    campo: "nota_q2",
    titulo: "De 0 a 10 o quanto você está satisfeito com o seu relacionamento com nossa equipe?",
  },
  {
    campo: "nota_q3",
    titulo: "De 0 a 10 o quão efetiva é a comunicação com os canais de acesso a Seteg?",
  },
  {
    campo: "nota_q4",
    titulo: "De 0 a 10 o quanto você nos indicaria a um amigo, familiar ou parceiro de negócios?",
  },
];

/** Mesmas faixas do NPS: 9–10 verde, 7–8 amarelo, 0–6 vermelho. */
function seloDaNota(nota: number | null) {
  const cat = categoriaDaNota(nota);
  const tom =
    cat === "PROMOTOR" ? "selo-verde" : cat === "NEUTRO" ? "selo-amarelo" : cat ? "selo-vermelho" : "selo-neutro";
  return (
    <span className={`selo ${tom}`} style={{ minWidth: 36, justifyContent: "center" }}>
      {nota ?? "—"}
    </span>
  );
}

function VerResposta({ pesquisa, aoFechar }: { pesquisa: Pesquisa; aoFechar: () => void }) {
  const respondida = pesquisa.status === "respondida";
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // So pesquisa respondida tem resposta a buscar.
    if (!respondida) return;
    let ativo = true;
    api
      .get<{ resposta: Resposta }>(`pesquisas/${pesquisa.id}/resposta`)
      .then((r) => {
        if (ativo) setResposta(r.resposta);
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar a resposta.");
      });
    return () => {
      ativo = false;
    };
  }, [pesquisa.id, respondida]);

  return (
    <Modal
      titulo="Pesquisa"
      subtitulo={`${pesquisa.projeto_nome} — ${pesquisa.respondente_nome}`}
      largo
      aoFechar={aoFechar}
      acoes={[{ rotulo: "Fechar", classe: "btn-primary", onClick: aoFechar }]}
    >
      <GradeDetalhes
        itens={[
          { rotulo: "Projeto", valor: pesquisa.projeto_nome },
          { rotulo: "Código", valor: pesquisa.codigo_clockify },
          { rotulo: "Cliente", valor: pesquisa.cliente_nome },
          { rotulo: "Respondente", valor: pesquisa.respondente_nome },
          {
            rotulo: "Tipo",
            valor: pesquisa.tipo === "finalizacao" ? "Finalização" : "Ciclo semestral",
          },
          { rotulo: "Ciclo", valor: pesquisa.ciclo_codigo },
          { rotulo: "Situação", valor: <SeloStatusPesquisa status={pesquisa.status} /> },
          { rotulo: "Gerada em", valor: formatarData(pesquisa.data_geracao, true) },
          { rotulo: "Respondida em", valor: formatarData(pesquisa.data_resposta, true) },
        ]}
      />

      {respondida ? (
        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px solid var(--line)",
            fontWeight: 700,
            fontSize: ".92rem",
          }}
        >
          Resposta
        </div>
      ) : null}
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}
      {respondida && !resposta && !erro ? (
        <p style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>Carregando...</p>
      ) : null}

      {resposta ? (
        <div style={{ display: "grid", gap: 14, fontSize: ".88rem", lineHeight: 1.5, marginTop: 10 }}>
          <div style={{ color: "var(--text-muted)", fontSize: ".82rem" }}>
            Respondida em <strong>{formatarData(resposta.timestamp || pesquisa.data_resposta, true)}</strong>
            {resposta.canal_resposta ? (
              <>
                {" "}
                · Canal <strong>{rotuloDoCanal(resposta.canal_resposta)}</strong>
              </>
            ) : null}
            {pesquisa.ciclo_codigo ? (
              <>
                {" "}
                · Ciclo <strong>{pesquisa.ciclo_codigo}</strong>
              </>
            ) : null}
          </div>

          {PERGUNTAS_RESPOSTA.map((p, i) => (
            <div
              key={p.campo}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}
            >
              <span>
                {i + 1}. {p.titulo}
              </span>
              {seloDaNota(resposta[p.campo] as number | null)}
            </div>
          ))}

          <div>
            <div style={{ marginBottom: 6 }}>
              5. Quais suas sugestões de melhorias, elogios e feedbacks gerais?
            </div>
            <div
              style={{
                padding: "10px 12px",
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                whiteSpace: "pre-wrap",
                color: resposta.feedback ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {resposta.feedback?.trim() || "Sem comentário."}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function AlterarStatus({
  pesquisa,
  aoFechar,
  aoSalvar,
}: {
  pesquisa: Pesquisa;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [status, setStatus] = useState(pesquisa.status);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      await api.post(`pesquisas/${pesquisa.id}/status`, { status });
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo="Atualizar situação da pesquisa"
      subtitulo={`${pesquisa.projeto_nome} — ${pesquisa.respondente_nome}`}
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
        <CampoSelect
          nome="status"
          rotulo="Nova situação"
          larguraTotal
          valor={status}
          aoMudar={setStatus}
          vazio={null}
          // "Respondida" nao esta na lista: quem define esse estado e o
          // respondente ao enviar o formulario, nao o PMO.
          opcoes={STATUS_ESCOLHIVEIS.filter((s) => s.valor !== "respondida")}
          ajuda='A situação "Respondida" é definida automaticamente quando o respondente envia o formulário.'
        />
      </div>
    </Modal>
  );
}
