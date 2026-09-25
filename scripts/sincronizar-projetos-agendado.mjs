// Sincronizacao diaria com o Clockrview no servidor proprio.
//
// Na Vercel quem disparava era o cron do vercel.json. No servidor da casa o
// padrao e o Agendador de Tarefas do Windows rodando um script node (como no
// Clockrview). Este script NAO repete a regra de sincronizacao: ele chama a
// rota que ja existe no app, /api/cron/sincronizar-projetos, com o mesmo
// `Authorization: Bearer <CRON_SECRET>` que a Vercel mandava. O app precisa
// estar no ar (npm start).
//
// TAREFA_AGENDADA — configuracao de referencia:
//   Nome: nps-sincronizar-projetos
//   Gatilho: diariamente, 06:00
//   Acao: node.exe "<pasta do NPS>\scripts\sincronizar-projetos-agendado.mjs"
//   Diretorio de trabalho: <pasta do NPS>
//
// Le do .env: CRON_SECRET (obrigatoria), PORT (padrao 3000) e, opcional,
// NPS_LOG_SINCRONIZACAO com o caminho de um arquivo de log.

import fs from "node:fs";
import { carregarEnv } from "./comum.mjs";

carregarEnv();

const segredo = process.env.CRON_SECRET;
const porta = process.env.PORT || "3000";
const arquivoLog = process.env.NPS_LOG_SINCRONIZACAO;

function registrar(linha) {
  const texto = `[${new Date().toISOString()}] ${linha}`;
  console.log(texto);
  if (arquivoLog) {
    try {
      fs.appendFileSync(arquivoLog, texto + "\n");
    } catch (e) {
      console.error(`nao foi possivel gravar o log em ${arquivoLog}:`, e.message);
    }
  }
}

if (!segredo) {
  registrar("ERRO: CRON_SECRET nao configurado no .env — sincronizacao nao executada.");
  process.exit(1);
}

try {
  const resposta = await fetch(`http://localhost:${porta}/api/cron/sincronizar-projetos`, {
    headers: { Authorization: `Bearer ${segredo}` },
    signal: AbortSignal.timeout(120_000),
  });
  const corpo = await resposta.text();
  registrar(`HTTP ${resposta.status} ${corpo.slice(0, 1000)}`);
  process.exit(resposta.ok ? 0 : 1);
} catch (e) {
  registrar(`ERRO: nao foi possivel chamar o app em localhost:${porta} — ${e.message}`);
  process.exit(1);
}
