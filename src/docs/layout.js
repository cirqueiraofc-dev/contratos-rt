/**
 * Camada fina sobre o pdf-lib para montar documentos A4 em portugues:
 * quebra de linha automatica, quebra de pagina, tabelas, campos e blocos
 * de assinatura. Usada pelo atestado e pelo requerimento de CAT.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = { esq: 56, dir: 56, topo: 56, base: 64 };

const PRETO = rgb(0.1, 0.1, 0.12);
const CINZA = rgb(0.42, 0.44, 0.48);
const LINHA = rgb(0.78, 0.79, 0.82);
const FUNDO_CABECALHO = rgb(0.94, 0.95, 0.97);

/** Caracteres extras (fora do Latin-1) que a codificacao WinAnsi aceita. */
const EXTRAS_WINANSI = new Set(
  [0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
    0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
    0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178],
);

const SUBSTITUICOES = new Map([
  [' ', ' '], ['−', '-'], ['→', '->'], ['≤', '<='],
  ['≥', '>='], ['²', '2'], ['³', '3'], ['‑', '-'],
  [' ', ' '], ['​', ''], ['\t', '  '],
]);

/** Garante que o texto pode ser escrito com as fontes padrao (WinAnsi). */
export function saneavel(texto) {
  let s = String(texto ?? '');
  for (const [de, para] of SUBSTITUICOES) s = s.split(de).join(para);
  let saida = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 10) { saida += '\n'; continue; }
    if (cp < 32) continue;
    if (cp <= 126 || (cp >= 0xa0 && cp <= 0xff) || EXTRAS_WINANSI.has(cp)) saida += ch;
    else saida += '?';
  }
  return saida;
}

export class Documento {
  constructor({ rodape = '' } = {}) {
    this.rodape = saneavel(rodape);
    this.doc = null;
    this.pagina = null;
    this.y = 0;
  }

  async iniciar() {
    this.doc = await PDFDocument.create();
    this.doc.setProducer('Sistema de Contratos e RT');
    this.doc.setCreator('Sistema de Contratos e RT');
    this.normal = await this.doc.embedFont(StandardFonts.Helvetica);
    this.negrito = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.italico = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.novaPagina();
    return this;
  }

  get larguraUtil() {
    return A4.largura - MARGEM.esq - MARGEM.dir;
  }

  novaPagina() {
    this.pagina = this.doc.addPage([A4.largura, A4.altura]);
    this.y = A4.altura - MARGEM.topo;
  }

  /** Reserva espaco vertical, abrindo pagina nova se nao couber. */
  reservar(altura) {
    if (this.y - altura < MARGEM.base) this.novaPagina();
  }

  espaco(altura = 10) {
    this.y -= altura;
  }

  /** Quebra o texto em linhas que cabem na largura informada. */
  quebrar(texto, fonte, tamanho, largura = this.larguraUtil) {
    const linhas = [];
    for (const paragrafo of saneavel(texto).split('\n')) {
      const palavras = paragrafo.split(/\s+/).filter(Boolean);
      if (!palavras.length) { linhas.push(''); continue; }
      let atual = '';
      for (const palavra of palavras) {
        const tentativa = atual ? `${atual} ${palavra}` : palavra;
        if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
          atual = tentativa;
        } else {
          if (atual) linhas.push(atual);
          // palavra sozinha maior que a linha: parte no caractere
          if (fonte.widthOfTextAtSize(palavra, tamanho) > largura) {
            let pedaco = '';
            for (const ch of palavra) {
              if (fonte.widthOfTextAtSize(pedaco + ch, tamanho) > largura) {
                linhas.push(pedaco);
                pedaco = ch;
              } else pedaco += ch;
            }
            atual = pedaco;
          } else atual = palavra;
        }
      }
      if (atual) linhas.push(atual);
    }
    return linhas;
  }

  escrever(texto, { fonte = this.normal, tamanho = 10.5, cor = PRETO, x = MARGEM.esq, alinhamento = 'esquerda', largura = this.larguraUtil, entrelinha = 1.45 } = {}) {
    const linhas = this.quebrar(texto, fonte, tamanho, largura);
    const alturaLinha = tamanho * entrelinha;
    for (const linha of linhas) {
      this.reservar(alturaLinha);
      let px = x;
      if (linha) {
        const w = fonte.widthOfTextAtSize(linha, tamanho);
        if (alinhamento === 'centro') px = x + (largura - w) / 2;
        else if (alinhamento === 'direita') px = x + largura - w;
        this.pagina.drawText(linha, { x: px, y: this.y - tamanho, size: tamanho, font: fonte, color: cor });
      }
      this.y -= alturaLinha;
    }
  }

  titulo(texto, { tamanho = 15 } = {}) {
    this.reservar(tamanho * 2.2);
    this.escrever(texto, { fonte: this.negrito, tamanho, alinhamento: 'centro', entrelinha: 1.3 });
    this.espaco(6);
  }

  subtitulo(texto, { tamanho = 10 } = {}) {
    this.escrever(texto, { fonte: this.normal, tamanho, cor: CINZA, alinhamento: 'centro' });
    this.espaco(4);
  }

  secao(texto, { tamanho = 11 } = {}) {
    this.espaco(10);
    // reserva o titulo mais ~5 linhas para o cabecalho nao ficar sozinho no rodape
    this.reservar(tamanho * 2.4 + 78);
    this.escrever(texto.toUpperCase(), { fonte: this.negrito, tamanho, entrelinha: 1.35 });
    this.reservar(6);
    this.pagina.drawLine({
      start: { x: MARGEM.esq, y: this.y + 3 },
      end: { x: A4.largura - MARGEM.dir, y: this.y + 3 },
      thickness: 0.8,
      color: LINHA,
    });
    this.espaco(8);
  }

  paragrafo(texto, opcoes = {}) {
    this.escrever(texto, { tamanho: 10.5, ...opcoes });
    this.espaco(opcoes.depois ?? 6);
  }

  /** Linha "Rotulo: valor" com rotulo em negrito. */
  campo(rotulo, valor, { tamanho = 10.5 } = {}) {
    const textoRotulo = `${saneavel(rotulo)}: `;
    const larguraRotulo = this.negrito.widthOfTextAtSize(textoRotulo, tamanho);
    const linhas = this.quebrar(valor || '—', this.normal, tamanho, this.larguraUtil - larguraRotulo);
    const alturaLinha = tamanho * 1.45;
    this.reservar(alturaLinha * linhas.length);
    this.pagina.drawText(textoRotulo, { x: MARGEM.esq, y: this.y - tamanho, size: tamanho, font: this.negrito, color: PRETO });
    linhas.forEach((linha, i) => {
      if (i > 0) this.reservar(alturaLinha);
      this.pagina.drawText(linha, {
        // continuacao alinha sob o valor, nao sob o rotulo
        x: MARGEM.esq + larguraRotulo,
        y: this.y - tamanho,
        size: tamanho,
        font: this.normal,
        color: PRETO,
      });
      this.y -= alturaLinha;
    });
  }

  campos(pares, opcoes = {}) {
    for (const [rotulo, valor] of pares) this.campo(rotulo, valor, opcoes);
  }

  /**
   * @param {{ colunas: Array<{titulo: string, largura: number}>, linhas: string[][] }} spec
   * larguras sao proporcionais e normalizadas para a largura util.
   */
  tabela({ colunas, linhas, tamanho = 9 }) {
    const somaPesos = colunas.reduce((s, c) => s + c.largura, 0);
    const larguras = colunas.map((c) => (c.largura / somaPesos) * this.larguraUtil);
    const padding = 5;
    const alturaLinhaTexto = tamanho * 1.35;

    const desenharCabecalho = () => {
      const altura = alturaLinhaTexto + padding * 2;
      this.reservar(altura);
      this.pagina.drawRectangle({
        x: MARGEM.esq, y: this.y - altura, width: this.larguraUtil, height: altura, color: FUNDO_CABECALHO,
      });
      let x = MARGEM.esq;
      colunas.forEach((col, i) => {
        this.pagina.drawText(saneavel(col.titulo), {
          x: x + padding, y: this.y - padding - tamanho, size: tamanho, font: this.negrito, color: PRETO,
        });
        x += larguras[i];
      });
      this.y -= altura;
    };

    // quebra tudo antes de desenhar para saber a altura real da primeira linha
    const preparadas = linhas.map((linha) => {
      const celulas = linha.map((celula, i) => this.quebrar(celula ?? '', this.normal, tamanho, larguras[i] - padding * 2));
      const maxLinhas = Math.max(1, ...celulas.map((c) => c.length));
      return { celulas, altura: maxLinhas * alturaLinhaTexto + padding * 2 };
    });

    // cabecalho sozinho no fim da pagina fica orfao: so desenha se a primeira linha couber junto
    const alturaCabecalho = alturaLinhaTexto + padding * 2;
    this.reservar(alturaCabecalho + (preparadas[0]?.altura ?? alturaCabecalho));
    desenharCabecalho();

    for (const { celulas, altura } of preparadas) {
      if (this.y - altura < MARGEM.base) {
        this.novaPagina();
        desenharCabecalho();
      }

      let x = MARGEM.esq;
      celulas.forEach((conteudo, i) => {
        conteudo.forEach((texto, j) => {
          this.pagina.drawText(texto, {
            x: x + padding,
            y: this.y - padding - tamanho - j * alturaLinhaTexto,
            size: tamanho,
            font: this.normal,
            color: PRETO,
          });
        });
        x += larguras[i];
      });

      this.pagina.drawLine({
        start: { x: MARGEM.esq, y: this.y - altura },
        end: { x: A4.largura - MARGEM.dir, y: this.y - altura },
        thickness: 0.5,
        color: LINHA,
      });
      this.y -= altura;
    }
    this.espaco(8);
  }

  checklist(itens, { tamanho = 10 } = {}) {
    const caixa = 9;
    for (const item of itens) {
      const linhas = this.quebrar(item, this.normal, tamanho, this.larguraUtil - caixa - 10);
      const altura = linhas.length * tamanho * 1.45;
      this.reservar(altura + 2);
      this.pagina.drawRectangle({
        x: MARGEM.esq, y: this.y - caixa - 1, width: caixa, height: caixa,
        borderColor: CINZA, borderWidth: 0.8,
      });
      linhas.forEach((linha, i) => {
        this.pagina.drawText(linha, {
          x: MARGEM.esq + caixa + 8,
          y: this.y - tamanho - i * tamanho * 1.45,
          size: tamanho, font: this.normal, color: PRETO,
        });
      });
      this.y -= altura + 3;
    }
    this.espaco(6);
  }

  /** Bloco de assinatura com linha, nome e cargos. */
  assinatura({ nome = '', linhas = [], largura = 260 } = {}) {
    this.espaco(28);
    this.reservar(70);
    const x = MARGEM.esq + (this.larguraUtil - largura) / 2;
    this.pagina.drawLine({
      start: { x, y: this.y }, end: { x: x + largura, y: this.y }, thickness: 0.9, color: PRETO,
    });
    this.y -= 14;
    if (nome) {
      this.escrever(nome, { fonte: this.negrito, tamanho: 10, alinhamento: 'centro', largura, x });
    }
    for (const linha of linhas) {
      this.escrever(linha, { tamanho: 9.5, cor: CINZA, alinhamento: 'centro', largura, x });
    }
    this.espaco(10);
  }

  nota(texto) {
    this.espaco(8);
    this.escrever(texto, { fonte: this.italico, tamanho: 8.5, cor: CINZA, entrelinha: 1.4 });
  }

  /** Carimbo de rodape com numeracao — aplicado a todas as paginas no fim. */
  aplicarRodape() {
    const paginas = this.doc.getPages();
    paginas.forEach((pagina, i) => {
      const texto = this.rodape ? `${this.rodape}` : '';
      const numero = `Página ${i + 1} de ${paginas.length}`;
      pagina.drawLine({
        start: { x: MARGEM.esq, y: MARGEM.base - 18 },
        end: { x: A4.largura - MARGEM.dir, y: MARGEM.base - 18 },
        thickness: 0.5,
        color: LINHA,
      });
      if (texto) {
        pagina.drawText(saneavel(texto), {
          x: MARGEM.esq, y: MARGEM.base - 30, size: 7.5, font: this.normal, color: CINZA,
        });
      }
      const w = this.normal.widthOfTextAtSize(numero, 7.5);
      pagina.drawText(saneavel(numero), {
        x: A4.largura - MARGEM.dir - w, y: MARGEM.base - 30, size: 7.5, font: this.normal, color: CINZA,
      });
    });
  }

  async finalizar() {
    this.aplicarRodape();
    return this.doc.save();
  }
}

export async function novoDocumento(opcoes) {
  return new Documento(opcoes).iniciar();
}
