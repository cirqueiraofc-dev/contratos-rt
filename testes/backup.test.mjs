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

/* ----------------------------------------------------------- restauracao */

const { montarZip } = await import('../src/backup.js');

async function enviarParaRestaurar(zip, nome = 'copia.zip') {
  const forma = new FormData();
  forma.append('arquivo', new Blob([zip], { type: 'application/zip' }), nome);
  const resposta = await fetch(`${url}/api/restaurar`, { method: 'POST', body: forma });
  return { resposta, corpo: await resposta.json() };
}

test('guarda uma cópia e depois destrói tudo, para ter o que restaurar', async () => {
  estado.copia = Buffer.from(await (await fetch(`${url}/api/backup`)).arrayBuffer());

  const apagado = await fetch(`${url}/api/contratos/${estado.contrato.id}`, { method: 'DELETE' });
  assert.equal(apagado.status, 204);

  const painel = await (await fetch(`${url}/api/painel`)).json();
  assert.equal(painel.indicadores.contratos_ativos, 0);
  assert.deepEqual(fs.readdirSync(process.env.UPLOAD_DIR).filter((n) => n.endsWith('.pdf')), []);
});

test('restaurar devolve os contratos, as RTs e os PDFs', async () => {
  const { resposta, corpo } = await enviarParaRestaurar(estado.copia);
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.contratos, 1);
  assert.equal(corpo.pdfs, 1);
  assert.equal(corpo.descartados, 0);

  const lista = await (await fetch(`${url}/api/contratos`)).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].numero, estado.contrato.numero);

  const contrato = await (await fetch(`${url}/api/contratos/${lista[0].id}`)).json();
  assert.equal(contrato.rts.length, 1);
  assert.equal(contrato.rts[0].disciplina, 'eletrica');

  // o PDF nao pode voltar so como linha no banco: o arquivo tem que existir
  const pdf = await fetch(`${url}/api/contratos/${contrato.id}/arquivo`);
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
});

test('restaurar duas vezes seguidas não duplica nada', async () => {
  await enviarParaRestaurar(estado.copia);
  const { corpo } = await enviarParaRestaurar(estado.copia);
  assert.equal(corpo.contratos, 1);
  assert.equal((await (await fetch(`${url}/api/contratos`)).json()).length, 1);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).filter((n) => n.endsWith('.pdf')).length, 1);
});

test('arquivo que não é cópia deste sistema é recusado sem estragar nada', async () => {
  const antes = await (await fetch(`${url}/api/contratos`)).json();

  const intruso = montarZip([
    { nome: 'contratos.db', conteudo: Buffer.from('isto não é um banco de dados') },
    { nome: 'uploads/qualquer.pdf', conteudo: Buffer.from('%PDF-1.4') },
  ]);
  const { resposta, corpo } = await enviarParaRestaurar(intruso);
  assert.ok(resposta.status >= 400, 'deve recusar');
  assert.ok(corpo.erro, 'deve explicar o que houve');

  const depois = await (await fetch(`${url}/api/contratos`)).json();
  assert.deepEqual(depois.map((c) => c.numero), antes.map((c) => c.numero));
});

test('zip sem o banco dentro é recusado com recado claro', async () => {
  const semBanco = montarZip([{ nome: 'uploads/solto.pdf', conteudo: Buffer.from('%PDF-1.4') }]);
  const { corpo } = await enviarParaRestaurar(semBanco);
  assert.match(corpo.erro, /contratos\.db/);
});

test('arquivo que não é zip é recusado antes de qualquer coisa', async () => {
  const forma = new FormData();
  forma.append('arquivo', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'contrato.pdf');
  const resposta = await fetch(`${url}/api/restaurar`, { method: 'POST', body: forma });
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /\.zip/);
});

test('nome de arquivo com caminho para fora da pasta é descartado', async () => {
  // um .zip preparado de má fé pode trazer "uploads/../../server.js" dentro;
  // se o sistema escrevesse onde o nome manda, sobrescreveria a si mesmo
  const banco = abrirZip(estado.copia).get('contratos.db');
  const armadilha = montarZip([
    { nome: 'contratos.db', conteudo: banco },
    { nome: 'uploads/../../invasao.txt', conteudo: Buffer.from('não deveria existir') },
    { nome: 'uploads/sub/pasta.pdf', conteudo: Buffer.from('%PDF-1.4') },
  ]);

  const { resposta, corpo } = await enviarParaRestaurar(armadilha);
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  assert.equal(corpo.descartados, 2, 'os dois caminhos suspeitos devem ser descartados');

  const acima = path.resolve(process.env.UPLOAD_DIR, '..', '..');
  assert.equal(fs.existsSync(path.join(acima, 'invasao.txt')), false);
  assert.equal(fs.existsSync(path.join(process.env.UPLOAD_DIR, 'invasao.txt')), false);
  assert.equal(fs.existsSync(path.join(process.env.UPLOAD_DIR, 'sub')), false);
});

test('zip corrompido no meio é percebido antes de tocar nos dados', async () => {
  const antes = await (await fetch(`${url}/api/contratos`)).json();
  const estragado = Buffer.from(estado.copia);
  estragado[Math.floor(estragado.length / 2)] ^= 0xff;

  const { resposta, corpo } = await enviarParaRestaurar(estragado);
  assert.ok(resposta.status >= 400, 'deve recusar');
  assert.match(corpo.erro, /corrompid|não é um \.zip|compressão|índice/i);

  const depois = await (await fetch(`${url}/api/contratos`)).json();
  assert.deepEqual(depois.map((c) => c.numero), antes.map((c) => c.numero));
});

test('o sistema segue de pé depois de tudo isso', async () => {
  await enviarParaRestaurar(estado.copia);
  assert.equal((await (await fetch(`${url}/api/contratos`)).json()).length, 1);
});

test('arquivo de arrumação do repositório não entra na cópia', async () => {
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, '.gitkeep'), '');

  const zip = Buffer.from(await (await fetch(`${url}/api/backup`)).arrayBuffer());
  const dentro = [...abrirZip(zip).keys()];
  assert.equal(dentro.includes('uploads/.gitkeep'), false, '.gitkeep não deve ir junto');

  // e, por consequência, a restauração não relata nada descartado
  const { corpo } = await enviarParaRestaurar(zip);
  assert.equal(corpo.descartados, 0);
});
