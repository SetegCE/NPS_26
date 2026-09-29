"use client";

// ISC — Indice de Satisfacao do Cliente.
//
// Percepcao INTERNA do lider, de 0 a 10. Visualmente separado do NPS e sem
// qualquer efeito sobre o calculo dele: sao duas perguntas diferentes feitas
// a duas pessoas diferentes.
//
// A tela e um calendario: projetos nas linhas, os 12 meses do ano nas
// colunas. O lider enxerga de relance o que ja preencheu e o que falta, e o
// PMO tem a mesma grade como visao global, com o resumo por lider em cima.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CampoArea, CampoTexto, opcoesDe } from "@/componentes/Campo";
import { ModalDetalhes } from "@/componentes/Detalhes";
import { useExclusao } from "@/componentes/Excluir";
import { Aviso, EstadoCarregando, EstadoErro, EstadoVazio } from "@/componentes/Estados";
import { Modal } from "@/componentes/Modal";
import { Tabela } from "@/componentes/Tabela";
import { BarraFiltros, CabecalhoTela, Filtro, FiltroSelect } from "@/componentes/Tela";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi, type Pagina } from "@/lib/cliente/api";
import { auxiliares, useAuxiliar } from "@/lib/cliente/auxiliares";
import { formatarCompetencia, formatarData } from "@/lib/formato";
import type { Sessao } from "@/lib/cliente/tipos";

interface ProjetoIsc {
  id: string;
  nome: string;
  codigo_clockify: string;
  cliente_nome: string | null;
  lider_id?: string | null;
  lider_nome: string | null;
}

interface RegistroIsc extends Record<string, unknown> {
  id?: string;
  projeto_id?: string;
  nota: number | string;
  observacao: string | null;
  created_at: string | null;
  competencia?: string;
  lider_nome?: string;
  registrado_por?: string;
}

interface Item extends Record<string, unknown> {
  projeto: ProjetoIsc;
  isc: RegistroIsc | null;
}

interface Calendario {
  ano: number;
  meses: string[];
  projetos: ProjetoIsc[];
  registros: (RegistroIsc & { projeto_id: string; competencia: string })[];
}

/** A celula aberta: o projeto, o mes e o registro (se houver). */
interface Celula extends Item {
  competencia: string;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const mesVigente = () => `${new Date().toISOString().slice(0, 7)}-01`;
const anoVigente = () => new Date().getUTCFullYear();

const umaCasa = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function media(notas: number[]): number | null {
  return notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
}

/** Mesmas faixas usadas no resto do sistema para notas de 0 a 10. */
function faixa(nota: number | null): string {
  if (nota === null) return "";
  if (nota >= 9) return "alta";
  if (nota >= 7) return "media";
  return "baixa";
}

export function TelaIsc({ sessao }: { sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const toast = useToast();
  const lideres = useAuxiliar(auxiliares.lideres);
  const clientes = useAuxiliar(auxiliares.clientes);

  const [ano, setAno] = useState(anoVigente());
  const [lider, setLider] = useState("");
  const [cliente, setCliente] = useState("");
  const [busca, setBusca] = useState("");
  const [soPendentes, setSoPendentes] = useState(false);

  const [dados, setDados] = useState<Calendario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<Celula | null>(null);
  const [registrando, setRegistrando] = useState<Celula | null>(null);
  const [historicoDe, setHistoricoDe] = useState<ProjetoIsc | null>(null);
  const [comparativoAberto, setComparativoAberto] = useState(false);

  const carregar = useCallback(() => {
    setErro(null);
    api
      .get<Calendario>("isc/calendario", { ano, lider, cliente })
      .then(setDados)
      .catch((e) => {
        setDados(null);
        setErro(e instanceof ErroApi ? e.message : "Falha ao carregar o ISC.");
      });
  }, [ano, lider, cliente]);

  useEffect(carregar, [carregar]);

  const exclusao = useExclusao(() => {
    setAberta(null);
    carregar();
  });

  const vigente = mesVigente();
  // Mes de referencia dos indicadores: o vigente no ano corrente, dezembro
  // nos anos fechados.
  const mesRef = ano === anoVigente() ? vigente : `${ano}-12-01`;

  const grade = useMemo(() => {
    if (!dados) return null;
    const porProjeto = new Map<string, Map<string, RegistroIsc>>();
    for (const r of dados.registros) {
      if (!porProjeto.has(r.projeto_id)) porProjeto.set(r.projeto_id, new Map());
      porProjeto.get(r.projeto_id)!.set(r.competencia, r);
    }
    const notaDe = (p: string, m: string) => {
      const r = porProjeto.get(p)?.get(m);
      return r ? Number(r.nota) : null;
    };
    const mesesAteRef = dados.meses.filter((m) => m <= mesRef);

    const linhas = dados.projetos.map((p) => {
      const notas = mesesAteRef.map((m) => notaDe(p.id, m)).filter((n): n is number => n !== null);
      return {
        projeto: p,
        registros: porProjeto.get(p.id) || new Map<string, RegistroIsc>(),
        media: media(notas),
        lacunas: mesesAteRef.length - notas.length,
        pendenteNoMes: notaDe(p.id, mesRef) === null,
      };
    });

    const notasDoMes = linhas.map((l) => notaDe(l.projeto.id, mesRef)).filter((n): n is number => n !== null);
    const notasDoAno = dados.registros.map((r) => Number(r.nota));

    const mediasPorMes = dados.meses.map((m) =>
      media(linhas.map((l) => notaDe(l.projeto.id, m)).filter((n): n is number => n !== null))
    );

    // Resumo por lider (visao do PMO)
    const porLider = new Map<string, { nome: string; id: string | null; linhas: typeof linhas }>();
    for (const l of linhas) {
      const chave = l.projeto.lider_id || "—";
      if (!porLider.has(chave)) {
        porLider.set(chave, { nome: l.projeto.lider_nome || "Sem líder", id: l.projeto.lider_id || null, linhas: [] });
      }
      porLider.get(chave)!.linhas.push(l);
    }
    const lideresResumo = [...porLider.values()]
      .map((g) => {
        const doMes = g.linhas.map((l) => notaDe(l.projeto.id, mesRef)).filter((n): n is number => n !== null);
        const doAno = g.linhas.flatMap((l) => [...l.registros.values()].map((r) => Number(r.nota)));
        return {
          id: g.id,
          nome: g.nome,
          projetos: g.linhas.length,
          preenchidos: doMes.length,
          mediaMes: media(doMes),
          mediaAno: media(doAno),
          lacunas: g.linhas.reduce((s, l) => s + l.lacunas, 0),
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    return {
      linhas,
      mediasPorMes,
      lideresResumo,
      mediaMes: media(notasDoMes),
      mediaAno: media(notasDoAno),
      preenchidosNoMes: notasDoMes.length,
      lacunas: linhas.reduce((s, l) => s + l.lacunas, 0),
    };
  }, [dados, mesRef]);

  const termo = busca.trim().toLowerCase();
  const visiveis = (grade?.linhas || []).filter(
    (l) =>
      (!soPendentes || l.pendenteNoMes) &&
      (!termo ||
        l.projeto.nome.toLowerCase().includes(termo) ||
        l.projeto.codigo_clockify.toLowerCase().includes(termo) ||
        (l.projeto.cliente_nome || "").toLowerCase().includes(termo))
  );

  const total = dados?.projetos.length || 0;
  const anos = Array.from({ length: 4 }, (_, i) => anoVigente() - i);

  function abrir(projeto: ProjetoIsc, competencia: string, isc: RegistroIsc | null) {
    const celula = { projeto, competencia, isc };
    // Mes vazio abre direto o registro; mes preenchido abre o detalhe.
    if (isc) setAberta(celula);
    else setRegistrando(celula);
  }

  return (
    <>
      <CabecalhoTela
        titulo={
          ehPmo ? "ISC — Índice de Satisfação do Cliente" : "ISC — Percepção mensal dos meus projetos"
        }
        descricao="Nota interna de 0 a 10 atribuída pelo líder, mês a mês. Não altera nem compõe o NPS."
        acoes={
          <button type="button" className="btn-secondary" onClick={() => setComparativoAberto(true)}>
            Comparar com NPS
          </button>
        }
      />

      <BarraFiltros>
        {ehPmo ? (
          <>
            <FiltroSelect
              id="f-lider"
              rotulo="Líder"
              valor={lider}
              aoMudar={setLider}
              opcoes={[{ valor: "", rotulo: "Todos" }, ...opcoesDe(lideres)]}
            />
            <FiltroSelect
              id="f-cliente"
              rotulo="Cliente"
              valor={cliente}
              aoMudar={setCliente}
              opcoes={[{ valor: "", rotulo: "Todos" }, ...opcoesDe(clientes)]}
            />
          </>
        ) : null}
        <Filtro id="f-busca" rotulo="Buscar">
          <input
            id="f-busca"
            type="search"
            placeholder="Projeto, código ou cliente"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </Filtro>
        <Filtro id="f-pendentes" rotulo="Mostrar">
          <label className="isc-check">
            <input
              id="f-pendentes"
              type="checkbox"
              checked={soPendentes}
              onChange={(e) => setSoPendentes(e.target.checked)}
            />
            Só pendentes em {formatarCompetencia(mesRef)}
          </label>
        </Filtro>
      </BarraFiltros>

      {grade ? (
        <>
          {!ehPmo ? <h2 className="isc-secao">Meus indicadores</h2> : null}
          <div className="kpi-modulo">
            <div className="kpi-card-modulo isc">
              <div className="rotulo">ISC do mês</div>
              <div className="valor">{grade.mediaMes !== null ? umaCasa(grade.mediaMes) : "—"}</div>
              <div className="detalhe">média em {formatarCompetencia(mesRef)}</div>
            </div>
            <div className="kpi-card-modulo isc">
              <div className="rotulo">ISC do ano</div>
              <div className="valor">{grade.mediaAno !== null ? umaCasa(grade.mediaAno) : "—"}</div>
              <div className="detalhe">média de {dados?.registros.length || 0} registro(s) em {ano}</div>
            </div>
            <div className="kpi-card-modulo">
              <div className="rotulo">Preenchidos no mês</div>
              <div className="valor">
                {grade.preenchidosNoMes}/{total}
              </div>
              <div className="detalhe">
                {total ? Math.round((grade.preenchidosNoMes / total) * 100) : 0}% dos projetos
              </div>
            </div>
            <div className="kpi-card-modulo">
              <div className="rotulo">Meses em aberto</div>
              <div className="valor">{grade.lacunas}</div>
              <div className="detalhe">lacunas até {formatarCompetencia(mesRef)}</div>
            </div>
          </div>

          {ehPmo && grade.lideresResumo.length > 1 ? (
            <>
              <h2 className="isc-secao">Por líder</h2>
              <div className="tabela-wrap" style={{ marginBottom: 22 }}>
                <Tabela
                  colunas={[
                    {
                      chave: "nome",
                      rotulo: "Líder",
                      render: (l) => <span className="td-principal">{l.nome}</span>,
                    },
                    { chave: "projetos", rotulo: "Projetos", classe: "td-num", render: (l) => l.projetos },
                    {
                      chave: "preenchidos",
                      rotulo: `Preenchidos ${formatarCompetencia(mesRef)}`,
                      render: (l) => (
                        <span className={`selo ${l.preenchidos === l.projetos ? "selo-verde" : "selo-amarelo"}`}>
                          {l.preenchidos}/{l.projetos}
                        </span>
                      ),
                    },
                    {
                      chave: "mediaMes",
                      rotulo: "ISC do mês",
                      classe: "td-num",
                      render: (l) => (l.mediaMes !== null ? <strong>{umaCasa(l.mediaMes)}</strong> : "—"),
                    },
                    {
                      chave: "mediaAno",
                      rotulo: "ISC do ano",
                      classe: "td-num",
                      render: (l) => (l.mediaAno !== null ? umaCasa(l.mediaAno) : "—"),
                    },
                    { chave: "lacunas", rotulo: "Meses em aberto", classe: "td-num", render: (l) => l.lacunas },
                    {
                      chave: "acoes",
                      rotulo: "Ações",
                      classe: "td-acoes",
                      render: (l) =>
                        l.id ? (
                          <button type="button" className="btn-mini" onClick={() => setLider(l.id!)}>
                            Ver só este líder
                          </button>
                        ) : null,
                    },
                  ]}
                  linhas={grade.lideresResumo}
                  chaveDaLinha={(l) => l.id || l.nome}
                />
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {erro ? (
        <EstadoErro mensagem={erro} />
      ) : !dados || !grade ? (
        <EstadoCarregando />
      ) : !total ? (
        <EstadoVazio
          titulo="Nenhum projeto para avaliar."
          descricao={ehPmo ? "Nenhum projeto ativo com esses filtros." : "Você não possui projetos ativos."}
        />
      ) : (
        <>
          <div className="isc-cabecalho-grade">
            <h2 className="isc-secao">Calendário {ano}</h2>
            <div className="isc-ferramentas">
              <div className="isc-legenda" aria-hidden="true">
                <span><i className="isc-cel alta" /> 9 a 10</span>
                <span><i className="isc-cel media" /> 7 a 8</span>
                <span><i className="isc-cel baixa" /> 0 a 6</span>
                <span><i className="isc-cel vazia" /> a preencher</span>
              </div>
              <label className="isc-ano">
                Ano
                <select value={String(ano)} onChange={(e) => setAno(Number(e.target.value))}>
                  {anos.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="tabela-wrap">
            <div className="tabela-scroll">
              <table className="tabela-modulo isc-calendario">
                <thead>
                  <tr>
                    <th className="isc-col-projeto">Projeto</th>
                    {dados.meses.map((m, i) => (
                      <th key={m} className={`isc-col-mes ${m === vigente ? "mes-atual" : ""}`}>
                        {MESES[i]}
                      </th>
                    ))}
                    <th className="isc-col-mes">Média</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.length ? (
                    visiveis.map((l) => (
                      <tr key={l.projeto.id}>
                        <td className="isc-col-projeto">
                          <button
                            type="button"
                            className="isc-projeto"
                            title="Histórico mensal do ISC"
                            onClick={() => setHistoricoDe(l.projeto)}
                          >
                            <span className="td-principal">{l.projeto.nome}</span>
                            <span className="td-sub">
                              {l.projeto.codigo_clockify} · {l.projeto.cliente_nome || "—"}
                              {ehPmo ? ` · ${l.projeto.lider_nome || "sem líder"}` : ""}
                            </span>
                          </button>
                        </td>
                        {dados.meses.map((m) => {
                          const r = l.registros.get(m) || null;
                          const n = r ? Number(r.nota) : null;
                          const futuro = m > vigente;
                          return (
                            <td key={m} className={`isc-col-mes ${m === vigente ? "mes-atual" : ""}`}>
                              {futuro ? (
                                <span className="isc-cel futura" aria-hidden="true" />
                              ) : (
                                <button
                                  type="button"
                                  className={`isc-cel ${r ? faixa(n) : "vazia"}`}
                                  title={
                                    r
                                      ? `${formatarCompetencia(m)}: ISC ${n}${r.observacao ? ` — ${r.observacao}` : ""}`
                                      : `Registrar ISC de ${formatarCompetencia(m)}`
                                  }
                                  onClick={() => abrir(l.projeto, m, r)}
                                >
                                  {r ? n : "+"}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="isc-col-mes">
                          <strong className={`isc-media ${faixa(l.media)}`}>
                            {l.media !== null ? umaCasa(l.media) : "—"}
                          </strong>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={14} className="td-sub" style={{ textAlign: "center", padding: 24 }}>
                        Nenhum projeto com esses filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="isc-col-projeto">
                      <span className="td-principal">Média do mês</span>
                    </td>
                    {grade.mediasPorMes.map((mm, i) => (
                      <td key={dados.meses[i]} className={`isc-col-mes ${dados.meses[i] === vigente ? "mes-atual" : ""}`}>
                        <strong className={`isc-media ${faixa(mm)}`}>{mm !== null ? umaCasa(mm) : "—"}</strong>
                      </td>
                    ))}
                    <td className="isc-col-mes">
                      <strong className={`isc-media ${faixa(grade.mediaAno)}`}>
                        {grade.mediaAno !== null ? umaCasa(grade.mediaAno) : "—"}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <p className="td-sub" style={{ marginTop: 10 }}>
            Clique em um mês vazio para registrar a nota. Meses anteriores podem ser preenchidos
            enquanto estiverem vazios; só o mês vigente pode ser editado depois de registrado.
          </p>
        </>
      )}

      {aberta ? (
        <ModalDetalhes
          titulo={aberta.projeto.nome}
          subtitulo={`ISC de ${formatarCompetencia(aberta.competencia)}`}
          aoFechar={() => setAberta(null)}
          itens={[
            { rotulo: "Código", valor: aberta.projeto.codigo_clockify },
            { rotulo: "Cliente", valor: aberta.projeto.cliente_nome },
            { rotulo: "Líder no período", valor: aberta.isc?.lider_nome || aberta.projeto.lider_nome },
            { rotulo: "Competência", valor: formatarCompetencia(aberta.competencia) },
            {
              rotulo: "Nota ISC",
              valor: <strong style={{ fontSize: "1rem" }}>{aberta.isc?.nota}</strong>,
            },
            { rotulo: "Registrado em", valor: formatarData(aberta.isc?.created_at, true) },
            { rotulo: "Registrado por", valor: aberta.isc?.registrado_por },
            { rotulo: "Observação", valor: aberta.isc?.observacao, largo: true },
          ]}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* So a competencia vigente e editavel: reescrever a percepcao de
                meses fechados apagaria o historico que a tela existe para
                mostrar. */}
            {aberta.competencia === vigente ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setRegistrando(aberta);
                  setAberta(null);
                }}
              >
                Editar nota
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setHistoricoDe(aberta.projeto);
                setAberta(null);
              }}
            >
              Histórico do projeto
            </button>
            {ehPmo && aberta.isc?.id
              ? exclusao.botao(
                  "isc",
                  aberta.isc.id,
                  `a nota ISC de ${aberta.projeto.codigo_clockify} em ${formatarCompetencia(aberta.competencia)}`
                )
              : null}
          </div>
        </ModalDetalhes>
      ) : null}

      {registrando ? (
        <Registro
          item={registrando}
          competencia={registrando.competencia}
          aoFechar={() => setRegistrando(null)}
          aoSalvar={(novo) => {
            setRegistrando(null);
            carregar();
            toast(novo ? "ISC registrado." : "ISC atualizado.", "sucesso");
          }}
        />
      ) : null}

      {historicoDe ? <Historico projeto={historicoDe} aoFechar={() => setHistoricoDe(null)} /> : null}

      {comparativoAberto ? (
        <Comparativo lider={lider} cliente={cliente} aoFechar={() => setComparativoAberto(false)} />
      ) : null}
      {exclusao.modal}
    </>
  );
}

function Registro({
  item,
  competencia,
  aoFechar,
  aoSalvar,
}: {
  item: Item;
  competencia: string;
  aoFechar: () => void;
  aoSalvar: (novo: boolean) => void;
}) {
  const existente = item.isc;
  const [nota, setNota] = useState(existente ? String(existente.nota) : "");
  const [observacao, setObservacao] = useState(existente?.observacao || "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const n = Number(nota);
    if (!Number.isInteger(n) || n < 0 || n > 10) {
      setErro("A nota deve ser um número inteiro de 0 a 10.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      await api.post("isc", {
        projeto_id: item.projeto.id,
        competencia,
        nota: n,
        observacao,
      });
      aoSalvar(!existente);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={existente ? "Editar ISC da competência" : "Registrar ISC"}
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Salvando..." : "Salvar ISC",
          classe: "btn-primary",
          onClick: salvar,
          desabilitado: salvando,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      <Aviso tipo="info">
        O ISC é a <strong>sua percepção interna</strong> sobre a satisfação do cliente. Ele não
        substitui nem altera o NPS informado pelo próprio cliente.
      </Aviso>

      <div style={{ fontSize: ".85rem", lineHeight: 1.7, marginBottom: 14 }}>
        <div>
          Cliente: <strong>{item.projeto.cliente_nome || "—"}</strong>
        </div>
        <div>
          Projeto: <strong>{item.projeto.nome}</strong>
        </div>
        <div>
          Líder: <strong>{item.projeto.lider_nome || "—"}</strong>
        </div>
        <div>
          Competência: <strong>{formatarCompetencia(competencia)}</strong>
        </div>
      </div>

      <div className="form-grade">
        <CampoTexto
          nome="nota"
          rotulo="Nota ISC (0 a 10)"
          tipo="number"
          obrigatorio
          valor={nota}
          aoMudar={setNota}
        />
        <CampoArea
          nome="observacao"
          rotulo="Observação"
          valor={observacao}
          aoMudar={setObservacao}
          larguraTotal
          maxLength={2000}
        />
      </div>
    </Modal>
  );
}

function Historico({ projeto, aoFechar }: { projeto: ProjetoIsc; aoFechar: () => void }) {
  const [itens, setItens] = useState<RegistroIsc[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Pagina<RegistroIsc>>("isc", {
        projeto: projeto.id,
        porPagina: 60,
        ordenarPor: "competencia",
        ordem: "desc",
      })
      .then((r) => setItens(r.itens || []))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Falha ao carregar o histórico."));
  }, [projeto.id]);

  return (
    <Modal
      titulo={`Histórico de ISC — ${projeto.nome}`}
      largo
      aoFechar={aoFechar}
      acoes={[{ rotulo: "Fechar", classe: "btn-secondary", onClick: aoFechar }]}
    >
      {erro ? (
        <EstadoErro mensagem={erro} />
      ) : itens === null ? (
        <EstadoCarregando />
      ) : itens.length ? (
        <Tabela
          colunas={[
            {
              chave: "competencia",
              rotulo: "Competência",
              render: (l) => (
                <span className="td-principal">{formatarCompetencia(l.competencia)}</span>
              ),
            },
            { chave: "nota", rotulo: "Nota", classe: "td-num", render: (l) => <strong>{l.nota}</strong> },
            { chave: "lider_nome", rotulo: "Líder no período", render: (l) => l.lider_nome || "—" },
            { chave: "observacao", rotulo: "Observação", render: (l) => l.observacao || "—" },
            {
              chave: "registrado_por",
              rotulo: "Registrado por",
              render: (l) => l.registrado_por || "—",
            },
          ]}
          linhas={itens}
          chaveDaLinha={(l, i) => `${l.competencia}-${i}`}
        />
      ) : (
        <EstadoVazio titulo="Nenhum ISC registrado para este projeto." />
      )}
    </Modal>
  );
}

interface ItemComparativo {
  projeto: { id: string; nome: string; cliente_nome: string | null; lider_nome: string | null };
  isc_media: number | null;
  isc_avaliacoes: number;
  q4_media: number | null;
  q4_respostas: number;
}


/**
 * As duas medias estao na mesma escala (0 a 10): media do ISC dado pelo lider
 * e media da pergunta 4 respondida pelo cliente. A frase e so leitura humana
 * e NAO entra em calculo nenhum.
 */
function descreverDivergencia(isc: number, q4: number): string {
  const delta = isc - q4;
  if (Math.abs(delta) < 1) return "Percepção interna alinhada à do cliente.";
  return delta > 0
    ? "Atenção: o líder percebe o cliente mais satisfeito do que o próprio cliente indicou."
    : "O cliente avaliou melhor do que a percepção interna do líder.";
}

function Comparativo({
  lider,
  cliente,
  aoFechar,
}: {
  lider: string;
  cliente: string;
  aoFechar: () => void;
}) {
  const [dados, setDados] = useState<{ itens: ItemComparativo[]; aviso: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ itens: ItemComparativo[]; aviso: string }>("isc/comparativo", { lider, cliente })
      .then(setDados)
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Falha ao carregar o comparativo."));
  }, [lider, cliente]);

  const comAlgo = (dados?.itens || []).filter((i) => i.isc_media !== null || i.q4_respostas > 0);

  return (
    <Modal
      titulo="ISC x NPS"
      subtitulo="Na mesma escala (0 a 10): média do ISC dado pelo líder x média da pergunta 4 respondida pelo cliente."
      largo
      aoFechar={aoFechar}
      acoes={[{ rotulo: "Fechar", classe: "btn-secondary", onClick: aoFechar }]}
    >
      {erro ? (
        <EstadoErro mensagem={erro} />
      ) : !dados ? (
        <EstadoCarregando />
      ) : !comAlgo.length ? (
        <EstadoVazio
          titulo="Nada a comparar ainda."
          descricao="É preciso ao menos um ISC registrado ou uma resposta recebida."
        />
      ) : (
        <>
          <Aviso tipo="atencao">{dados.aviso}</Aviso>
          <div className="comparativo-grade">
            {comAlgo.map((i) => (
              <div className="comparativo-card" key={i.projeto.id}>
                <h3>{i.projeto.nome}</h3>
                <div className="cliente">
                  {i.projeto.cliente_nome || "—"} · {i.projeto.lider_nome || "—"}
                </div>
                <div className="comparativo-metricas">
                  <div className="metrica-bloco isc">
                    <div className="m-rotulo">ISC (média do líder)</div>
                    <div className="m-valor">{i.isc_media !== null ? umaCasa(i.isc_media) : "—"}</div>
                    <div className="m-obs">
                      {i.isc_avaliacoes
                        ? `${i.isc_avaliacoes} avaliação(ões) mensal(is)`
                        : "sem registro"}
                    </div>
                  </div>
                  <div className="comparativo-vs">x</div>
                  <div className="metrica-bloco nps">
                    <div className="m-rotulo">NPS (pergunta 4)</div>
                    <div className="m-valor">{i.q4_media !== null ? umaCasa(i.q4_media) : "—"}</div>
                    <div className="m-obs">
                      {i.q4_respostas ? `média de ${i.q4_respostas} resposta(s)` : "sem resposta"}
                    </div>
                  </div>
                </div>
                {i.isc_media !== null && i.q4_media !== null ? (
                  <div className="comparativo-nota">
                    {descreverDivergencia(i.isc_media, i.q4_media)}
                    {" "}
                    <span className="td-sub">
                      (diferença de {umaCasa(Math.abs(i.isc_media - i.q4_media))} ponto(s))
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
