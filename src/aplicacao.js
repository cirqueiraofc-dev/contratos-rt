import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { api } from './routes/api.js';
import { limparTemporarios } from './arquivos.js';
import { PUBLIC_DIR } from './paths.js';
import { NOME_COOKIE, cookieDeEntrada, cookieDeSaida, lerCookies, valido } from './sessao.js';
import './db.js';

/**
 * Le um cabecalho Basic. O formato e "usuario:senha", e so o primeiro
 * dois-pontos separa — senha com ":" dentro continua valendo inteira.
 */
function lerBasic(credencial) {
  let bruto;
  try {
    bruto = Buffer.from(credencial, 'base64').toString('utf8');
  } catch {
    return { usuario: '', senha: '' };
  }
  const separador = bruto.indexOf(':');
  if (separador === -1) return { usuario: bruto, senha: '' };
  return { usuario: bruto.slice(0, separador), senha: bruto.slice(separador + 1) };
}

/** Comparacao de tempo constante, para nao vazar a senha pelo tempo de resposta. */
function senhaConfere(informada, esperada) {
  const a = Buffer.from(String(informada), 'utf8');
  const b = Buffer.from(String(esperada), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * O usuario nao e segredo — e um nome, nao uma senha. Por isso a comparacao
 * aqui e a comum, e perdoa o que o teclado faz sem pedir licenca: espaco
 * sobrando e maiuscula no comeco.
 *
 * Sem APP_USUARIO definido, qualquer nome passa. E o comportamento que o
 * sistema sempre teve, e quem so definiu a senha continua entrando igual.
 */
function usuarioConfere(informado, esperado) {
  if (!esperado) return true;
  return String(informado ?? '').trim().toLocaleLowerCase('pt-BR')
    === String(esperado).trim().toLocaleLowerCase('pt-BR');
}

/**
 * Freio contra tentativa de adivinhar a senha por forca bruta.
 *
 * Nao ha conta para bloquear — e uma senha so, compartilhada — entao o freio
 * e por IP de quem tenta. A partir do quinto erro seguido sem um acerto no
 * meio, o IP espera um tempo que dobra a cada novo erro (30s, 1min, 2min...
 * ate um teto de 15min). Um login certo zera a contagem desse IP.
 *
 * Nao e infalivel — X-Forwarded-For pode ser forjado fora de um proxy
 * confiavel — mas encarece uma tentativa automatizada sem exigir cadastro
 * nem CAPTCHA, e sem guardar nada em disco.
 */
const tentativasPorIp = new Map();
const TETO_ESPERA_MS = 15 * 60 * 1000;

function segundosBloqueado(ip) {
  const registro = tentativasPorIp.get(ip);
  if (!registro || registro.bloqueadoAte <= Date.now()) return 0;
  return Math.ceil((registro.bloqueadoAte - Date.now()) / 1000);
}

function registrarFalhaDeLogin(ip) {
  const registro = tentativasPorIp.get(ip) ?? { erros: 0, bloqueadoAte: 0 };
  registro.erros += 1;
  if (registro.erros >= 5) {
    const espera = Math.min(30_000 * 2 ** (registro.erros - 5), TETO_ESPERA_MS);
    registro.bloqueadoAte = Date.now() + espera;
  }
  tentativasPorIp.set(ip, registro);
}

// Varre de vez em quando para o mapa nao crescer para sempre com IP que so
// tentou uma vez. Fica fora da funcao para nao recriar o timer a cada teste
// que sobe uma aplicacao nova.
setInterval(() => {
  const agora = Date.now();
  for (const [ip, r] of tentativasPorIp) {
    if (r.bloqueadoAte < agora && r.erros < 5) tentativasPorIp.delete(ip);
  }
}, 30 * 60 * 1000).unref();

/**
 * Monta a aplicacao Express. Separado de server.js para que os testes possam
 * subir a mesma aplicacao numa porta efemera.
 */
export function criarAplicacao({ senha = '', usuario = '' } = {}) {
  // O que assina a sessao e o par inteiro. Trocar o usuario derruba as
  // sessoes abertas do mesmo jeito que trocar a senha — que e o esperado de
  // quem acabou de mudar quem pode entrar.
  const segredo = `${usuario}\n${senha}`;
  const app = express();
  app.disable('x-powered-by');

  // Cabecalhos de resposta que nao mudam comportamento nenhum da aplicacao,
  // so fecham brecha de navegador: nao deixar o site ser carregado dentro de
  // um <iframe> de outro site (clickjacking), nao deixar o navegador "adivinhar"
  // um tipo de arquivo diferente do Content-Type declarado, e nao vazar a URL
  // completa de dentro do sistema para o site de onde veio um link de saida.
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

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
      // bloqueado nao chega nem a conferir a senha — e o proprio ponto do freio
      if (segundosBloqueado(req.ip)) return res.redirect(303, '/login.html?erro=1');

      // as duas conferencias antes do `if`: assim errar o usuario e errar a
      // senha custam o mesmo tempo, e o relogio nao conta qual dos dois foi
      const nomeOk = usuarioConfere(req.body?.usuario, usuario);
      const senhaOk = senhaConfere(req.body?.senha ?? '', senha);
      if (!nomeOk || !senhaOk) {
        registrarFalhaDeLogin(req.ip);
        return res.redirect(303, '/login.html?erro=1');
      }

      tentativasPorIp.delete(req.ip);
      res.setHeader('Set-Cookie', cookieDeEntrada(segredo, { seguro: seguro(req) }));
      return res.redirect(303, '/');
    });

    app.get('/sair', (req, res) => {
      res.setHeader('Set-Cookie', cookieDeSaida({ seguro: seguro(req) }));
      return res.redirect(303, '/login.html');
    });

    app.use((req, res, next) => {
      const cookie = lerCookies(req.headers.cookie)[NOME_COOKIE];
      if (valido(cookie, segredo)) {
        // quem ja entrou nao tem o que fazer na tela de entrada
        if (/^\/login(\.html)?$/.test(req.path)) return res.redirect(303, '/');
        return next();
      }

      // O Basic continua valendo: e o que serve para chamar a API de fora do
      // navegador (um script de backup, por exemplo) sem inventar um segundo
      // segredo so para isso.
      const [tipo, credencial] = (req.headers.authorization ?? '').split(' ');
      if (tipo === 'Basic' && credencial) {
        const dito = lerBasic(credencial);
        if (usuarioConfere(dito.usuario, usuario) && senhaConfere(dito.senha, senha)) {
          return next();
        }
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
