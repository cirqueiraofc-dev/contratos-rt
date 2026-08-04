/**
 * Gera o ATESTADO DE CAPACIDADE TECNICA — o documento que a contratante
 * (secretaria/orgao) assina e que depois instrui o pedido de CAT no CREA.
 *
 * O conteudo segue os elementos exigidos pelo art. 57 da Resolucao
 * CONFEA no 1.025/2009: identificacao das partes, contrato, periodo de
 * execucao, descricao dos servicos e profissionais com suas ARTs.
 */
import { novoDocumento } from './layout.js';
import { DISCIPLINAS } from '../disciplinas.js';
import { dataPorExtenso, formatarData, formatarMoeda, hojeISO, porExtenso } from '../texto.js';

function periodoTexto(contrato) {
  const ini = formatarData(contrato.data_assinatura);
  const fim = formatarData(contrato.data_conclusao || contrato.data_vencimento);
  if (ini && fim) return `${ini} a ${fim}`;
  return ini || fim || '—';
}

function prazoTexto(contrato) {
  if (!contrato.vigencia_meses) return '';
  const n = Number(contrato.vigencia_meses);
  return `${n} (${porExtenso(n)}) ${n === 1 ? 'mês' : 'meses'}`;
}

const ROTULO_TIPO_ADITIVO = {
  prazo: 'Prorrogação de prazo',
  valor: 'Alteração de valor',
  prazo_valor: 'Prazo e valor',
  escopo: 'Alteração de escopo',
};

/**
 * @param {{ contrato: object, rts: object[], empresa: object, aditivos?: object[] }} dados
 * @returns {Promise<Uint8Array>}
 */
export async function gerarAtestado({ contrato, rts, empresa, aditivos = [] }) {
  const doc = await novoDocumento({
    rodape: `Atestado de Capacidade Técnica — Contrato nº ${contrato.numero} — ${empresa.razao_social || 'contratada'}`,
  });

  const emitidas = rts.filter((rt) => rt.status === 'emitida');
  const cidadeUf = [empresa.cidade, empresa.uf].filter(Boolean).join('/');

  doc.escrever('(Emitir preferencialmente em papel timbrado do órgão contratante)', {
    tamanho: 8.5, cor: undefined, alinhamento: 'centro', fonte: doc.italico,
  });
  doc.espaco(14);
  doc.titulo('ATESTADO DE CAPACIDADE TÉCNICA');
  doc.subtitulo(`Contrato nº ${contrato.numero}`);
  doc.espaco(10);

  const identificacaoEmpresa = [
    empresa.razao_social || '[RAZÃO SOCIAL DA CONTRATADA]',
    empresa.cnpj ? `inscrita no CNPJ sob o nº ${empresa.cnpj}` : 'inscrita no CNPJ sob o nº [CNPJ]',
    empresa.crea_empresa ? `registrada no ${empresa.crea_empresa}` : null,
    empresa.endereco ? `com sede em ${[empresa.endereco, cidadeUf].filter(Boolean).join(', ')}` : null,
  ].filter(Boolean).join(', ');

  doc.paragrafo(
    `Atestamos, para os devidos fins de comprovação de capacidade técnica, que a empresa ${identificacaoEmpresa}, `
    + `executou para ${contrato.contratante || '[ÓRGÃO CONTRATANTE]'}`
    + `${contrato.contratante_cnpj ? `, CNPJ nº ${contrato.contratante_cnpj},` : ','}`
    + ` os serviços objeto do Contrato nº ${contrato.numero}, `
    + `${contrato.data_assinatura ? `firmado em ${formatarData(contrato.data_assinatura)}` : 'firmado entre as partes'}`
    + `${prazoTexto(contrato) ? `, com prazo de vigência de ${prazoTexto(contrato)}` : ''}, `
    + 'conforme discriminado a seguir.',
  );

  doc.secao('1. Identificação das partes');
  doc.campos([
    ['Contratante', contrato.contratante || '[ÓRGÃO CONTRATANTE]'],
    ['CNPJ do contratante', contrato.contratante_cnpj || '—'],
    ['Contratada', empresa.razao_social || '[RAZÃO SOCIAL DA CONTRATADA]'],
    ['CNPJ da contratada', empresa.cnpj || '—'],
    ['Registro da contratada', empresa.crea_empresa || '—'],
  ]);

  doc.secao('2. Dados do contrato');
  doc.campos([
    ['Número do contrato', contrato.numero],
    ['Data de assinatura', formatarData(contrato.data_assinatura) || '—'],
    ['Vigência', `${periodoTexto(contrato)}${prazoTexto(contrato) ? ` (${prazoTexto(contrato)})` : ''}`],
    ['Valor contratual', formatarMoeda(contrato.valor) || '—'],
    ['Data de conclusão dos serviços', formatarData(contrato.data_conclusao) || '—'],
  ]);

  if (aditivos.length) {
    doc.secao('3. Termos aditivos');
    doc.tabela({
      colunas: [
        { titulo: 'Termo', largura: 24 },
        { titulo: 'Assinatura', largura: 16 },
        { titulo: 'Alteração', largura: 24 },
        { titulo: 'Efeito', largura: 36 },
      ],
      linhas: aditivos.map((a) => [
        a.numero || 'Termo aditivo',
        formatarData(a.data_assinatura) || '—',
        ROTULO_TIPO_ADITIVO[a.tipo] ?? a.tipo,
        [
          a.nova_data_vencimento ? `vigência até ${formatarData(a.nova_data_vencimento)}` : '',
          a.valor_acrescido
            ? `${a.valor_acrescido > 0 ? 'acréscimo' : 'supressão'} de ${formatarMoeda(Math.abs(a.valor_acrescido))}`
            : '',
        ].filter(Boolean).join('; ') || (a.objeto ? a.objeto.slice(0, 90) : '—'),
      ]),
    });
  }

  doc.secao(`${aditivos.length ? 4 : 3}. Objeto e serviços executados`);
  doc.paragrafo(contrato.objeto || '[Descrever o objeto contratual e os serviços efetivamente executados]');

  if (emitidas.length) {
    doc.paragrafo('Os serviços abrangeram as seguintes modalidades técnicas:');
    doc.tabela({
      colunas: [
        { titulo: 'Modalidade', largura: 22 },
        { titulo: 'Descrição dos serviços', largura: 78 },
      ],
      linhas: emitidas.map((rt) => [
        DISCIPLINAS[rt.disciplina]?.nome ?? rt.disciplina,
        rt.observacoes || '[Descrever os serviços e quantitativos executados nesta modalidade]',
      ]),
    });
  }

  doc.secao(`${aditivos.length ? 5 : 4}. Responsáveis técnicos e ARTs`);
  if (emitidas.length) {
    doc.tabela({
      colunas: [
        { titulo: 'Modalidade', largura: 17 },
        { titulo: 'Profissional', largura: 27 },
        { titulo: 'Registro / CREA', largura: 20 },
        { titulo: 'Nº da ART', largura: 20 },
        { titulo: 'Período', largura: 16 },
      ],
      linhas: emitidas.map((rt) => [
        DISCIPLINAS[rt.disciplina]?.nome ?? rt.disciplina,
        rt.profissional || '—',
        [rt.crea, rt.rnp ? `RNP ${rt.rnp}` : ''].filter(Boolean).join(' · ') || '—',
        rt.numero_art || '—',
        [formatarData(rt.data_inicio), formatarData(rt.data_validade)].filter(Boolean).join(' a ') || '—',
      ]),
    });
  } else {
    doc.paragrafo('[Nenhuma ART registrada no sistema para este contrato — informe os profissionais e as ARTs correspondentes.]');
  }

  doc.secao(`${aditivos.length ? 6 : 5}. Avaliação da execução`);
  doc.paragrafo(
    'Declaramos que os serviços foram executados dentro dos prazos e das especificações contratuais, '
    + 'nada constando que desabone a conduta técnica e comercial da empresa contratada, '
    + 'estando esta apta ao recebimento do presente atestado.',
  );
  doc.paragrafo('Conceito atribuído à execução:');
  doc.checklist(['Ótimo', 'Bom', 'Regular', 'Insatisfatório']);

  doc.espaco(10);
  doc.escrever(
    `${cidadeUf || '____________________'}, ${dataPorExtenso(hojeISO())}.`,
    { alinhamento: 'direita' },
  );

  doc.assinatura({
    nome: '[NOME DO REPRESENTANTE LEGAL DO CONTRATANTE]',
    linhas: ['Cargo / Matrícula', contrato.contratante || '[ÓRGÃO CONTRATANTE]'],
  });

  doc.nota(
    'Documento gerado automaticamente como modelo a partir dos dados cadastrados no sistema. '
    + 'Antes do envio, confira todos os campos entre colchetes, complete a descrição dos serviços e os quantitativos executados '
    + 'e colha a assinatura do representante legal do contratante. Nos termos do art. 57 da Resolução nº 1.025/2009 do CONFEA, '
    + 'o atestado deve identificar o contratante e a contratada, o contrato, o período de execução, a descrição dos serviços '
    + 'e os profissionais responsáveis com as respectivas ARTs.',
  );

  return doc.finalizar();
}
