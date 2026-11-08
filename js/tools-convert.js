/* Convert Desk: conversion tools. Each tool is registered with CD.register. */
(function () {
  const CD = window.CD;
  const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const pdfjs = () => {
    if (!window.pdfjsLib) throw new Error('the PDF reader did not load; reload the page');
    return window.pdfjsLib;
  };
  const openPdf = async (file) => pdfjs().getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const SCALE_CAP = 16e6; // pixels; keeps phone memory safe on very large pages

  CD.register([
    {
      id: 'img-convert', group: 'convert', icon: 'JPG', title: 'Image converter',
      desc: 'JPG, PNG, WebP, BMP or GIF in. Pick the format you want out.',
      accepts: ['image'], mode: 'each', action: 'Convert',
      options: [
        { id: 'to', type: 'select', label: 'Convert to', value: 'png', choices: [['png', 'PNG (lossless)'], ['jpg', 'JPG'], ['webp', 'WebP']] },
        { id: 'q', type: 'range', label: 'Quality (JPG and WebP)', value: 90, min: 30, max: 100, unit: '%' },
      ],
      async runOne(it, o, ctx) {
        const img = await CD.loadImage(it.file);
        ctx.progress(it, 50);
        const cv = CD.drawCanvas(img, { fill: o.to === 'png' ? null : '#ffffff' });
        const blob = await CD.canvasBlob(cv, CD.mimeFor(o.to), o.q / 100);
        return [{ name: CD.baseName(it.file.name) + '.' + o.to, blob }];
      },
    },
    {
      id: 'img-to-pdf', group: 'convert', icon: 'PDF', title: 'Images to one PDF',
      desc: 'Put photos in order into a single PDF. Files are added in the order you see them.',
      accepts: ['image'], mode: 'all', minFiles: 1, action: 'Make PDF',
      options: [
        { id: 'size', type: 'select', label: 'Page size', value: 'a4', choices: [['a4', 'A4, image fitted with margins'], ['fit', 'Same size as each image']] },
      ],
      async runAll(items, o, ctx) {
        const doc = await PDFLib.PDFDocument.create();
        for (const it of items) {
          const img = await CD.loadImage(it.file);
          ctx.progress(it, 30);
          const cv = CD.drawCanvas(img, { fill: '#ffffff' });
          const bytes = await (await CD.canvasBlob(cv, 'image/jpeg', 0.92)).arrayBuffer();
          const emb = await doc.embedJpg(new Uint8Array(bytes));
          if (o.size === 'a4') {
            const pw = 595.28, ph = 841.89, m = 36;
            const s = Math.min((pw - 2 * m) / emb.width, (ph - 2 * m) / emb.height);
            const w = emb.width * s, h = emb.height * s;
            doc.addPage([pw, ph]).drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
          } else {
            const page = doc.addPage([emb.width, emb.height]);
            page.drawImage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
          }
          ctx.progress(it, 100);
          await CD.tick();
        }
        const out = await doc.save();
        const name = items.length === 1 ? CD.baseName(items[0].file.name) + '.pdf' : `images-${items.length}.pdf`;
        return [{ name, blob: new Blob([out], { type: 'application/pdf' }) }];
      },
    },
    {
      id: 'pdf-to-img', group: 'convert', icon: 'PNG', title: 'PDF to images',
      desc: 'One image per page, PNG or JPG. Download them one by one or as a ZIP.',
      accepts: ['pdf'], mode: 'each', action: 'Export pages',
      options: [
        { id: 'fmt', type: 'select', label: 'Image type', value: 'png', choices: [['png', 'PNG'], ['jpg', 'JPG']] },
        { id: 'scale', type: 'select', label: 'Sharpness', value: '2', choices: [['1', 'Normal (72 dpi)'], ['2', 'Sharp (144 dpi)'], ['3', 'Very sharp (216 dpi)']] },
        { id: 'pages', type: 'text', label: 'Pages (blank = all)', value: '', placeholder: 'for example 1-3, 5' },
      ],
      async runOne(it, o, ctx) {
        const pdf = await openPdf(it.file);
        const pages = CD.parsePages(o.pages, pdf.numPages);
        const base = CD.baseName(it.file.name);
        const out = [];
        for (let k = 0; k < pages.length; k++) {
          const page = await pdf.getPage(pages[k]);
          const v1 = page.getViewport({ scale: 1 });
          const s = Math.min(Number(o.scale), Math.sqrt(SCALE_CAP / (v1.width * v1.height)));
          const vp = page.getViewport({ scale: s });
          const cv = document.createElement('canvas');
          cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
          const cx = cv.getContext('2d');
          if (o.fmt === 'jpg') { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cv.width, cv.height); }
          await page.render({ canvasContext: cx, viewport: vp }).promise;
          out.push({ name: `${base}_page${pages[k]}.${o.fmt}`, blob: await CD.canvasBlob(cv, CD.mimeFor(o.fmt), 0.92), from: null });
          cv.width = cv.height = 0;
          ctx.progress(it, ((k + 1) / pages.length) * 100);
          page.cleanup();
          await CD.tick();
        }
        return out;
      },
    },
    {
      id: 'pdf-to-text', group: 'convert', icon: 'TXT', title: 'PDF to text',
      desc: 'Copies the text layer of every page into a .txt file.',
      accepts: ['pdf'], mode: 'each', action: 'Extract text',
      options: [],
      async runOne(it, o, ctx) {
        const pdf = await openPdf(it.file);
        let txt = '';
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          txt += tc.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('') + '\n';
          ctx.progress(it, (p / pdf.numPages) * 100);
          page.cleanup();
          await CD.tick();
        }
        if (!txt.trim()) throw new Error('no text found. This PDF looks scanned, and there is no OCR here.');
        return [{ name: CD.baseName(it.file.name) + '.txt', blob: new Blob([txt.trim() + '\n'], { type: 'text/plain' }) }];
      },
    },
    {
      id: 'docx-to-text', group: 'convert', icon: 'DOC', title: 'Word to text',
      desc: 'Reads a .docx file and saves its text as .txt.',
      accepts: ['docx'], mode: 'each', action: 'Extract text',
      options: [],
      async runOne(it, o, ctx) {
        if (!window.mammoth) throw new Error('the Word reader did not load; reload the page');
        ctx.progress(it, 40);
        const r = await mammoth.extractRawText({ arrayBuffer: await it.file.arrayBuffer() });
        return [{ name: CD.baseName(it.file.name) + '.txt', blob: new Blob([r.value], { type: 'text/plain' }) }];
      },
    },
    {
      id: 'text-to-pdf', group: 'convert', icon: 'PDF', title: 'Text to PDF',
      desc: 'TXT, MD, LOG, SRT, XML, HTML or JSON as a monospace PDF. Latin letters only.',
      accepts: ['text', 'json'], mode: 'each', action: 'Make PDF',
      options: [
        { id: 'size', type: 'select', label: 'Page size', value: 'a4', choices: [['a4', 'A4'], ['letter', 'US Letter']] },
        { id: 'font', type: 'select', label: 'Text size', value: '11', choices: [['9', 'Small'], ['11', 'Medium'], ['13', 'Large']] },
      ],
      async runOne(it, o, ctx) {
        const doc = await PDFLib.PDFDocument.create();
        const font = await doc.embedFont(PDFLib.StandardFonts.Courier);
        const [W, H] = o.size === 'letter' ? [612, 792] : [595.28, 841.89];
        const M = 50, size = Number(o.font), LH = size * 1.4;
        const maxW = W - 2 * M;
        const src = CD.winAnsi(await it.file.text());
        const cw = font.widthOfTextAtSize('M', size);
        const perLine = Math.max(10, Math.floor(maxW / cw));
        const lines = [];
        for (const raw of src.split('\n')) {
          if (!raw.trimEnd()) { lines.push(''); continue; }
          let rest = raw.trimEnd();
          while (rest.length > perLine) { lines.push(rest.slice(0, perLine)); rest = rest.slice(perLine); }
          lines.push(rest);
        }
        let page = doc.addPage([W, H]);
        let y = H - M;
        lines.forEach((ln, i) => {
          if (y < M) { page = doc.addPage([W, H]); y = H - M; }
          if (ln) page.drawText(ln, { x: M, y, size, font });
          y -= LH;
          if (i % 200 === 0) ctx.progress(it, (i / lines.length) * 100);
        });
        const out = await doc.save();
        return [{ name: CD.baseName(it.file.name) + '.pdf', blob: new Blob([out], { type: 'application/pdf' }) }];
      },
    },
    {
      id: 'sheet', group: 'convert', icon: 'XLS', title: 'Spreadsheet converter',
      desc: 'CSV or Excel in; Excel, CSV or JSON out. Uses the first sheet for CSV and JSON.',
      accepts: ['csv', 'xlsx'], mode: 'each', action: 'Convert',
      options: [
        { id: 'to', type: 'select', label: 'Save as', value: 'xlsx', choices: [['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (.csv)'], ['json', 'JSON (.json)']] },
      ],
      async runOne(it, o, ctx) {
        const buf = await it.file.arrayBuffer();
        const wb = it.kind === 'csv'
          ? XLSX.read(new TextDecoder().decode(buf), { type: 'string' })
          : XLSX.read(new Uint8Array(buf), { type: 'array' });
        ctx.progress(it, 60);
        const first = wb.Sheets[wb.SheetNames[0]];
        const base = CD.baseName(it.file.name);
        if (o.to === 'xlsx') {
          const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          return [{ name: base + '.xlsx', blob: new Blob([out], { type: MIME_XLSX }) }];
        }
        if (o.to === 'csv') {
          return [{ name: base + '.csv', blob: new Blob([XLSX.utils.sheet_to_csv(first)], { type: 'text/csv' }) }];
        }
        const rows = XLSX.utils.sheet_to_json(first, { defval: '' });
        return [{ name: base + '.json', blob: new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }) }];
      },
    },
    {
      id: 'json-csv', group: 'convert', icon: '{}', title: 'JSON and CSV',
      desc: 'A JSON array of objects to CSV, or CSV to JSON. Nested values stay as JSON text in their cell.',
      accepts: ['json', 'csv'], mode: 'each', action: 'Convert',
      options: [
        { id: 'to', type: 'select', label: 'Save as', value: 'csv', choices: [['csv', 'CSV (.csv)'], ['json', 'JSON (.json)']] },
      ],
      async runOne(it, o, ctx) {
        const text = await it.file.text();
        const base = CD.baseName(it.file.name);
        ctx.progress(it, 50);
        if (o.to === 'json') {
          let data;
          if (it.kind === 'csv') {
            const wb = XLSX.read(text, { type: 'string' });
            data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          } else data = JSON.parse(text);
          return [{ name: base + '.json', blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }) }];
        }
        if (it.kind === 'csv') {
          const wb = XLSX.read(text, { type: 'string' });
          return [{ name: base + '.csv', blob: new Blob([XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])], { type: 'text/csv' }) }];
        }
        let data = JSON.parse(text);
        if (!Array.isArray(data)) data = [data];
        if (!data.length) throw new Error('the JSON array is empty');
        const flat = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);
        const rows = data.map((r) =>
          r && typeof r === 'object' && !Array.isArray(r)
            ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, flat(v)]))
            : { value: flat(r) }
        );
        const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
        return [{ name: base + '.csv', blob: new Blob([csv], { type: 'text/csv' }) }];
      },
    },
  ]);
})();
