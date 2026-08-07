import { criarAplicacao } from './src/aplicacao.js';
import { limparTemporarios } from './src/arquivos.js';

const PORTA = Number(process.env.PORT ?? 3000);

// O `trim` nao e frescura: painel de hospedagem e campo de texto, e colar uma
// senha ali costuma trazer um espaco ou uma quebra de linha junto. O espaco e
// invisivel, a senha digitada certa nunca confere, e nao ha o que olhar na
// tela que explique. Quem quiser senha com espaco nas pontas — ninguem quer —
// perde essa possibilidade, e vale a troca.
const SENHA = (process.env.APP_SENHA ?? '').trim();
const USUARIO = (process.env.APP_USUARIO ?? '').trim();

const app = criarAplicacao({ senha: SENHA, usuario: USUARIO });

setInterval(limparTemporarios, 60 * 60 * 1000).unref();

app.listen(PORTA, () => {
  console.log(`\n  Sistema de Contratos e RT rodando em http://localhost:${PORTA}`);

  if (!SENHA) {
    console.log('  (sem senha — defina APP_SENHA para exigir login)\n');
    return;
  }

  // Este bloco existe para quando alguem nao consegue entrar e nao ha como
  // saber por que. Diz o nome esperado (nome nao e segredo) e o TAMANHO da
  // senha — nunca a senha. Contar as letras do que se esta tentando digitar e
  // suficiente para descobrir que a variavel guarda outra coisa.
  console.log(`  Login exigido. Usuário: ${USUARIO || 'qualquer um (APP_USUARIO em branco)'}`);
  console.log(`  APP_SENHA definida, com ${SENHA.length} caracteres.\n`);
});
