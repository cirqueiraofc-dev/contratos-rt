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

CREATE INDEX IF NOT EXISTS idx_rts_contrato   ON rts (contrato_id);
CREATE INDEX IF NOT EXISTS idx_rts_status     ON rts (status);
CREATE INDEX IF NOT EXISTS idx_docs_contrato  ON documentos (contrato_id);
CREATE INDEX IF NOT EXISTS idx_eventos_contrato ON eventos (contrato_id);
`);

db.exec(`INSERT OR IGNORE INTO empresa (id) VALUES (1)`);

export function agora() {
  return new Date().toISOString();
}

export function run(sql, ...params) {
  const info = db.prepare(sql).run(...params);
  return { changes: Number(info.changes), id: Number(info.lastInsertRowid) };
}

export function get(sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
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
