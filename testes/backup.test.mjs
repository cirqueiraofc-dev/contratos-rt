/**
 * Copia de seguranca: o .zip precisa abrir em qualquer descompactador comum e
 * trazer o banco e os PDFs de volta inteiros. Um backup que so parece certo e
 * pior que backup nenhum, porque da falsa seguranca — entao aqui o arquivo e
 * aberto de verdade e o banco recuperado e consultado.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contratos-rt-backup-'));
process.env.DATA_DIR = path.join(base, 'data');
process.env.UPLOAD_DIR = path.join(base, 'uploads');

const { criarAplicacao } = await import('../src/aplicacao.js');
const { fecharBanco } = await import('../src/db.js');
const { pdfContrato, datasExemplo } = await import('./amostras.mjs');

let servidor;
let url;

before(async () => {
  servidor = criarAplicacao().listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  url = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  fecharBanco();
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
});

/**
 * Le um .zip pelo diretorio central, que e como todo descompactador faz.
 * Se este leitor consegue, o Windows e o 7-Zip tambem conseguem.
 */
function abrirZip(buffer) {
  const fim = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(fim, -1, 'o arquivo não termina com um diretório central de ZIP');

  const quantos = buffer.readUInt16LE(fim + 10);
  let ponteiro = buffer.readUInt32LE(fim + 16);
  const arquivos = new Map();

  for (let i = 0; i < quantos; i += 1) {
    assert.equal(buffer.readUInt32LE(ponteiro), 0x02014b50, 'entrada do diretório central corrompida');
    const metodo = buffer.readUInt16LE(ponteiro + 10);
    const crc = buffer.readUInt32LE(ponteiro + 16);
    const comprimido = buffer.readUInt32LE(ponteiro + 20);
    const original = buffer.readUInt32LE(ponteiro + 24);
    const tamNome = buffer.readUInt16LE(ponteiro + 28);
    const tamExtra = buffer.readUInt16LE(ponteiro + 30);
    const tamComentario = buffer.readUInt16LE(ponteiro + 32);
    const inicio = buffer.readUInt32LE(ponteiro + 42);
    const nome = buffer.toString('utf8', ponteiro + 46, ponteiro + 46 + tamNome);

    // no cabecalho local o nome e o extra podem ter tamanhos proprios
    assert.equal(buffer.readUInt32LE(inicio), 0x04034b50, `cabeçalho local de ${nome} corrompido`);
    const dados = inicio + 30 + buffer.readUInt16LE(inicio + 26) + buffer.readUInt16LE(inicio + 28);
    const bruto = buffer.subarray(dados, dados + comprimido);
    const conteudo = metodo === 8 ? zlib.inflateRawSync(bruto) : bruto;

    assert.equal(conteudo.length, original, `${nome} saiu com tamanho diferente`);
    assert.equal(zlib.crc32(conteudo), crc, `${nome} não bate com o CRC guardado`);
    arquivos.set(nome, conteudo);

    ponteiro += 46 + tamNome + tamExtra + tamComentario;
  }
  return arquivos;
}

const estado = {};

test('cadastra um contrato com PDF para o backup ter o que guardar', async () => {
  const datas = datasExemplo();
  const forma = new FormData();
  forma.append('arquivo', new Blob([await pdfContrato(datas)], { type: 'application/pdf' }), 'contrato.pdf');

  const analise = await (await fetch(`${url}/api/contratos/analisar`, { method: 'POST', body: forma })).json();
  const criado = await fetch(`${url}/api/contratos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: analise.token, ...analise.extraidos, disciplinas: ['eletrica'] }),
  });
  assert.ok(criado.ok);
  estado.contrato = await criado.json();

  await fetch(`${url}/api/empresa`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ razao_social: 'ECOART SOLUÇÕES LTDA', cnpj: '00.000.000/0001-00' }),
  });
});

test('o backup é um zip legível com o banco, os PDFs e um leia-me', async () => {
  const resposta = await fetch(`${url}/api/backup`);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('content-type'), 'application/zip');
  assert.match(resposta.headers.get('content-disposition') ?? '', /attachment; filename="contratos-rt-backup-.+\.zip"/);

  const zip = Buffer.from(await resposta.arrayBuffer());
  estado.arquivos = abrirZip(zip);

  assert.ok(estado.arquivos.has('contratos.db'), 'o banco precisa estar no backup');
  assert.ok(estado.arquivos.has('LEIA-ME.txt'), 'o leia-me precisa estar no backup');

  const pdfs = [...estado.arquivos.keys()].filter((n) => n.startsWith('uploads/'));
  assert.equal(pdfs.length, 1, 'o PDF do contrato precisa estar no backup');
  assert.equal(estado.arquivos.get(pdfs[0]).subarray(0, 4).toString(), '%PDF');
});

test('o banco recuperado do backup ainda tem os dados', () => {
  const solto = path.join(base, 'recuperado.db');
  fs.writeFileSync(solto, estado.arquivos.get('contratos.db'));

  const banco = new DatabaseSync(solto, { readOnly: true });
  try {
    const contrato = banco.prepare('SELECT numero, objeto FROM contratos').get();
    assert.equal(contrato.numero, estado.contrato.numero);
    assert.match(contrato.objeto, /manuten[çc][ãa]o predial/i);

    const empresa = banco.prepare('SELECT razao_social FROM empresa WHERE id = 1').get();
    assert.equal(empresa.razao_social, 'ECOART SOLUÇÕES LTDA');

    const rts = banco.prepare('SELECT COUNT(*) AS n FROM rts').get();
    assert.equal(Number(rts.n), 1);
  } finally {
    banco.close();
  }
});

test('o leia-me explica o que fazer com o arquivo', () => {
  const texto = estado.arquivos.get('LEIA-ME.txt').toString('utf8');
  assert.match(texto, /ECOART/);
  assert.match(texto, /COMO RESTAURAR/);
  assert.match(texto, /1 arquivo\(s\) PDF/);
});

test('a cópia sai consistente mesmo com o banco em uso', async () => {
  // grava algo logo antes de pedir o backup: e o caso em que copiar o .db na
  // mao pegaria o arquivo sem a transacao, que ainda estaria so no WAL
  await fetch(`${url}/api/empresa`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ razao_social: 'ECOART SOLUÇÕES LTDA', cnpj: '11.222.333/0001-44' }),
  });

  const zip = Buffer.from(await (await fetch(`${url}/api/backup`)).arrayBuffer());
  const solto = path.join(base, 'recente.db');
  fs.writeFileSync(solto, abrirZip(zip).get('contratos.db'));

  const banco = new DatabaseSync(solto, { readOnly: true });
  try {
    assert.equal(banco.prepare('SELECT cnpj FROM empresa WHERE id = 1').get().cnpj, '11.222.333/0001-44');
  } finally {
    banco.close();
  }
});
