/**
 * Varias empresas na mesma instalacao.
 *
 * O que se testa aqui nao e a tela, e a separacao: contrato de uma empresa
 * nao pode aparecer na lista da outra, e o documento gerado tem que sair com
 * o CNPJ de quem realmente assinou o contrato. Errar isso significa entregar
 * ao cliente um atestado com o registro da empresa errada.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contratos-rt-empresas-'));
process.env.DATA_DIR = path.join(base, 'data');
process.env.UPLOAD_DIR = path.join(base, 'uploads');

const { criarAplicacao } = await import('../src/aplicacao.js');
const { fecharBanco } = await import('../src/db.js');

let servidor;
let url;

before(async () => {
  servidor = criarAplicacao().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  url = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await new Promise((r) => servidor.close(r));
  fecharBanco();
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
});

async function json(caminho, opcoes = {}) {
  const resposta = await fetch(url + caminho, {
    ...opcoes,
    headers: opcoes.body ? { 'Content-Type': 'application/json', ...opcoes.headers } : opcoes.headers,
  });
  const corpo = resposta.headers.get('content-type')?.includes('json')
    ? await resposta.json()
    : await resposta.text();
  return { status: resposta.status, corpo };
}

const post = (caminho, dados) => json(caminho, { method: 'POST', body: JSON.stringify(dados) });

let alfa;
let beta;

test('a instalação já nasce com uma empresa, em branco', async () => {
  const { corpo } = await json('/api/empresas');
  assert.equal(corpo.length, 1);
  assert.equal(corpo[0].razao_social, '');
  assert.equal(corpo[0].total_contratos, 0);
});

test('cadastrar uma segunda empresa', async () => {
  const primeira = await json('/api/empresas/1', {
    method: 'PUT',
    body: JSON.stringify({ razao_social: 'ALFA ENGENHARIA LTDA', cnpj: '11.111.111/0001-11', crea_empresa: 'CREA-AM 1111' }),
  });
  assert.equal(primeira.status, 200);
  alfa = primeira.corpo.id;

  const segunda = await post('/api/empresas', {
    razao_social: 'BETA MONTAGENS LTDA', cnpj: '22.222.222/0001-22', crea_empresa: 'CREA-SP 2222',
  });
  assert.equal(segunda.status, 201);
  beta = segunda.corpo.id;
  assert.notEqual(alfa, beta);

  const { corpo } = await json('/api/empresas');
  assert.equal(corpo.length, 2);
});

test('empresa sem razão social não entra', async () => {
  const { status, corpo } = await post('/api/empresas', { razao_social: '  ' });
  assert.equal(status, 400);
  assert.match(corpo.erro, /razão social/i);
});

test('cada contrato fica com a empresa em que foi cadastrado', async () => {
  const a = await post('/api/contratos', { numero: '001/2026', contratante: 'Prefeitura A', empresa_id: alfa });
  const b = await post('/api/contratos', { numero: '002/2026', contratante: 'Prefeitura B', empresa_id: beta });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.corpo.empresa_id, alfa);
  assert.equal(b.corpo.empresa_id, beta);
});

test('uma empresa não enxerga o contrato da outra', async () => {
  const daAlfa = (await json(`/api/contratos?empresa=${alfa}`)).corpo;
  const daBeta = (await json(`/api/contratos?empresa=${beta}`)).corpo;

  assert.deepEqual(daAlfa.map((c) => c.numero), ['001/2026']);
  assert.deepEqual(daBeta.map((c) => c.numero), ['002/2026']);
});

test('o painel também conta só o que é da empresa aberta', async () => {
  const daAlfa = (await json(`/api/painel?empresa=${alfa}`)).corpo;
  const daBeta = (await json(`/api/painel?empresa=${beta}`)).corpo;

  assert.equal(daAlfa.indicadores.contratos_ativos, 1);
  assert.equal(daBeta.indicadores.contratos_ativos, 1);
  assert.equal(daAlfa.empresa.razao_social, 'ALFA ENGENHARIA LTDA');
  assert.equal(daBeta.empresa.razao_social, 'BETA MONTAGENS LTDA');
});

test('empresa que não existe cai na primeira, em vez de esvaziar a tela', async () => {
  // acontece de verdade: a escolha fica guardada no navegador e a empresa
  // pode ter sido excluída depois, ou a cópia restaurada não a ter
  const { status, corpo } = await json('/api/painel?empresa=99999');
  assert.equal(status, 200);
  assert.equal(corpo.empresa.razao_social, 'ALFA ENGENHARIA LTDA');
});

test('empresa com contrato não pode ser excluída', async () => {
  const { status, corpo } = await json(`/api/empresas/${beta}`, { method: 'DELETE' });
  assert.equal(status, 400);
  assert.match(corpo.erro, /contrato/i);

  assert.equal((await json('/api/empresas')).corpo.length, 2);
});

test('empresa vazia sai, e a última nunca sai', async () => {
  const vazia = (await post('/api/empresas', { razao_social: 'GAMA LTDA' })).corpo;
  assert.equal((await json(`/api/empresas/${vazia.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await json('/api/empresas')).corpo.length, 2);
});

test('o atestado sai com o CNPJ de quem assinou o contrato', async () => {
  // o teste que justifica todo o resto: gerar a CAT do contrato da Beta tem
  // que produzir um PDF com o registro da Beta, e nao o da primeira empresa
  const daBeta = (await json(`/api/contratos?empresa=${beta}`)).corpo[0];

  const rt = await post(`/api/contratos/${daBeta.id}/rts`, { disciplina: 'eletrica' });
  assert.equal(rt.status, 201);
  const idRt = (await json(`/api/contratos/${daBeta.id}`)).corpo.rts[0].id;

  await json(`/api/rts/${idRt}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'emitida', numero_art: 'AM20260000001', profissional_nome: 'Fulano de Tal' }),
  });
  await post(`/api/contratos/${daBeta.id}/status`, { status: 'concluido', data_conclusao: '2026-06-30' });

  const cat = await post(`/api/contratos/${daBeta.id}/cat`, {});
  assert.equal(cat.status, 201, JSON.stringify(cat.corpo));

  const doc = cat.corpo.documentos.find((d) => d.tipo === 'atestado');
  const pdf = await fetch(`${url}/api/documentos/${doc.id}/arquivo`);
  const { extrairTexto } = await import('../src/extract/pdfTexto.js');
  const { texto } = await extrairTexto(Buffer.from(await pdf.arrayBuffer()));

  assert.match(texto, /BETA MONTAGENS LTDA/);
  assert.match(texto, /22\.222\.222\/0001-22/);
  assert.doesNotMatch(texto, /ALFA ENGENHARIA/);
  assert.doesNotMatch(texto, /11\.111\.111/);
});
