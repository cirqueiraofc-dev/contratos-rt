import * as cofre from './src/cofre.js';
import * as r2 from './src/r2.js';

const PORTA = Number(process.env.PORT ?? 3000);

// O `trim` nao e frescura: painel de hospedagem e campo de texto, e colar uma
// senha ali costuma trazer um espaco ou uma quebra de linha junto. O espaco e
// invisivel, a senha digitada certa nunca confere, e nao ha o que olhar na
// tela que explique. Quem quiser senha com espaco nas pontas — ninguem quer —
// perde essa possibilidade, e vale a troca.
const SENHA = (process.env.APP_SENHA ?? '').trim();
const USUARIO = (process.env.APP_USUARIO ?? '').trim();

// O cofre desce ANTES de qualquer coisa importar o banco: db.js abre o arquivo
// no momento em que e carregado, e depois disso trocar o arquivo por baixo dele
// nao faz efeito. Por isso os imports do sistema sao dinamicos, mais abaixo.
const situacao = await cofre.restaurarSePreciso();

const { criarAplicacao } = await import('./src/aplicacao.js');
const { limparTemporarios } = await import('./src/arquivos.js');
const { avisarEscritas, db, fecharBanco } = await import('./src/db.js');

const app = criarAplicacao({ senha: SENHA, usuario: USUARIO });

// a partir daqui, toda escrita marca que ha copia nova para subir
avisarEscritas(() => cofre.agendarGuarda(db));

setInterval(limparTemporarios, 60 * 60 * 1000).unref();

// Ctrl+C e o desligamento do Render passam por aqui: e a ultima chance de o
// que acabou de ser digitado chegar ao cofre.
let encerrando = false;
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, async () => {
    if (encerrando) return;
    encerrando = true;
    await cofre.aguardarGuarda();
    fecharBanco();
    process.exit(0);
  });
}

app.listen(PORTA, () => {
  console.log(`\n  Sistema de Contratos e RT rodando em http://localhost:${PORTA}`);

  if (SENHA) {
    // Este bloco existe para quando alguem nao consegue entrar e nao ha como
    // saber por que. Diz o nome esperado (nome nao e segredo) e o TAMANHO da
    // senha — nunca a senha. Contar as letras do que se esta tentando digitar e
    // suficiente para descobrir que a variavel guarda outra coisa.
    console.log(`  Login exigido. Usuário: ${USUARIO || 'qualquer um (APP_USUARIO em branco)'}`);
    console.log(`  APP_SENHA definida, com ${SENHA.length} caracteres.`);
  } else {
    console.log('  (sem senha — defina APP_SENHA para exigir login)');
  }

  const explicacao = {
    restaurado: 'banco recuperado do cofre no R2',
    'disco-tem-dado': 'banco do disco preservado; cópia vai para o R2 a cada mudança',
    'cofre-vazio': 'cofre no R2 ainda sem cópia; a primeira gravação cria',
    desligado: 'sem R2 configurado — os dados vivem só no disco desta máquina',
  }[situacao];
  console.log(`  Arquivos em ${r2.configurado() ? 'Cloudflare R2' : 'disco local'} · ${explicacao}\n`);
});
