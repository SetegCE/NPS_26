// Cabecalhos de seguranca e CSP calibrados para o que o Dashboard NPS
// realmente usa. O mesmo endurecimento ja aplicado no SGA, com uma diferenca
// a favor daqui: este sistema nao busca NADA de fora.
//
// - fontes: a Satoshi e servida pelo proprio site (public/fonts), como ja era;
// - icones: todos sao <svg> inline no JSX, nao ha CDN de icone;
// - estilos: dashboard.css/app.css viraram app/globals.css, servido pelo site.
//   'unsafe-inline' em style-src continua necessario porque ha `style={{...}}`
//   e alguns `style="..."` remanescentes nas telas portadas;
// - o Next injeta script inline em desenvolvimento (HMR) e em producao
//   (bootstrap, __NEXT_DATA__), entao script-src precisa de 'unsafe-inline'
//   enquanto nao houver nonce configurado.
//
// 'unsafe-eval' so em desenvolvimento: quem precisa dele e o webpack (HMR e
// source maps que usam eval). O bundle de producao nao.
const emProducao = process.env.NODE_ENV === "production";

const scriptSrc = ["'self'", "'unsafe-inline'"];
if (!emProducao) scriptSrc.push("'unsafe-eval'");

// `frame-ancestors 'none'` impede que qualquer iframe exiba o app. Em
// desenvolvimento fica 'self': o painel de preview do editor embute a pagina
// num iframe e, bloqueado, le isso como "nao carregou" e entra em laco de
// reload. Mesma decisao do SGA.
const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  // data: e blob: sao necessarios para o export de PDF/CSV, que monta o
  // arquivo no proprio navegador e o entrega por URL de objeto.
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  emProducao ? "frame-ancestors 'none'" : "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // O driver `pg` (lib/dbPostgres.ts) roda no Node e tem dependencia nativa
  // opcional (pg-native): fica fora do bundle do webpack e e carregado do
  // node_modules em tempo de execucao.
  experimental: {
    serverComponentsExternalPackages: ["pg"],
  },

  // Pasta de build configuravel, e o padrao continua `.next`.
  //
  // Existe por um acidente que ja aconteceu duas vezes aqui: rodar
  // `next build` com o `next dev` ligado. Os dois escrevem na MESMA pasta, o
  // build substitui os chunks que o servidor de desenvolvimento esta
  // servindo, e a pagina passa a responder 200 apontando para arquivos que
  // nao existem mais — HTML carrega, todo CSS e JS da 404, tela branca. O
  // sintoma nao acusa a causa, e se perde tempo procurando no lugar errado.
  //
  // Para conferir o build sem derrubar o dev:
  //     NEXT_DIST_DIR=.next-build npx next build
  distDir: process.env.NEXT_DIST_DIR || ".next",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(emProducao ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
          // HSTS so em producao: em http://localhost ele forcaria o navegador
          // a tentar HTTPS numa porta sem certificado, travando o acesso.
          //
          // Sem `preload` e sem `includeSubDomains`, pelos mesmos motivos
          // documentados no SGA: entrar na lista de preload dos navegadores e
          // praticamente irreversivel, e nao ha confirmacao de que todo
          // subdominio de setegce.com serve HTTPS.
          ...(emProducao
            ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }]
            : []),
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: csp.join("; ") },
        ],
      },
      {
        // A API nunca pode ser cacheada: toda resposta depende da sessao de
        // quem chamou. Vinha do vercel.json e continua valendo.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

module.exports = nextConfig;
