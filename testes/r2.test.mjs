/**
 * Cliente do R2. Como a assinatura SigV4 foi escrita a mao, o que importa aqui
 * e conferir o que ele coloca no fio: metodo, endereco, cabecalhos e corpo.
 * A conversa de verdade com a Cloudflare so o R2 pode validar — este teste
 * garante que nada mude sem querer, e que com o R2 ligado o disco nao e tocado.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contratos-rt-r2-'));
process.env.DATA_DIR = path.join(base, 'data');
process.env.UPLOAD_DIR = path.join(base, 'uploads');

const arquivos = await import('../src/arquivos.js');
const { fecharBanco } = await import('../src/db.js');

const fetchOriginal = globalThis.fetch;
const chamadas = [];

before(() => {
  process.env.R2_CONTA = 'contafalsa123';
  process.env.R2_BALDE = 'contratos-rt';
  process.env.R2_CHAVE_ID = 'CHAVEDETESTE';
  process.env.R2_CHAVE_SECRETA = 'segredodeteste';
});

beforeEach(() => {
  chamadas.length = 0;
});

after(() => {
  globalThis.fetch = fetchOriginal;
  for (const v of ['R2_CONTA', 'R2_BALDE', 'R2_CHAVE_ID', 'R2_CHAVE_SECRETA']) delete process.env[v];
  fecharBanco();
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
});

function fingirR2(resposta) {
  globalThis.fetch = async (url, opcoes) => {
    chamadas.push({ url: String(url), ...opcoes });
    return resposta();
  };
}

test('gravar no acervo vai para o R2 e não encosta no disco', async () => {
  fingirR2(() => new Response('', { status: 200 }));

  await arquivos.guardarNoAcervo('contrato-abc123.pdf', Buffer.from('%PDF-1.4 conteudo'));

  assert.equal(chamadas.length, 1);
  const [c] = chamadas;
  assert.equal(c.method, 'PUT');
  assert.equal(c.url, 'https://contafalsa123.r2.cloudflarestorage.com/contratos-rt/pdfs/contrato-abc123.pdf');
  assert.equal(c.headers['content-type'], 'application/pdf');
  assert.match(c.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=CHAVEDETESTE\/\d{8}\/auto\/s3\/aws4_request, /);
  assert.match(c.headers.Authorization, /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(c.body.toString(), '%PDF-1.4 conteudo');

  // o ponto todo: com o R2 ligado, nada é gravado na pasta local
  assert.deepEqual(fs.readdirSync(process.env.UPLOAD_DIR).filter((n) => n.endsWith('.pdf')), []);
});

test('o hash do corpo é o do conteúdo, não o de vazio', async () => {
  fingirR2(() => new Response('', { status: 200 }));
  await arquivos.guardarNoAcervo('a.pdf', Buffer.from('um'));
  const primeiro = chamadas[0].headers['x-amz-content-sha256'];

  chamadas.length = 0;
  await arquivos.guardarNoAcervo('b.pdf', Buffer.from('outro'));
  const segundo = chamadas[0].headers['x-amz-content-sha256'];

  assert.match(primeiro, /^[0-9a-f]{64}$/);
  assert.notEqual(primeiro, segundo, 'conteúdos diferentes têm de assinar diferente');
});

test('ler devolve os bytes de volta', async () => {
  fingirR2(() => new Response(Buffer.from('%PDF-1.4 de volta'), { status: 200 }));
  const bytes = await arquivos.lerArquivo('contrato-abc123.pdf');
  assert.equal(bytes.toString(), '%PDF-1.4 de volta');
  assert.equal(chamadas[0].method, 'GET');
});

test('arquivo que não existe devolve nulo, não erro', async () => {
  fingirR2(() => new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }));
  assert.equal(await arquivos.lerArquivo('sumiu.pdf'), null);
});

test('remover aceita apagar o que já não estava lá', async () => {
  fingirR2(() => new Response('', { status: 404 }));
  await arquivos.remover('sumiu.pdf');     // não pode lançar
  assert.equal(chamadas[0].method, 'DELETE');
});

test('erro do R2 chega com a explicação dele junto', async () => {
  fingirR2(() => new Response(
    '<Error><Code>AccessDenied</Code><Message>Token sem permissão de escrita</Message></Error>',
    { status: 403 },
  ));
  await assert.rejects(
    () => arquivos.guardarNoAcervo('x.pdf', Buffer.from('a')),
    /403.*AccessDenied.*Token sem permissão de escrita/s,
  );
});

test('nome com acento e espaço vira endereço válido', async () => {
  fingirR2(() => new Response('', { status: 200 }));
  await arquivos.guardarNoAcervo('art elétrica (1).pdf', Buffer.from('a'));
  const { url } = chamadas[0];
  assert.equal(url.includes(' '), false, 'espaço tem de ser codificado');
  assert.match(url, /\/contratos-rt\/pdfs\/art%20el%C3%A9trica%20\(1\)\.pdf$/);
});
