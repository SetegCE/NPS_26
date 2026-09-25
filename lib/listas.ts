// Listas de valores validos compartilhadas por mais de uma rota.
//
// Vivem aqui, e nao dentro de uma das rotas, para que nenhuma route handler
// importe outra: um route handler importando outro faz o Next.js carregar o
// modulo inteiro — incluindo o proprio `POST` — so para pegar uma constante.
// Mesma razao pela qual o SGA criou lib/politicaConta.ts.
//
// Sao as mesmas listas que o banco valida por CHECK constraint. A duplicacao e
// proposital: rejeitar no validador devolve mensagem legivel em portugues;
// deixar chegar no banco devolveria "violates check constraint".

export const STATUS_PROJETO = [
  "ativo",
  "em_encerramento",
  "encerrado",
  "cancelado",
  "standby",
] as const;

export const TIPOS_PESQUISA = ["ciclo_semestral", "finalizacao"] as const;

export const STATUS_PESQUISA = [
  "gerada",
  "enviada",
  "respondida",
  "pendente",
  "encerrada",
] as const;

export const STATUS_CICLO = ["planejamento", "aberto", "encerrado"] as const;

export const DECISOES_PASSAGEM = [
  "levar",
  "nao_levar",
  "encerrado",
  "pesquisa_finalizacao",
  "nao_elegivel",
] as const;

export const MOTIVOS_PASSAGEM = [
  "projeto_encerrado",
  "menos_de_tres_meses",
  "em_encerramento",
  "cancelado",
  "standby",
  "outro",
] as const;

export const SITUACOES_OPERACAO = [
  "nao_elegivel",
  "respondido",
  "sem_pesquisa",
  "aguardando_resposta",
  "pesquisa_gerada",
] as const;
