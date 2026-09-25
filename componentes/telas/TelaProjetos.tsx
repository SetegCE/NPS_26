"use client";

// Listagem de projetos. Serve tambem a rota /meus-projetos, que e a mesma
// tela com o recorte do lider — recorte que o SERVIDOR aplica: a flag aqui so
// muda o titulo e esconde o que nao faz sentido oferecer.
//
// Projeto nao e cadastrado aqui: codigo, nome, cliente, lider e ativo/inativo
// vem do Clockrview. O PMO sincroniza pelo botao do cabecalho (e o cron da
// Vercel sincroniza uma vez por dia). Continuam editaveis no NPS os campos que
// o Clockrview nao tem e o LIDER, que muda na pratica antes de o Clockrview ser
// atualizado — a sincronizacao respeita a troca feita aqui.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CampoArea, CampoSelect, CampoTexto, opcoesDe } from "@/componentes/Campo";
import { Aviso } from "@/componentes/Estados";
import { Modal } from "@/componentes/Modal";
import { BotaoAcao, type Coluna } from "@/componentes/Tabela";
import {
  BarraFiltros,
  CabecalhoTela,
  CorpoLista,
  FiltroBusca,
  FiltroSelect,
  OPCOES_SITUACAO,
} from "@/componentes/Tela";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi } from "@/lib/cliente/api";
import { auxiliares, useAuxiliar } from "@/lib/cliente/auxiliares";
import type { Sessao } from "@/lib/cliente/tipos";
import { useLista } from "@/lib/cliente/useLista";

export interface Projeto extends Record<string, unknown> {
  id: string;
  nome: string;
  codigo_clockify: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  lider_id: string | null;
  lider_nome: string | null;
  categoria: string | null;
  classe_contratual: string | null;
  tipo_servico: string | null;
  segmento_cliente: string | null;
  escopo_geral: string | null;
  vendedor: string | null;
  acesso: string | null;
  status: string;
  ativo: boolean;
  elegivel: boolean;
  ciclo_atual: string | null;
  total_pesquisas: number;
  pesquisas_respondidas: number;
}

export const STATUS_PROJETO = [
  { valor: "ativo", rotulo: "Ativo" },
  { valor: "em_encerramento", rotulo: "Em encerramento" },
  { valor: "encerrado", rotulo: "Encerrado" },
  { valor: "cancelado", rotulo: "Cancelado" },
  { valor: "standby", rotulo: "Standby" },
];

export const ROTULO_STATUS = Object.fromEntries(STATUS_PROJETO.map((s) => [s.valor, s.rotulo]));

const SELO_STATUS: Record<string, string> = {
  ativo: "selo-verde",
  em_encerramento: "selo-amarelo",
  encerrado: "selo-neutro",
  cancelado: "selo-vermelho",
  standby: "selo-laranja",
};

const VAZIO = { cliente: "", lider: "", ciclo: "", status: "", elegivel: "", ativo: "true" };

export function TelaProjetos({
  sessao,
  somenteMeus = false,
}: {
  sessao: Sessao;
  somenteMeus?: boolean;
}) {
  const ehPmo = sessao.perfil === "pmo" && !somenteMeus;
  const toast = useToast();
  const clientes = useAuxiliar(auxiliares.clientes);
  const lideres = useAuxiliar(auxiliares.lideres);
  const ciclos = useAuxiliar(auxiliares.ciclos);

  const [f, setF] = useState(VAZIO);
  const [editando, setEditando] = useState<Projeto | null>(null);
  const [trocandoLider, setTrocandoLider] = useState<Projeto | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  const filtros = useMemo(() => ({ ...f, lider: ehPmo ? f.lider : "" }), [f, ehPmo]);
  const lista = useLista<Projeto>("projetos", {
    ordemInicial: { campo: "nome", ascending: true },
    filtros,
  });

  const mudar = (campo: keyof typeof VAZIO, valor: string) =>
    setF((atual) => ({ ...atual, [campo]: valor }));

  const colunas: Coluna<Projeto>[] = [
    {
      chave: "cliente_nome",
      rotulo: "Cliente",
      ordenavel: true,
      render: (l) => l.cliente_nome || "—",
    },
    {
      chave: "nome",
      rotulo: "Projeto",
      ordenavel: true,
      render: (l) => (
        <>
          <div className="td-principal">{l.nome}</div>
          <div className="td-sub">{l.codigo_clockify}</div>
        </>
      ),
    },
    { chave: "lider_nome", rotulo: "Líder", ordenavel: true, render: (l) => l.lider_nome || "—" },
    { chave: "classe_contratual", rotulo: "Classe", render: (l) => l.classe_contratual || "—" },
    { chave: "tipo_servico", rotulo: "Serviço", render: (l) => l.tipo_servico || "—" },
    { chave: "segmento_cliente", rotulo: "Segmento", render: (l) => l.segmento_cliente || "—" },
    { chave: "vendedor", rotulo: "Vendedor", render: (l) => l.vendedor || "—" },
    {
      chave: "status",
      rotulo: "Status",
      // Inativar mexe so em `ativo`; o status do ciclo de vida continua como
      // estava (quase sempre "ativo"). Mostrar os dois lado a lado lia como
      // "Ativo Inativo" — o cadastro inativo prevalece.
      render: (l) =>
        l.ativo ? (
          <span className={`selo ${SELO_STATUS[l.status] || "selo-neutro"}`}>
            {ROTULO_STATUS[l.status] || l.status}
          </span>
        ) : (
          <span className="selo selo-neutro">Inativo</span>
        ),
    },
    {
      chave: "acoes",
      rotulo: "Ações",
      classe: "td-acoes",
      render: (l) => (
        <>
          {/* Link de verdade, e nao um botao que empurra o historico a mao:
              abre em nova aba com o meio do mouse e pode ser compartilhado. */}
          <Link
            href={`/projetos/${l.id}`}
            className="btn-acoes"
            title="Ver detalhes do projeto"
            aria-label="Ver detalhes do projeto"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>
          {ehPmo ? (
            <>
              <BotaoAcao icone="editar" titulo="Editar dados do NPS" onClick={() => setEditando(l)} />
              <BotaoAcao
                icone="lider"
                titulo="Alterar líder responsável"
                onClick={() => setTrocandoLider(l)}
              />
            </>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <>
      <CabecalhoTela
        titulo={somenteMeus ? "Meus Projetos" : "Projetos"}
        descricao={
          somenteMeus
            ? "Projetos sob sua responsabilidade atual."
            : "Projetos do Clockrview, com ciclo, elegibilidade e situação da pesquisa."
        }
        acoes={
          ehPmo ? (
            <button type="button" className="btn-primary" onClick={() => setSincronizando(true)}>
              Sincronizar com Clockrview
            </button>
          ) : null
        }
      />

      <BarraFiltros>
        <FiltroBusca
          placeholder="Projeto, código ou cliente"
          valor={lista.busca}
          aoMudar={lista.setBusca}
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
          id="f-status"
          rotulo="Status"
          valor={f.status}
          aoMudar={(v) => mudar("status", v)}
          opcoes={[{ valor: "", rotulo: "Todos" }, ...STATUS_PROJETO]}
        />
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
          id="f-ativo"
          rotulo="Situação"
          valor={f.ativo}
          aoMudar={(v) => mudar("ativo", v)}
          opcoes={OPCOES_SITUACAO}
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
          vazio="Nenhum projeto encontrado com os filtros atuais."
        />
      </div>

      {editando ? (
        <FormularioProjeto
          projeto={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            lista.recarregar();
            toast("Projeto atualizado.", "sucesso");
          }}
        />
      ) : null}

      {trocandoLider ? (
        <TrocaLider
          projeto={trocandoLider}
          aoFechar={() => setTrocandoLider(null)}
          aoSalvar={() => {
            setTrocandoLider(null);
            lista.recarregar();
          }}
        />
      ) : null}

      {sincronizando ? (
        <SincronizarClockrview
          aoFechar={(mudou) => {
            setSincronizando(false);
            if (mudou) lista.recarregar();
          }}
        />
      ) : null}
    </>
  );
}

// ─── Edicao dos dados do NPS ───────────────────────────────────────────────

export function FormularioProjeto({
  projeto,
  aoFechar,
  aoSalvar,
}: {
  projeto: Projeto;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [categoria, setCategoria] = useState(projeto.categoria || "");
  const [classe, setClasse] = useState(projeto.classe_contratual || "");
  const [servico, setServico] = useState(projeto.tipo_servico || "");
  const [segmento, setSegmento] = useState(projeto.segmento_cliente || "");
  const [vendedor, setVendedor] = useState(projeto.vendedor || "");
  const [acesso, setAcesso] = useState(projeto.acesso || "");
  const [status, setStatus] = useState(projeto.status || "ativo");
  const [escopo, setEscopo] = useState(projeto.escopo_geral || "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      // Codigo, nome e cliente nao vao: vem do Clockrview. O lider tambem
      // nao: a troca tem fluxo proprio, com historico (TrocaLider).
      await api.patch("projetos", {
        id: projeto.id,
        categoria,
        classe_contratual: classe,
        tipo_servico: servico,
        segmento_cliente: segmento,
        status,
        escopo_geral: escopo,
        vendedor,
        acesso,
      });
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  const doClockrview = "Vem do Clockrview. Para mudar, altere lá e sincronize.";
  const semEdicao = () => {};

  return (
    <Modal
      titulo="Editar projeto"
      subtitulo={projeto.codigo_clockify}
      largo
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Salvando..." : "Salvar alterações",
          classe: "btn-primary",
          onClick: salvar,
          desabilitado: salvando,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      <div className="form-grade">
        <CampoTexto
          nome="codigo_clockify"
          rotulo="Código do projeto"
          valor={projeto.codigo_clockify}
          aoMudar={semEdicao}
          desabilitado
          ajuda={doClockrview}
        />
        <CampoTexto
          nome="nome"
          rotulo="Projeto"
          valor={projeto.nome}
          aoMudar={semEdicao}
          desabilitado
          ajuda={doClockrview}
        />
        <CampoTexto
          nome="cliente"
          rotulo="Cliente"
          valor={projeto.cliente_nome || "—"}
          aoMudar={semEdicao}
          desabilitado
          ajuda={doClockrview}
        />
        <CampoTexto
          nome="lider"
          rotulo="Líder"
          valor={projeto.lider_nome || "—"}
          aoMudar={semEdicao}
          desabilitado
          ajuda='Troque pelo botão "Alterar líder", que registra o histórico.'
        />
        <CampoTexto nome="categoria" rotulo="Categoria" valor={categoria} aoMudar={setCategoria} />
        <CampoSelect
          nome="classe_contratual"
          rotulo="Classe contratual"
          valor={classe}
          aoMudar={setClasse}
          vazio="—"
          opcoes={[
            { valor: "A", rotulo: "A" },
            { valor: "B", rotulo: "B" },
            { valor: "C", rotulo: "C" },
          ]}
        />
        <CampoTexto nome="tipo_servico" rotulo="Serviço" valor={servico} aoMudar={setServico} />
        <CampoTexto
          nome="segmento_cliente"
          rotulo="Segmento"
          valor={segmento}
          aoMudar={setSegmento}
        />
        <CampoTexto
          nome="vendedor"
          rotulo="Vendedor"
          valor={vendedor}
          aoMudar={setVendedor}
          maxLength={160}
          ajuda="Quem vendeu o contrato."
        />
        <CampoTexto
          nome="acesso"
          rotulo="Acesso"
          valor={acesso}
          aoMudar={setAcesso}
          maxLength={60}
          ajuda='Exigência para ir a campo — ex.: "COM SST" ou "N.A".'
        />
        <CampoSelect
          nome="status"
          rotulo="Status no NPS"
          valor={status}
          aoMudar={setStatus}
          vazio={null}
          opcoes={STATUS_PROJETO}
          ajuda="Fase do projeto para a pesquisa. Ativo/inativo vem do Clockrview."
        />
        <CampoArea
          nome="escopo_geral"
          rotulo="Escopo geral"
          valor={escopo}
          aoMudar={setEscopo}
          larguraTotal
          maxLength={2000}
        />
      </div>
    </Modal>
  );
}

// ─── Sincronizacao com o Clockrview ────────────────────────────────────────

interface ResumoSincronizacao {
  simulacao: boolean;
  totalClockrview: number;
  clientesCriados: string[];
  lideresCriados: string[];
  projetosCriados: string[];
  projetosAtualizados: string[];
  ativados: string[];
  inativados: string[];
  trocasLider: string[];
  lideresMantidos: string[];
  avisos: string[];
  foraDoClockrview: { codigo: string; nome: string }[];
  inativosIgnorados: number;
  falhas: string[];
}

function GrupoMudancas({ titulo, itens }: { titulo: string; itens: string[] }) {
  if (!itens.length) return null;
  return (
    <details style={{ marginBottom: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        {titulo} ({itens.length})
      </summary>
      <ul style={{ margin: "6px 0 0 18px", fontSize: ".82rem", color: "var(--text-secondary)" }}>
        {itens.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Primeiro mostra o que MUDARIA (GET, nao grava) e so aplica quando o PMO
 * confirma: a sincronizacao pode trocar lider e inativar projeto, e isso
 * mexe em quem ve o que no dashboard.
 */
export function SincronizarClockrview({ aoFechar }: { aoFechar: (mudou: boolean) => void }) {
  const toast = useToast();
  const [resumo, setResumo] = useState<ResumoSincronizacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    api
      .get<ResumoSincronizacao>("projetos/sincronizar")
      .then(setResumo)
      .catch((e) =>
        setErro(e instanceof ErroApi ? e.message : "Não foi possível falar com o Clockrview.")
      );
  }, []);

  const mudancas = resumo
    ? resumo.clientesCriados.length +
      resumo.lideresCriados.length +
      resumo.projetosCriados.length +
      resumo.projetosAtualizados.length +
      resumo.ativados.length +
      resumo.inativados.length +
      resumo.trocasLider.length
    : 0;
  const aplicado = Boolean(resumo && !resumo.simulacao);

  async function aplicar() {
    setErro(null);
    setAplicando(true);
    try {
      const r = await api.post<ResumoSincronizacao>("projetos/sincronizar", {});
      setResumo(r);
      if (r.falhas.length) toast(`Sincronizado com ${r.falhas.length} falha(s).`, "aviso");
      else toast("Projetos sincronizados com o Clockrview.", "sucesso");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível sincronizar.");
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Modal
      titulo="Sincronizar com Clockrview"
      subtitulo={
        resumo ? `${resumo.totalClockrview} projetos no Clockrview` : "Consultando o Clockrview..."
      }
      largo
      aoFechar={() => aoFechar(aplicado)}
      acoes={
        aplicado || (resumo && !mudancas) || erro
          ? [{ rotulo: "Fechar", classe: "btn-primary", onClick: () => aoFechar(aplicado) }]
          : [
              { rotulo: "Cancelar", classe: "btn-secondary", onClick: () => aoFechar(false) },
              {
                rotulo: aplicando ? "Sincronizando..." : "Aplicar sincronização",
                classe: "btn-primary",
                onClick: aplicar,
                desabilitado: aplicando || !resumo,
              },
            ]
      }
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}
      {!resumo && !erro ? <p style={{ color: "var(--text-muted)" }}>Carregando...</p> : null}

      {resumo ? (
        <>
          {aplicado ? (
            <Aviso tipo={resumo.falhas.length ? "atencao" : "info"}>
              Sincronização aplicada. O histórico de liderança e as respostas foram preservados.
            </Aviso>
          ) : mudancas ? (
            <Aviso tipo="info">
              Prévia: nada foi gravado ainda. Projetos novos <strong>não</strong> entram em ciclo
              automaticamente, e cada troca de líder preserva o período anterior.
            </Aviso>
          ) : (
            <Aviso tipo="info">O NPS já está igual ao Clockrview. Nada a fazer.</Aviso>
          )}

          <GrupoMudancas titulo="Projetos novos" itens={resumo.projetosCriados} />
          <GrupoMudancas titulo="Projetos atualizados" itens={resumo.projetosAtualizados} />
          <GrupoMudancas titulo="Trocas de líder" itens={resumo.trocasLider} />
          <GrupoMudancas
            titulo="Líder alterado no NPS, mantido"
            itens={resumo.lideresMantidos}
          />
          <GrupoMudancas titulo="Inativados" itens={resumo.inativados} />
          <GrupoMudancas titulo="Reativados" itens={resumo.ativados} />
          <GrupoMudancas titulo="Clientes novos" itens={resumo.clientesCriados} />
          <GrupoMudancas titulo="Líderes novos" itens={resumo.lideresCriados} />
          <GrupoMudancas titulo="Avisos" itens={resumo.avisos} />
          <GrupoMudancas titulo="Falhas" itens={resumo.falhas} />
          <GrupoMudancas
            titulo="No NPS, mas fora do Clockrview (preservados)"
            itens={resumo.foraDoClockrview.map((p) => `${p.codigo} — ${p.nome}`)}
          />
          {resumo.inativosIgnorados ? (
            <p style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: 8 }}>
              {resumo.inativosIgnorados} projeto(s) inativo(s) no Clockrview que nunca passaram pelo
              NPS não são trazidos.
            </p>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

// ─── Troca de lider ────────────────────────────────────────────────────────

export function TrocaLider({
  projeto,
  aoFechar,
  aoSalvar,
}: {
  projeto: Projeto;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const lideres = useAuxiliar(auxiliares.lideres);
  const [liderId, setLiderId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!liderId) {
      setErro("Selecione o novo líder.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const r = await api.post<{
        alterado?: boolean;
        lider_anterior?: string;
        lider_novo?: string;
      }>(`projetos/${projeto.id}/lider`, { lider_id: liderId, observacao });
      if (r.alterado === false) toast("Este já é o líder atual do projeto.", "aviso");
      else toast(`Líder alterado de ${r.lider_anterior || "—"} para ${r.lider_novo}.`, "sucesso");
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível alterar o líder.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo="Alterar líder do projeto"
      subtitulo={`${projeto.codigo_clockify} — ${projeto.nome}`}
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Alterando..." : "Alterar líder",
          classe: "btn-primary",
          onClick: salvar,
          desabilitado: salvando,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      <Aviso tipo="info">
        Esta alteração <strong>não modificará respostas históricas</strong>. O período do líder
        anterior continua registrado e os resultados já recebidos permanecem associados a ele.
      </Aviso>
      <Aviso tipo="atencao">
        A sincronização com o Clockrview <strong>mantém</strong> esta escolha. O líder só volta a
        ser trocado automaticamente se a liderança for alterada no Clockrview.
      </Aviso>

      <p style={{ fontSize: ".84rem", color: "var(--text-muted)", marginBottom: 12 }}>
        Líder atual:{" "}
        <strong style={{ color: "var(--text-primary)" }}>
          {projeto.lider_nome || "Sem líder"}
        </strong>
      </p>

      <div className="form-grade">
        <CampoSelect
          nome="lider_id"
          rotulo="Novo líder"
          obrigatorio
          larguraTotal
          valor={liderId}
          aoMudar={setLiderId}
          opcoes={opcoesDe(lideres.filter((l) => l.id !== projeto.lider_id))}
        />
        <CampoArea
          nome="observacao"
          rotulo="Observação"
          valor={observacao}
          aoMudar={setObservacao}
          larguraTotal
          maxLength={1000}
          ajuda="Opcional. Fica registrada no histórico."
        />
      </div>
    </Modal>
  );
}
