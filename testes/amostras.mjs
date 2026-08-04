/**
 * PDFs de exemplo (contrato e ART) usados pelos testes.
 *
 * As datas sao calculadas a partir de hoje para que o contrato de exemplo
 * esteja sempre dentro da vigencia — assim o teste nao "vence" com o tempo.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const iso = (ano, mes, dia) => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
const br = (texto) => texto.split('-').reverse().join('/');

async function montarPdf(linhas) {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  let pagina = doc.addPage([595, 842]);
  let y = 790;

  const escrever = (texto) => {
    if (y < 60) {
      pagina = doc.addPage([595, 842]);
      y = 790;
    }
    pagina.drawText(texto, { x: 50, y, size: 10, font: fonte });
    y -= 14;
  };

  for (const linha of linhas) {
    let atual = '';
    for (const palavra of linha.split(' ')) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, 10) > 495) {
        escrever(atual);
        atual = palavra;
      } else atual = tentativa;
    }
    escrever(atual);
  }

  return Buffer.from(await doc.save());
}

/**
 * Datas do contrato de exemplo: assinado no dia 15 de dois meses atras,
 * com vigencia de 12 meses (vence no dia 14, doze meses depois).
 */
export function datasExemplo(referencia = new Date()) {
  const base = new Date(Date.UTC(referencia.getUTCFullYear(), referencia.getUTCMonth() - 2, 15));
  const ano = base.getUTCFullYear();
  const mes = base.getUTCMonth() + 1;

  const assinatura = iso(ano, mes, 15);
  const vencimento = iso(ano + 1, mes, 14);
  const inicioArt = iso(ano, mes, 20);
  const registroArt = iso(ano, mes, 19);

  // 1o termo aditivo: assinado pouco antes do vencimento, prorroga por mais 12 meses
  const assinaturaAditivo = iso(ano + 1, mes, 1);
  const vencimentoProrrogado = iso(ano + 2, mes, 14);

  return {
    assinatura,
    vencimento,
    inicioArt,
    registroArt,
    assinaturaAditivo,
    vencimentoProrrogado,
    assinaturaExtenso: `15 de ${MESES[mes - 1]} de ${ano}`,
    assinaturaAditivoExtenso: `1 de ${MESES[mes - 1]} de ${ano + 1}`,
  };
}

export function linhasContrato(datas = datasExemplo()) {
  return [
    'PREFEITURA MUNICIPAL DE RIBEIRÃO PRETO',
    'SECRETARIA MUNICIPAL DA SAÚDE',
    '',
    'CONTRATO ADMINISTRATIVO Nº 045/2025',
    '',
    'CONTRATANTE: PREFEITURA MUNICIPAL DE RIBEIRÃO PRETO, inscrita no CNPJ sob o nº 56.024.581/0001-56,'
      + ' com sede na Praça Barão do Rio Branco, s/n, Centro.',
    'CONTRATADA: ENGEBRÁS SERVIÇOS DE ENGENHARIA LTDA, CNPJ 12.345.678/0001-90.',
    '',
    'CLÁUSULA PRIMEIRA - DO OBJETO',
    'O presente contrato tem por objeto a prestação de serviços continuados de manutenção predial preventiva e'
      + ' corretiva das unidades de saúde do município, compreendendo instalações elétricas de baixa tensão, quadros'
      + ' de distribuição, sistema de proteção contra descargas atmosféricas (SPDA) e iluminação interna e externa;'
      + ' manutenção dos sistemas de climatização, incluindo aparelhos de ar condicionado tipo split e self contained,'
      + ' com elaboração e execução do PMOC; e serviços de reforma predial, alvenaria, impermeabilização de lajes e'
      + ' pintura predial das unidades.',
    '',
    'CLÁUSULA SEGUNDA - DO VALOR',
    'O valor global do presente contrato é de R$ 1.284.500,00 (um milhão, duzentos e oitenta e quatro mil e'
      + ' quinhentos reais), a ser pago em parcelas mensais.',
    '',
    'CLÁUSULA TERCEIRA - DA VIGÊNCIA',
    'O prazo de vigência do presente contrato será de 12 (doze) meses, contados da data de sua assinatura,'
      + ' podendo ser prorrogado nos termos da legislação vigente.',
    '',
    'CLÁUSULA QUARTA - DA RESPONSABILIDADE TÉCNICA',
    'A CONTRATADA deverá apresentar as Anotações de Responsabilidade Técnica (ART) junto ao CREA no prazo de'
      + ' 10 (dez) dias após a assinatura deste instrumento.',
    '',
    'E, por estarem justas e contratadas, as partes assinam o presente instrumento em duas vias de igual teor.',
    '',
    `Ribeirão Preto, ${datas.assinaturaExtenso}.`,
  ];
}

export function linhasArt(datas = datasExemplo()) {
  return [
    'CONSELHO REGIONAL DE ENGENHARIA E AGRONOMIA DO ESTADO DE SÃO PAULO',
    'ANOTAÇÃO DE RESPONSABILIDADE TÉCNICA - ART',
    'Lei nº 6.496, de 7 de dezembro de 1977',
    '',
    'ART Nº: SP20250487213',
    '',
    '1. RESPONSÁVEL TÉCNICO',
    'Nome: CARLOS EDUARDO MARQUES DE ALMEIDA',
    'Título: Engenheiro Eletricista',
    'RNP: 2612345678',
    'Registro: CREA-SP 5063087421',
    '',
    '2. DADOS DO CONTRATANTE',
    'Nome: PREFEITURA MUNICIPAL DE RIBEIRÃO PRETO',
    'Contrato: 045/2025',
    '',
    '3. DADOS DA OBRA / SERVIÇO',
    `Data de Início: ${br(datas.inicioArt)}`,
    `Previsão de Término: ${br(datas.vencimento)}`,
    'Valor: R$ 640.000,00',
    '',
    '4. ATIVIDADE TÉCNICA',
    'Manutenção preventiva e corretiva de instalações elétricas de baixa tensão, quadros de distribuição,'
      + ' SPDA e sistemas de iluminação das unidades de saúde municipais.',
    '',
    '5. OBSERVAÇÕES',
    `Data de Registro: ${br(datas.registroArt)}`,
  ];
}

export function linhasAditivo(datas = datasExemplo()) {
  return [
    'PREFEITURA MUNICIPAL DE RIBEIRÃO PRETO',
    'SECRETARIA MUNICIPAL DA SAÚDE',
    '',
    'PRIMEIRO TERMO ADITIVO AO CONTRATO ADMINISTRATIVO Nº 045/2025',
    '',
    'CLÁUSULA PRIMEIRA - DO OBJETO',
    'O presente termo aditivo tem por objeto a prorrogação do prazo de vigência do contrato e o'
      + ' acréscimo ao escopo dos serviços de manutenção preventiva e corretiva dos elevadores e'
      + ' das plataformas elevatórias das unidades de saúde do município.',
    '',
    'CLÁUSULA SEGUNDA - DA PRORROGAÇÃO',
    'Fica prorrogado o prazo de vigência do contrato por mais 12 (doze) meses, contados do dia'
      + ' seguinte ao término da vigência atual, nos termos da legislação aplicável.',
    '',
    'CLÁUSULA TERCEIRA - DO VALOR',
    'Fica acrescido ao contrato o valor de R$ 128.450,00 (cento e vinte e oito mil, quatrocentos e'
      + ' cinquenta reais), passando o valor total do contrato para R$ 1.412.950,00.',
    '',
    'CLÁUSULA QUARTA - DA RATIFICAÇÃO',
    'Ficam ratificadas as demais cláusulas do contrato original não alteradas por este instrumento.',
    '',
    `Ribeirão Preto, ${datas.assinaturaAditivoExtenso}.`,
  ];
}

export const pdfContrato = (datas) => montarPdf(linhasContrato(datas));
export const pdfArt = (datas) => montarPdf(linhasArt(datas));
export const pdfAditivo = (datas) => montarPdf(linhasAditivo(datas));
