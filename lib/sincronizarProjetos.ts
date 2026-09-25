// Sincronizacao Clockrview -> espelho de projetos do NPS.
//
// O Clockrview e a fonte de verdade de: codigo, nome, cliente, lider e
// situacao (ativo/inativo). O NPS continua dono do que o Clockrview nao tem:
// status do ciclo de vida (ativo/standby/em encerramento/...), categoria,
// classe contratual, servico, segmento, escopo, vendedor e acesso.
//
// Dividido em duas metades de proposito:
//  - planejar(): funcao pura. Recebe a API e o estado do banco e devolve o
//    que mudaria. E o que os testes exercitam e o que o modo "simular" mostra;
//  - executar(): grava o plano.
//
// Regras herdadas do importador da planilha, que continuam valendo:
//  - nada e apagado. Projeto que sumiu do Clockrview fica no banco, porque
//    tem respostas e historico pendurados;
//  - projeto novo NAO entra em ciclo. Participacao em ciclo e decisao do PMO
//    na tela de Ciclos — incluir aqui mudaria o denominador do NPS;
//  - lider NUNCA muda por UPDATE: vai por nps_alterar_lider, que fecha o
//    periodo anterior e abre o novo. Resposta antiga nao muda de dono;
//  - o lider tambem e editavel no NPS (a lideranca muda antes de o Clockrview
//    ser atualizado). Para a sincronizacao nao desfazer essa troca, cada
//    projeto guarda o ultimo lider VISTO no Clockrview (lider_clockrview) e o
//    lider so e trocado quando esse valor muda. Vale a mudanca mais recente,
//    de qualquer um dos lados;
//  - ativo/inativo vai por nps_definir_ativo_projeto, que audita.

import { buscarProjetosClockrview, chaveCodigo, type ProjetoClockrview } from "@/lib/clockrview";
import { atualizar, auditar, inserir, normalizar, rpc, selecionar } from "@/lib/db";

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ProjetoLocal {
  id: string;
  codigo_clockify: string;
  nome: string;
  cliente_id: string | null;
  lider_id: string | null;
  lider_clockrview: string | null;
  ativo: boolean;
}
export interface LiderLocal {
  id: string;
  nome: string;
  email: string | null;
  ativo: boolean;
}
export interface ClienteLocal {
  id: string;
  nome: string;
}
export interface UsuarioLocal {
  email: string | null;
  lider_id: string | null;
}

export interface EstadoLocal {
  projetos: ProjetoLocal[];
  lideres: LiderLocal[];
  clientes: ClienteLocal[];
  usuarios: UsuarioLocal[];
}

/** Referencia a um lider/cliente que ja existe (`id`) ou que o plano cria (`novo`). */
type Ref = { id: string } | { novo: string };

export interface Plano {
  clientesNovos: string[];
  lideresNovos: { nome: string; email: string | null }[];
  lideresEmail: { id: string; nome: string; email: string }[];
  projetosNovos: {
    codigo: string;
    nome: string;
    cliente: Ref | null;
    lider: Ref | null;
    liderVisto: string | null;
    rotulo: string;
  }[];
  projetosAlterados: {
    id: string;
    codigo: string;
    campos: { nome?: string; codigo_clockify?: string };
    cliente: Ref | null;
    antes: Record<string, unknown>;
    descricao: string[];
  }[];
  situacao: { id: string; codigo: string; ativo: boolean }[];
  trocasLider: { id: string; codigo: string; de: string; para: string; lider: Ref }[];
  /** Grava o lider visto no Clockrview, sem trocar ninguem (ja e o atual). */
  lideresVistos: { id: string; valor: string }[];
  /** Lider escolhido no NPS que difere do Clockrview e foi mantido. */
  lideresMantidos: string[];
  avisos: string[];
  foraDoClockrview: { codigo: string; nome: string }[];
  inativosIgnorados: number;
  totalClockrview: number;
}

// ── Planejamento (puro) ────────────────────────────────────────────────────

/** Identidade do lider como o Clockrview o informa: e-mail, ou o nome. */
export function chaveLider(nome: string | null, email: string | null): string | null {
  return email?.trim().toLowerCase() || (nome ? normalizar(nome) : "") || null;
}

export function planejar(api: ProjetoClockrview[], estado: EstadoLocal): Plano {
  const plano: Plano = {
    clientesNovos: [],
    lideresNovos: [],
    lideresEmail: [],
    projetosNovos: [],
    projetosAlterados: [],
    situacao: [],
    trocasLider: [],
    lideresVistos: [],
    lideresMantidos: [],
    avisos: [],
    foraDoClockrview: [],
    inativosIgnorados: 0,
    totalClockrview: api.length,
  };

  // Codigo repetido no Clockrview: fica o primeiro, e o PMO fica sabendo.
  const porChave = new Map<string, ProjetoClockrview>();
  for (const p of api) {
    const k = chaveCodigo(p.codigo);
    if (porChave.has(k)) {
      plano.avisos.push(`Código ${p.codigo} aparece mais de uma vez no Clockrview; usado o primeiro.`);
      continue;
    }
    porChave.set(k, p);
  }

  // ── Clientes ─────────────────────────────────────────────────────────────
  const clientePorNome = new Map(estado.clientes.map((c) => [normalizar(c.nome), c]));
  const clientesNovos = new Map<string, string>();
  function refCliente(nome: string | null): Ref | null {
    if (!nome) return null;
    const k = normalizar(nome);
    const atual = clientePorNome.get(k);
    if (atual) return { id: atual.id };
    if (!clientesNovos.has(k)) clientesNovos.set(k, nome);
    return { novo: k };
  }

  // ── Lideres ──────────────────────────────────────────────────────────────
  //
  // Casamento: e-mail no cadastro de lider > e-mail da conta de acesso >
  // nome igual. So entao cria. O e-mail vem primeiro porque o Clockrview e o
  // NPS escrevem nomes de jeitos diferentes; o e-mail corporativo nao.
  const liderPorId = new Map(estado.lideres.map((l) => [l.id, l]));
  const liderPorEmail = new Map(
    estado.lideres.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l])
  );
  const liderPorUsuario = new Map(
    estado.usuarios
      .filter((u) => u.email && u.lider_id && liderPorId.has(u.lider_id))
      .map((u) => [u.email!.toLowerCase(), liderPorId.get(u.lider_id!)!])
  );
  const liderPorNome = new Map(estado.lideres.map((l) => [normalizar(l.nome), l]));
  const lideresNovos = new Map<string, { nome: string; email: string | null }>();
  const emailPendente = new Set<string>();
  const inativoAvisado = new Set<string>();

  function acharLider(nome: string | null, email: string | null): LiderLocal | undefined {
    const e = email?.toLowerCase() ?? null;
    return (
      (e && (liderPorEmail.get(e) || liderPorUsuario.get(e))) ||
      (nome ? liderPorNome.get(normalizar(nome)) : undefined)
    );
  }

  /** Achado pelo nome e sem e-mail: grava o e-mail do Clockrview, para o
   *  proximo casamento ja ser pelo e-mail. */
  function anotarEmail(achado: LiderLocal, email: string | null) {
    const e = email?.toLowerCase() ?? null;
    if (e && !achado.email && !emailPendente.has(achado.id)) {
      emailPendente.add(achado.id);
      plano.lideresEmail.push({ id: achado.id, nome: achado.nome, email: e });
    }
  }

  function refLider(nome: string | null, email: string | null): { ref: Ref | null; nome: string } {
    if (!nome && !email) return { ref: null, nome: "" };
    const e = email?.toLowerCase() ?? null;
    const achado = acharLider(nome, email);

    if (achado) {
      if (!achado.ativo) {
        if (!inativoAvisado.has(achado.id)) {
          inativoAvisado.add(achado.id);
          plano.avisos.push(
            `Líder ${achado.nome} está inativo no NPS; reative o cadastro na tela de Líderes para que os projetos dele passem a ele.`
          );
        }
        return { ref: null, nome: achado.nome };
      }
      anotarEmail(achado, e);
      return { ref: { id: achado.id }, nome: achado.nome };
    }

    const k = e || normalizar(nome);
    if (!lideresNovos.has(k)) lideresNovos.set(k, { nome: nome || e!, email: e });
    return { ref: { novo: k }, nome: nome || e! };
  }

  const mesmaRef = (ref: Ref | null, id: string | null) =>
    Boolean(ref && "id" in ref && ref.id === id);

  // ── Projetos ─────────────────────────────────────────────────────────────
  const localPorChave = new Map(estado.projetos.map((p) => [chaveCodigo(p.codigo_clockify), p]));

  for (const [k, r] of porChave) {
    const ativoNaApi = r.status === "ativo";
    const atual = localPorChave.get(k);

    if (!atual) {
      // Inativo que nunca passou pelo NPS nao tem historico nenhum a
      // preservar — trazer os ~300 projetos encerrados so poluiria as listas.
      if (!ativoNaApi) {
        plano.inativosIgnorados++;
        continue;
      }
      const lider = refLider(r.liderNome, r.liderEmail);
      plano.projetosNovos.push({
        codigo: r.codigo,
        nome: r.nome,
        cliente: refCliente(r.clienteNome),
        lider: lider.ref,
        liderVisto: lider.ref ? chaveLider(r.liderNome, r.liderEmail) : null,
        rotulo: `${r.codigo} — ${r.clienteNome || "sem cliente"} / ${r.nome} (${lider.nome || "sem líder"})`,
      });
      continue;
    }

    const campos: { nome?: string; codigo_clockify?: string } = {};
    const antes: Record<string, unknown> = {};
    const descricao: string[] = [];
    if (r.nome !== atual.nome) {
      campos.nome = r.nome;
      antes.nome = atual.nome;
      descricao.push(`nome: "${atual.nome}" → "${r.nome}"`);
    }
    if (r.codigo !== atual.codigo_clockify) {
      campos.codigo_clockify = r.codigo;
      antes.codigo_clockify = atual.codigo_clockify;
      descricao.push(`código: ${atual.codigo_clockify} → ${r.codigo}`);
    }
    // Cliente ausente no Clockrview nao apaga o cliente que o NPS ja tem.
    const cliente = refCliente(r.clienteNome);
    const mudaCliente = cliente !== null && !mesmaRef(cliente, atual.cliente_id);
    if (mudaCliente) {
      antes.cliente_id = atual.cliente_id;
      descricao.push(`cliente → ${r.clienteNome}`);
    }
    if (descricao.length) {
      plano.projetosAlterados.push({
        id: atual.id,
        codigo: r.codigo,
        campos,
        cliente: mudaCliente ? cliente : null,
        antes,
        descricao,
      });
    }

    if (ativoNaApi !== atual.ativo) {
      plano.situacao.push({ id: atual.id, codigo: r.codigo, ativo: ativoNaApi });
    }

    // Lider: sem lider no Clockrview, o NPS mantem o que tem. Com lider, so
    // troca se o Clockrview mudou desde a ultima vez — senao, quem esta no
    // projeto foi escolhido no NPS depois, e essa escolha e mantida.
    const visto = chaveLider(r.liderNome, r.liderEmail);
    const nomeAtual = (atual.lider_id && liderPorId.get(atual.lider_id)?.nome) || "sem líder";
    if (visto && visto !== atual.lider_clockrview) {
      const lider = refLider(r.liderNome, r.liderEmail);
      // Lider inativo (ref nula): nao marca como visto, para tentar de novo
      // depois que reativarem o cadastro.
      if (lider.ref) {
        if (!mesmaRef(lider.ref, atual.lider_id)) {
          plano.trocasLider.push({
            id: atual.id,
            codigo: r.codigo,
            de: nomeAtual,
            para: lider.nome,
            lider: lider.ref,
          });
        }
        plano.lideresVistos.push({ id: atual.id, valor: visto });
      }
    } else if (visto) {
      const doClockrview = acharLider(r.liderNome, r.liderEmail);
      if (doClockrview?.ativo) anotarEmail(doClockrview, r.liderEmail);
      if (!doClockrview || doClockrview.id !== atual.lider_id) {
        plano.lideresMantidos.push(
          `${r.codigo} — ${nomeAtual} (no Clockrview: ${doClockrview?.nome || r.liderNome || r.liderEmail})`
        );
      }
    }
  }

  for (const p of estado.projetos) {
    if (!porChave.has(chaveCodigo(p.codigo_clockify))) {
      plano.foraDoClockrview.push({ codigo: p.codigo_clockify, nome: p.nome });
    }
  }

  plano.clientesNovos = [...clientesNovos.values()];
  plano.lideresNovos = [...lideresNovos.values()];
  return plano;
}

// ── Execucao ───────────────────────────────────────────────────────────────

export interface Resumo {
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

async function carregarEstado(): Promise<EstadoLocal> {
  const [projetos, lideres, clientes, usuarios] = await Promise.all([
    selecionar<ProjetoLocal[]>("projetos_mestre_nps", {
      colunas: "id,codigo_clockify,nome,cliente_id,lider_id,lider_clockrview,ativo",
    }),
    selecionar<LiderLocal[]>("lideres_nps", { colunas: "id,nome,email,ativo" }),
    selecionar<ClienteLocal[]>("clientes_nps", { colunas: "id,nome" }),
    selecionar<UsuarioLocal[]>("usuarios_nps", { colunas: "email,lider_id" }),
  ]);
  return {
    projetos: projetos.dados || [],
    lideres: lideres.dados || [],
    clientes: clientes.dados || [],
    usuarios: usuarios.dados || [],
  };
}

/** Roda `tarefas` com no maximo `limite` em paralelo — o suficiente para
 *  caber no tempo de uma funcao da Vercel sem martelar o PostgREST. */
async function emLotes<T>(itens: T[], limite: number, tarefa: (item: T) => Promise<void>) {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) await tarefa(itens[i++]);
  });
  await Promise.all(trabalhadores);
}

export async function sincronizarProjetos({
  aplicar,
  ator,
  atorTipo,
}: {
  aplicar: boolean;
  ator: string;
  atorTipo: "pmo" | "sistema";
}): Promise<Resumo> {
  const [api, estado] = await Promise.all([buscarProjetosClockrview(), carregarEstado()]);
  const plano = planejar(api, estado);

  const resumo: Resumo = {
    simulacao: !aplicar,
    totalClockrview: plano.totalClockrview,
    clientesCriados: plano.clientesNovos,
    lideresCriados: plano.lideresNovos.map((l) => (l.email ? `${l.nome} <${l.email}>` : l.nome)),
    projetosCriados: plano.projetosNovos.map((p) => p.rotulo),
    projetosAtualizados: plano.projetosAlterados.map((p) => `${p.codigo} — ${p.descricao.join(" · ")}`),
    ativados: plano.situacao.filter((s) => s.ativo).map((s) => s.codigo),
    inativados: plano.situacao.filter((s) => !s.ativo).map((s) => s.codigo),
    trocasLider: plano.trocasLider.map((t) => `${t.codigo} — ${t.de} → ${t.para}`),
    lideresMantidos: plano.lideresMantidos,
    avisos: plano.avisos,
    foraDoClockrview: plano.foraDoClockrview,
    inativosIgnorados: plano.inativosIgnorados,
    falhas: [],
  };
  if (!aplicar) return resumo;

  const falhou = (o_que: string, e: unknown) => {
    console.error(`[NPS][sincronizacao] ${o_que}:`, e);
    resumo.falhas.push(`${o_que}: ${e instanceof Error ? e.message : String(e)}`);
  };

  // 1. Clientes e lideres novos, para que os projetos possam apontar para eles.
  const idNovo = { cliente: new Map<string, string>(), lider: new Map<string, string>() };

  for (const nome of plano.clientesNovos) {
    try {
      const [c] = await inserir<ClienteLocal[]>("clientes_nps", { nome });
      idNovo.cliente.set(normalizar(nome), c.id);
    } catch (e) {
      falhou(`criar cliente ${nome}`, e);
    }
  }
  for (const l of plano.lideresNovos) {
    try {
      const [criado] = await inserir<LiderLocal[]>("lideres_nps", { nome: l.nome, email: l.email });
      idNovo.lider.set(l.email || normalizar(l.nome), criado.id);
    } catch (e) {
      falhou(`criar líder ${l.nome}`, e);
    }
  }
  await emLotes(plano.lideresEmail, 6, async (l) => {
    try {
      await atualizar("lideres_nps", { id: l.id }, { email: l.email });
    } catch (e) {
      falhou(`gravar e-mail de ${l.nome}`, e);
    }
  });

  const resolver = (ref: Ref | null, tipo: "cliente" | "lider") =>
    !ref ? null : "id" in ref ? ref.id : idNovo[tipo].get(ref.novo) ?? null;

  // 2. Projetos novos — sem ciclo.
  await emLotes(plano.projetosNovos, 6, async (p) => {
    try {
      const criado = await rpc<{ id?: string }>("nps_criar_projeto", {
        p_dados: {
          codigo_clockify: p.codigo,
          nome: p.nome,
          cliente_id: resolver(p.cliente, "cliente"),
          lider_id: resolver(p.lider, "lider"),
          status: "ativo",
          ciclo_id: null,
          elegivel: true,
        },
        p_ator: ator,
      });
      if (criado?.id && p.liderVisto) {
        await atualizar("projetos_mestre_nps", { id: criado.id }, { lider_clockrview: p.liderVisto });
      }
    } catch (e) {
      falhou(`criar projeto ${p.codigo}`, e);
    }
  });

  // 3. Nome, codigo e cliente dos que ja existem.
  await emLotes(plano.projetosAlterados, 6, async (p) => {
    const campos: Record<string, unknown> = { ...p.campos };
    const clienteId = resolver(p.cliente, "cliente");
    if (clienteId) campos.cliente_id = clienteId;
    if (!Object.keys(campos).length) return;
    try {
      await atualizar("projetos_mestre_nps", { id: p.id }, campos);
      await auditar({
        acao: "sincronizar",
        entidade: "projeto",
        registroId: p.id,
        descricao: `Projeto ${p.codigo} atualizado pelo Clockrview`,
        atorTipo,
        atorNome: ator,
        antes: p.antes,
        depois: campos,
      });
    } catch (e) {
      falhou(`atualizar projeto ${p.codigo}`, e);
    }
  });

  // 4. Situacao e lider, cada um pela funcao do banco que registra historico.
  await emLotes(plano.situacao, 6, async (s) => {
    try {
      await rpc("nps_definir_ativo_projeto", {
        p_projeto_id: s.id,
        p_ativo: s.ativo,
        p_ator: ator,
      });
    } catch (e) {
      falhou(`${s.ativo ? "reativar" : "inativar"} projeto ${s.codigo}`, e);
    }
  });
  // Troca que falhou nao marca o lider como visto: na proxima vez, tenta de novo.
  const trocaFalhou = new Set<string>();
  await emLotes(plano.trocasLider, 6, async (t) => {
    const liderId = resolver(t.lider, "lider");
    if (!liderId) {
      trocaFalhou.add(t.id);
      return;
    }
    try {
      await rpc("nps_alterar_lider", {
        p_projeto_id: t.id,
        p_lider_id: liderId,
        p_ator: ator,
        p_observacao: "Líder atualizado pelo Clockrview.",
      });
    } catch (e) {
      trocaFalhou.add(t.id);
      falhou(`trocar líder de ${t.codigo}`, e);
    }
  });
  await emLotes(
    plano.lideresVistos.filter((v) => !trocaFalhou.has(v.id)),
    6,
    async (v) => {
      try {
        await atualizar("projetos_mestre_nps", { id: v.id }, { lider_clockrview: v.valor });
      } catch (e) {
        falhou("registrar líder do Clockrview", e);
      }
    }
  );

  await auditar({
    acao: "sincronizar",
    entidade: "projeto",
    registroId: null,
    descricao:
      `Sincronização com o Clockrview: ${resumo.projetosCriados.length} criado(s), ` +
      `${resumo.projetosAtualizados.length} atualizado(s), ${resumo.inativados.length} inativado(s), ` +
      `${resumo.ativados.length} reativado(s), ${resumo.trocasLider.length} troca(s) de líder` +
      (resumo.falhas.length ? `, ${resumo.falhas.length} falha(s)` : ""),
    atorTipo,
    atorNome: ator,
  });

  return resumo;
}
