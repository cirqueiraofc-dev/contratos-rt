/**
 * Extracao de texto de PDF usando o build "legacy" do pdf.js (roda em Node sem DOM).
 *
 * Preserva quebras de linha aproximadas: o pdf.js entrega itens soltos e marca
 * `hasEOL` no fim de linha, o que basta para as heuristicas de leitura do contrato.
 */

let getDocument;

async function carregarPdfjs() {
  if (!getDocument) {
    const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
    getDocument = mod.getDocument;
  }
  return getDocument;
}

/**
 * @param {Buffer|Uint8Array} buffer conteudo do PDF
 * @returns {Promise<{ texto: string, paginas: number, temTexto: boolean }>}
 */
export async function extrairTexto(buffer) {
  const carregar = await carregarPdfjs();
  const tarefa = carregar({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });

  const pdf = await tarefa.promise;
  const partes = [];

  try {
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const pagina = await pdf.getPage(n);
      const conteudo = await pagina.getTextContent();
      let linha = '';
      for (const item of conteudo.items) {
        if (typeof item.str !== 'string') continue;
        linha += item.str;
        if (item.hasEOL) {
          partes.push(linha);
          linha = '';
        } else if (item.str && !item.str.endsWith(' ')) {
          linha += ' ';
        }
      }
      if (linha.trim()) partes.push(linha);
      partes.push('');
      pagina.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  const texto = partes.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return {
    texto,
    paginas: pdf.numPages,
    // PDF so com imagem (documento escaneado) devolve praticamente nada
    temTexto: texto.replace(/\s/g, '').length > 120,
  };
}
