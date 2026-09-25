"use client";

// Clientes e lideres: a mesma tela com outro nome de tabela e um campo extra.
// A API tambem trata as duas com um handler so (lib/cadastros.ts).
//
// Em "lideres", e so para o PMO, a tela ganha a gestao de acessos, no mesmo
// desenho da tela de acessos do SGA: a coluna "Acesso ao sistema", a direcao
// listada como ADMIN, e os botoes de criar conta, redefinir senha e
// desativar/reativar a CONTA (usuarios_nps, via lib/acessos.ts).
//
// Fica aqui, e nao numa tela propria, porque a pergunta que leva ate ela —
// "fulano ainda entra?" — se faz olhando a lista de lideres, nao um cadastro
// de contas a parte.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CampoTexto } from "@/componentes/Campo";
import { GradeDetalhes } from "@/componentes/Detalhes";
import { Confirmacao, Modal } from "@/componentes/Modal";
import { BotaoAcao, type Coluna, Tabela } from "@/componentes/Tabela";
import {
  BarraFiltros,
  CabecalhoTela,
  CorpoLista,
  FiltroBusca,
  FiltroSelect,
  OPCOES_SITUACAO,
  Selo,
} from "@/componentes/Tela";
import { Aviso, EstadoCarregando } from "@/componentes/Estados";
import type { Projeto } from "@/componentes/telas/TelaProjetos";
import { useToast } from "@/componentes/Toast";
import { api, ErroApi, type Pagina } from "@/lib/cliente/api";
import { formatarData } from "@/lib/formato";
import { useLista } from "@/lib/cliente/useLista";
import type { Sessao } from "@/lib/cliente/tipos";

export type RecursoCadastro = "clientes" | "lideres";

interface Registro extends Record<string, unknown> {
  id: string;
  nome: string;
  ativo: boolean;
  segmento?: string | null;
  email?: string | null;
  /** Linha da direção: não é cadastro de líder, é conta de acesso (ver
   *  `linhasDaDirecao`). Não tem o que editar nem período de liderança. */
  direcao?: boolean;
  /** Conta já resolvida. Só as linhas da direção trazem — as de líder acham a
   *  delas pelo mapa, indexado por `lideres_nps.id`. */
  conta?: Conta;
}

/** Conta de acesso — o que /api/usuarios devolve (lib/acessos.ts). */
interface Conta {
  id: string;
  nome: string;
  email: string;
  papel: "pmo" | "lider";
  lider_id: string | null;
  ativo: boolean;
  ultimo_acesso_em: string | null;
}

const CONFIG = {
  clientes: {
    titulo: "Clientes",
    descricao: "Empresas atendidas. Um cliente reúne vários projetos ao longo dos ciclos.",
    singular: "cliente",
    campo: "segmento" as const,
    rotuloCampo: "Segmento",
    tipoCampo: "text",
  },
  lideres: {
    titulo: "Líderes",
    descricao: "Responsáveis pelos projetos. O histórico de liderança preserva cada período.",
    singular: "líder",
    campo: "email" as const,
    rotuloCampo: "E-mail",
    tipoCampo: "email",
  },
};

/**
 * Contas de acesso indexadas pelo líder a que pertencem.
 *
 * Uma carga só, e não uma consulta por linha: são poucas dezenas de contas, e
 * a tela precisa de todas de qualquer jeito — inclusive para dizer quem NÃO
 * tem conta, que é justamente a informação que some numa busca por id.
 *
 * `habilitado` desliga a chamada fora da tela de líderes e para quem não é
 * PMO: /api/usuarios é exclusiva do PMO e responderia 403.
 */
function useContasPorLider(habilitado: boolean) {
  const [porLider, setPorLider] = useState<Map<string, Conta>>(new Map());
  const [direcao, setDirecao] = useState<Conta[]>([]);
  const [gatilho, setGatilho] = useState(0);

  useEffect(() => {
    if (!habilitado) return;
    let ativo = true;

    api
      .get<Pagina<Conta>>("usuarios", { porPagina: 200 })
      .then((r) => {
        if (!ativo) return;
        const mapa = new Map<string, Conta>();
        const pmo: Conta[] = [];
        for (const c of r.itens || []) {
          // Uma conta de direção normalmente não tem `lider_id` — o PMO
          // enxerga tudo, e o recorte por líder não se aplica a ela.
          //
          // Quando tem, é porque a pessoa também lidera projeto. Aí ela entra
          // pela linha do cadastro dela, e não como bloco da direção: duas
          // linhas para a mesma pessoa, cada uma com seu botão de desativar a
          // MESMA conta, é confusão pronta.
          if (c.papel === "pmo" && !c.lider_id) pmo.push(c);
          else if (c.lider_id) mapa.set(c.lider_id, c);
        }
        setPorLider(mapa);
        setDirecao(pmo.sort((a, b) => a.nome.localeCompare(b.nome)));
      })
      .catch(() => {
        // Sem as contas a tela ainda serve para o cadastro: a coluna de acesso
        // fica vazia e o resto continua de pé.
        if (!ativo) return;
        setPorLider(new Map());
        setDirecao([]);
      });

    return () => {
      ativo = false;
    };
  }, [habilitado, gatilho]);

  const recarregar = useCallback(() => setGatilho((g) => g + 1), []);
  return { porLider, direcao, recarregar };
}

export function TelaCadastro({
  recurso,
  sessao,
}: {
  recurso: RecursoCadastro;
  sessao: Sessao;
}) {
  const cfg = CONFIG[recurso];
  const ehPmo = sessao.perfil === "pmo";
  const toast = useToast();

  // Gestão de acessos: só na tela de líderes e só para o PMO. Cliente não tem
  // conta para desativar, e líder não gere o acesso de ninguém.
  const gerindoAcessos = recurso === "lideres" && ehPmo;
  const contas = useContasPorLider(gerindoAcessos);

  const [situacao, setSituacao] = useState("true");
  const [emEdicao, setEmEdicao] = useState<Registro | null | undefined>(undefined);
  const [alternandoConta, setAlternandoConta] = useState<{
    linha: Registro;
    conta: Conta;
  } | null>(null);
  const [salvandoConta, setSalvandoConta] = useState(false);
  // `conta: null` = criar; `conta: <Conta>` = redefinir a senha dela.
  const [mexendoNaSenha, setMexendoNaSenha] = useState<{
    linha: Registro;
    conta: Conta | null;
  } | null>(null);
  const [vendoProjetos, setVendoProjetos] = useState<Registro | null>(null);

  const filtros = useMemo(() => ({ ativo: situacao }), [situacao]);
  const lista = useLista<Registro>(recurso, {
    ordemInicial: { campo: "nome", ascending: true },
    filtros,
  });

  /**
   * Linhas da direção, no topo da primeira página.
   *
   * Não saem de `lideres_nps`, e não devem sair: a direção não lidera projeto,
   * e criar cadastro de líder para ela poluiria os selects das outras telas e
   * o recorte por líder. Elas entram aqui porque a pergunta que esta tela
   * passou a responder é "quem acessa o sistema" — e a resposta ficaria
   * incompleta justamente sem quem tem a chave inteira.
   *
   * Repetem os filtros da tela à mão porque não passam pela API: a situação
   * vale para a CONTA delas, que é a única que têm.
   */
  const linhasDaDirecao = useMemo<Registro[]>(() => {
    if (!gerindoAcessos || lista.pagina > 1) return [];
    const termo = lista.busca.trim().toLowerCase();
    return contas.direcao
      .filter((c) => (situacao === "" ? true : (situacao === "true") === c.ativo))
      .filter((c) => !termo || `${c.nome} ${c.email}`.toLowerCase().includes(termo))
      .map((c) => ({
        id: c.id,
        nome: c.nome,
        ativo: c.ativo,
        email: c.email,
        direcao: true,
        conta: c,
      }));
  }, [gerindoAcessos, lista.pagina, lista.busca, situacao, contas.direcao]);

  const listaExibida = useMemo(
    () =>
      linhasDaDirecao.length ? { ...lista, itens: [...linhasDaDirecao, ...lista.itens] } : lista,
    [lista, linhasDaDirecao]
  );

  /** A conta da linha: a direção traz a sua junto; o líder acha a dele no mapa. */
  const contaDaLinha = (l: Registro): Conta | undefined =>
    l.conta ?? (gerindoAcessos ? contas.porLider.get(l.id) : undefined);

  async function confirmarConta() {
    if (!alternandoConta) return;
    const { linha, conta } = alternandoConta;
    const ativar = !conta.ativo;

    setSalvandoConta(true);
    try {
      await api.patch("usuarios", { id: conta.id, ativo: ativar });
      toast(
        ativar ? `Acesso de ${linha.nome} reativado.` : `Acesso de ${linha.nome} desativado.`,
        "sucesso"
      );
      setAlternandoConta(null);
      contas.recarregar();
    } catch (e) {
      toast(e instanceof ErroApi ? e.message : "Não foi possível alterar o acesso.", "erro");
    } finally {
      setSalvandoConta(false);
    }
  }

  const colunas: Coluna<Registro>[] = [
    {
      chave: "nome",
      rotulo: "Nome",
      ordenavel: true,
      render: (l) => <span className="td-principal">{l.nome}</span>,
    },
    {
      chave: cfg.campo,
      rotulo: cfg.rotuloCampo,
      ordenavel: true,
      // Havendo conta, mostra o e-mail DELA: é esse que faz login, e é o único
      // que não pode divergir sem que a pessoa deixe de entrar. O do cadastro
      // é cópia — e cópia envelhece calada.
      render: (l) => contaDaLinha(l)?.email || (l[cfg.campo] as string) || "—",
    },
    {
      chave: "ativo",
      rotulo: "Situação",
      // Quem entra como direção aparece como ADMIN, tenha cadastro de líder ou
      // não: o que distingue essa pessoa das demais é o alcance da conta, e é
      // isso que o selo precisa dizer.
      render: (l) =>
        l.direcao || contaDaLinha(l)?.papel === "pmo" ? (
          <Selo tom="azul">ADMIN</Selo>
        ) : (
          <Selo tom={l.ativo ? "verde" : "neutro"}>{l.ativo ? "Ativo" : "Inativo"}</Selo>
        ),
    },
  ];

  if (gerindoAcessos) {
    // Coluna separada da "Situação" de propósito: uma é o cadastro (aparece
    // nos selects, entra em ciclo novo), a outra é a credencial (consegue
    // entrar). Juntá-las num selo só faria quem desativa achar que fez o outro.
    colunas.push({
      chave: "acesso",
      rotulo: "Acesso ao sistema",
      render: (l) => {
        const conta = contaDaLinha(l);
        if (!conta) return <span className="td-sub">Sem conta de acesso</span>;
        return (
          <>
            <Selo tom={conta.ativo ? "verde" : "vermelho"}>
              {conta.ativo ? "Ativo" : "Desativado"}
            </Selo>
            <div className="td-sub">
              {conta.ultimo_acesso_em
                ? `Último acesso ${formatarData(conta.ultimo_acesso_em, true)}`
                : "Nunca entrou"}
            </div>
          </>
        );
      },
    });
  }

  if (ehPmo) {
    colunas.push({
      chave: "acoes",
      rotulo: "Ações",
      classe: "td-acoes",
      render: (l) => {
        const conta = contaDaLinha(l);
        // Só quem tem cadastro tem o que editar. A linha da direção é conta
        // pura: nome e e-mail dela vivem em usuarios_nps, não nesta tela.
        const ehEu = Boolean(conta && conta.email === sessao.email);
        return (
          <>
            {/* A direção não lidera projeto nem tem cadastro — não há o que abrir. */}
            {l.direcao ? null : (
              <BotaoAcao
                icone="ver"
                titulo={`Ver ${cfg.singular} e seus projetos`}
                onClick={() => setVendoProjetos(l)}
              />
            )}
            {l.direcao ? null : (
              <BotaoAcao icone="editar" titulo="Editar registro" onClick={() => setEmEdicao(l)} />
            )}
            {gerindoAcessos && !conta && !l.direcao ? (
              <BotaoAcao
                icone="conta-nova"
                titulo={`Criar conta de acesso para ${l.nome}`}
                onClick={() => setMexendoNaSenha({ linha: l, conta: null })}
              />
            ) : null}
            {conta ? (
              <BotaoAcao
                icone="chave"
                titulo={
                  ehEu
                    ? "Redefinir a sua senha (a sessão cai)"
                    : `Redefinir a senha de ${l.nome}`
                }
                onClick={() => setMexendoNaSenha({ linha: l, conta })}
              />
            ) : null}
            {conta ? (
              <BotaoAcao
                icone={conta.ativo ? "inativar" : "reativar"}
                titulo={
                  ehEu
                    ? "Você não pode desativar a própria conta"
                    : conta.ativo
                      ? `Desativar o acesso de ${l.nome} ao sistema`
                      : `Reativar o acesso de ${l.nome} ao sistema`
                }
                perigo={conta.ativo}
                // O servidor recusa de qualquer forma (CONTA_PROPRIA em
                // lib/acessos.ts); aqui é só para o botão não convidar.
                desabilitado={ehEu}
                onClick={() => setAlternandoConta({ linha: l, conta })}
              />
            ) : null}
          </>
        );
      },
    });
  }

  return (
    <>
      <CabecalhoTela
        titulo={cfg.titulo}
        descricao={
          gerindoAcessos
            ? "Quem acessa o sistema: a direção, marcada como ADMIN, e os responsáveis pelos projetos. Desativar o acesso bloqueia o login na hora e não apaga nada — cadastro, projetos e histórico de liderança continuam aqui, e o acesso volta a qualquer momento."
            : cfg.descricao
        }
        acoes={
          ehPmo ? (
            <button type="button" className="btn-primary" onClick={() => setEmEdicao(null)}>
              + Adicionar {cfg.singular}
            </button>
          ) : null
        }
      />

      <BarraFiltros>
        <FiltroBusca placeholder="Nome" valor={lista.busca} aoMudar={lista.setBusca} />
        <FiltroSelect
          id="f-situacao"
          rotulo="Situação"
          valor={situacao}
          aoMudar={setSituacao}
          opcoes={OPCOES_SITUACAO}
        />
      </BarraFiltros>

      <div className="tabela-wrap">
        <CorpoLista
          lista={listaExibida}
          colunas={colunas}
          chaveDaLinha={(l) => l.id}
          vazio={`Nenhum ${cfg.singular} encontrado.`}
        />
      </div>

      {emEdicao !== undefined ? (
        <Formulario
          recurso={recurso}
          cfg={cfg}
          registro={emEdicao}
          aoFechar={() => setEmEdicao(undefined)}
          aoSalvar={() => {
            setEmEdicao(undefined);
            lista.recarregar();
            toast(emEdicao ? "Registro atualizado." : "Registro cadastrado.", "sucesso");
          }}
        />
      ) : null}

      {vendoProjetos ? (
        <ProjetosDoRegistro
          recurso={recurso}
          registro={vendoProjetos}
          aoFechar={() => setVendoProjetos(null)}
        />
      ) : null}

      {mexendoNaSenha ? (
        <FormularioConta
          linha={mexendoNaSenha.linha}
          conta={mexendoNaSenha.conta}
          ehMinhaConta={mexendoNaSenha.conta?.email === sessao.email}
          aoFechar={() => setMexendoNaSenha(null)}
          aoSalvar={(mensagem) => {
            setMexendoNaSenha(null);
            contas.recarregar();
            // Criar conta pode preencher o e-mail do cadastro (lib/acessos.ts),
            // então a listagem também precisa ser relida.
            lista.recarregar();
            toast(mensagem, "sucesso");
          }}
        />
      ) : null}

      {alternandoConta ? (
        <Confirmacao
          titulo={alternandoConta.conta.ativo ? "Desativar acesso?" : "Reativar acesso?"}
          mensagem={
            alternandoConta.conta.ativo
              ? `${alternandoConta.linha.nome} deixa de conseguir entrar no sistema.`
              : `${alternandoConta.linha.nome} volta a entrar com a mesma senha de antes.`
          }
          detalhe={
            alternandoConta.conta.ativo
              ? "Se houver uma sessão aberta, ela cai na próxima ação — o sistema reconfere a conta no banco a cada requisição. Nada é apagado: o cadastro do líder, os projetos e as respostas continuam intactos."
              : undefined
          }
          rotuloConfirmar={alternandoConta.conta.ativo ? "Desativar" : "Reativar"}
          perigo={alternandoConta.conta.ativo}
          ocupado={salvandoConta}
          aoConfirmar={confirmarConta}
          aoCancelar={() => setAlternandoConta(null)}
        />
      ) : null}
    </>
  );
}

function Formulario({
  recurso,
  cfg,
  registro,
  aoFechar,
  aoSalvar,
}: {
  recurso: RecursoCadastro;
  cfg: (typeof CONFIG)[RecursoCadastro];
  registro: Registro | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const edicao = Boolean(registro);
  const [nome, setNome] = useState(registro?.nome || "");
  const [extra, setExtra] = useState((registro?.[cfg.campo] as string) || "");
  const [ativo, setAtivo] = useState(registro ? String(registro.ativo) : "true");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const corpo: Record<string, unknown> = { nome, [cfg.campo]: extra };
      if (edicao) {
        await api.patch(recurso, { id: registro!.id, ...corpo, ativo: ativo === "true" });
      } else {
        await api.post(recurso, corpo);
      }
      aoSalvar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={`${edicao ? "Editar" : "Adicionar"} ${cfg.singular}`}
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
        <CampoTexto
          nome={cfg.campo}
          rotulo={cfg.rotuloCampo}
          tipo={cfg.tipoCampo}
          valor={extra}
          aoMudar={setExtra}
          maxLength={200}
          // Sem este aviso o campo vira armadilha: parece o e-mail de login,
          // e mudá-lo aqui não muda por onde a pessoa entra.
          ajuda={
            recurso === "lideres"
              ? "Campo do cadastro. O e-mail de login é o da conta de acesso e só muda pelo seed."
              : undefined
          }
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
    </Modal>
  );
}

// ─── Conta de acesso: criar e redefinir senha ──────────────────────────────

/**
 * O mesmo modal serve para os dois casos, porque a decisão é a mesma: qual
 * senha esta pessoa vai usar. Criar pede o e-mail junto; redefinir não pede,
 * porque o e-mail é a identidade da conta e não muda (ver lib/acessos.ts).
 */
function FormularioConta({
  linha,
  conta,
  ehMinhaConta,
  aoFechar,
  aoSalvar,
}: {
  linha: Registro;
  conta: Conta | null;
  ehMinhaConta: boolean;
  aoFechar: () => void;
  aoSalvar: (mensagem: string) => void;
}) {
  const criando = !conta;
  const [email, setEmail] = useState(conta?.email || (linha.email as string) || "");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      if (conta) {
        await api.patch("usuarios", { id: conta.id, senha });
        aoSalvar(`Senha de ${linha.nome} redefinida.`);
      } else {
        await api.post("usuarios", { liderId: linha.id, nome: linha.nome, email, senha });
        aoSalvar(`Conta de ${linha.nome} criada.`);
      }
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={criando ? "Criar conta de acesso" : "Redefinir senha"}
      subtitulo={conta ? `${linha.nome} · ${conta.email}` : linha.nome}
      aoFechar={aoFechar}
      acoes={[
        { rotulo: "Cancelar", classe: "btn-secondary", onClick: aoFechar },
        {
          rotulo: salvando ? "Salvando..." : criando ? "Criar conta" : "Redefinir",
          classe: "btn-primary",
          onClick: salvar,
          desabilitado: salvando,
        },
      ]}
    >
      {erro ? <Aviso tipo="perigo">{erro}</Aviso> : null}

      {ehMinhaConta ? (
        <Aviso tipo="atencao">
          Esta é a sua conta. Ao salvar, a sua sessão cai na hora e você precisa entrar de novo
          com a senha nova.
        </Aviso>
      ) : null}

      <Aviso tipo="info">
        Anote a senha antes de salvar e entregue à pessoa por fora do sistema. O banco guarda só
        o hash, então ela não é recuperável depois — se perder, o caminho é redefinir outra vez.
      </Aviso>

      <div className="form-grade">
        {criando ? (
          <CampoTexto
            nome="conta-email"
            rotulo="E-mail de acesso"
            tipo="email"
            valor={email}
            aoMudar={setEmail}
            obrigatorio
            larguraTotal
            maxLength={200}
            placeholder="nome@setegce.com"
            ajuda="Vira o login desta pessoa e não muda depois."
          />
        ) : null}
        <CampoTexto
          nome="conta-senha"
          rotulo={criando ? "Senha inicial" : "Nova senha"}
          tipo="password"
          valor={senha}
          aoMudar={setSenha}
          obrigatorio
          larguraTotal
          maxLength={200}
          ajuda="Mínimo de 7 caracteres. Uma frase curta protege bem mais que sete símbolos — e é mais fácil de lembrar."
        />
      </div>
    </Modal>
  );
}

// ─── Projetos do líder ─────────────────────────────────────────────────────

/**
 * Os projetos sob responsabilidade ATUAL do líder.
 *
 * Vem de /api/projetos filtrado por `lider`, que lê `vw_projetos_admin` — a
 * mesma fonte da tela de Projetos, e não uma consulta paralela que pudesse
 * divergir dela. Fica em modal porque a pergunta é pontual ("o que é dele
 * hoje?"), e a resposta não precisa competir por espaço com a lista.
 *
 * Só os ativos: "está liderando" é presente. Projeto inativo continua no
 * cadastro e na tela de Projetos, onde há filtro para ele.
 */
function ProjetosDoRegistro({
  recurso,
  registro,
  aoFechar,
}: {
  recurso: RecursoCadastro;
  registro: Registro;
  aoFechar: () => void;
}) {
  const lider = registro;
  const cfg = CONFIG[recurso];
  const [itens, setItens] = useState<Projeto[] | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .get<Pagina<Projeto>>("projetos", {
        [recurso === "lideres" ? "lider" : "cliente"]: registro.id,
        ativo: true,
        porPagina: 200,
        ordenarPor: "cliente_nome",
      })
      .then((r) => {
        if (vivo) setItens(r.itens || []);
      })
      .catch((e) => {
        if (!vivo) return;
        setFalha(e instanceof ErroApi ? e.message : "Não foi possível carregar os projetos.");
        setItens([]);
      });
    return () => {
      vivo = false;
    };
  }, [recurso, registro.id]);

  const colunas: Coluna<Projeto>[] = [
    { chave: "cliente_nome", rotulo: "Cliente", render: (p) => p.cliente_nome || "—" },
    {
      chave: "nome",
      rotulo: "Projeto",
      render: (p) => (
        <>
          <div className="td-principal">{p.nome}</div>
          <div className="td-sub">{p.codigo_clockify}</div>
        </>
      ),
    },
    { chave: "ciclo_atual", rotulo: "Ciclo", render: (p) => p.ciclo_atual || "—" },
    {
      chave: "elegivel",
      rotulo: "Elegível",
      render: (p) => (
        <Selo tom={p.elegivel ? "verde" : "neutro"}>{p.elegivel ? "Sim" : "Não"}</Selo>
      ),
    },
    {
      chave: "respostas",
      rotulo: "Respostas",
      render: (p) => `${p.pesquisas_respondidas ?? 0} de ${p.total_pesquisas ?? 0}`,
    },
  ];

  return (
    <Modal
      titulo={lider.nome}
      subtitulo={recurso === "lideres" ? "Dados do líder" : "Dados do cliente"}
      largo
      aoFechar={aoFechar}
      acoes={[{ rotulo: "Fechar", classe: "btn-secondary", onClick: aoFechar }]}
    >
      <GradeDetalhes
        itens={[
          { rotulo: "Nome", valor: registro.nome },
          { rotulo: cfg.rotuloCampo, valor: registro[cfg.campo] as string | null },
          {
            rotulo: "Situação",
            valor: (
              <Selo tom={registro.ativo ? "verde" : "neutro"}>
                {registro.ativo ? "Ativo" : "Inativo"}
              </Selo>
            ),
          },
        ]}
      />
      <div style={{ fontWeight: 700, fontSize: ".9rem", margin: "18px 0 8px" }}>
        Projetos ativos
        {itens?.length ? ` (${itens.length})` : ""}
      </div>
      {falha ? <Aviso tipo="perigo">{falha}</Aviso> : null}

      {itens === null ? (
        <EstadoCarregando />
      ) : itens.length ? (
        <div className="tabela-scroll">
          <Tabela colunas={colunas} linhas={itens} chaveDaLinha={(p) => p.id} />
        </div>
      ) : falha ? null : (
        <Aviso tipo="info">
          {recurso === "lideres"
            ? `Nenhum projeto ativo sob a responsabilidade de ${lider.nome} hoje. Se liderou algo antes, o histórico continua no projeto — a troca de líder preserva cada período.`
            : `Nenhum projeto ativo para ${lider.nome} hoje. Projetos encerrados continuam na tela de Projetos, com o filtro de situação.`}
        </Aviso>
      )}
    </Modal>
  );
}
