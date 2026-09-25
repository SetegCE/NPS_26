"use client";

// Planos de acao (modelo 5W2H da planilha do PMO).
//
// PMO: decide, projeto a projeto, se ele e passivel de plano de acao (so
// aparece depois da primeira resposta no ciclo) e, quando sim, escreve o
// contexto (Assunto e Objetivo). Lider: preenche as acoes dos projetos que
// lidera e atualiza a situacao de cada uma. A regra vive no banco
// (supabase/migrations/20_plano_de_acao.sql); a tela so conduz.

import { useCallback, useEffect, useState } from "react";
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
  evidencia_url: string | null;
  concluido_em: string | null;
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
          ? `Plano de ação ${r.numero} salvo. O líder já pode preencher as ações.`
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
        <table className="plano-grade">
          <tbody>
            <tr>
              <th>Assunto</th>
              <td colSpan={3}>
                <input
                  aria-label="Assunto"
                  value={assunto}
                  onChange={(e) => setAssunto(e.target.value)}
                  maxLength={200}
                  placeholder="Ex.: Comunicação com o cliente"
                  autoFocus
                />
              </td>
            </tr>
            <tr>
              <th>Objetivo</th>
              <td colSpan={3}>
                <textarea
                  aria-label="Objetivo"
                  rows={4}
                  value={objetivo}
                  onChange={(e) => setObjetivo(e.target.value)}
                  maxLength={4000}
                  placeholder="O que motivou o plano e onde está a oportunidade de melhoria."
                />
              </td>
            </tr>
            <tr>
              <th>Responsável</th>
              <td>{alvo.lider || "—"}</td>
              <th>Nº Plano</th>
              <td>{alvo.atual?.numero || <span className="td-sub">gerado ao salvar</span>}</td>
            </tr>
          </tbody>
        </table>
      ) : null}

      {passivel === "nao" && alvo.atual?.passivel && alvo.atual.total_acoes ? (
        <Aviso tipo="atencao">
          Este plano já tem ações lançadas. Remova as ações antes de marcar como não passível.
        </Aviso>
      ) : null}
    </Modal>
  );
}

// ─── Plano: tabela editavel ────────────────────────────────────────────────

/** Campos editaveis de uma acao, como texto (o que esta nos inputs). */
interface Rascunho {
  o_que: string;
  por_que: string;
  onde: string;
  quem: string;
  quanto: string;
  prazo: string;
  situacao: string;
  observacao: string;
  evidencia_url: string;
}

const RASCUNHO_VAZIO: Rascunho = {
  o_que: "",
  por_que: "",
  onde: "",
  quem: "",
  quanto: "",
  prazo: "",
  situacao: "no_prazo",
  observacao: "",
  evidencia_url: "",
};

const doBanco = (a: Acao): Rascunho => ({
  o_que: a.o_que || "",
  por_que: a.por_que || "",
  onde: a.onde || "",
  quem: a.quem || "",
  quanto: a.quanto === null || a.quanto === undefined ? "" : String(a.quanto).replace(".", ","),
  prazo: a.prazo || "",
  situacao: a.situacao || "no_prazo",
  observacao: a.observacao || "",
  evidencia_url: a.evidencia_url || "",
});

/** Link de evidencia aceito: so http(s), como o banco exige. */
const linkValido = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());

/** Situacao que a linha MOSTRA: prazo vencido e nao concluida = atrasada. */
function situacaoEfetiva(r: Rascunho): string {
  if (r.situacao === "concluido") return "concluido";
  const hoje = new Date().toISOString().slice(0, 10);
  if (r.situacao === "atrasado" || (r.prazo && r.prazo < hoje)) return "atrasado";
  return "no_prazo";
}

const iguais = (a: Rascunho, b: Rascunho) =>
  (Object.keys(a) as (keyof Rascunho)[]).every((k) => a[k] === b[k]);

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
  // So as linhas alteradas e ainda nao salvas. Recarregar o plano nao apaga o
  // que a pessoa esta digitando em outra linha.
  const [edicoes, setEdicoes] = useState<Record<string, Rascunho>>({});
  const [nova, setNova] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [cabecalho, setCabecalho] = useState<{ assunto: string; objetivo: string } | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<Acao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api
      .get<{ plano: Plano; acoes: Acao[] }>(`planos-acao/${planoId}`)
      .then(setDados)
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível abrir o plano."));
  }, [planoId]);

  useEffect(carregar, [carregar]);

  const plano = dados?.plano;
  const aberto = plano ? !plano.encerrado_em : false;
  const paginaAcoes = usePaginacaoLocal(dados?.acoes || []);

  const recarregarTudo = () => {
    carregar();
    aoAlterar();
  };

  const valorDe = (a: Acao) => edicoes[a.id] || doBanco(a);
  const mudar = (a: Acao, campo: keyof Rascunho, valor: string) =>
    setEdicoes((atual) => ({ ...atual, [a.id]: { ...valorDe(a), [campo]: valor } }));

  const semEdicao = (id: string) =>
    setEdicoes((atual) => {
      const resto = { ...atual };
      delete resto[id];
      return resto;
    });

  async function salvarLinha(itemId: string | null, r: Rascunho) {
    if (!r.o_que.trim()) {
      toast('Preencha "O que fazer?" antes de salvar.', "erro");
      return;
    }
    // Feito exige evidencia: o link da pasta do cliente (ou outro registro).
    if (r.situacao === "concluido" && !linkValido(r.evidencia_url)) {
      toast("Para marcar como feita, cole o link da evidência (começando com http:// ou https://).", "erro");
      return;
    }
    if (r.evidencia_url.trim() && !linkValido(r.evidencia_url)) {
      toast("O link da evidência deve começar com http:// ou https://.", "erro");
      return;
    }
    setSalvandoId(itemId || "nova");
    try {
      await api.post(`planos-acao/${planoId}/acoes`, { item_id: itemId || undefined, ...r });
      if (itemId) semEdicao(itemId);
      else setNova(RASCUNHO_VAZIO);
      toast(itemId ? "Ação salva." : "Ação adicionada.", "sucesso", 1800);
      recarregarTudo();
    } catch (e) {
      toast(e instanceof ErroApi ? e.message : "Não foi possível salvar a ação.", "erro");
    } finally {
      setSalvandoId(null);
    }
  }

  async function salvarCabecalho() {
    if (!plano || !cabecalho) return;
    setOcupado(true);
    try {
      await api.post("planos-acao", {
        projeto_id: plano.projeto_id,
        ciclo_id: plano.ciclo_id,
        passivel: true,
        assunto: cabecalho.assunto,
        objetivo: cabecalho.objetivo,
      });
      setCabecalho(null);
      toast("Assunto e objetivo salvos.", "sucesso", 1800);
      recarregarTudo();
    } catch (e) {
      toast(e instanceof ErroApi ? e.message : "Não foi possível salvar.", "erro");
    } finally {
      setOcupado(false);
    }
  }

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
      semEdicao(removendo.id);
      setRemovendo(null);
      recarregarTudo();
    } catch (e) {
      toast(e instanceof ErroApi ? e.message : "Não foi possível remover.", "erro");
    } finally {
      setOcupado(false);
    }
  }

  const alteradas = (dados?.acoes || []).filter(
    (a) => edicoes[a.id] && !iguais(edicoes[a.id], doBanco(a))
  ).length;
  const fechar = () => {
    if (alteradas && !window.confirm(`Há ${alteradas} linha(s) alterada(s) sem salvar. Fechar mesmo assim?`)) return;
    aoFechar();
  };

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
    { rotulo: "Fechar", classe: "btn-primary", onClick: fechar },
  ];

  /** Celulas editaveis de uma linha (existente ou a nova). */
  function celulas(
    r: Rascunho,
    mudarCampo: (campo: keyof Rascunho, valor: string) => void,
    aoEnter: () => void,
    concluidoEm: string | null = null
  ) {
    const campo = (
      nome: keyof Rascunho,
      rotulo: string,
      extra: React.InputHTMLAttributes<HTMLInputElement> = {}
    ) => (
      <input
        aria-label={rotulo}
        value={r[nome]}
        disabled={!aberto}
        onChange={(e) => mudarCampo(nome, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") aoEnter();
        }}
        {...extra}
      />
    );
    const efetiva = situacaoEfetiva(r);
    const vencida = efetiva === "atrasado" && r.situacao !== "atrasado";
    const faltaEvidencia = r.situacao === "concluido" && !linkValido(r.evidencia_url);
    return (
      <>
        <td>{campo("o_que", "O que fazer?", { maxLength: 1000, placeholder: "O que fazer?" })}</td>
        <td>{campo("por_que", "Por que fazer?", { maxLength: 1000 })}</td>
        <td>{campo("onde", "Onde fazer?", { maxLength: 300 })}</td>
        <td>{campo("quem", "Quem vai fazer?", { maxLength: 300 })}</td>
        <td className="num">
          {campo("quanto", "Quanto vai custar?", { maxLength: 20, inputMode: "decimal", placeholder: "0,00" })}
        </td>
        <td className="data">{campo("prazo", "Prazo", { type: "date" })}</td>
        <td className="feito">
          <input
            type="checkbox"
            aria-label="Ação feita"
            title={r.situacao === "concluido" ? "Feita" : "Marcar como feita (exige o link da evidência)"}
            checked={r.situacao === "concluido"}
            disabled={!aberto}
            onChange={(e) => mudarCampo("situacao", e.target.checked ? "concluido" : "no_prazo")}
          />
        </td>
        <td className={`status ${efetiva}`} title={vencida ? "Prazo vencido e ação não concluída" : undefined}>
          {SITUACAO_ACAO[efetiva]?.rotulo || efetiva}
          {concluidoEm && r.situacao === "concluido" ? (
            <span className="quando">em {formatarData(concluidoEm)}</span>
          ) : null}
        </td>
        <td className={`evidencia${faltaEvidencia ? " falta" : ""}`}>
          <div className="evidencia-campo">
            {campo("evidencia_url", "Link da evidência", {
              maxLength: 1000,
              type: "url",
              placeholder: r.situacao === "concluido" ? "Cole o link da evidência" : "https://...",
            })}
            {linkValido(r.evidencia_url) ? (
              <a
                href={r.evidencia_url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir evidência"
                aria-label="Abrir evidência"
              >
                ↗
              </a>
            ) : null}
          </div>
        </td>
        <td>{campo("observacao", "Observação", { maxLength: 2000 })}</td>
      </>
    );
  }

  return (
    <>
      <Modal
        titulo={plano ? `Plano de ação ${plano.numero}` : "Plano de ação"}
        subtitulo={
          plano ? `${plano.codigo_clockify} — ${plano.projeto_nome} · ciclo ${plano.ciclo_codigo}` : undefined
        }
        largo
        aoFechar={fechar}
        acoes={acoesModal}
      >
        {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}
        {!dados && !erro ? <EstadoCarregando /> : null}

        {plano ? (
          <>
            {/* Cabecalho do plano. Assunto e objetivo: o PMO edita aqui mesmo. */}
            <table className="plano-grade">
              <tbody>
                <tr>
                  <th>Assunto</th>
                  <td colSpan={3}>
                    {ehPmo && aberto ? (
                      <input
                        aria-label="Assunto"
                        value={cabecalho?.assunto ?? plano.assunto ?? ""}
                        maxLength={200}
                        onChange={(e) =>
                          setCabecalho({
                            assunto: e.target.value,
                            objetivo: cabecalho?.objetivo ?? plano.objetivo ?? "",
                          })
                        }
                      />
                    ) : (
                      plano.assunto
                    )}
                  </td>
                  <th>Nº Plano</th>
                  <td>{plano.numero}</td>
                </tr>
                <tr>
                  <th>Objetivo</th>
                  <td colSpan={3}>
                    {ehPmo && aberto ? (
                      <textarea
                        aria-label="Objetivo"
                        rows={2}
                        value={cabecalho?.objetivo ?? plano.objetivo ?? ""}
                        maxLength={4000}
                        onChange={(e) =>
                          setCabecalho({
                            assunto: cabecalho?.assunto ?? plano.assunto ?? "",
                            objetivo: e.target.value,
                          })
                        }
                      />
                    ) : (
                      <span style={{ whiteSpace: "pre-wrap" }}>{plano.objetivo}</span>
                    )}
                  </td>
                  <th>Situação</th>
                  <td>
                    <SeloPlano situacao={plano.situacao} />
                  </td>
                </tr>
                <tr>
                  <th>Responsável</th>
                  <td>{plano.lider_nome || plano.responsavel_nome || "—"}</td>
                  <th>Início</th>
                  <td>{formatarData(plano.inicio)}</td>
                  <th>Encerrado</th>
                  <td>{plano.encerrado_em ? formatarData(plano.encerrado_em) : "—"}</td>
                </tr>
              </tbody>
            </table>
            {cabecalho ? (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setCabecalho(null)} disabled={ocupado}>
                  Descartar
                </button>
                <button type="button" className="btn-primary" onClick={salvarCabecalho} disabled={ocupado}>
                  Salvar assunto e objetivo
                </button>
              </div>
            ) : null}

            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 0 8px" }}
            >
              <strong style={{ fontSize: ".92rem" }}>Ações ({dados?.acoes.length || 0})</strong>
              {aberto ? (
                <span className="td-sub">
                  Edite direto nas células e salve a linha no ✓ (ou Enter). Ao marcar Feito, cole o link da evidência.
                </span>
              ) : null}
            </div>

            {!aberto ? <Aviso tipo="info">Plano encerrado: as ações ficam só para consulta.</Aviso> : null}

            <div className="tabela-scroll">
              <table className="plano-tabela plano-edit">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>Item</th>
                    <th style={{ minWidth: 200 }}>O que fazer?</th>
                    <th style={{ minWidth: 160 }}>Por que fazer?</th>
                    <th style={{ minWidth: 110 }}>Onde fazer?</th>
                    <th style={{ minWidth: 120 }}>Quem vai fazer?</th>
                    <th style={{ minWidth: 100 }}>Quanto (R$)</th>
                    <th style={{ minWidth: 135 }}>Prazo</th>
                    <th style={{ width: 56 }}>Feito</th>
                    <th style={{ minWidth: 110 }}>Situação</th>
                    <th style={{ minWidth: 190 }}>Evidência (link)</th>
                    <th style={{ minWidth: 150 }}>Observação</th>
                    {aberto ? <th style={{ width: 84 }} /> : null}
                  </tr>
                </thead>
                <tbody>
                  {paginaAcoes.visiveis.map((a) => {
                    const r = valorDe(a);
                    const alterada = Boolean(edicoes[a.id]) && !iguais(edicoes[a.id], doBanco(a));
                    return (
                      <tr key={a.id} className={alterada ? "alterada" : undefined}>
                        <td className="item">{a.ordem}</td>
                        {celulas(
                          r,
                          (c, v) => mudar(a, c, v),
                          () => {
                            if (alterada) salvarLinha(a.id, r);
                          },
                          a.concluido_em
                        )}
                        {aberto ? (
                          <td className="acoes">
                            <BotaoAcao
                              icone="check"
                              titulo={alterada ? "Salvar alterações da linha" : "Sem alterações"}
                              onClick={() => salvarLinha(a.id, r)}
                              desabilitado={!alterada || salvandoId === a.id}
                            />
                            <BotaoAcao icone="inativar" titulo="Remover ação" perigo onClick={() => setRemovendo(a)} />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}

                  {aberto ? (
                    <tr className="nova">
                      <td className="item">+</td>
                      {celulas(
                        nova,
                        (c, v) => setNova((atual) => ({ ...atual, [c]: v })),
                        () => salvarLinha(null, nova)
                      )}
                      <td className="acoes">
                        <BotaoAcao
                          icone="adicionar"
                          titulo="Adicionar ação"
                          onClick={() => salvarLinha(null, nova)}
                          desabilitado={!nova.o_que.trim() || salvandoId === "nova"}
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {paginaAcoes.barra}
          </>
        ) : null}
      </Modal>

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
