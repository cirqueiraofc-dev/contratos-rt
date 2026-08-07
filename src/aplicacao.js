import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { api } from './routes/api.js';
import { limparTemporarios } from './arquivos.js';
import { PUBLIC_DIR } from './paths.js';
import { NOME_COOKIE, cookieDeEntrada, cookieDeSaida, lerCookies, valido } from './sessao.js';
import './db.js';

/**
 * Le a senha de um cabecalho Basic. O formato e "usuario:senha", e so o
 * primeiro dois-pontos separa — senha com ":" dentro continua valendo inteira.
 */
function extrairSenha(credencial) {
  let bruto;
  try {
    bruto = Buffer.from(credencial, 'base64').toString('utf8');
  } catch {
    return '';
  }
  const separador = bruto.indexOf(':');
  return separador === -1 ? '' : bruto.slice(separador + 1);
}

/** Comparacao de tempo constante, para nao vazar a senha pelo tempo de resposta. */
function senhaConfere(informada, esperada) {
  const a = Buffer.from(String(informada), 'utf8');
  const b = Buffer.from(String(esperada), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Monta a aplicacao Express. Separado de server.js para que os testes possam
 * subir a mesma aplicacao numa porta efemera.
 */
export function criarAplicacao({ senha = '' } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Verificacao de saude para o servico de hospedagem — fica antes da protecao
  // por senha, senao a plataforma recebe 401 e considera a aplicacao no ar como
  // se estivesse quebrada. Nao devolve nenhum dado.
  app.get('/saude', (_req, res) => res.json({ ok: true }));

  // Protecao opcional por senha: sem APP_SENHA o sistema roda aberto, que e o
  // esperado para uso local. Ao publicar em rede, defina a variavel.
  //
  // O usuario e ignorado de proposito — so a senha vale. Quem acessa pode
  // digitar qualquer coisa (ou nada) no campo de usuario.
  if (senha) {
    // atras do Render a conexao chega em http; quem sabe que era https e o
    // cabecalho que o proxy poe, e disso depende marcar o cookie como Secure
    app.set('trust proxy', 1);

    const seguro = (req) => req.secure;

    // A tela de entrada precisa poder se desenhar antes de alguem entrar:
    // ela mesma, o que ela carrega e as duas rotas do formulario ficam de
    // fora da porteira. Nada aqui e dado de contrato — e a fachada.
    const ABERTO = /^\/(entrar|sair|login(\.html)?|css\/|imagens\/|fontes\/)/;

    app.post('/entrar', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
      if (!senhaConfere(req.body?.senha ?? '', senha)) {
        return res.redirect(303, '/login.html?erro=1');
      }
      res.setHeader('Set-Cookie', cookieDeEntrada(senha, { seguro: seguro(req) }));
      return res.redirect(303, '/');
    });

    app.get('/sair', (req, res) => {
      res.setHeader('Set-Cookie', cookieDeSaida({ seguro: seguro(req) }));
      return res.redirect(303, '/login.html');
    });

    app.use((req, res, next) => {
      const cookie = lerCookies(req.headers.cookie)[NOME_COOKIE];
      if (valido(cookie, senha)) {
        // quem ja entrou nao tem o que fazer na tela de entrada
        if (/^\/login(\.html)?$/.test(req.path)) return res.redirect(303, '/');
        return next();
      }

      // O Basic continua valendo: e o que serve para chamar a API de fora do
      // navegador (um script de backup, por exemplo) sem inventar um segundo
      // segredo so para isso.
      const [tipo, credencial] = (req.headers.authorization ?? '').split(' ');
      if (tipo === 'Basic' && credencial && senhaConfere(extrairSenha(credencial), senha)) {
        return next();
      }

      if (ABERTO.test(req.path)) return next();

      // Quem chegou de navegador vai ver a tela de entrada. Quem chegou pela
      // API leva um 401 com o convite ao Basic, que e o que um script entende.
      if (req.path.startsWith('/api/')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Contratos e RT", charset="UTF-8"');
        return res.status(401).json({ erro: 'Acesso restrito.' });
      }
      return res.redirect(303, '/login.html');
    });
  } else {
    // Sem senha nao ha o que guardar, mas o formulario existe do mesmo jeito:
    // em vez de devolver "rota nao encontrada" para quem apertar Entrar, a
    // porta simplesmente abre.
    app.post('/entrar', (_req, res) => res.redirect(303, '/'));
    app.get('/sair', (_req, res) => res.redirect(303, '/'));
  }

  app.use(express.json({ limit: '2mb' }));
  app.use('/api', api);
  // As fontes tem nome fixo e conteudo que nunca muda, entao vale guardar por
  // muito tempo: sao 390 KB que ninguem precisa baixar duas vezes. Se um dia a
  // fonte trocar, troca-se o nome do arquivo junto.
  app.use('/fontes', express.static(path.join(PUBLIC_DIR, 'fontes'), {
    immutable: true,
    maxAge: '365d',
  }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada.' });
    return res.sendFile('index.html', { root: PUBLIC_DIR });
  });

  limparTemporarios();

  return app;
}
