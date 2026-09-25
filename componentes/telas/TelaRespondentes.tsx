"use client";

// Respondentes: quem responde as pesquisas, e a quais projetos cada um esta
// vinculado (relacao N:N).

import { useEffect, useMemo, useState } from "react";
import { CampoSelect, CampoTexto, opcoesDe } from "@/componentes/Campo";
import { ModalDetalhes } from "@/componentes/Detalhes";
import { Aviso, EstadoCarregando, EstadoErro, EstadoVazio } from "@/componentes/Estados";
import { Modal } from "@/componentes/Modal";
import { BotaoAcao, type Coluna } from "@/componentes/Tabela";
import {
  BarraFiltros,
  CabecalhoTela,
  CorpoLista,
  FiltroBusca,
  FiltroSelect,
  OPCOES_SITUACAO,
  Selo,
} from "@/componentes/Tela";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi, type Pagina } from "@/lib/cliente/api";
import { auxiliares, useAuxiliar } from "@/lib/cliente/auxiliares";
import type { Sessao } from "@/lib/cliente/tipos";
import { useLista } from "@/lib/cliente/useLista";

interface Respondente extends Record<string, unknown> {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cliente_id: string | null;
  ativo: boolean;
  clientes_nps?: { id: string; nome: string } | null;
}

interface ProjetoResumo {
  id: string;
  nome: string;
  codigo_clockify: string;
  cliente_id?: string | null;
  cliente_nome: string | null;
}

export function TelaRespondentes({ sessao }: { sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const toast = useToast();
  const clientes = useAuxiliar(auxiliares.clientes);

  const [cliente, setCliente] = useState("");
  const [situacao, setSituacao] = useState("true");
  const [emEdicao, setEmEdicao] = useState<Respondente | null | undefined>(undefined);
  const [vinculosDe, setVinculosDe] = useState<Respondente | null>(null);
  const [vendo, setVendo] = useState<Respondente | null>(null);

  const filtros = useMemo(() => ({ cliente, ativo: situacao }), [cliente, situacao]);
  const lista = useLista<Respondente>("respondentes", {
    ordemInicial: { campo: "nome", ascending: true },
    filtros,
  });

  const colunas: Coluna<Respondente>[] = [
    {
      chave: "nome",
      rotulo: "Nome",
      ordenavel: true,
      render: (l) => <span className="td-principal">{l.nome}</span>,
    },
    {
      chave: "cliente",
      rotulo: "Cliente / empresa",
      render: (l) => l.clientes_nps?.nome || "—",
    },
    { chave: "email", rotulo: "E-mail", ordenavel: true, render: (l) => l.email || "—" },
    { chave: "telefone", rotulo: "Telefone / WhatsApp", render: (l) => l.telefone || "—" },
    {
      chave: "ativo",
      rotulo: "Situação",
      render: (l) => <Selo tom={l.ativo ? "verde" : "neutro"}>{l.ativo ? "Ativo" : "Inativo"}</Selo>,
    },
  ];

  colunas.push({
    chave: "acoes",
    rotulo: "Ações",
    classe: "td-acoes",
    render: (l) => (
      <>
        <BotaoAcao icone="ver" titulo="Ver respondente" onClick={() => setVendo(l)} />
        {ehPmo ? (
          <>
            <BotaoAcao icone="editar" titulo="Editar respondente" onClick={() => setEmEdicao(l)} />
            <BotaoAcao
              icone="projetos"
              titulo="Projetos vinculados"
              onClick={() => setVinculosDe(l)}
            />
          </>
        ) : null}
      </>
    ),
  });

  return (
    <>
      <CabecalhoTela
        titulo="Respondentes"
        descricao="Um respondente pode avaliar vários projetos, e um projeto pode ter vários respondentes."
        acoes={
          ehPmo ? (
            <button type="button" className="btn-primary" onClick={() => setEmEdicao(null)}>
              + Adicionar Respondente
            </button>
          ) : null
        }
      />

      <BarraFiltros>
        <FiltroBusca
          placeholder="Nome, e-mail ou telefone"
          valor={lista.busca}
          aoMudar={lista.setBusca}
        />
        <FiltroSelect
          id="f-cliente"
          rotulo="Cliente"
          valor={cliente}
          aoMudar={setCliente}
          opcoes={[{ valor: "", rotulo: "Todos" }, ...opcoesDe(clientes)]}
        />
        <FiltroSelect
          id="f-situacao"
          rotulo="Situação"
          valor={situacao}
          aoMudar={setSituacao}
          opcoes={OPCOES_SITUACAO}
        />
        <div className="filtro filtro-acoes">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setCliente("");
              setSituacao("true");
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
          vazio="Nenhum respondente encontrado."
        />
      </div>

      {emEdicao !== undefined ? (
        <Formulario
          registro={emEdicao}
          clientes={clientes}
          aoFechar={() => setEmEdicao(undefined)}
          aoSalvar={(mensagem, tipo) => {
            setEmEdicao(undefined);
            lista.recarregar();
            toast(mensagem, tipo);
          }}
        />
      ) : null}

      {vendo ? <VerRespondente respondente={vendo} aoFechar={() => setVendo(null)} /> : null}

      {vinculosDe ? (
        <Vinculos respondente={vinculosDe} aoFechar={() => setVinculosDe(null)} />
      ) : null}
    </>
  );
}

function Formulario({
  registro,
  clientes,
  aoFechar,
  aoSalvar,
}: {
  registro: Respondente | null;
  clientes: { id: string; nome: string }[];
  aoFechar: () => void;
  aoSalvar: (mensagem: string, tipo: "sucesso" | "aviso") => void;
}) {
  const edicao = Boolean(registro);
  const [nome, setNome] = useState(registro?.nome || "");
  const [clienteId, setClienteId] = useState(registro?.cliente_id || "");
  const [email, setEmail] = useState(registro?.email || "");
  const [telefone, setTelefone] = useState(registro?.telefone || "");
  const [ativo, setAtivo] = useState(registro ? String(registro.ativo) : "true");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // No cadastro, o cliente sai do projeto escolhido: a lista e o espelho dos
  // projetos ativos do Clockrview (sincronizado diariamente), mostrada como
  // "codigo — cliente". Escolher o projeto ja vincula o respondente a ele.
  const [projetos, setProjetos] = useState<ProjetoResumo[]>([]);
  const [projetoId, setProjetoId] = useState("");
  useEffect(() => {
    if (edicao) return;
    api
      .get<Pagina<ProjetoResumo>>("projetos", {
        porPagina: 200,
        ativo: true,
        ordenarPor: "codigo_clockify",
        ordem: "asc",
      })
      .then((r) => setProjetos(r.itens || []))
      .catch(() => setProjetos([]));
  }, [edicao]);
  const projeto = projetos.find((p) => p.id === projetoId) || null;

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      if (edicao) {
        const corpo = { nome, cliente_id: clienteId, email, telefone };
        await api.patch("respondentes", { id: registro!.id, ...corpo, ativo: ativo === "true" });
        aoSalvar("Respondente atualizado.", "sucesso");
      } else {
        if (!projeto) {
          setErro("Selecione o projeto do respondente.");
          setSalvando(false);
          return;
        }
        const corpo = { nome, cliente_id: projeto.cliente_id || "", email, telefone };
        const r = await api.post<{ reaproveitado: boolean; respondente: { id: string } }>(
          "respondentes",
          corpo
        );
        await api.post(`respondentes/${r.respondente.id}/projetos`, {
          projeto_id: projeto.id,
          vincular: true,
        });
        aoSalvar(
          r.reaproveitado
            ? `Já existia um respondente com estes dados — o cadastro existente foi reaproveitado e vinculado ao projeto ${projeto.codigo_clockify}.`
            : `Respondente cadastrado e vinculado ao projeto ${projeto.codigo_clockify}.`,
          r.reaproveitado ? "aviso" : "sucesso"
        );
      }
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={edicao ? "Editar respondente" : "Adicionar respondente"}
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Salvando..." : edicao ? "Salvar" : "Cadastrar",
          classe: "btn-primary",
          onClick: salvar,
          desabilitado: salvando,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      <div className="form-grade">
        <CampoTexto
          nome="nome"
          rotulo="Nome"
          valor={nome}
          aoMudar={setNome}
          obrigatorio
          larguraTotal
          maxLength={200}
        />
        {edicao ? (
          <CampoSelect
            nome="cliente_id"
            rotulo="Cliente / empresa"
            valor={clienteId}
            aoMudar={setClienteId}
            opcoes={opcoesDe(clientes)}
          />
        ) : (
          <CampoSelect
            nome="projeto_id"
            rotulo="Cliente / empresa (Clockrview)"
            obrigatorio
            larguraTotal
            valor={projetoId}
            aoMudar={setProjetoId}
            vazio={projetos.length ? "Selecione pelo código do projeto..." : "Carregando projetos..."}
            opcoes={projetos.map((p) => ({
              valor: p.id,
              rotulo: `${p.codigo_clockify} — ${p.cliente_nome || "sem cliente"} (${p.nome})`,
            }))}
            ajuda="O respondente fica vinculado a este projeto. Outros projetos podem ser adicionados depois, em Projetos do respondente."
          />
        )}
        <CampoTexto
          nome="email"
          rotulo="E-mail"
          tipo="email"
          valor={email}
          aoMudar={setEmail}
          maxLength={200}
        />
        <CampoTexto
          nome="telefone"
          rotulo="Telefone / WhatsApp"
          valor={telefone}
          aoMudar={setTelefone}
          maxLength={40}
        />
        {edicao ? (
          <div className="form-campo">
            <label htmlFor="campo-ativo">Situação</label>
            <select id="campo-ativo" value={ativo} onChange={(e) => setAtivo(e.target.value)}>
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </select>
          </div>
        ) : null}
      </div>

      {!edicao ? (
        <div style={{ marginTop: 14 }}>
          <Aviso tipo="info">
            Se já existir um respondente com o mesmo e-mail ou nome, o cadastro existente será
            reaproveitado em vez de duplicado.
          </Aviso>
        </div>
      ) : null}
    </Modal>
  );
}

function VerRespondente({
  respondente,
  aoFechar,
}: {
  respondente: Respondente;
  aoFechar: () => void;
}) {
  const [projetos, setProjetos] = useState<ProjetoResumo[] | null>(null);

  useEffect(() => {
    let ativo = true;
    Promise.all([
      api.get<Pagina<ProjetoResumo>>("projetos", { porPagina: 200 }),
      api.get<{ vinculos: string[] }>(`respondentes/${respondente.id}/projetos`),
    ])
      .then(([todos, atuais]) => {
        if (!ativo) return;
        const ids = new Set(atuais.vinculos || []);
        setProjetos((todos.itens || []).filter((p) => ids.has(p.id)));
      })
      .catch(() => {
        if (ativo) setProjetos([]);
      });
    return () => {
      ativo = false;
    };
  }, [respondente.id]);

  return (
    <ModalDetalhes
      titulo={respondente.nome}
      subtitulo="Dados do respondente"
      largo
      aoFechar={aoFechar}
      itens={[
        { rotulo: "Nome", valor: respondente.nome },
        { rotulo: "Cliente / empresa", valor: respondente.clientes_nps?.nome },
        { rotulo: "E-mail", valor: respondente.email },
        { rotulo: "Telefone / WhatsApp", valor: respondente.telefone },
        {
          rotulo: "Situação",
          valor: (
            <Selo tom={respondente.ativo ? "verde" : "neutro"}>
              {respondente.ativo ? "Ativo" : "Inativo"}
            </Selo>
          ),
        },
      ]}
    >
      <div style={{ fontWeight: 700, fontSize: ".9rem", marginBottom: 8 }}>Projetos vinculados</div>
      {projetos === null ? (
        <EstadoCarregando mensagem="Carregando projetos..." />
      ) : projetos.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          {projetos.map((p) => (
            <div
              key={p.id}
              style={{ padding: "8px 10px", border: "1px solid var(--line-soft)", borderRadius: 8 }}
            >
              <span className="td-principal">{p.nome}</span>
              <span className="td-sub" style={{ display: "block" }}>
                {p.codigo_clockify} · {p.cliente_nome || "—"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: ".85rem", color: "var(--text-muted)" }}>Nenhum projeto vinculado.</p>
      )}
    </ModalDetalhes>
  );
}

function Vinculos({
  respondente,
  aoFechar,
}: {
  respondente: Respondente;
  aoFechar: () => void;
}) {
  const toast = useToast();
  const [projetos, setProjetos] = useState<ProjetoResumo[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    Promise.all([
      api.get<Pagina<ProjetoResumo>>("projetos", { porPagina: 200, ativo: true }),
      api.get<{ vinculos: string[] }>(`respondentes/${respondente.id}/projetos`),
    ])
      .then(([todos, atuais]) => {
        if (!ativo) return;
        setProjetos(todos.itens || []);
        setMarcados(new Set(atuais.vinculos || []));
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ErroApi ? e.message : "Falha ao carregar os projetos.");
      });
    return () => {
      ativo = false;
    };
  }, [respondente.id]);

  async function alternar(projetoId: string, vincular: boolean) {
    setSalvandoId(projetoId);
    try {
      await api.post(`respondentes/${respondente.id}/projetos`, {
        projeto_id: projetoId,
        vincular,
      });
      setMarcados((atuais) => {
        const novo = new Set(atuais);
        if (vincular) novo.add(projetoId);
        else novo.delete(projetoId);
        return novo;
      });
      toast(vincular ? "Projeto vinculado." : "Vínculo removido.", "sucesso", 2200);
    } catch (e) {
      // O estado nao muda em caso de erro, entao a caixa volta sozinha ao que
      // era — nao ha o que desfazer a mao.
      toast(e instanceof ErroApi ? e.message : "Não foi possível alterar o vínculo.", "erro");
    } finally {
      setSalvandoId(null);
    }
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = (projetos || []).filter(
    (p) =>
      !termo ||
      p.nome.toLowerCase().includes(termo) ||
      (p.codigo_clockify || "").toLowerCase().includes(termo)
  );

  return (
    <Modal
      titulo={`Projetos de ${respondente.nome}`}
      subtitulo="Um respondente pode estar vinculado a vários projetos."
      largo
      aoFechar={aoFechar}
      acoes={[{ rotulo: "Fechar", classe: "btn-secondary", onClick: aoFechar }]}
    >
      {erro ? (
        <EstadoErro mensagem={erro} />
      ) : projetos === null ? (
        <EstadoCarregando mensagem="Carregando projetos..." />
      ) : (
        <>
          <div className="filtro" style={{ marginBottom: 12 }}>
            <label htmlFor="vinc-busca">Buscar projeto</label>
            <input
              id="vinc-busca"
              type="search"
              placeholder="Nome ou código do projeto"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div style={{ maxHeight: "52vh", overflow: "auto" }}>
            {filtrados.length ? (
              filtrados.map((p) => (
                <label
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 6px",
                    borderBottom: "1px solid var(--line-soft)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={marcados.has(p.id)}
                    disabled={salvandoId === p.id}
                    onChange={(e) => alternar(p.id, e.target.checked)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="td-principal">{p.nome}</span>
                    <span className="td-sub" style={{ display: "block" }}>
                      {p.codigo_clockify} · {p.cliente_nome || "—"}
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <EstadoVazio titulo="Nenhum projeto encontrado." />
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
