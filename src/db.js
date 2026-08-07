import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, UPLOAD_DIR, TMP_DIR } from './paths.js';

for (const dir of [DATA_DIR, UPLOAD_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'contratos.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS empresa (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE TABLE IF NOT EXISTS profissionais (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  titulo      TEXT NOT NULL DEFAULT '',
  crea        TEXT NOT NULL DEFAULT '',
  rnp         TEXT NOT NULL DEFAULT '',
  disciplinas TEXT NOT NULL DEFAULT '',
  ativo       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contratos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id       INTEGER NOT NULL DEFAULT 1 REFERENCES empresa(id),
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

CREATE TABLE IF NOT EXISTS aditivos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id          INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  numero               TEXT NOT NULL DEFAULT '',
  tipo                 TEXT NOT NULL DEFAULT 'prazo',
  data_assinatura      TEXT,
  prazo_meses          INTEGER,
  nova_data_vencimento TEXT,
  valor_acrescido      REAL,
  objeto               TEXT NOT NULL DEFAULT '',
  observacoes          TEXT NOT NULL DEFAULT '',
  arquivo              TEXT,
  arquivo_nome         TEXT,
  texto                TEXT,
  criado_em            TEXT NOT NULL,
  atualizado_em        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id   INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  disciplina    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pendente',
  numero_art    TEXT,
  profissional  TEXT,
  titulo        TEXT,
  crea          TEXT,
  rnp           TEXT,
  data_registro TEXT,
  data_inicio   TEXT,
  data_validade TEXT,
  valor         REAL,
  motivo        TEXT,
  origem        TEXT NOT NULL DEFAULT 'manual',
  arquivo       TEXT,
  arquivo_nome  TEXT,
  observacoes   TEXT NOT NULL DEFAULT '',
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (contrato_id, disciplina)
);

CREATE TABLE IF NOT EXISTS documentos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id  INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,
  titulo       TEXT NOT NULL DEFAULT '',
  arquivo      TEXT NOT NULL,
  arquivo_nome TEXT NOT NULL DEFAULT '',
  dados        TEXT,
  criado_em    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eventos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER REFERENCES contratos(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  descricao   TEXT NOT NULL DEFAULT '',
  criado_em   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aditivos_contrato ON aditivos (contrato_id);
CREATE INDEX IF NOT EXISTS idx_rts_contrato   ON rts (contrato_id);
CREATE INDEX IF NOT EXISTS idx_rts_status     ON rts (status);
CREATE INDEX IF NOT EXISTS idx_docs_contrato  ON documentos (contrato_id);
CREATE INDEX IF NOT EXISTS idx_eventos_contrato ON eventos (contrato_id);
`);

/**
 * A tabela `empresa` nasceu com `CHECK (id = 1)`: cabia uma empresa e ponto.
 * Passou a caber mais de uma, e no SQLite nao se remove um CHECK com ALTER —
 * o jeito e recriar a tabela e mudar o nome. A copia preserva os ids, entao
 * a empresa que ja estava la continua sendo a de numero 1 e os contratos
 * existentes seguem apontando para ela.
 */
const empresaTravada = /CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'empresa'").get()?.sql ?? '',
);

if (empresaTravada) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    BEGIN;
    CREATE TABLE empresa_nova (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
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
    INSERT INTO empresa_nova
      SELECT id, razao_social, cnpj, crea_empresa, endereco, cidade, uf,
             telefone, email, dias_alerta_rt, dias_alerta_contrato
        FROM empresa;
    DROP TABLE empresa;
    ALTER TABLE empresa_nova RENAME TO empresa;
    COMMIT;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

db.exec(`INSERT OR IGNORE INTO empresa (id) VALUES (1)`);

/** Acrescenta uma coluna a uma tabela ja existente, se ela ainda nao estiver la. */
function garantirColuna(tabela, coluna, definicao) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all();
  if (!colunas.some((c) => c.name === coluna)) {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
    return true;
  }
  return false;
}

// Contrato que existia antes de haver mais de uma empresa pertence a primeira
// delas — que e a unica que existia quando ele foi cadastrado.
if (garantirColuna('contratos', 'empresa_id', 'INTEGER NOT NULL DEFAULT 1')) {
  db.exec('UPDATE contratos SET empresa_id = 1 WHERE empresa_id IS NULL');
}

// O indice fica aqui embaixo, e nao junto das tabelas la em cima: num banco
// que ja existia, a coluna `empresa_id` so passa a existir na linha acima.
// Criar o indice antes disso derruba o sistema no arranque — para quem ja
// usava, e so para essa pessoa, que e justamente quem nao pode ficar sem.
db.exec('CREATE INDEX IF NOT EXISTS idx_contratos_empresa ON contratos (empresa_id)');

/**
 * Valores originais do contrato, antes de qualquer termo aditivo.
 * As colunas "vivas" (data_vencimento, valor, vigencia_meses) passam a ser
 * recalculadas a partir destas mais os aditivos registrados.
 */
const novasColunasOriginais = [
  garantirColuna('contratos', 'data_vencimento_original', 'TEXT'),
  garantirColuna('contratos', 'valor_original', 'REAL'),
  garantirColuna('contratos', 'vigencia_meses_original', 'INTEGER'),
].some(Boolean);

if (novasColunasOriginais) {
  db.exec(`
    UPDATE contratos
       SET data_vencimento_original = COALESCE(data_vencimento_original, data_vencimento),
           valor_original           = COALESCE(valor_original, valor),
           vigencia_meses_original  = COALESCE(vigencia_meses_original, vigencia_meses)
  `);
}

export function agora() {
  return new Date().toISOString();
}

/**
 * Avisado a cada escrita. Existe para o cofre (src/cofre.js) saber que ha algo
 * novo para guardar sem que este arquivo precise conhece-lo — db.js e o pedaco
 * mais baixo do sistema e nao deveria depender de nada acima dele.
 */
let aoEscrever = null;

export function avisarEscritas(fn) {
  aoEscrever = fn;
}

export function run(sql, ...params) {
  const info = db.prepare(sql).run(...params);
  aoEscrever?.();
  return { changes: Number(info.changes), id: Number(info.lastInsertRowid) };
}

export function get(sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

/**
 * Fecha o banco e solta o arquivo.
 *
 * Existe por causa dos testes: cada teste cria uma pasta temporaria, sobe o
 * servidor e apaga a pasta no fim. No Windows o arquivo aberto nao pode ser
 * apagado, entao sem fechar o banco a limpeza falha. Em producao o processo
 * simplesmente termina e o sistema operacional fecha tudo, mas fechar de
 * proposito tambem garante que o WAL seja incorporado ao arquivo principal.
 */
export function fecharBanco() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // banco ja pode estar fechado; nao ha o que salvar
  }
  try {
    db.close();
  } catch {
    // idem — fechar duas vezes nao e erro que interesse a ninguem
  }
}

export function registrarEvento(contratoId, tipo, descricao = '') {
  run(
    `INSERT INTO eventos (contrato_id, tipo, descricao, criado_em) VALUES (?, ?, ?, ?)`,
    contratoId,
    tipo,
    descricao,
    agora(),
  );
}
