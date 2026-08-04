/**
 * Teste de ponta a ponta do caminho principal:
 * upload do contrato -> deteccao das RTs -> importacao da ART -> conclusao -> CAT.
 *
 * Rode com: npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contratos-rt-teste-'));
process.env.DATA_DIR = path.join(base, 'data');
process.env.UPLOAD_DIR = path.join(base, 'uploads');

const { criarAplicacao } = await import('../src/aplicacao.js');
const { extrairTexto } = await import('../src/extract/pdfTexto.js');
const { datasExemplo, pdfAditivo, pdfArt, pdfContrato } = await import('./amostras.mjs');

const datas = datasExemplo();

let servidor;
let url;

before(async () => {
  servidor = criarAplicacao().listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  url = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await new Promise((resolve) => servidor.close(resolve));
  fs.rmSync(base, { recursive: true, force: true });
});

async function json(caminho, opcoes = {}) {
  const resposta = await fetch(url + caminho, {
    ...opcoes,
    headers: opcoes.body && !(opcoes.body instanceof FormData)
      ? { 'Content-Type': 'application/json', ...opcoes.headers }
      : opcoes.headers,
  });
  const corpo = resposta.status === 204 ? null : await resposta.json();
  assert.ok(resposta.ok, `${caminho} respondeu ${resposta.status}: ${JSON.stringify(corpo)}`);
  return corpo;
}

function forma(buffer, nome) {
  const dados = new FormData();
  dados.append('arquivo', new Blob([buffer], { type: 'application/pdf' }), nome);
  return dados;
}

const estado = {};

test('lê o PDF do contrato e identifica número, datas, valor e RTs', async () => {
  const resultado = await json('/api/contratos/analisar', {
    method: 'POST',
    body: forma(await pdfContrato(datas), 'contrato-045-2025.pdf'),
  });

  const e = resultado.extraidos;
  assert.equal(e.numero, '045/2025');
  assert.equal(e.data_assinatura, datas.assinatura);
  assert.equal(e.vigencia_meses, 12);
  assert.equal(e.data_vencimento, datas.vencimento);
  assert.equal(e.valor, 1284500);
  assert.equal(e.contratante_cnpj, '56.024.581/0001-56');
  assert.match(e.contratante, /RIBEIR[ÃA]O PRETO/i);
  assert.match(e.objeto, /manuten[çc][ãa]o predial/i);

  const sugeridas = e.disciplinas.filter((d) => d.sugerida).map((d) => d.disciplina).sort();
  assert.deepEqual(sugeridas, ['civil', 'eletrica', 'refrigeracao']);
  assert.equal(e.disciplinas.find((d) => d.disciplina === 'mecanica').sugerida, false);

  estado.token = resultado.token;
  estado.extraidos = e;
});

test('cadastra o contrato com as RTs marcadas como pendentes', async () => {
  const contrato = await json('/api/contratos', {
    method: 'POST',
    body: JSON.stringify({
      token: estado.token,
      ...estado.extraidos,
      disciplinas: ['eletrica', 'civil', 'refrigeracao'],
    }),
  });

  estado.contrato = contrato;
  assert.equal(contrato.numero, '045/2025');
  assert.equal(contrato.status, 'ativo');
  assert.equal(contrato.rts.length, 3);
  assert.equal(contrato.resumo_rts.pendentes, 3);
  assert.match(contrato.rotulo, /Pendente de RT/);
  assert.ok(contrato.arquivo, 'o PDF do contrato deve ficar anexado');
});

test('o PDF original do contrato fica disponível para download', async () => {
  const resposta = await fetch(`${url}/api/contratos/${estado.contrato.id}/arquivo`);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get('content-type'), 'application/pdf');
  const bytes = Buffer.from(await resposta.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
});

test('lê o PDF da ART e registra a RT de elétrica', async () => {
  const rtEletrica = estado.contrato.rts.find((rt) => rt.disciplina === 'eletrica');

  const leitura = await json(`/api/rts/${rtEletrica.id}/analisar-art`, {
    method: 'POST',
    body: forma(await pdfArt(datas), 'art-eletrica.pdf'),
  });

  const e = leitura.extraidos;
  assert.equal(e.numero_art, 'SP20250487213');
  assert.match(e.profissional, /CARLOS EDUARDO/);
  assert.equal(e.data_inicio, datas.inicioArt);
  assert.equal(e.data_validade, datas.vencimento);
  assert.equal(e.data_registro, datas.registroArt);
  assert.equal(e.disciplina_provavel, 'eletrica');

  const contrato = await json(`/api/rts/${rtEletrica.id}/art`, {
    method: 'POST',
    body: JSON.stringify({
      token: leitura.token,
      ...e,
      observacoes: 'Manutenção de instalações elétricas de baixa tensão, quadros e SPDA.',
    }),
  });

  const atualizada = contrato.rts.find((rt) => rt.disciplina === 'eletrica');
  assert.equal(atualizada.status, 'emitida');
  assert.equal(atualizada.numero_art, 'SP20250487213');
  assert.equal(atualizada.tem_arquivo, true);
  assert.equal(contrato.resumo_rts.pendentes, 2);
  estado.contrato = contrato;
});

test('alerta quando a ART está perto do vencimento', async () => {
  const rt = estado.contrato.rts.find((rt) => rt.disciplina === 'civil');
  const daquiA20Dias = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);

  const contrato = await json(`/api/rts/${rt.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: 'emitida', numero_art: 'SP20250490001', profissional: 'ANA PAULA SOUZA',
      crea: 'CREA-SP 5060011223', data_validade: daquiA20Dias,
    }),
  });

  const civil = contrato.rts.find((r) => r.disciplina === 'civil');
  assert.equal(civil.situacao, 'a_vencer');
  assert.equal(civil.tom, 'alerta');
  assert.equal(civil.dias_para_vencer, 20);
  assert.ok(contrato.pendencias.some((p) => p.tipo === 'rt_a_vencer'));

  const painel = await json('/api/painel');
  assert.equal(painel.indicadores.rts_a_vencer, 1);
  assert.equal(painel.indicadores.rts_pendentes, 1);
  estado.contrato = contrato;
});

test('lê o PDF do termo aditivo: prorrogação, valor e nova modalidade', async () => {
  const resultado = await json(`/api/contratos/${estado.contrato.id}/aditivos/analisar`, {
    method: 'POST',
    body: forma(await pdfAditivo(datas), 'aditivo-1.pdf'),
  });

  const e = resultado.extraidos;
  assert.equal(e.ordem, 1);
  assert.equal(e.numero, '1º Termo Aditivo');
  assert.equal(e.contrato_referenciado, '045/2025');
  assert.equal(e.tipo, 'prazo_valor');
  assert.equal(e.data_assinatura, datas.assinaturaAditivo);
  assert.equal(e.prazo_meses, 12);
  // o termo não traz data final: o vencimento sai do vencimento atual + 12 meses
  assert.equal(e.nova_data_vencimento, datas.vencimentoProrrogado);
  assert.equal(e.valor_acrescido, 128450);
  assert.equal(e.novo_valor_total, 1412950);
  assert.match(e.objeto, /elevadores/i);

  const sugeridas = e.disciplinas.filter((d) => d.sugerida).map((d) => d.disciplina);
  assert.ok(sugeridas.includes('mecanica'), 'elevadores devem sugerir a RT de mecânica');

  estado.tokenAditivo = resultado.token;
  estado.aditivo = e;
});

test('registrar o aditivo prorroga a vigência e recalcula o valor', async () => {
  const contrato = await json(`/api/contratos/${estado.contrato.id}/aditivos`, {
    method: 'POST',
    body: JSON.stringify({
      token: estado.tokenAditivo,
      ...estado.aditivo,
      disciplinas: ['mecanica'],
    }),
  });

  assert.equal(contrato.aditivos.length, 1);
  assert.equal(contrato.data_vencimento, datas.vencimentoProrrogado);
  assert.equal(contrato.data_vencimento_original, datas.vencimento);
  assert.equal(contrato.valor, 1284500 + 128450);
  assert.equal(contrato.valor_original, 1284500);
  assert.equal(contrato.vigencia_meses, 24);

  const mecanica = contrato.rts.find((rt) => rt.disciplina === 'mecanica');
  assert.ok(mecanica, 'a modalidade nova deve entrar como RT');
  assert.equal(mecanica.status, 'pendente');
  assert.match(mecanica.motivo, /termo aditivo/i);
  estado.contrato = contrato;
});

test('ART que não cobre a vigência prorrogada vira pendência de ART complementar', async () => {
  const eletrica = estado.contrato.rts.find((rt) => rt.disciplina === 'eletrica');
  assert.equal(eletrica.cobertura_incompleta, true);
  assert.equal(eletrica.data_validade, datas.vencimento);

  const pendencia = estado.contrato.pendencias.find((p) => p.tipo === 'rt_cobertura' && p.texto.includes('Elétrica'));
  assert.ok(pendencia, 'deve haver pendência de cobertura para a elétrica');
  assert.match(pendencia.texto, /ART complementar/);

  const painel = await json('/api/painel');
  assert.ok(painel.indicadores.rts_descobertas >= 1);
});

test('remover o aditivo devolve a vigência e o valor originais', async () => {
  const contrato = await json(`/api/aditivos/${estado.contrato.aditivos[0].id}`, { method: 'DELETE' });

  assert.equal(contrato.aditivos.length, 0);
  assert.equal(contrato.data_vencimento, datas.vencimento);
  assert.equal(contrato.valor, 1284500);
  assert.equal(contrato.vigencia_meses, 12);
  assert.equal(contrato.rts.find((rt) => rt.disciplina === 'eletrica').cobertura_incompleta, false);

  // a RT criada pelo aditivo continua: quem removeu o termo decide o que fazer com ela
  assert.ok(contrato.rts.some((rt) => rt.disciplina === 'mecanica'));
  estado.contrato = contrato;
});

test('reregistra o aditivo para seguir o fluxo com o contrato prorrogado', async () => {
  const leitura = await json(`/api/contratos/${estado.contrato.id}/aditivos/analisar`, {
    method: 'POST',
    body: forma(await pdfAditivo(datas), 'aditivo-1.pdf'),
  });
  const contrato = await json(`/api/contratos/${estado.contrato.id}/aditivos`, {
    method: 'POST',
    body: JSON.stringify({ token: leitura.token, ...leitura.extraidos }),
  });
  assert.equal(contrato.data_vencimento, datas.vencimentoProrrogado);
  estado.contrato = contrato;
});

test('recusa gerar CAT antes de concluir o contrato', async () => {
  const resposta = await fetch(`${url}/api/contratos/${estado.contrato.id}/cat`, { method: 'POST' });
  assert.equal(resposta.status, 400);
  assert.match((await resposta.json()).erro, /Conclua o contrato/);
});

test('concluir o contrato baixa as ARTs e pede a CAT', async () => {
  const contrato = await json(`/api/contratos/${estado.contrato.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'concluido', data_conclusao: datas.vencimento }),
  });

  assert.equal(contrato.status, 'concluido');
  assert.equal(contrato.rotulo, 'Concluído — gerar CAT');
  assert.equal(contrato.tom, 'acao');
  assert.ok(contrato.pendencias.some((p) => p.tipo === 'gerar_cat'));
  assert.equal(contrato.rts.filter((rt) => rt.status === 'baixada').length, 2);
  estado.contrato = contrato;
});

test('gera o atestado e um requerimento de CAT por ART', async () => {
  const contrato = await json(`/api/contratos/${estado.contrato.id}/cat`, { method: 'POST' });

  assert.equal(contrato.rotulo, 'Concluído — CAT gerada');
  assert.equal(contrato.documentos.filter((d) => d.tipo === 'atestado').length, 1);
  assert.equal(contrato.documentos.filter((d) => d.tipo === 'requerimento_cat').length, 2);
  estado.contrato = contrato;
});

test('o atestado gerado é um PDF legível com os dados do contrato', async () => {
  const atestado = estado.contrato.documentos.find((d) => d.tipo === 'atestado');
  const resposta = await fetch(`${url}/api/documentos/${atestado.id}/arquivo`);
  assert.equal(resposta.status, 200);

  const bytes = Buffer.from(await resposta.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');

  const { texto } = await extrairTexto(bytes);
  assert.match(texto, /ATESTADO DE CAPACIDADE TÉCNICA/);
  assert.match(texto, /045\/2025/);
  assert.match(texto, /SP20250487213/);
  // o nome quebra em varias linhas dentro da celula da tabela
  assert.match(texto, /CARLOS EDUARDO/);
  assert.match(texto, /ALMEIDA/);
  assert.match(texto, /RIBEIRÃO PRETO/i);
  assert.match(texto, new RegExp(datas.assinatura.split('-').reverse().join('/')));
  // o atestado precisa listar os termos aditivos — o CREA exige contrato e aditivos
  assert.match(texto, /TERMOS ADITIVOS/i);
  assert.match(texto, /1º Termo Aditivo/);
});

test('o requerimento de CAT traz os dados do profissional e da ART', async () => {
  const requerimento = estado.contrato.documentos.find(
    (d) => d.tipo === 'requerimento_cat' && d.titulo.includes('Elétrica'),
  );
  assert.ok(requerimento, 'deve existir um requerimento da modalidade elétrica');

  const resposta = await fetch(`${url}/api/documentos/${requerimento.id}/arquivo`);
  const { texto } = await extrairTexto(Buffer.from(await resposta.arrayBuffer()));

  assert.match(texto, /REQUERIMENTO DE CERTIDÃO DE ACERVO TÉCNICO/);
  assert.match(texto, /SP20250487213/);
  assert.match(texto, /CARLOS EDUARDO MARQUES DE ALMEIDA/);
  assert.match(texto, /Documentos anexos/i);
});

test('regerar a CAT substitui os documentos anteriores', async () => {
  const antes = estado.contrato.documentos.map((d) => d.id).sort();
  const contrato = await json(`/api/contratos/${estado.contrato.id}/cat`, { method: 'POST' });
  const depois = contrato.documentos.map((d) => d.id).sort();

  assert.equal(contrato.documentos.length, 3);
  assert.notDeepEqual(antes, depois);
  estado.contrato = contrato;
});

test('o histórico registra os passos do contrato', async () => {
  const eventos = await json(`/api/contratos/${estado.contrato.id}/eventos`);
  const tipos = eventos.map((e) => e.tipo);
  assert.ok(tipos.includes('contrato_cadastrado'));
  assert.ok(tipos.includes('art_registrada'));
  assert.ok(tipos.includes('contrato_concluido'));
  assert.ok(tipos.includes('cat_gerada'));
});

test('excluir o contrato apaga também os arquivos ligados a ele', async () => {
  const resposta = await fetch(`${url}/api/contratos/${estado.contrato.id}`, { method: 'DELETE' });
  assert.equal(resposta.status, 204);

  const restantes = fs.readdirSync(process.env.UPLOAD_DIR).filter((n) => n.endsWith('.pdf'));
  assert.deepEqual(restantes, []);

  const painel = await json('/api/painel');
  assert.equal(painel.indicadores.contratos_ativos, 0);
  assert.equal(painel.indicadores.contratos_concluidos, 0);
});
