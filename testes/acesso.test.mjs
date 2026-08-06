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
let servidor;
let url;

before(async () => {
  servidor = criarAplicacao({ senha: SENHA }).listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  url = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  // o banco precisa fechar antes: no Windows arquivo aberto nao se apaga
  fecharBanco();
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
});

const comSenha = (senha) => ({
  headers: { Authorization: `Basic ${Buffer.from(`:${senha}`, 'utf8').toString('base64')}` },
});

test('a rota de saúde responde sem senha e não devolve dado nenhum', async () => {
  const resposta = await fetch(`${url}/saude`);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { ok: true });
});

test('sem senha, o sistema não abre', async () => {
  for (const caminho of ['/', '/api/painel', '/api/contratos']) {
    const resposta = await fetch(url + caminho);
    assert.equal(resposta.status, 401, `${caminho} deveria exigir senha`);
    assert.match(resposta.headers.get('www-authenticate') ?? '', /Basic/);
  }
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

test('o usuário é ignorado: só a senha vale', async () => {
  for (const usuario of ['', 'adm', 'admin', 'joão', 'qualquer coisa']) {
    const credencial = Buffer.from(`${usuario}:${SENHA}`, 'utf8').toString('base64');
    const resposta = await fetch(`${url}/api/painel`, {
      headers: { Authorization: `Basic ${credencial}` },
    });
    assert.equal(resposta.status, 200, `usuário "${usuario}" deveria entrar`);
  }
});
