import { criarAplicacao } from './src/aplicacao.js';
import { limparTemporarios } from './src/arquivos.js';

const PORTA = Number(process.env.PORT ?? 3000);
const SENHA = process.env.APP_SENHA ?? '';
const USUARIO = process.env.APP_USUARIO ?? '';

const app = criarAplicacao({ senha: SENHA, usuario: USUARIO });

setInterval(limparTemporarios, 60 * 60 * 1000).unref();

app.listen(PORTA, () => {
  console.log(`\n  Sistema de Contratos e RT rodando em http://localhost:${PORTA}`);
  console.log(SENHA
    ? `  (login exigido — usuário ${USUARIO || 'qualquer um'}, senha em APP_SENHA)\n`
    : '  (sem senha — defina APP_SENHA para exigir login)\n');
});
