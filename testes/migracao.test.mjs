/**
 * A migração de um banco que já estava em uso.
 *
 * A tabela `empresa` nasceu com `CHECK (id = 1)` e os contratos não tinham
 * dono. Quem já usava o sistema tem um arquivo com esse formato no disco, e
 * ele precisa atravessar a atualização inteiro — com os contratos apontando
 * para a empresa que já existia, não para lugar nenhum.
 *
 * Este teste monta um banco no formato antigo, com dados dentro, e só então
 * deixa o `db.js` abrir. É a única forma de saber que a migração funciona
 * antes de descobrir no banco de verdade de alguém.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contratos-rt-migracao-'));
const pastaDados = path.join(base, 'data');
fs.mkdirSync(pastaDados, { recursive: true });
process.env.DATA_DIR = pastaDados;
process.env.UPLOAD_DIR = path.join(base, 'uploads');

// --- o banco como ele era antes de existir mais de uma empresa -------------
const antigo = new DatabaseSync(path.join(pastaDados, 'contratos.db'));
antigo.exec(`
  CREATE TABLE empresa (
    id                   INTEGER PRIMARY KEY CHECK (id = 1),
    razao_social         TEXT NOT NULL DEFAULT '',
    cnpj                 TEXT NOT NULL DEFAULT '',
    crea_empresa         TEXT NOT NULL DEFAULT '',
    endereco             TEXT NOT NULL DEFAULT '',
    cidade               TEXT NOT NULL DEFAULT '',
    uf                   TEXT NOT NULL DEFAULT '',
    telefone             TEXT NOT NULL DEFAULT '',
    email                TEXT NOT NULL DEFAULT '',
    dias_alerta_rt       INTEGER NOT NULL DEFAULT 60,
    dias_alerta_contrato INTEGER NOT NULL DEFAULT 90
  );
  CREATE TABLE contratos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    numero           TEXT NOT NULL,
    contratante      TEXT NOT NULL DEFAULT '',
    contratante_cnpj TEXT NOT NULL DEFAULT '',
    objeto           TEXT NOT NULL DEFAULT '',
    valor            REAL,
    data_assinatura  TEXT,
    data_vencimento  TEXT,
    vigencia_meses   INTEGER,
    status           TEXT NOT NULL DEFAULT 'ativo',
    data_conclusao   TEXT,
    observacoes      TEXT NOT NULL DEFAULT '',
    arquivo          TEXT,
    arquivo_nome     TEXT,
    texto            TEXT,
    criado_em        TEXT NOT NULL,
    atualizado_em    TEXT NOT NULL
  );
  INSERT INTO empresa (id, razao_social, cnpj, crea_empresa, dias_alerta_rt)
    VALUES (1, 'ECOART SOLUÇÕES LTDA', '00.000.000/0001-00', 'CREA-AM 9999', 45);
  INSERT INTO contratos (numero, contratante, objeto, valor, criado_em, atualizado_em)
    VALUES ('010/2025', 'Prefeitura de Manaus', 'Montagem de estrutura', 150000.0, '2025-01-01', '2025-01-01'),
           ('011/2025', 'Governo do Estado',    'Locação de palco',      90000.0, '2025-02-01', '2025-02-01');
`);
antigo.close();

const { all, fecharBanco, get } = await import('../src/db.js');
const { listarContratos, listarEmpresas } = await import('../src/servico.js');

after(() => {
  fecharBanco();
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
});

test('a trava de linha única sai da tabela empresa', () => {
  const sql = get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'empresa'").sql;
  assert.doesNotMatch(sql, /CHECK/i);
});

test('a empresa que já estava lá continua inteira, e continua sendo a de número 1', () => {
  const empresas = listarEmpresas();
  assert.equal(empresas.length, 1);
  assert.equal(empresas[0].id, 1);
  assert.equal(empresas[0].razao_social, 'ECOART SOLUÇÕES LTDA');
  assert.equal(empresas[0].cnpj, '00.000.000/0001-00');
  assert.equal(empresas[0].crea_empresa, 'CREA-AM 9999');
  // parametro que a pessoa tinha ajustado a mao nao pode voltar ao padrao
  assert.equal(empresas[0].dias_alerta_rt, 45);
});

test('os contratos que existiam ficam com a empresa que existia', () => {
  const contratos = all('SELECT id, numero, empresa_id, valor FROM contratos ORDER BY id');
  assert.equal(contratos.length, 2);
  for (const c of contratos) assert.equal(c.empresa_id, 1);
  assert.deepEqual(contratos.map((c) => c.numero), ['010/2025', '011/2025']);
  assert.equal(contratos[0].valor, 150000);
});

test('depois da migração cabe uma segunda empresa', () => {
  const { id } = get(
    "INSERT INTO empresa (razao_social) VALUES ('SEGUNDA LTDA') RETURNING id AS id",
  );
  assert.ok(id > 1, 'a segunda empresa deveria receber um id proprio');
  assert.equal(listarEmpresas().length, 2);

  // e os contratos antigos continuam visíveis só para a primeira
  assert.equal(listarContratos({ empresaId: 1 }).length, 2);
  assert.equal(listarContratos({ empresaId: id }).length, 0);
});
