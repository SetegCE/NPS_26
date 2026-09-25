"use client";

// Ciclos: o universo de projetos avaliados em cada periodo, a selecao de
// participantes e a passagem de um ciclo para o seguinte.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CampoSelect, CampoTexto } from "@/componentes/Campo";
import { ModalDetalhes } from "@/componentes/Detalhes";
import { Aviso, EstadoCarregando, EstadoErro, EstadoVazio } from "@/componentes/Estados";
import { type AcaoModal, Confirmacao, Modal } from "@/componentes/Modal";
import { BotaoAcao, Tabela, type Coluna } from "@/componentes/Tabela";
import { CabecalhoTela } from "@/componentes/Tela";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi } from "@/lib/cliente/api";
import { auxiliares } from "@/lib/cliente/auxiliares";
import { formatarData } from "@/lib/formato";
import type { Ciclo } from "@/lib/cliente/tipos";

const STATUS_CICLO = [
  { valor: "planejamento", rotulo: "Planejamento" },
  { valor: "aberto", rotulo: "Aberto" },
  { valor: "encerrado", rotulo: "Encerrado" },
];

const SELO: Record<string, string> = {
  planejamento: "selo-amarelo",
  aberto: "selo-verde",
  encerrado: "selo-neutro",
};

const DECISOES = [
  { valor: "levar", rotulo: "Levar para o próximo ciclo" },
  { valor: "nao_levar", rotulo: "Não levar" },
  { valor: "encerrado", rotulo: "Projeto encerrado" },
  { valor: "pesquisa_finalizacao", rotulo: "Pesquisa de finalização" },
  { valor: "nao_elegivel", rotulo: "Não elegível" },
];

const MOTIVOS = [
  { valor: "", rotulo: "—" },
  { valor: "projeto_encerrado", rotulo: "Projeto encerrado" },
  { valor: "menos_de_tres_meses", rotulo: "Menos de três meses de execução" },
  { valor: "em_encerramento", rotulo: "Em fase de encerramento" },
  { valor: "cancelado", rotulo: "Cancelado" },
  { valor: "standby", rotulo: "Standby" },
  { valor: "outro", rotulo: "Outro" },
];

type CicloLinha = Ciclo & Record<string, unknown>;

export function TelaCiclos() {
  const toast = useToast();
  const [ciclos, setCiclos] = useState<CicloLinha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [editando, setEditando] = useState<CicloLinha | null | undefined>(undefined);
  const [vendo, setVendo] = useState<CicloLinha | null>(null);
  const [participantesDe, setParticipantesDe] = useState<CicloLinha | null>(null);
  const [passagemAberta, setPassagemAberta] = useState(false);
  const [mudandoStatus, setMudandoStatus] = useState<{
    ciclo: CicloLinha;
    status: "aberto" | "encerrado";
  } | null>(null);
  const [salvandoStatus, setSalvandoStatus] = useState(false);

  const carregar = useCallback(() => {
    setErro(null);
    auxiliares.invalidar("ciclos");
    api
      .get<{ itens: CicloLinha[] }>("ciclos")
      .then((r) => setCiclos(r.itens || []))
      .catch((e) => {
        setCiclos(null);
        setErro(e instanceof ErroApi ? e.message : "Falha ao carregar os ciclos.");
      });
  }, []);

  useEffect(carregar, [carregar]);

  async function confirmarStatus() {
    if (!mudandoStatus) return;
    setSalvandoStatus(true);
    try {
      await api.post(`ciclos/${mudandoStatus.ciclo.id}/status`, { status: mudandoStatus.status });
      toast(
        mudandoStatus.status === "aberto"
          ? "Ciclo aberto."
          : "Ciclo encerrado. Histórico preservado.",
        "sucesso"
      );
      setMudandoStatus(null);
      carregar();
    } catch (e) {
      toast(e instanceof ErroApi ? e.message : "Não foi possível alterar o ciclo.", "erro");
    } finally {
      setSalvandoStatus(false);
    }
  }

  const colunas: Coluna<CicloLinha>[] = [
    {
      chave: "codigo",
      rotulo: "Ciclo",
      render: (l) => (
        <>
          <span className="td-principal">{l.codigo}</span>
          <span className="td-sub" style={{ display: "block" }}>
            {l.descricao || ""}
          </span>
        </>
      ),
    },
    {
      chave: "status",
      rotulo: "Status",
      render: (l) => (
        <span className={`selo ${SELO[l.status]}`}>
          {STATUS_CICLO.find((s) => s.valor === l.status)?.rotulo || l.status}
        </span>
      ),
    },
    { chave: "data_inicio", rotulo: "Início", render: (l) => formatarData(l.data_inicio) },
    { chave: "data_fim", rotulo: "Fim", render: (l) => formatarData(l.data_fim) },
    {
      chave: "total_projetos",
      rotulo: "Projetos",
      classe: "td-num",
      render: (l) => l.total_projetos ?? 0,
    },
    {
      chave: "total_elegiveis",
      rotulo: "Elegíveis",
      classe: "td-num",
      render: (l) => l.total_elegiveis ?? 0,
    },
    {
      chave: "acoes",
      rotulo: "Ações",
      classe: "td-acoes",
      render: (l) => (
        <>
          <BotaoAcao icone="ver" titulo="Ver ciclo" onClick={() => setVendo(l)} />
          <BotaoAcao
            icone="projetos"
            titulo={
              l.status === "encerrado"
                ? "Ver projetos do ciclo"
                : "Definir quais projetos participam deste ciclo"
            }
            onClick={() => setParticipantesDe(l)}
          />
          <BotaoAcao icone="editar" titulo="Editar ciclo" onClick={() => setEditando(l)} />
          {l.status === "planejamento" ? (
            <BotaoAcao
              icone="reativar"
              titulo="Abrir ciclo"
              onClick={() => setMudandoStatus({ ciclo: l, status: "aberto" })}
            />
          ) : null}
          {l.status === "aberto" ? (
            <BotaoAcao
              icone="inativar"
              titulo="Encerrar ciclo"
              perigo
              onClick={() => setMudandoStatus({ ciclo: l, status: "encerrado" })}
            />
          ) : null}
        </>
      ),
    },
  ];

  return (
    <>
      <CabecalhoTela
        titulo="Ciclos"
        descricao="Cada ciclo define o universo de projetos avaliados no período. Ciclos anteriores permanecem consultáveis."
        acoes={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if ((ciclos?.length || 0) < 2) {
                  toast("Crie ao menos dois ciclos para fazer a passagem.", "aviso");
                  return;
                }
                setPassagemAberta(true);
              }}
            >
              Passagem de ciclo
            </button>
            <button type="button" className="btn-primary" onClick={() => setEditando(null)}>
              + Criar Ciclo
            </button>
          </>
        }
      />

      {erro ? (
        <EstadoErro mensagem={erro} />
      ) : !ciclos ? (
        <EstadoCarregando />
      ) : !ciclos.length ? (
        <EstadoVazio
          titulo="Nenhum ciclo cadastrado."
          descricao="Crie o primeiro ciclo para começar."
        />
      ) : (
        <div className="tabela-wrap">
          <Tabela colunas={colunas} linhas={ciclos} chaveDaLinha={(l) => l.id} />
        </div>
      )}

      {vendo ? (
        <ModalDetalhes
          titulo={`Ciclo ${vendo.codigo}`}
          subtitulo={vendo.descricao || undefined}
          aoFechar={() => setVendo(null)}
          itens={[
            { rotulo: "Código", valor: vendo.codigo },
            {
              rotulo: "Status",
              valor: (
                <span className={`selo ${SELO[vendo.status]}`}>
                  {STATUS_CICLO.find((s) => s.valor === vendo.status)?.rotulo || vendo.status}
                </span>
              ),
            },
            { rotulo: "Início", valor: formatarData(vendo.data_inicio) },
            { rotulo: "Fim", valor: formatarData(vendo.data_fim) },
            { rotulo: "Coleta por e-mail até", valor: formatarData(vendo.canal_email_ate) },
            { rotulo: "Projetos no ciclo", valor: vendo.total_projetos ?? 0 },
            { rotulo: "Elegíveis", valor: vendo.total_elegiveis ?? 0 },
            { rotulo: "Descrição", valor: vendo.descricao, largo: true },
          ]}
        />
      ) : null}

      {editando !== undefined ? (
        <FormularioCiclo
          ciclo={editando}
          aoFechar={() => setEditando(undefined)}
          aoSalvar={() => {
            const edicao = Boolean(editando);
            setEditando(undefined);
            carregar();
            toast(edicao ? "Ciclo atualizado." : "Ciclo criado.", "sucesso");
          }}
        />
      ) : null}

      {participantesDe ? (
        <Participantes
          ciclo={participantesDe}
          aoFechar={() => setParticipantesDe(null)}
          aoSalvar={() => {
            setParticipantesDe(null);
            carregar();
          }}
        />
      ) : null}

      {passagemAberta ? (
        <Passagem
          ciclos={ciclos || []}
          aoFechar={() => setPassagemAberta(false)}
          aoSalvar={() => {
            setPassagemAberta(false);
            carregar();
          }}
        />
      ) : null}

      {mudandoStatus ? (
        <Confirmacao
          titulo={mudandoStatus.status === "aberto" ? "Abrir ciclo?" : "Encerrar ciclo?"}
          mensagem={
            mudandoStatus.status === "aberto"
              ? "O ciclo passará a aceitar projetos e geração de pesquisas."
              : "Tem certeza que deseja encerrar este ciclo?"
          }
          detalhe={
            mudandoStatus.status === "encerrado"
              ? "O ciclo deixará de aceitar alterações, mas continuará consultável. Nenhum dado será apagado."
              : undefined
          }
          rotuloConfirmar={mudandoStatus.status === "aberto" ? "Abrir ciclo" : "Encerrar ciclo"}
          ocupado={salvandoStatus}
          aoConfirmar={confirmarStatus}
          aoCancelar={() => setMudandoStatus(null)}
        />
      ) : null}
    </>
  );
}

// ─── Criar / editar ────────────────────────────────────────────────────────

function FormularioCiclo({
  ciclo,
  aoFechar,
  aoSalvar,
}: {
  ciclo: CicloLinha | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const edicao = Boolean(ciclo);
  const [codigo, setCodigo] = useState(ciclo?.codigo || "");
  const [descricao, setDescricao] = useState(ciclo?.descricao || "");
  const [inicio, setInicio] = useState(ciclo?.data_inicio || "");
  const [fim, setFim] = useState(ciclo?.data_fim || "");
  const [emailAte, setEmailAte] = useState(ciclo?.canal_email_ate || "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // A janela do WhatsApp não é digitada: ela é o que sobra do ciclo depois do
  // corte. Mostrá-la calculada evita o campo que poderia contradizê-la.
  const janelaWhatsapp = (() => {
    if (!emailAte) return "Defina o último dia de e-mail para que o restante do ciclo conte como WhatsApp.";
    if (!fim) return "Do dia seguinte até o fim do ciclo — informe a data de fim acima.";
    const diaSeguinte = new Date(`${emailAte}T00:00:00`);
    diaSeguinte.setDate(diaSeguinte.getDate() + 1);
    const de = diaSeguinte.toISOString().slice(0, 10);
    if (de > fim) return "O corte está no fim do ciclo: não sobra período para o WhatsApp.";
    return `De ${formatarData(de)} até ${formatarData(fim)} — o resto do ciclo.`;
  })();

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      if (edicao) {
        // O codigo nao vai: e a identidade do ciclo e aparece em respostas,
        // pesquisas e no comparativo. Renomear reescreveria o passado.
        await api.patch("ciclos", {
          id: ciclo!.id,
          descricao,
          data_inicio: inicio,
          data_fim: fim,
          canal_email_ate: emailAte,
        });
      } else {
        await api.post("ciclos", {
          codigo,
          descricao,
          data_inicio: inicio,
          data_fim: fim,
          canal_email_ate: emailAte,
        });
      }
      auxiliares.invalidar("ciclos");
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={edicao ? "Editar ciclo" : "Criar ciclo"}
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Salvando..." : edicao ? "Salvar" : "Criar ciclo",
          classe: "btn-primary",
          onClick: salvar,
          desabilitado: salvando,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      <div className="form-grade">
        <CampoTexto
          nome="codigo"
          rotulo="Código do ciclo"
          valor={codigo}
          aoMudar={setCodigo}
          obrigatorio={!edicao}
          desabilitado={edicao}
          placeholder="2026.2"
          ajuda={
            edicao ? "O código não pode ser alterado." : "Formato AAAA.S — por exemplo 2026.2."
          }
        />
        <CampoTexto nome="descricao" rotulo="Descrição" valor={descricao} aoMudar={setDescricao} />
        <CampoTexto nome="data_inicio" rotulo="Início" tipo="date" valor={inicio} aoMudar={setInicio} />
        <CampoTexto nome="data_fim" rotulo="Fim" tipo="date" valor={fim} aoMudar={setFim} />

        {/* Como a coleta foi conduzida. Quem responde não escolhe canal — só
            clica no link; quem sabe é o PMO, e é aqui que ele diz.

            Uma data só, e não duas: o período de coleta já é o ciclo, então o
            WhatsApp vai do dia seguinte ao corte até o fim dele. Um segundo
            campo não acrescentaria nada e poderia discordar do próprio ciclo. */}
        <div className="form-secao">
          <h3>Como as respostas chegaram</h3>
          <p>
            Do início do ciclo até a data abaixo, as respostas contam como e-mail. Do dia seguinte
            até o fim do ciclo, contam como WhatsApp. Salvar reclassifica as respostas já
            registradas neste ciclo.
          </p>
        </div>
        <CampoTexto
          nome="canal_email_ate"
          rotulo="Respostas registradas por e-mail — até"
          tipo="date"
          valor={emailAte}
          aoMudar={setEmailAte}
          ajuda="Último dia do envio por e-mail"
        />
        <div className="form-campo">
          <span className="rotulo-estatico">Respostas registradas por WhatsApp</span>
          <p className="form-derivado">{janelaWhatsapp}</p>
        </div>
      </div>
    </Modal>
  );
}

// ─── Participantes do ciclo ────────────────────────────────────────────────

interface ItemParticipante {
  projeto_id: string;
  projeto_nome: string;
  codigo_clockify: string;
  cliente_nome: string | null;
  lider_nome: string | null;
  respostas: number;
  participa: boolean;
  elegivel: boolean;
}

interface Selecao {
  participa: boolean;
  elegivel: boolean;
}

function Participantes({
  ciclo,
  aoFechar,
  aoSalvar,
}: {
  ciclo: CicloLinha;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [itens, setItens] = useState<ItemParticipante[] | null>(null);
  const [editavel, setEditavel] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Estado local: so e gravado quando o PMO confirma. O `original` permite
  // enviar apenas o que de fato mudou.
  const [selecao, setSelecao] = useState<Map<string, Selecao>>(new Map());
  const [original, setOriginal] = useState<Map<string, Selecao>>(new Map());

  const [busca, setBusca] = useState("");
  const [mostrar, setMostrar] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmandoSaida, setConfirmandoSaida] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<{ itens: ItemParticipante[]; editavel: boolean }>(`ciclos/${ciclo.id}/participantes`)
      .then((r) => {
        setItens(r.itens || []);
        setEditavel(r.editavel);
        const mapa = new Map(
          (r.itens || []).map((i) => [
            i.projeto_id,
            { participa: i.participa, elegivel: i.elegivel },
          ])
        );
        setSelecao(mapa);
        setOriginal(new Map([...mapa].map(([k, v]) => [k, { ...v }])));
      })
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Falha ao carregar os projetos."));
  }, [ciclo.id]);

  const alterados = useMemo(
    () =>
      [...selecao.entries()]
        .filter(([id, v]) => {
          const o = original.get(id);
          if (!o) return false;
          return o.participa !== v.participa || (v.participa && o.elegivel !== v.elegivel);
        })
        .map(([id, v]) => ({ projeto_id: id, participar: v.participa, elegivel: v.elegivel })),
    [selecao, original]
  );

  async function salvar() {
    if (!alterados.length) {
      toast("Nenhuma alteração para salvar.", "aviso");
      return;
    }
    const saindo = alterados.filter((a) => !a.participar).length;
    if (saindo && confirmandoSaida === null) {
      setConfirmandoSaida(saindo);
      return;
    }
    setConfirmandoSaida(null);
    setSalvando(true);
    try {
      const r = await api.post<{ incluidos: number; retirados: number }>(
        `ciclos/${ciclo.id}/participantes`,
        { itens: alterados }
      );
      toast(
        `Ciclo atualizado: ${r.incluidos} incluído(s), ${r.retirados} retirado(s).`,
        "sucesso"
      );
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  function marcarTodos(participa: boolean) {
    setSelecao((atual) => {
      const novo = new Map(atual);
      novo.forEach((v, k) => novo.set(k, { participa, elegivel: participa ? v.elegivel : true }));
      return novo;
    });
  }

  const termo = busca.trim().toLowerCase();
  const visiveis = (itens || []).filter((i) => {
    const e = selecao.get(i.projeto_id);
    if (!e) return false;
    if (mostrar === "dentro" && !e.participa) return false;
    if (mostrar === "fora" && e.participa) return false;
    if (!termo) return true;
    return [i.projeto_nome, i.codigo_clockify, i.cliente_nome].some((c) =>
      (c || "").toLowerCase().includes(termo)
    );
  });

  const dentro = [...selecao.values()].filter((v) => v.participa).length;
  const elegiveis = [...selecao.values()].filter((v) => v.participa && v.elegivel).length;

  const acoes: AcaoModal[] = [{ rotulo: "Fechar", classe: "btn-secondary", onClick: aoFechar }];
  // Ciclo encerrado abre em modo leitura: sem botao de salvar.
  if (editavel) {
    acoes.push({
      rotulo: salvando ? "Salvando..." : "Salvar participantes",
      classe: "btn-primary",
      onClick: salvar,
      desabilitado: salvando,
    });
  }

  return (
    <>
      <Modal
        titulo={`Projetos do ciclo ${ciclo.codigo}`}
        subtitulo={
          editavel
            ? "Marque os projetos que participam deste ciclo."
            : "Ciclo encerrado — somente leitura. O histórico permanece consultável."
        }
        largo
        aoFechar={aoFechar}
        acoes={acoes}
      >
        {erro ? (
          <EstadoErro mensagem={erro} />
        ) : itens === null ? (
          <EstadoCarregando mensagem="Carregando projetos..." />
        ) : (
          <>
            <div className="filtros-modulo" style={{ marginBottom: 12 }}>
              <div className="filtro">
                <label htmlFor="pt-busca">Buscar</label>
                <input
                  id="pt-busca"
                  type="search"
                  placeholder="Projeto, código ou cliente"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <div className="filtro">
                <label htmlFor="pt-mostrar">Mostrar</label>
                <select
                  id="pt-mostrar"
                  value={mostrar}
                  onChange={(e) => setMostrar(e.target.value)}
                >
                  <option value="">Todos os projetos</option>
                  <option value="dentro">Só os que participam</option>
                  <option value="fora">Só os que estão fora</option>
                </select>
              </div>
              {editavel ? (
                <div className="filtro filtro-acoes">
                  <button type="button" className="btn-mini" onClick={() => marcarTodos(true)}>
                    Marcar todos
                  </button>
                  <button type="button" className="btn-mini" onClick={() => marcarTodos(false)}>
                    Desmarcar todos
                  </button>
                </div>
              ) : null}
            </div>

            <div style={{ fontSize: ".82rem", color: "var(--text-muted)", marginBottom: 8 }}>
              <strong>{dentro}</strong> de {selecao.size} projetos no ciclo ·{" "}
              <strong>{elegiveis}</strong> elegíveis para pesquisa
            </div>

            <div
              style={{
                maxHeight: "48vh",
                overflow: "auto",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {visiveis.length ? (
                visiveis.map((i) => {
                  const e = selecao.get(i.projeto_id)!;
                  return (
                    <div
                      key={i.projeto_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        padding: "9px 12px",
                        borderBottom: "1px solid var(--line-soft)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={e.participa}
                        disabled={!editavel}
                        style={{ flexShrink: 0, width: 16, height: 16, cursor: "pointer" }}
                        onChange={(ev) =>
                          setSelecao((atual) => {
                            const novo = new Map(atual);
                            // Sair do ciclo devolve a elegibilidade ao padrao:
                            // um projeto marcado "nao elegivel" que sai e volta
                            // deve voltar elegivel, nao herdar a excecao.
                            novo.set(i.projeto_id, {
                              participa: ev.target.checked,
                              elegivel: ev.target.checked ? e.elegivel : true,
                            });
                            return novo;
                          })
                        }
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="td-principal" style={{ whiteSpace: "normal" }}>
                          {i.projeto_nome}
                        </div>
                        <div className="td-sub">
                          {i.codigo_clockify} · {i.cliente_nome || "—"} ·{" "}
                          {i.lider_nome || "sem líder"}
                          {Number(i.respostas) > 0 ? (
                            <>
                              {" · "}
                              <span className="selo selo-verde">{i.respostas} resposta(s)</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: ".75rem",
                          color: "var(--text-muted)",
                          flexShrink: 0,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={e.elegivel}
                          disabled={!editavel || !e.participa}
                          onChange={(ev) =>
                            setSelecao((atual) => {
                              const novo = new Map(atual);
                              novo.set(i.projeto_id, { ...e, elegivel: ev.target.checked });
                              return novo;
                            })
                          }
                        />
                        elegível
                      </label>
                    </div>
                  );
                })
              ) : (
                <EstadoVazio titulo="Nenhum projeto encontrado com esse filtro." />
              )}
            </div>
          </>
        )}
      </Modal>

      {confirmandoSaida !== null ? (
        <Confirmacao
          titulo="Confirmar alterações?"
          mensagem={`${confirmandoSaida} projeto(s) serão retirados deste ciclo.`}
          detalhe="Nenhum dado é apagado: o registro da participação é preservado e as respostas já recebidas continuam no histórico."
          rotuloConfirmar="Salvar"
          ocupado={salvando}
          aoConfirmar={salvar}
          aoCancelar={() => setConfirmandoSaida(null)}
        />
      ) : null}
    </>
  );
}

// ─── Passagem de ciclo ─────────────────────────────────────────────────────

interface ItemPassagem {
  projeto_id: string;
  projeto_nome: string;
  codigo_clockify: string;
  cliente_nome: string | null;
  lider_ciclo: string | null;
  respostas: number;
  decisao: { decisao?: string; motivo?: string; observacao?: string } | null;
}

interface Decisao {
  decisao: string;
  motivo: string;
  observacao: string;
}

function Passagem({
  ciclos,
  aoFechar,
  aoSalvar,
}: {
  ciclos: CicloLinha[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [itens, setItens] = useState<ItemPassagem[] | null>(null);
  const [decisoes, setDecisoes] = useState<Map<string, Decisao>>(new Map());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const naoEncerrados = ciclos.filter((c) => c.status !== "encerrado");
  const mesmoCiclo = Boolean(origem && destino && origem === destino);

  useEffect(() => {
    if (!origem || !destino || mesmoCiclo) {
      setItens(null);
      return;
    }
    let ativo = true;
    setCarregando(true);
    setErro(null);
    api
      .get<{ itens: ItemPassagem[] }>("ciclos/preparar", { origem, destino })
      .then((r) => {
        if (!ativo) return;
        setItens(r.itens || []);
        setDecisoes(
          new Map(
            (r.itens || []).map((i) => [
              i.projeto_id,
              {
                decisao: i.decisao?.decisao || "levar",
                motivo: i.decisao?.motivo || "",
                observacao: i.decisao?.observacao || "",
              },
            ])
          )
        );
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof ErroApi ? e.message : "Falha ao carregar os projetos.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [origem, destino, mesmoCiclo]);

  function mudar(id: string, campo: keyof Decisao, valor: string) {
    setDecisoes((atual) => {
      const novo = new Map(atual);
      const d = { ...novo.get(id)!, [campo]: valor };
      // Motivo so faz sentido quando o projeto NAO vai para o proximo ciclo.
      if (campo === "decisao" && valor === "levar") {
        d.motivo = "";
        d.observacao = "";
      }
      novo.set(id, d);
      return novo;
    });
  }

  function marcarTodos(decisao: string) {
    setDecisoes((atual) => {
      const novo = new Map(atual);
      novo.forEach((d, k) =>
        novo.set(k, decisao === "levar" ? { decisao, motivo: "", observacao: "" } : { ...d, decisao })
      );
      return novo;
    });
  }

  async function confirmar() {
    if (!origem || !destino || !itens?.length) {
      setErro("Selecione os ciclos e revise os projetos antes de confirmar.");
      return;
    }
    const semObservacao = [...decisoes.entries()].find(
      ([, d]) => d.motivo === "outro" && !d.observacao.trim()
    );
    if (semObservacao) {
      setErro('Informe a observação nos projetos cujo motivo é "Outro".');
      return;
    }

    setErro(null);
    setSalvando(true);
    try {
      const r = await api.post<{ registros: number; levados: number }>("ciclos/passagem", {
        ciclo_origem_id: origem,
        ciclo_destino_id: destino,
        decisoes: [...decisoes.entries()].map(([projeto_id, d]) => ({ projeto_id, ...d })),
      });
      toast(
        `Passagem registrada: ${r.registros} decisão(ões), ${r.levados} projeto(s) levados.`,
        "sucesso"
      );
      auxiliares.invalidar("ciclos");
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível registrar a passagem.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo="Passagem para novo ciclo"
      subtitulo="Decida projeto a projeto o que vai para o próximo ciclo."
      largo
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Registrando..." : "Confirmar passagem",
          classe: "btn-primary",
          onClick: confirmar,
          desabilitado: salvando || !itens?.length,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      <div className="form-grade" style={{ marginBottom: 14 }}>
        <CampoSelect
          nome="origem"
          rotulo="Ciclo de origem"
          obrigatorio
          valor={origem}
          aoMudar={setOrigem}
          opcoes={ciclos.map((c) => ({ valor: c.id, rotulo: c.codigo }))}
        />
        <CampoSelect
          nome="destino"
          rotulo="Ciclo de destino"
          obrigatorio
          valor={destino}
          aoMudar={setDestino}
          opcoes={naoEncerrados.map((c) => ({
            valor: c.id,
            rotulo: `${c.codigo} (${c.status})`,
          }))}
        />
      </div>

      {mesmoCiclo ? (
        <Aviso tipo="perigo">Origem e destino devem ser ciclos diferentes.</Aviso>
      ) : !origem || !destino ? (
        <p style={{ fontSize: ".84rem", color: "var(--text-muted)" }}>
          Selecione o ciclo de origem e o de destino.
        </p>
      ) : carregando ? (
        <EstadoCarregando mensagem="Carregando projetos do ciclo anterior..." />
      ) : !itens?.length ? (
        <EstadoVazio titulo="Nenhum projeto no ciclo de origem." />
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn-mini" onClick={() => marcarTodos("levar")}>
              Marcar todos: Levar
            </button>
            <button type="button" className="btn-mini" onClick={() => marcarTodos("nao_levar")}>
              Marcar todos: Não levar
            </button>
          </div>

          <div
            style={{
              maxHeight: "46vh",
              overflow: "auto",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {itens.map((i) => {
              const d = decisoes.get(i.projeto_id)!;
              const leva = d.decisao === "levar";
              const controle = {
                height: 32,
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-2)",
                fontFamily: "inherit",
                fontSize: ".82rem",
              } as const;

              return (
                <div
                  key={i.projeto_id}
                  style={{ padding: "11px 13px", borderBottom: "1px solid var(--line-soft)" }}
                >
                  <div className="td-principal">{i.projeto_nome}</div>
                  <div className="td-sub" style={{ marginBottom: 8 }}>
                    {i.codigo_clockify} · {i.cliente_nome || "—"} · {i.lider_ciclo || "—"}
                    {Number(i.respostas) > 0 ? (
                      <>
                        {" · "}
                        <span className="selo selo-verde">{i.respostas} resposta(s)</span>
                      </>
                    ) : null}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                      gap: 8,
                    }}
                  >
                    <select
                      style={controle}
                      value={d.decisao}
                      aria-label={`Decisão para ${i.projeto_nome}`}
                      onChange={(e) => mudar(i.projeto_id, "decisao", e.target.value)}
                    >
                      {DECISOES.map((o) => (
                        <option key={o.valor} value={o.valor}>
                          {o.rotulo}
                        </option>
                      ))}
                    </select>
                    {!leva ? (
                      <select
                        style={controle}
                        value={d.motivo}
                        aria-label={`Motivo para ${i.projeto_nome}`}
                        onChange={(e) => mudar(i.projeto_id, "motivo", e.target.value)}
                      >
                        {MOTIVOS.map((o) => (
                          <option key={o.valor} value={o.valor}>
                            {o.rotulo}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                  {!leva && d.motivo === "outro" ? (
                    <textarea
                      placeholder="Descreva o motivo"
                      rows={2}
                      value={d.observacao}
                      onChange={(e) => mudar(i.projeto_id, "observacao", e.target.value)}
                      style={{
                        width: "100%",
                        marginTop: 7,
                        padding: "7px 9px",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--surface-2)",
                        fontFamily: "inherit",
                        fontSize: ".82rem",
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
