/**
 * Protecao por senha e rota de saude — o que a hospedagem depende para
 * considerar a aplicacao no ar sem expor nenhum dado.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contratos-rt-acesso-'));
process.env.DATA_DIR = path.join(base, 'data');
process.env.UPLOAD_DIR = path.join(base, 'uploads');

const { criarAplicacao } = await import('../src/aplicacao.js');
const { fecharBanco } = await import('../src/db.js');

// dois-pontos e acento de proposito: sao os casos que quebram uma leitura
// ingenua do cabecalho Basic, e senha de gente de verdade tem disso
const SENHA = 'Obra:2026#Ribeirão';
// nome inventado de proposito: o repositorio e publico, e o usuario de
// verdade mora na APP_USUARIO do painel do Render, nao aqui
const USUARIO = 'engenharia';
let servidor;
let url;

before(async () => {
  servidor = criarAplicacao({ senha: SENHA, usuario: USUARIO }).listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  url = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  // o banco precisa fechar antes: no Windows arquivo aberto nao se apaga
  fecharBanco();
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
});

const comSenha = (senha, usuario = USUARIO) => ({
  headers: {
    Authorization: `Basic ${Buffer.from(`${usuario}:${senha}`, 'utf8').toString('base64')}`,
  },
});

test('a rota de saúde responde sem senha e não devolve dado nenhum', async () => {
  const resposta = await fetch(`${url}/saude`);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { ok: true });
});

test('sem senha, a API não abre', async () => {
  for (const caminho of ['/api/painel', '/api/contratos']) {
    const resposta = await fetch(url + caminho);
    assert.equal(resposta.status, 401, `${caminho} deveria exigir senha`);
    assert.match(resposta.headers.get('www-authenticate') ?? '', /Basic/);
  }
});

test('sem senha, o navegador é levado para a tela de entrada', async () => {
  for (const caminho of ['/', '/index.html', '/qualquer-coisa']) {
    const resposta = await fetch(url + caminho, { redirect: 'manual' });
    assert.equal(resposta.status, 303, `${caminho} deveria mandar para a entrada`);
    assert.equal(resposta.headers.get('location'), '/login.html');
  }
});

test('a tela de entrada e o que ela carrega abrem sem senha', async () => {
  // se isto quebrar, o visitante vê um formulário sem estilo e sem marca
  for (const caminho of ['/login.html', '/css/login.css', '/css/app.css',
                         '/imagens/marca-ecoart.svg']) {
    const resposta = await fetch(url + caminho);
    assert.equal(resposta.status, 200, `${caminho} deveria abrir`);
  }
  assert.match(await (await fetch(`${url}/login.html`)).text(), /Contratos e RT/);
});

test('senha errada continua barrada', async () => {
  for (const tentativa of ['outra-coisa', 'Obra', 'Obra:', '', 'Obra:2026#Ribeirão ']) {
    const resposta = await fetch(`${url}/api/painel`, comSenha(tentativa));
    assert.equal(resposta.status, 401, `"${tentativa}" não deveria entrar`);
  }
});

test('com a senha certa, o sistema abre', async () => {
  const pagina = await fetch(url, comSenha(SENHA));
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Contratos e RT/);

  const painel = await fetch(`${url}/api/painel`, comSenha(SENHA));
  assert.equal(painel.status, 200);
  assert.equal((await painel.json()).indicadores.contratos_ativos, 0);
});

test('o usuário também é conferido, e perdoa caixa e espaço', async () => {
  for (const jeito of [USUARIO, 'Engenharia', 'ENGENHARIA', '  engenharia  ']) {
    const resposta = await fetch(`${url}/api/painel`, comSenha(SENHA, jeito));
    assert.equal(resposta.status, 200, `"${jeito}" deveria entrar`);
  }
  for (const errado of ['', 'adm', 'engenhari', 'enge nharia', 'engenharia2']) {
    const resposta = await fetch(`${url}/api/painel`, comSenha(SENHA, errado));
    assert.equal(resposta.status, 401, `"${errado}" não deveria entrar`);
  }
});

test('sem APP_USUARIO, qualquer nome continua servindo', async () => {
  // é como o sistema sempre funcionou; quem só definiu a senha não quebra
  const solto = criarAplicacao({ senha: SENHA }).listen(0);
  await new Promise((r) => solto.once('listening', r));
  const outra = `http://127.0.0.1:${solto.address().port}`;
  try {
    for (const nome of ['', 'adm', 'joão', 'qualquer coisa']) {
      const credencial = Buffer.from(`${nome}:${SENHA}`, 'utf8').toString('base64');
      const resposta = await fetch(`${outra}/api/painel`, {
        headers: { Authorization: `Basic ${credencial}` },
      });
      assert.equal(resposta.status, 200, `"${nome}" deveria entrar`);
    }
  } finally {
    await new Promise((r) => solto.close(r));
  }
});

// ------------------------------------------------------------ entrar/sair

/** Faz o caminho do formulário e devolve o cookie que o servidor mandou. */
async function entrar(comQue) {
  const resposta = await fetch(`${url}/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ usuario: USUARIO, senha: comQue }),
    redirect: 'manual',
  });
  return { resposta, cookie: (resposta.headers.get('set-cookie') ?? '').split(';')[0] };
}

test('o formulário com a senha certa abre a porta e guarda a sessão', async () => {
  const { resposta, cookie } = await entrar(SENHA);
  assert.equal(resposta.status, 303);
  assert.equal(resposta.headers.get('location'), '/');

  const bruto = resposta.headers.get('set-cookie') ?? '';
  assert.match(bruto, /^sessao=/);
  assert.match(bruto, /HttpOnly/);
  assert.match(bruto, /SameSite=Lax/);

  const painel = await fetch(`${url}/api/painel`, { headers: { Cookie: cookie } });
  assert.equal(painel.status, 200);

  const pagina = await fetch(url, { headers: { Cookie: cookie } });
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Contratos e RT/);
});

test('o formulário com a senha errada volta para a entrada avisando', async () => {
  for (const tentativa of ['', 'outra-coisa', 'Obra:2026#Ribeirão ']) {
    const { resposta, cookie } = await entrar(tentativa);
    assert.equal(resposta.status, 303);
    assert.equal(resposta.headers.get('location'), '/login.html?erro=1');
    assert.equal(cookie, '', `"${tentativa}" não deveria receber sessão`);
  }
});

test('cookie adulterado não vale — nem o prazo, nem a assinatura', async () => {
  const { cookie } = await entrar(SENHA);
  const [, valor] = cookie.split('=');
  const [ate, marca] = valor.split('.');

  const falsos = [
    `sessao=${Number(ate) + 1}.${marca}`,        // esticaram o prazo
    `sessao=${ate}.${marca.slice(0, -1)}x`,      // mexeram na assinatura
    `sessao=${ate}`,                             // tiraram a assinatura
    'sessao=1.2',
    'sessao=',
  ];
  for (const falso of falsos) {
    const resposta = await fetch(`${url}/api/painel`, { headers: { Cookie: falso } });
    assert.equal(resposta.status, 401, `"${falso}" não deveria entrar`);
  }
});

test('sair apaga a sessão do navegador', async () => {
  const { cookie } = await entrar(SENHA);
  const saida = await fetch(`${url}/sair`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(saida.status, 303);
  assert.equal(saida.headers.get('location'), '/login.html');
  assert.match(saida.headers.get('set-cookie') ?? '', /^sessao=;/);
  assert.match(saida.headers.get('set-cookie') ?? '', /Max-Age=0/);
});

test('quem já entrou não fica preso na tela de entrada', async () => {
  const { cookie } = await entrar(SENHA);
  const resposta = await fetch(`${url}/login.html`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  assert.equal(resposta.status, 303);
  assert.equal(resposta.headers.get('location'), '/');
});

test('o formulário com o usuário errado não abre a porta', async () => {
  for (const nome of ['', 'adm', 'sabrina', 'outra pessoa']) {
    const resposta = await fetch(`${url}/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ usuario: nome, senha: SENHA }),
      redirect: 'manual',
    });
    assert.equal(resposta.headers.get('location'), '/login.html?erro=1', `"${nome}" entrou`);
    assert.equal(resposta.headers.get('set-cookie'), null);
  }
});

test('sessão emitida com um usuário não vale para outro', async () => {
  // trocar quem entra tem que derrubar quem já estava dentro
  const { cookie } = await entrar(SENHA);
  const outro = criarAplicacao({ senha: SENHA, usuario: 'outronome' }).listen(0);
  await new Promise((r) => outro.once('listening', r));
  try {
    const resposta = await fetch(`http://127.0.0.1:${outro.address().port}/api/painel`, {
      headers: { Cookie: cookie },
    });
    assert.equal(resposta.status, 401);
  } finally {
    await new Promise((r) => outro.close(r));
  }
});
