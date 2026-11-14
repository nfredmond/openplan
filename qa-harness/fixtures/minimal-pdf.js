// Writes a small, valid PDF for tests: each page is a list of text lines in
// Helvetica, plus an optional filled rectangle in a given colour (a stand-in
// for a map figure). No dependency; Poppler reads the result.

function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * @param {Array<{lines: string[], rect?: {x:number,y:number,w:number,h:number,rgb:[number,number,number]}}>} pages
 * @returns {Buffer}
 */
function buildMinimalPdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add(null);
  const pagesId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (const page of pages) {
    let stream = '';
    if (page.rect) {
      const [r, g, b] = page.rect.rgb.map((value) => (value / 255).toFixed(3));
      stream += `${r} ${g} ${b} rg ${page.rect.x} ${page.rect.y} ${page.rect.w} ${page.rect.h} re f\n`;
    }
    stream += '0 0 0 rg BT /F1 11 Tf 14 TL 50 740 Td\n';
    for (const line of page.lines) stream += `(${escapePdfText(line)}) Tj T*\n`;
    stream += 'ET\n';
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { buildMinimalPdf };
