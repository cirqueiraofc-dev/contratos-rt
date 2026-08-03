import express from 'express';
import { api } from './routes/api.js';
import { limparTemporarios } from './arquivos.js';
import { PUBLIC_DIR } from './paths.js';
import './db.js';

/**
 * Monta a aplicacao Express. Separado de server.js para que os testes possam
 * subir a mesma aplicacao numa porta efemera.
 */
export function criarAplicacao({ senha = '' } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Protecao opcional por senha: sem APP_SENHA o sistema roda aberto, que e o
  // esperado para uso local. Ao publicar em rede, defina a variavel.
  if (senha) {
    app.use((req, res, next) => {
      const [tipo, credencial] = (req.headers.authorization ?? '').split(' ');
      if (tipo === 'Basic' && credencial) {
        const [, informada] = Buffer.from(credencial, 'base64').toString('utf8').split(':');
        if (informada === senha) return next();
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
