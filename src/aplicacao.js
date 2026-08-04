import crypto from 'node:crypto';
import express from 'express';
import { api } from './routes/api.js';
import { limparTemporarios } from './arquivos.js';
import { PUBLIC_DIR } from './paths.js';
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
    app.use((req, res, next) => {
      const [tipo, credencial] = (req.headers.authorization ?? '').split(' ');
      if (tipo === 'Basic' && credencial) {
        if (senhaConfere(extrairSenha(credencial), senha)) return next();
      }
      res.setHeader('WWW-Authenticate', 'Basic realm="Contratos e RT", charset="UTF-8"');
      return res.status(401).send('Acesso restrito.');
    });
  }

  app.use(express.json({ limit: '2mb' }));
  app.use('/api', api);
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada.' });
    return res.sendFile('index.html', { root: PUBLIC_DIR });
  });

  limparTemporarios();

  return app;
}
