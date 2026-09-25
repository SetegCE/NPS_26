"use client";

// ISC — Indice de Satisfacao do Cliente.
//
// Percepcao INTERNA do lider, de 0 a 10. Visualmente separado do NPS e sem
// qualquer efeito sobre o calculo dele: sao duas perguntas diferentes feitas
// a duas pessoas diferentes.

import { useCallback, useEffect, useState } from "react";
import { CampoArea, CampoTexto, opcoesDe } from "@/componentes/Campo";
import { ModalDetalhes } from "@/componentes/Detalhes";
import { Aviso, EstadoCarregando, EstadoErro, EstadoVazio } from "@/componentes/Estados";
import { Modal } from "@/componentes/Modal";
import { BotaoAcao, Tabela, type Coluna } from "@/componentes/Tabela";
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
  lider_nome: string | null;
}

interface RegistroIsc extends Record<string, unknown> {
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

interface Pendentes {
  competencia: string;
  avaliados: Item[];
  pendentes: Item[];
  total: number;
  percentual_avaliado: number;
}

const competenciaAtual = () => new Date().toISOString().slice(0, 7);

export function TelaIsc({ sessao }: { sessao: Sessao }) {
  const ehPmo = sessao.perfil === "pmo";
  const toast = useToast();
  const lideres = useAuxiliar(auxiliares.lideres);
  const clientes = useAuxiliar(auxiliares.clientes);

  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [lider, setLider] = useState("");
  const [cliente, setCliente] = useState("");

  const [dados, setDados] = useState<Pendentes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState<Item | null>(null);
  const [historicoDe, setHistoricoDe] = useState<ProjetoIsc | null>(null);
  const [vendo, setVendo] = useState<Item | null>(null);
  const [comparativoAberto, setComparativoAberto] = useState(false);

  const carregar = useCallback(() => {
    setErro(null);
    api
      .get<Pendentes>("isc/pendentes", { competencia, lider, cliente })
      .then(setDados)
      .catch((e) => {
        setDados(null);
        setErro(e instanceof ErroApi ? e.message : "Falha ao carregar o ISC.");
      });
  }, [competencia, lider, cliente]);

  useEffect(carregar, [carregar]);

  const vigente = competencia === competenciaAtual();

  const colunas = (avaliados: boolean): Coluna<Item>[] => [
    {
      chave: "projeto",
      rotulo: "Projeto",
      render: (l) => (
        <>
          <span className="td-principal">{l.projeto.nome}</span>
          <span className="td-sub" style={{ display: "block" }}>
            {l.projeto.codigo_clockify}
          </span>
        </>
      ),
    },
    { chave: "cliente", rotulo: "Cliente", render: (l) => l.projeto.cliente_nome || "—" },
    { chave: "lider", rotulo: "Líder", render: (l) => l.projeto.lider_nome || "—" },
    ...(avaliados
      ? [
          {
            chave: "nota",
            rotulo: "Nota ISC",
            classe: "td-num",
            render: (l: Item) => <strong style={{ fontSize: "1rem" }}>{l.isc?.nota}</strong>,
          },
          {
            chave: "observacao",
            rotulo: "Observação",
            render: (l: Item) => l.isc?.observacao || "—",
          },
          {
            chave: "registro",
            rotulo: "Registrado em",
            render: (l: Item) => formatarData(l.isc?.created_at),
          },
        ]
      : [
          {
            chave: "pendente",
            rotulo: "Situação",
            render: () => <span className="selo selo-amarelo">Pendente</span>,
          },
        ]),
    {
      chave: "acoes",
      rotulo: "Ações",
      classe: "td-acoes",
      render: (l) => (
        <>
          <BotaoAcao icone="ver" titulo="Ver avaliação ISC" onClick={() => setVendo(l)} />
          {/* So a competencia vigente e editavel: reescrever a percepcao de
              meses fechados apagaria o historico que a tela existe para
              mostrar. */}
          {vigente ? (
            <BotaoAcao
              icone="editar"
              titulo={avaliados ? "Editar nota ISC" : "Registrar nota ISC"}
              onClick={() => setRegistrando(l)}
            />
          ) : null}
          <BotaoAcao
            icone="historico"
            titulo="Histórico mensal do ISC"
            onClick={() => setHistoricoDe(l.projeto)}
          />
        </>
      ),
    },
  ];

  const notas = (dados?.avaliados || []).map((a) => Number(a.isc?.nota)).filter(Number.isFinite);
  const media = notas.length ? (notas.reduce((s, n) => s + n, 0) / notas.length).toFixed(1) : "—";

  return (
    <>
      <CabecalhoTela
        titulo={
          ehPmo ? "ISC — Índice de Satisfação do Cliente" : "ISC — Percepção mensal dos meus projetos"
        }
        descricao="Nota interna de 0 a 10 atribuída pelo líder. Não altera nem compõe o NPS."
        acoes={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setComparativoAberto(true)}
          >
            Comparar com NPS
          </button>
        }
      />

      <BarraFiltros>
        <Filtro id="f-competencia" rotulo="Competência">
          <input
            id="f-competencia"
            type="month"
            value={competencia}
            max={competenciaAtual()}
            onChange={(e) => setCompetencia(e.target.value || competenciaAtual())}
          />
        </Filtro>
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
      </BarraFiltros>

      {dados ? (
        <div className="kpi-modulo">
          <div className="kpi-card-modulo isc">
            <div className="rotulo">ISC médio</div>
            <div className="valor">{media}</div>
            <div className="detalhe">{formatarCompetencia(dados.competencia)}</div>
          </div>
          <div className="kpi-card-modulo">
            <div className="rotulo">Avaliados</div>
            <div className="valor">
              {dados.avaliados.length}/{dados.total}
            </div>
            <div className="detalhe">{dados.percentual_avaliado}% dos projetos</div>
          </div>
          <div className="kpi-card-modulo">
            <div className="rotulo">Pendentes</div>
            <div className="valor">{dados.pendentes.length}</div>
            <div className="detalhe">aguardando registro</div>
          </div>
        </div>
      ) : null}

      {erro ? (
        <EstadoErro mensagem={erro} />
      ) : !dados ? (
        <EstadoCarregando />
      ) : (
        <>
          {dados.pendentes.length ? (
            <>
              <h2 style={{ fontSize: "1rem", margin: "4px 0 10px" }}>Precisam ser avaliados</h2>
              <div className="tabela-wrap" style={{ marginBottom: 22 }}>
                <Tabela
                  colunas={colunas(false)}
                  linhas={dados.pendentes}
                  chaveDaLinha={(l) => l.projeto.id}
                />
              </div>
            </>
          ) : null}

          {dados.avaliados.length ? (
            <>
              <h2 style={{ fontSize: "1rem", margin: "4px 0 10px" }}>Já avaliados</h2>
              <div className="tabela-wrap">
                <Tabela
                  colunas={colunas(true)}
                  linhas={dados.avaliados}
                  chaveDaLinha={(l) => l.projeto.id}
                />
              </div>
            </>
          ) : null}

          {!dados.pendentes.length && !dados.avaliados.length ? (
            <EstadoVazio
              titulo="Nenhum projeto para avaliar."
              descricao="Você não possui projetos ativos nesta competência."
            />
          ) : null}
        </>
      )}

      {vendo ? (
        <ModalDetalhes
          titulo={vendo.projeto.nome}
          subtitulo={`ISC de ${formatarCompetencia(competencia)}`}
          aoFechar={() => setVendo(null)}
          itens={[
            { rotulo: "Projeto", valor: vendo.projeto.nome },
            { rotulo: "Código", valor: vendo.projeto.codigo_clockify },
            { rotulo: "Cliente", valor: vendo.projeto.cliente_nome },
            { rotulo: "Líder", valor: vendo.projeto.lider_nome },
            { rotulo: "Competência", valor: formatarCompetencia(competencia) },
            {
              rotulo: "Nota ISC",
              valor: vendo.isc ? (
                <strong style={{ fontSize: "1rem" }}>{vendo.isc.nota}</strong>
              ) : (
                <span className="selo selo-amarelo">Pendente</span>
              ),
            },
            { rotulo: "Registrado em", valor: vendo.isc ? formatarData(vendo.isc.created_at, true) : null },
            { rotulo: "Registrado por", valor: vendo.isc?.registrado_por },
            { rotulo: "Observação", valor: vendo.isc?.observacao, largo: true },
          ]}
        />
      ) : null}

      {registrando ? (
        <Registro
          item={registrando}
          competencia={dados?.competencia || competencia}
          aoFechar={() => setRegistrando(null)}
          aoSalvar={(novo) => {
            setRegistrando(null);
            carregar();
            toast(novo ? "ISC registrado." : "ISC atualizado.", "sucesso");
          }}
        />
      ) : null}

      {historicoDe ? (
        <Historico projeto={historicoDe} aoFechar={() => setHistoricoDe(null)} />
      ) : null}

      {comparativoAberto ? (
        <Comparativo
          lider={lider}
          cliente={cliente}
          aoFechar={() => setComparativoAberto(false)}
        />
      ) : null}
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

const umaCasa = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
