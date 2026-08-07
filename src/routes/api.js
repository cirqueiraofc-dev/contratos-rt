import express from 'express';
import multer from 'multer';
import fs from 'node:fs';

import { agora, all, get, registrarEvento, run } from '../db.js';
import { gerarBackup, restaurarBackup } from '../backup.js';
import { DISCIPLINAS, IDS_DISCIPLINAS } from '../disciplinas.js';
import { analisarContrato } from '../extract/contrato.js';
import { analisarAditivo } from '../extract/aditivo.js';
import { analisarArt } from '../extract/art.js';
import { extrairTexto } from '../extract/pdfTexto.js';
import { gerarAtestado } from '../docs/atestado.js';
import { gerarRequerimentoCat } from '../docs/requerimentoCat.js';
import {
  descartarTemporario, efetivar, gravarGerado, guardarTemporario, lerArquivo, lerTemporario, remover,
} from '../arquivos.js';
import {
  STATUS_CONTRATO, STATUS_RT, empresaDoContrato, lerEmpresa, listarContratos, listarEmpresas,
  montarContrato, montarPainel, recalcularContrato,
} from '../servico.js';
import { formatarData, formatarMoeda, hojeISO, somarMeses } from '../texto.js';

export const api = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ehPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    cb(ehPdf ? null : new HttpError(400, 'Envie um arquivo PDF.'), ehPdf);
  },
});

// A restauracao recebe .zip, nao PDF, e o arquivo pode ser bem maior: 25 MB
// dao pouco mais de uma duzia de contratos com anexo.
const uploadBackup = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ehZip = file.mimetype === 'application/zip'
      || file.mimetype === 'application/x-zip-compressed'
      || /\.zip$/i.test(file.originalname);
    cb(ehZip ? null : new HttpError(400, 'Envie o arquivo .zip da cópia de segurança.'), ehZip);
  },
});

class HttpError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const rota = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function exigir(condicao, mensagem, status = 400) {
  if (!condicao) throw new HttpError(status, mensagem);
}

function textoOuVazio(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function numeroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function dataOuNulo(valor) {
  const texto = textoOuVazio(valor);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

async function enviarPdf(res, arquivo, nomeExibido, inline = true) {
  const bytes = await lerArquivo(arquivo);
  exigir(bytes, 'Arquivo não encontrado.', 404);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', bytes.length);
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${(nomeExibido || 'documento.pdf').replace(/"/g, '')}"`,
  );
  res.end(bytes);
}

/* ---------------------------------------------------------------- painel */

api.get('/painel', rota((req, res) => {
  res.json(montarPainel(req.query.empresa));
}));

api.get('/disciplinas', rota((_req, res) => {
  res.json(Object.values(DISCIPLINAS).map(({ id, nome, titulo, cor }) => ({ id, nome, titulo, cor })));
}));

/* ------------------------------------------------------------- cadastros */

/** Os campos que o formulario de empresa manda, ja limpos. */
function camposDaEmpresa(c = {}) {
  return [
    textoOuVazio(c.razao_social), textoOuVazio(c.cnpj), textoOuVazio(c.crea_empresa),
    textoOuVazio(c.endereco), textoOuVazio(c.cidade), textoOuVazio(c.uf).toUpperCase().slice(0, 2),
    textoOuVazio(c.telefone), textoOuVazio(c.email),
    Math.max(1, numeroOuNulo(c.dias_alerta_rt) ?? 60),
    Math.max(1, numeroOuNulo(c.dias_alerta_contrato) ?? 90),
  ];
}

api.get('/empresas', rota((_req, res) => {
  res.json(listarEmpresas());
}));

api.post('/empresas', rota((req, res) => {
  const c = req.body ?? {};
  exigir(textoOuVazio(c.razao_social), 'Informe a razão social da empresa.');
  const { id } = run(
    `INSERT INTO empresa (razao_social, cnpj, crea_empresa, endereco, cidade, uf,
                          telefone, email, dias_alerta_rt, dias_alerta_contrato)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...camposDaEmpresa(c),
  );
  res.status(201).json(lerEmpresa(id));
}));

api.put('/empresas/:id', rota((req, res) => {
  const id = Number(req.params.id);
  exigir(get('SELECT id FROM empresa WHERE id = ?', id), 'Empresa não encontrada.', 404);
  run(
    `UPDATE empresa SET razao_social = ?, cnpj = ?, crea_empresa = ?, endereco = ?, cidade = ?,
            uf = ?, telefone = ?, email = ?, dias_alerta_rt = ?, dias_alerta_contrato = ?
      WHERE id = ?`,
    ...camposDaEmpresa(req.body ?? {}), id,
  );
  res.json(lerEmpresa(id));
}));

api.delete('/empresas/:id', rota((req, res) => {
  const id = Number(req.params.id);
  exigir(get('SELECT id FROM empresa WHERE id = ?', id), 'Empresa não encontrada.', 404);

  // Apagar empresa com contrato levaria o contrato junto, e contrato de
  // terceiro nao se apaga por tabela. Quem quiser sair tem que esvaziar antes.
  const { total } = get('SELECT COUNT(*) AS total FROM contratos WHERE empresa_id = ?', id);
  exigir(!total, `Esta empresa tem ${total} contrato(s). Remova ou transfira os contratos antes de excluí-la.`);
  exigir(listarEmpresas().length > 1, 'O sistema precisa de pelo menos uma empresa cadastrada.');

  run('DELETE FROM empresa WHERE id = ?', id);
  res.json({ ok: true });
}));

api.get('/profissionais', rota((_req, res) => {
  res.json(all('SELECT * FROM profissionais ORDER BY nome').map((p) => ({
    ...p,
    disciplinas: p.disciplinas ? p.disciplinas.split(',') : [],
  })));
}));

api.post('/profissionais', rota((req, res) => {
  const p = req.body ?? {};
  exigir(textoOuVazio(p.nome), 'Informe o nome do profissional.');
  const disciplinas = (Array.isArray(p.disciplinas) ? p.disciplinas : [])
    .filter((d) => IDS_DISCIPLINAS.includes(d));
  const { id } = run(
    `INSERT INTO profissionais (nome, titulo, crea, rnp, disciplinas, ativo) VALUES (?, ?, ?, ?, ?, 1)`,
    textoOuVazio(p.nome), textoOuVazio(p.titulo), textoOuVazio(p.crea), textoOuVazio(p.rnp),
    disciplinas.join(','),
  );
  res.status(201).json(get('SELECT * FROM profissionais WHERE id = ?', id));
}));

api.delete('/profissionais/:id', rota((req, res) => {
  run('DELETE FROM profissionais WHERE id = ?', Number(req.params.id));
  res.status(204).end();
}));

/* ------------------------------------------------- contratos: leitura PDF */

api.post('/contratos/analisar', upload.single('arquivo'), rota(async (req, res) => {
  exigir(req.file, 'Selecione o PDF do contrato.');
  const { texto, paginas, temTexto } = await extrairTexto(req.file.buffer);
  exigir(
    temTexto,
    'Não foi possível ler texto deste PDF. Provavelmente é um documento digitalizado (imagem). '
    + 'Passe um OCR no arquivo ou cadastre o contrato manualmente.',
  );

  const extraidos = analisarContrato(texto);
  const token = guardarTemporario(req.file.buffer, req.file.originalname, { texto });

  res.json({ token, paginas, extraidos });
}));

api.post('/contratos', rota(async (req, res) => {
  const c = req.body ?? {};
  exigir(textoOuVazio(c.numero), 'Informe o número do contrato.');

  const disciplinas = (Array.isArray(c.disciplinas) ? c.disciplinas : [])
    .filter((d) => IDS_DISCIPLINAS.includes(d));

  let arquivo = null;
  let arquivoNome = null;
  let texto = null;
  if (c.token) {
    const tmp = lerTemporario(c.token);
    exigir(tmp, 'O arquivo enviado expirou. Faça o upload novamente.');
    texto = tmp.texto ?? null;
    const efetivado = await efetivar(c.token, 'contrato');
    arquivo = efetivado?.arquivo ?? null;
    arquivoNome = efetivado?.arquivo_nome ?? null;
  }

  const agoraIso = agora();
  const valor = numeroOuNulo(c.valor);
  const vencimento = dataOuNulo(c.data_vencimento);
  const vigencia = numeroOuNulo(c.vigencia_meses);
  // O contrato nasce dentro da empresa que esta aberta na tela; sem isso ele
  // cairia sempre na primeira e sumiria da lista de quem acabou de cadastrar.
  const dono = lerEmpresa(c.empresa_id);
  const { id } = run(
    `INSERT INTO contratos (empresa_id, numero, contratante, contratante_cnpj, objeto, valor, data_assinatura,
                            data_vencimento, vigencia_meses, status, observacoes, arquivo, arquivo_nome,
                            texto, valor_original, data_vencimento_original, vigencia_meses_original,
                            criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    dono.id,
    textoOuVazio(c.numero), textoOuVazio(c.contratante), textoOuVazio(c.contratante_cnpj),
    textoOuVazio(c.objeto), valor, dataOuNulo(c.data_assinatura),
    vencimento, vigencia, textoOuVazio(c.observacoes),
    arquivo, arquivoNome, texto, valor, vencimento, vigencia, agoraIso, agoraIso,
  );

  for (const disciplina of disciplinas) {
    run(
      `INSERT INTO rts (contrato_id, disciplina, status, motivo, origem, criado_em, atualizado_em)
       VALUES (?, ?, 'pendente', ?, ?, ?, ?)`,
      id, disciplina, textoOuVazio(c.motivos?.[disciplina]),
      c.token ? 'automatica' : 'manual', agoraIso, agoraIso,
    );
  }

  registrarEvento(id, 'contrato_cadastrado',
    `Contrato ${textoOuVazio(c.numero)} cadastrado com ${disciplinas.length} RT(s) pendente(s).`);

  res.status(201).json(montarContrato(id));
}));

api.post('/contratos/descartar', rota((req, res) => {
  if (req.body?.token) descartarTemporario(req.body.token);
  res.status(204).end();
}));

/* ----------------------------------------------------- contratos: gestao */

api.get('/contratos', rota((req, res) => {
  res.json(listarContratos({
    status: textoOuVazio(req.query.status),
    busca: textoOuVazio(req.query.q),
    empresaId: req.query.empresa,
  }));
}));

api.get('/contratos/:id', rota((req, res) => {
  const contrato = montarContrato(Number(req.params.id));
  exigir(contrato, 'Contrato não encontrado.', 404);
  res.json(contrato);
}));

api.put('/contratos/:id', rota((req, res) => {
  const id = Number(req.params.id);
  const atual = get('SELECT * FROM contratos WHERE id = ?', id);
  exigir(atual, 'Contrato não encontrado.', 404);
  const c = req.body ?? {};
  exigir(textoOuVazio(c.numero ?? atual.numero), 'Informe o número do contrato.');

  // a edicao altera o contrato original; vencimento, valor e vigencia atuais
  // sao recalculados na sequencia somando os termos aditivos existentes
  run(
    `UPDATE contratos SET numero = ?, contratante = ?, contratante_cnpj = ?, objeto = ?,
            data_assinatura = ?, observacoes = ?,
            valor_original = ?, data_vencimento_original = ?, vigencia_meses_original = ?,
            atualizado_em = ?
      WHERE id = ?`,
    textoOuVazio(c.numero ?? atual.numero), textoOuVazio(c.contratante), textoOuVazio(c.contratante_cnpj),
    textoOuVazio(c.objeto), dataOuNulo(c.data_assinatura), textoOuVazio(c.observacoes),
    numeroOuNulo(c.valor), dataOuNulo(c.data_vencimento), numeroOuNulo(c.vigencia_meses),
    agora(), id,
  );
  recalcularContrato(id);
  res.json(montarContrato(id));
}));

api.delete('/contratos/:id', rota(async (req, res) => {
  const id = Number(req.params.id);
  const contrato = get('SELECT * FROM contratos WHERE id = ?', id);
  exigir(contrato, 'Contrato não encontrado.', 404);
  for (const arquivo of [
    contrato.arquivo,
    ...all('SELECT arquivo FROM rts WHERE contrato_id = ?', id).map((r) => r.arquivo),
    ...all('SELECT arquivo FROM aditivos WHERE contrato_id = ?', id).map((a) => a.arquivo),
    ...all('SELECT arquivo FROM documentos WHERE contrato_id = ?', id).map((d) => d.arquivo),
  ]) {
    if (arquivo) await remover(arquivo);
  }
  run('DELETE FROM contratos WHERE id = ?', id);
  res.status(204).end();
}));

api.post('/contratos/:id/status', rota((req, res) => {
  const id = Number(req.params.id);
  const contrato = get('SELECT * FROM contratos WHERE id = ?', id);
  exigir(contrato, 'Contrato não encontrado.', 404);
  const status = textoOuVazio(req.body?.status);
  exigir(STATUS_CONTRATO.includes(status), 'Situação inválida.');

  const dataConclusao = status === 'concluido'
    ? (dataOuNulo(req.body?.data_conclusao) ?? hojeISO())
    : null;

  run(
    'UPDATE contratos SET status = ?, data_conclusao = ?, atualizado_em = ? WHERE id = ?',
    status, dataConclusao, agora(), id,
  );

  if (status === 'concluido') {
    // ARTs emitidas passam a "baixada": o contrato acabou, cabe dar baixa no conselho
    run(
      `UPDATE rts SET status = 'baixada', atualizado_em = ? WHERE contrato_id = ? AND status = 'emitida'`,
      agora(), id,
    );
    registrarEvento(id, 'contrato_concluido', `Contrato concluído em ${formatarData(dataConclusao)}.`);
  } else {
    registrarEvento(id, 'contrato_status', `Situação alterada para ${status}.`);
  }

  res.json(montarContrato(id));
}));

api.get('/contratos/:id/arquivo', rota(async (req, res) => {
  const contrato = get('SELECT arquivo, arquivo_nome, numero FROM contratos WHERE id = ?', Number(req.params.id));
  exigir(contrato?.arquivo, 'Este contrato não tem PDF anexado.', 404);
  await enviarPdf(res, contrato.arquivo, contrato.arquivo_nome || `contrato-${contrato.numero}.pdf`);
}));

api.get('/contratos/:id/eventos', rota((req, res) => {
  res.json(all('SELECT * FROM eventos WHERE contrato_id = ? ORDER BY criado_em DESC LIMIT 100', Number(req.params.id)));
}));

/* ---------------------------------------------------------------- aditivos */

api.post('/contratos/:id/aditivos/analisar', upload.single('arquivo'), rota(async (req, res) => {
  const contrato = get('SELECT * FROM contratos WHERE id = ?', Number(req.params.id));
  exigir(contrato, 'Contrato não encontrado.', 404);
  exigir(req.file, 'Selecione o PDF do termo aditivo.');

  const { texto, temTexto } = await extrairTexto(req.file.buffer);
  exigir(
    temTexto,
    'Não foi possível ler texto deste PDF. Provavelmente é um documento digitalizado (imagem). '
    + 'Passe um OCR no arquivo ou registre o aditivo manualmente.',
  );

  const extraidos = analisarAditivo(texto, contrato);
  const proximaOrdem = all('SELECT COUNT(*) AS total FROM aditivos WHERE contrato_id = ?', contrato.id)[0].total + 1;
  if (!extraidos.numero) extraidos.numero = `${proximaOrdem}º Termo Aditivo`;

  const token = guardarTemporario(req.file.buffer, req.file.originalname, { texto });
  res.json({ token, extraidos });
}));

api.post('/contratos/:id/aditivos', rota(async (req, res) => {
  const contratoId = Number(req.params.id);
  const contrato = get('SELECT * FROM contratos WHERE id = ?', contratoId);
  exigir(contrato, 'Contrato não encontrado.', 404);

  const c = req.body ?? {};
  const novaData = dataOuNulo(c.nova_data_vencimento);
  const valorAcrescido = numeroOuNulo(c.valor_acrescido);
  exigir(
    novaData || valorAcrescido !== null || textoOuVazio(c.objeto),
    'Informe ao menos a nova data de vencimento, o valor acrescido ou o objeto do aditivo.',
  );

  let arquivo = null;
  let arquivoNome = null;
  let texto = null;
  if (c.token) {
    const tmp = lerTemporario(c.token);
    exigir(tmp, 'O arquivo enviado expirou. Faça o upload novamente.');
    texto = tmp.texto ?? null;
    const efetivado = await efetivar(c.token, `aditivo-${contrato.numero.replace(/\W+/g, '-')}`);
    arquivo = efetivado?.arquivo ?? null;
    arquivoNome = efetivado?.arquivo_nome ?? null;
  }

  const agoraIso = agora();
  const { id } = run(
    `INSERT INTO aditivos (contrato_id, numero, tipo, data_assinatura, prazo_meses,
                           nova_data_vencimento, valor_acrescido, objeto, observacoes,
                           arquivo, arquivo_nome, texto, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    contratoId, textoOuVazio(c.numero) || 'Termo Aditivo', textoOuVazio(c.tipo) || 'prazo',
    dataOuNulo(c.data_assinatura), numeroOuNulo(c.prazo_meses), novaData, valorAcrescido,
    textoOuVazio(c.objeto), textoOuVazio(c.observacoes), arquivo, arquivoNome, texto,
    agoraIso, agoraIso,
  );

  // modalidades novas trazidas pelo aditivo entram como pendentes
  const novasDisciplinas = (Array.isArray(c.disciplinas) ? c.disciplinas : [])
    .filter((d) => IDS_DISCIPLINAS.includes(d))
    .filter((d) => !get('SELECT id FROM rts WHERE contrato_id = ? AND disciplina = ?', contratoId, d));

  for (const disciplina of novasDisciplinas) {
    run(
      `INSERT INTO rts (contrato_id, disciplina, status, motivo, origem, criado_em, atualizado_em)
       VALUES (?, ?, 'pendente', ?, 'automatica', ?, ?)`,
      contratoId, disciplina, `acrescentada pelo ${textoOuVazio(c.numero) || 'termo aditivo'}`,
      agoraIso, agoraIso,
    );
  }

  const atualizado = recalcularContrato(contratoId);

  registrarEvento(contratoId, 'aditivo_registrado',
    `${textoOuVazio(c.numero) || 'Termo aditivo'} registrado`
    + `${novaData ? ` — vigência até ${formatarData(novaData)}` : ''}`
    + `${valorAcrescido ? ` — valor ${valorAcrescido > 0 ? 'acrescido' : 'suprimido'} de ${formatarMoeda(Math.abs(valorAcrescido))}` : ''}`
    + `${novasDisciplinas.length ? ` — ${novasDisciplinas.length} nova(s) RT pendente(s)` : ''}.`);

  // se a prorrogacao trouxe o contrato de volta para dentro do prazo, ele volta a ativo
  if (atualizado?.status === 'concluido' && novaData && novaData >= hojeISO()) {
    run(`UPDATE contratos SET status = 'ativo', data_conclusao = NULL, atualizado_em = ? WHERE id = ?`, agoraIso, contratoId);
    registrarEvento(contratoId, 'contrato_reaberto', 'Contrato reaberto pela prorrogação do termo aditivo.');
  }

  res.status(201).json({ ...montarContrato(contratoId), aditivo_id: id });
}));

api.delete('/aditivos/:id', rota(async (req, res) => {
  const aditivo = get('SELECT * FROM aditivos WHERE id = ?', Number(req.params.id));
  exigir(aditivo, 'Termo aditivo não encontrado.', 404);
  if (aditivo.arquivo) await remover(aditivo.arquivo);
  run('DELETE FROM aditivos WHERE id = ?', aditivo.id);
  recalcularContrato(aditivo.contrato_id);
  registrarEvento(aditivo.contrato_id, 'aditivo_removido', `${aditivo.numero} removido.`);
  res.json(montarContrato(aditivo.contrato_id));
}));

api.get('/aditivos/:id/arquivo', rota(async (req, res) => {
  const aditivo = get('SELECT arquivo, arquivo_nome, numero FROM aditivos WHERE id = ?', Number(req.params.id));
  exigir(aditivo?.arquivo, 'Este termo aditivo não tem PDF anexado.', 404);
  await enviarPdf(res, aditivo.arquivo, aditivo.arquivo_nome || `${aditivo.numero}.pdf`);
}));

/* -------------------------------------------------------------------- RTs */

api.post('/contratos/:id/rts', rota((req, res) => {
  const contratoId = Number(req.params.id);
  exigir(get('SELECT id FROM contratos WHERE id = ?', contratoId), 'Contrato não encontrado.', 404);
  const disciplina = textoOuVazio(req.body?.disciplina);
  exigir(IDS_DISCIPLINAS.includes(disciplina), 'Modalidade de RT inválida.');
  exigir(
    !get('SELECT id FROM rts WHERE contrato_id = ? AND disciplina = ?', contratoId, disciplina),
    'Este contrato já tem uma RT desta modalidade.',
  );
  const agoraIso = agora();
  run(
    `INSERT INTO rts (contrato_id, disciplina, status, origem, criado_em, atualizado_em)
     VALUES (?, ?, 'pendente', 'manual', ?, ?)`,
    contratoId, disciplina, agoraIso, agoraIso,
  );
  registrarEvento(contratoId, 'rt_adicionada', `RT de ${DISCIPLINAS[disciplina].nome} adicionada manualmente.`);
  res.status(201).json(montarContrato(contratoId));
}));

api.put('/rts/:id', rota((req, res) => {
  const id = Number(req.params.id);
  const rt = get('SELECT * FROM rts WHERE id = ?', id);
  exigir(rt, 'RT não encontrada.', 404);
  const c = req.body ?? {};
  const status = textoOuVazio(c.status) || rt.status;
  exigir(STATUS_RT.includes(status), 'Situação de RT inválida.');

  run(
    `UPDATE rts SET status = ?, numero_art = ?, profissional = ?, titulo = ?, crea = ?, rnp = ?,
            data_registro = ?, data_inicio = ?, data_validade = ?, valor = ?, observacoes = ?, atualizado_em = ?
      WHERE id = ?`,
    status, textoOuVazio(c.numero_art) || null, textoOuVazio(c.profissional) || null,
    textoOuVazio(c.titulo) || null, textoOuVazio(c.crea) || null, textoOuVazio(c.rnp) || null,
    dataOuNulo(c.data_registro), dataOuNulo(c.data_inicio), dataOuNulo(c.data_validade),
    numeroOuNulo(c.valor), textoOuVazio(c.observacoes), agora(), id,
  );
  res.json(montarContrato(rt.contrato_id));
}));

api.delete('/rts/:id', rota(async (req, res) => {
  const rt = get('SELECT * FROM rts WHERE id = ?', Number(req.params.id));
  exigir(rt, 'RT não encontrada.', 404);
  if (rt.arquivo) await remover(rt.arquivo);
  run('DELETE FROM rts WHERE id = ?', rt.id);
  res.json(montarContrato(rt.contrato_id));
}));

api.post('/rts/:id/analisar-art', upload.single('arquivo'), rota(async (req, res) => {
  const rt = get('SELECT * FROM rts WHERE id = ?', Number(req.params.id));
  exigir(rt, 'RT não encontrada.', 404);
  exigir(req.file, 'Selecione o PDF da ART.');

  const { texto, temTexto } = await extrairTexto(req.file.buffer);
  const extraidos = temTexto
    ? analisarArt(texto)
    : { avisos: ['Não foi possível ler texto do PDF (documento digitalizado). Preencha os campos manualmente.'] };

  if (temTexto && extraidos.disciplina_provavel && extraidos.disciplina_provavel !== rt.disciplina) {
    extraidos.avisos.push(
      `O conteúdo da ART parece ser de ${DISCIPLINAS[extraidos.disciplina_provavel].nome}, `
      + `mas ela está sendo anexada à RT de ${DISCIPLINAS[rt.disciplina].nome}. Confirme antes de salvar.`,
    );
  }

  const token = guardarTemporario(req.file.buffer, req.file.originalname);
  res.json({ token, extraidos });
}));

api.post('/rts/:id/art', rota(async (req, res) => {
  const rt = get('SELECT * FROM rts WHERE id = ?', Number(req.params.id));
  exigir(rt, 'RT não encontrada.', 404);
  const c = req.body ?? {};
  exigir(textoOuVazio(c.numero_art), 'Informe o número da ART.');

  let arquivo = rt.arquivo;
  let arquivoNome = rt.arquivo_nome;
  if (c.token) {
    const efetivado = await efetivar(c.token, `art-${rt.disciplina}`);
    exigir(efetivado, 'O arquivo enviado expirou. Faça o upload novamente.');
    if (rt.arquivo) await remover(rt.arquivo);
    arquivo = efetivado.arquivo;
    arquivoNome = efetivado.arquivo_nome;
  }

  run(
    `UPDATE rts SET status = 'emitida', numero_art = ?, profissional = ?, titulo = ?, crea = ?, rnp = ?,
            data_registro = ?, data_inicio = ?, data_validade = ?, valor = ?, observacoes = ?,
            arquivo = ?, arquivo_nome = ?, atualizado_em = ?
      WHERE id = ?`,
    textoOuVazio(c.numero_art), textoOuVazio(c.profissional) || null, textoOuVazio(c.titulo) || null,
    textoOuVazio(c.crea) || null, textoOuVazio(c.rnp) || null, dataOuNulo(c.data_registro),
    dataOuNulo(c.data_inicio), dataOuNulo(c.data_validade), numeroOuNulo(c.valor),
    textoOuVazio(c.observacoes), arquivo, arquivoNome, agora(), rt.id,
  );

  registrarEvento(rt.contrato_id, 'art_registrada',
    `ART ${textoOuVazio(c.numero_art)} registrada para a RT de ${DISCIPLINAS[rt.disciplina].nome}.`);

  res.json(montarContrato(rt.contrato_id));
}));

api.get('/rts/:id/arquivo', rota(async (req, res) => {
  const rt = get('SELECT arquivo, arquivo_nome, numero_art FROM rts WHERE id = ?', Number(req.params.id));
  exigir(rt?.arquivo, 'Esta RT não tem PDF de ART anexado.', 404);
  await enviarPdf(res, rt.arquivo, rt.arquivo_nome || `art-${rt.numero_art}.pdf`);
}));

/* -------------------------------------------------------------- CAT / docs */

api.post('/contratos/:id/cat', rota(async (req, res) => {
  const id = Number(req.params.id);
  const contrato = get('SELECT * FROM contratos WHERE id = ?', id);
  exigir(contrato, 'Contrato não encontrado.', 404);
  exigir(contrato.status === 'concluido', 'Conclua o contrato antes de gerar a CAT.');

  const empresa = empresaDoContrato(id);
  const rts = all('SELECT * FROM rts WHERE contrato_id = ? ORDER BY disciplina', id);
  const comArt = rts.filter((rt) => rt.numero_art && rt.status !== 'dispensada');
  exigir(comArt.length, 'Nenhuma ART registrada neste contrato — registre as ARTs antes de gerar a CAT.');

  // regerar substitui os documentos anteriores para nao acumular versoes soltas
  for (const antigo of all(`SELECT * FROM documentos WHERE contrato_id = ? AND tipo IN ('atestado', 'requerimento_cat')`, id)) {
    await remover(antigo.arquivo);
    run('DELETE FROM documentos WHERE id = ?', antigo.id);
  }

  const criadoEm = agora();
  const gerados = [];
  const aditivos = all(
    `SELECT * FROM aditivos WHERE contrato_id = ? ORDER BY COALESCE(data_assinatura, '9999'), id`,
    id,
  );

  const atestado = await gerarAtestado({
    contrato, rts: comArt.map((rt) => ({ ...rt, status: 'emitida' })), empresa, aditivos,
  });
  const arquivoAtestado = await gravarGerado(atestado, `atestado-${contrato.numero.replace(/\W+/g, '-')}`);
  const nomeAtestado = `Atestado de Capacidade Tecnica - Contrato ${contrato.numero.replace(/\W+/g, '-')}.pdf`;
  const { id: idAtestado } = run(
    `INSERT INTO documentos (contrato_id, tipo, titulo, arquivo, arquivo_nome, dados, criado_em)
     VALUES (?, 'atestado', ?, ?, ?, ?, ?)`,
    id, `Atestado de Capacidade Técnica — Contrato ${contrato.numero}`,
    arquivoAtestado, nomeAtestado, JSON.stringify({ rts: comArt.map((rt) => rt.id) }), criadoEm,
  );
  gerados.push(idAtestado);

  for (const rt of comArt) {
    const bytes = await gerarRequerimentoCat({ contrato, rt, empresa, aditivos });
    const arquivo = await gravarGerado(bytes, `requerimento-cat-${rt.disciplina}`);
    const nome = `Requerimento CAT - ${DISCIPLINAS[rt.disciplina].nome} - Contrato ${contrato.numero.replace(/\W+/g, '-')}.pdf`;
    const { id: idDoc } = run(
      `INSERT INTO documentos (contrato_id, tipo, titulo, arquivo, arquivo_nome, dados, criado_em)
       VALUES (?, 'requerimento_cat', ?, ?, ?, ?, ?)`,
      id, `Requerimento de CAT — ${DISCIPLINAS[rt.disciplina].nome} — ART ${rt.numero_art}`,
      arquivo, nome, JSON.stringify({ rt: rt.id, disciplina: rt.disciplina }), criadoEm,
    );
    gerados.push(idDoc);
  }

  registrarEvento(id, 'cat_gerada',
    `Atestado e ${comArt.length} requerimento(s) de CAT gerados.`);

  res.status(201).json(montarContrato(id));
}));

api.get('/documentos/:id/arquivo', rota(async (req, res) => {
  const doc = get('SELECT * FROM documentos WHERE id = ?', Number(req.params.id));
  exigir(doc, 'Documento não encontrado.', 404);
  await enviarPdf(res, doc.arquivo, doc.arquivo_nome, req.query.download !== '1');
}));

api.delete('/documentos/:id', rota(async (req, res) => {
  const doc = get('SELECT * FROM documentos WHERE id = ?', Number(req.params.id));
  exigir(doc, 'Documento não encontrado.', 404);
  await remover(doc.arquivo);
  run('DELETE FROM documentos WHERE id = ?', doc.id);
  res.status(204).end();
}));

/* ---------------------------------------------------------------- backup */

/**
 * Baixa tudo — banco e PDFs — num unico .zip.
 *
 * Enquanto a hospedagem for a gratuita, sem disco persistente, este e o unico
 * jeito de os dados sobreviverem a uma atualizacao do sistema. Nao ha nada de
 * secreto no arquivo alem dos proprios contratos, e a rota ja esta atras da
 * senha como todo o resto da API.
 */
api.get('/backup', rota(async (_req, res) => {
  const { nome, zip } = await gerarBackup();
  res.setHeader('Content-Type', 'application/zip');
  // o nome vai entre aspas porque tem hifen e dois-pontos
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.setHeader('Content-Length', zip.length);
  res.end(zip);
}));

/**
 * Devolve os dados de uma copia para dentro do sistema.
 *
 * APAGA tudo o que estiver cadastrado e poe o conteudo do arquivo no lugar —
 * e por isso que a tela pede confirmacao por escrito antes de chamar aqui.
 * A troca acontece dentro de uma transacao: se algo der errado no meio, o
 * sistema fica exatamente como estava.
 */
api.post('/restaurar', uploadBackup.single('arquivo'), rota(async (req, res) => {
  exigir(req.file, 'Selecione o arquivo .zip da cópia de segurança.');
  const resultado = await restaurarBackup(req.file.buffer);
  registrarEvento(null, 'backup_restaurado', `${resultado.contratos} contrato(s) e ${resultado.pdfs} arquivo(s).`);
  res.json(resultado);
}));

/* ------------------------------------------------------------ utilidades */

api.post('/utilidades/vencimento', rota((req, res) => {
  const inicio = dataOuNulo(req.body?.data_assinatura);
  const meses = numeroOuNulo(req.body?.vigencia_meses);
  res.json({ data_vencimento: inicio && meses ? somarMeses(inicio, meses) : null });
}));

api.use((erro, _req, res, _next) => {
  if (erro instanceof multer.MulterError) {
    const mensagem = erro.code === 'LIMIT_FILE_SIZE'
      ? 'O arquivo passa de 25 MB.'
      : 'Falha no envio do arquivo.';
    return res.status(400).json({ erro: mensagem });
  }
  const status = erro.status ?? 500;
  if (status >= 500) console.error(erro);
  return res.status(status).json({ erro: erro.message || 'Erro inesperado no servidor.' });
});
