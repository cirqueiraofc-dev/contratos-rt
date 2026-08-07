/**
 * O cofre: o banco guardado fora do Render.
 *
 * O teste que importa é o do ciclo inteiro — gravar, apagar o disco como o
 * Render faz, subir de novo e encontrar tudo no lugar. Sem isso, a promessa
 * de que "os dados não se perdem" é só uma intenção, e a hora de descobrir
 * que não era verdade seria a pior possível.
 *
 * O R2 aqui é de mentira: um objeto na memória no lugar do `fetch`. O que se
 * testa é a lógica do cofre, não a conversa com a Cloudflare — essa quem
 * valida é `r2.test.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, test } from 'node:test';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contratos-rt-cofre-'));
const pastaDados = path.join(base, 'data');
process.env.DATA_DIR = pastaDados;
process.env.UPLOAD_DIR = path.join(base, 'uploads');

const fetchOriginal = globalThis.fetch;

/** O balde de mentira: chave -> bytes. */
let balde = new Map();
let falharLeitura = false;

before(() => {
  process.env.R2_CONTA = 'contafalsa';
  process.env.R2_BALDE = 'contratos-rt';
  process.env.R2_CHAVE_ID = 'CHAVE';
  process.env.R2_CHAVE_SECRETA = 'segredo';

  globalThis.fetch = async (url, opcoes = {}) => {
    const chave = decodeURIComponent(new URL(url).pathname.replace(/^\/[^/]+\//, ''));
    const metodo = opcoes.method ?? 'GET';
    if (metodo === 'PUT') {
      balde.set(chave, Buffer.from(opcoes.body));
      return new Response('', { status: 200 });
    }
    if (metodo === 'GET') {
      if (falharLeitura) throw new Error('rede caiu');
      const bytes = balde.get(chave);
      return bytes
        ? new Response(bytes, { status: 200 })
        : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    }
    if (metodo === 'HEAD') return new Response('', { status: balde.has(chave) ? 200 : 404 });
    if (metodo === 'DELETE') { balde.delete(chave); return new Response('', { status: 204 }); }
    return new Response('', { status: 400 });
  };
});

beforeEach(() => {
  falharLeitura = false;
});

after(() => {
  globalThis.fetch = fetchOriginal;
  for (const v of ['R2_CONTA', 'R2_BALDE', 'R2_CHAVE_ID', 'R2_CHAVE_SECRETA']) delete process.env[v];
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
});

const cofre = await import('../src/cofre.js');

/** Abre um banco com o mínimo de tabelas que o cofre olha. */
function abrirBanco() {
  fs.mkdirSync(pastaDados, { recursive: true });
  const db = new DatabaseSync(cofre.CAMINHO);
  db.exec(`
    CREATE TABLE IF NOT EXISTS empresa (id INTEGER PRIMARY KEY, razao_social TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS contratos (id INTEGER PRIMARY KEY, numero TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO empresa (id) VALUES (1);
  `);
  return db;
}

/** O que o Render faz a cada publicação: leva o disco embora. */
function apagarODisco() {
  fs.rmSync(pastaDados, { recursive: true, force: true });
}

test('banco recém-criado conta como vazio', () => {
  const db = abrirBanco();
  assert.equal(cofre.bancoVazio(db), true);
  db.exec("UPDATE empresa SET razao_social = 'ECOART SOLUÇÕES LTDA'");
  assert.equal(cofre.bancoVazio(db), false);
  db.close();
  apagarODisco();
});

test('guardar sobe a cópia viva e a cópia do dia', async () => {
  balde = new Map();
  const db = abrirBanco();
  db.exec("INSERT INTO contratos (numero) VALUES ('014/2026')");
  assert.equal(await cofre.guardarAgora(db), true);
  db.close();

  assert.ok(balde.has(cofre.CHAVE), 'a cópia viva deveria estar no balde');
  const doDia = [...balde.keys()].find((k) => k.startsWith('cofre/historico/'));
  assert.ok(doDia, 'deveria existir a cópia do dia');
  assert.deepEqual(balde.get(doDia), balde.get(cofre.CHAVE));
  apagarODisco();
});

test('o ciclo inteiro: gravar, o Render apagar o disco, e voltar inteiro', async () => {
  balde = new Map();
  const db = abrirBanco();
  db.exec("UPDATE empresa SET razao_social = 'ECOART SOLUÇÕES LTDA'");
  db.exec("INSERT INTO contratos (numero) VALUES ('014/2026'), ('021/2026')");
  await cofre.guardarAgora(db);
  db.close();

  apagarODisco();
  assert.equal(fs.existsSync(cofre.CAMINHO), false, 'o disco deveria estar limpo');

  assert.equal(await cofre.restaurarSePreciso({ log() {} }), 'restaurado');

  const voltou = new DatabaseSync(cofre.CAMINHO, { readOnly: true });
  assert.equal(voltou.prepare('SELECT COUNT(*) AS t FROM contratos').get().t, 2);
  assert.equal(voltou.prepare('SELECT razao_social AS r FROM empresa').get().r, 'ECOART SOLUÇÕES LTDA');
  voltou.close();
  apagarODisco();
});

test('não restaura por cima de banco que já tem dado', async () => {
  balde = new Map();
  const antigo = abrirBanco();
  antigo.exec("INSERT INTO contratos (numero) VALUES ('velho/2020')");
  await cofre.guardarAgora(antigo);
  antigo.close();

  // disco sobreviveu e tem coisa mais nova que a cópia
  const db = abrirBanco();
  db.exec("DELETE FROM contratos");
  db.exec("INSERT INTO contratos (numero) VALUES ('novo/2026')");
  db.exec("UPDATE empresa SET razao_social = 'ECOART'");
  db.close();

  assert.equal(await cofre.restaurarSePreciso({ log() {} }), 'disco-tem-dado');

  const conferir = new DatabaseSync(cofre.CAMINHO, { readOnly: true });
  assert.equal(conferir.prepare('SELECT numero AS n FROM contratos').get().n, 'novo/2026');
  conferir.close();
  apagarODisco();
});

test('cofre ainda vazio não é erro — é a primeira vez', async () => {
  balde = new Map();
  apagarODisco();
  assert.equal(await cofre.restaurarSePreciso({ log() {} }), 'cofre-vazio');
});

test('leitura quebrada derruba o arranque em vez de subir vazio', async () => {
  // é o ponto mais delicado do desenho: subir vazio com o cofre cheio faria a
  // primeira escrita sobrescrever a cópia boa, e aí o dado teria acabado
  balde = new Map();
  const db = abrirBanco();
  db.exec("INSERT INTO contratos (numero) VALUES ('014/2026')");
  await cofre.guardarAgora(db);
  db.close();
  apagarODisco();

  falharLeitura = true;
  await assert.rejects(() => cofre.restaurarSePreciso({ log() {} }), /rede caiu/);
});

test('sem R2 configurado o cofre não faz nada e não atrapalha', async () => {
  const guardadas = ['R2_CONTA', 'R2_BALDE', 'R2_CHAVE_ID', 'R2_CHAVE_SECRETA']
    .map((v) => [v, process.env[v]]);
  for (const [v] of guardadas) delete process.env[v];
  try {
    apagarODisco();
    assert.equal(await cofre.restaurarSePreciso({ log() {} }), 'desligado');
    const db = abrirBanco();
    assert.equal(await cofre.guardarAgora(db), false);
    db.close();
  } finally {
    for (const [v, valor] of guardadas) process.env[v] = valor;
    apagarODisco();
  }
});

test('mudanças próximas viram um envio só, e nada se perde no caminho', async () => {
  balde = new Map();
  const db = abrirBanco();
  let envios = 0;
  const fetchDoTeste = globalThis.fetch;
  globalThis.fetch = async (url, opcoes = {}) => {
    if ((opcoes.method ?? 'GET') === 'PUT' && String(url).includes('banco.db')) envios += 1;
    return fetchDoTeste(url, opcoes);
  };
  try {
    // uma dúzia de escritas seguidas, como cadastrar um contrato com RTs
    for (let i = 0; i < 12; i += 1) {
      db.exec(`INSERT INTO contratos (numero) VALUES ('${i}/2026')`);
      cofre.agendarGuarda(db, { log() {} });
    }
    await cofre.aguardarGuarda();
    assert.equal(envios, 1, 'doze mudanças seguidas deveriam render um envio só');

    // e o envio tem que ser o estado FINAL, não o do primeiro agendamento.
    // A cópia é aberta ao lado, não por cima do banco vivo: no Windows não se
    // apaga arquivo que ainda está aberto.
    const aoLado = path.join(pastaDados, 'conferencia.db');
    fs.writeFileSync(aoLado, balde.get(cofre.CHAVE));
    const voltou = new DatabaseSync(aoLado, { readOnly: true });
    assert.equal(voltou.prepare('SELECT COUNT(*) AS t FROM contratos').get().t, 12);
    voltou.close();
  } finally {
    globalThis.fetch = fetchDoTeste;
    db.close();
    apagarODisco();
  }
});
