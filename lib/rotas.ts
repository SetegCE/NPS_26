// Classificacao das rotas: o que e publico e o que so o PMO abre.
//
// Vive fora do middleware, e sem depender de nada do Next, por um motivo
// concreto: foi aqui que um erro passou despercebido. A primeira versao
// listava `/api/projetos`, `/api/ciclos`, `/api/operacao`, `/api/historico`,
// `/api/clientes` e `/api/lideres` como exclusivas do PMO. Parecia
// conservador e quebrava o sistema inteiro para o lider — "Meus Projetos",
// o filtro de ciclo, o indicador de ISC do dashboard e a tela Resultados
// chamam exatamente essas rotas.
//
// Separado assim, o acerto vira teste (tests/rotas.test.mjs) em vez de
// depender de alguem entrar como lider e reparar.

/**
 * Comparacao EXATA, e nao prefixo: nenhuma destas tem sub-rota, e `startsWith`
 * deixaria passar "/login-qualquer-coisa" ou "/api/auth/loginX" como publicas.
 *
 * `/api/auth/sessao` esta aqui para que a propria rota responda
 * `{ autenticado: false }` em vez de o middleware devolver 401 seco: quem
 * pergunta "tem alguem logado?" precisa de resposta, nao de erro.
 */
export const ROTAS_PUBLICAS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/sessao",
  // Chamada pela Vercel, sem cookie. A rota confere o CRON_SECRET sozinha.
  "/api/cron/sincronizar-projetos",
] as const;

/**
 * O formulario da pesquisa e publico por definicao: quem responde e o
 * cliente, que nao tem conta. O token do link e a credencial, e quem o valida
 * e a rota, nao o middleware.
 */
export const PREFIXOS_PUBLICOS = ["/pesquisa/", "/api/responder"] as const;

/**
 * Telas que so o PMO abre. Espelha MENU_PMO da barra lateral.
 *
 * So TELAS — com uma excecao de API, e essa distincao e o ponto:
 *
 * Quase nenhuma rota de API e "so do PMO". A regra real delas e outra: LER e
 * permitido aos dois perfis, com o resultado recortado ao lider; ESCREVER e
 * que exige PMO. Quem sabe aplicar isso e a propria rota, que tem a consulta
 * na mao (`exigirSessao` + filtro por lider_id para ler, `exigirPmo` para
 * escrever). O middleware nao distingue GET de POST nem enxerga o recorte,
 * entao nao tem como decidir isso — e nao deve tentar.
 */
export const PREFIXOS_SO_PMO = [
  "/operacao-ciclo",
  "/projetos",
  "/respondentes",
  "/ciclos",
  "/clientes",
  "/lideres",
  "/historico",
  // As duas unicas rotas de API genuinamente exclusivas — nenhuma tem recorte
  // por lider a aplicar, entao nao ha o que a rota decida que o middleware nao
  // possa barrar antes:
  //
  //  - a trilha de auditoria: ver quem alterou o que e prerrogativa do PMO;
  //  - as contas de acesso: a lista traz e-mail, papel e ultimo acesso de todo
  //    mundo, e ligar/desligar acesso e a chave da porta.
  "/api/auditoria",
  "/api/usuarios",
] as const;

export const ehPublica = (pathname: string): boolean =>
  (ROTAS_PUBLICAS as readonly string[]).includes(pathname) ||
  PREFIXOS_PUBLICOS.some((p) => pathname.startsWith(p));

export const ehSoPmo = (pathname: string): boolean =>
  PREFIXOS_SO_PMO.some((p) => pathname.startsWith(p));
