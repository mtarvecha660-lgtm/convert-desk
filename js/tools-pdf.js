/* Convert Desk: PDF tools. */
(function () {
  const CD = window.CD;
  const loadPdf = async (it, opts) => {
    try { return await PDFLib.PDFDocument.load(await it.file.arrayBuffer(), { ignoreEncryption: true }); }
    catch (e) { throw new Error(`${it.file.name} could not be opened. It may be damaged or password protected.`); }
  };
  const toBlob = async (doc) => new Blob([await doc.save()], { type: 'application/pdf' });

  CD.register([
    {
      id: 'pdf-merge', group: 'pdf', icon: 'PDF', title: 'Merge PDFs',
      desc: 'Join several PDFs into one, in the order shown in the list.',
      accepts: ['pdf'], mode: 'all', minFiles: 2, action: 'Merge',
      options: [],
      async runAll(items, o, ctx) {
        const out = await PDFLib.PDFDocument.create();
        for (const it of items) {
          const src = await loadPdf(it);
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach((p) => out.addPage(p));
          ctx.progress(it, 100);
          await CD.tick();
        }
        return [{ name: `merged-${items.length}-files.pdf`, blob: await toBlob(out) }];
      },
    },
    {
      id: 'pdf-split', group: 'pdf', icon: '✂', title: 'Split PDF',
      desc: 'Pull out a page range as one PDF, or save each chosen page as its own PDF.',
      accepts: ['pdf'], mode: 'each', action: 'Split',
      options: [
        { id: 'pages', type: 'text', label: 'Pages (blank = all)', value: '', placeholder: 'for example 2-4, 7' },
        { id: 'mode', type: 'select', label: 'Save as', value: 'one', choices: [['one', 'One PDF with these pages'], ['each', 'A separate PDF for each page']] },
      ],
      async runOne(it, o, ctx) {
        const src = await loadPdf(it);
        const pages = CD.parsePages(o.pages, src.getPageCount());
        const base = CD.baseName(it.file.name);
        if (o.mode === 'one') {
          const out = await PDFLib.PDFDocument.create();
          (await out.copyPages(src, pages.map((p) => p - 1))).forEach((p) => out.addPage(p));
          return [{ name: `${base}-pages.pdf`, blob: await toBlob(out) }];
        }
        const res = [];
        for (let k = 0; k < pages.length; k++) {
          const out = await PDFLib.PDFDocument.create();
          (await out.copyPages(src, [pages[k] - 1])).forEach((p) => out.addPage(p));
          res.push({ name: `${base}-page-${pages[k]}.pdf`, blob: await toBlob(out) });
          ctx.progress(it, ((k + 1) / pages.length) * 100);
          await CD.tick();
        }
        return res;
      },
    },
    {
      id: 'pdf-pages', group: 'pdf', icon: '↻', title: 'Edit pages',
      desc: 'List the pages to keep, in the order you want. Leave out the ones to delete.',
      accepts: ['pdf'], mode: 'each', action: 'Save pages',
      options: [
        { id: 'order', type: 'text', label: 'Pages to keep, in order (blank = all)', value: '', placeholder: 'for example 3, 1, 2' },
        { id: 'rot', type: 'select', label: 'Rotate the kept pages', value: '0', choices: [['0', 'No rotation'], ['90', '90° clockwise'], ['180', '180°'], ['270', '90° counter-clockwise']] },
      ],
      async runOne(it, o, ctx) {
        const src = await loadPdf(it);
        const pages = CD.parsePages(o.order, src.getPageCount());
        const out = await PDFLib.PDFDocument.create();
        const copied = await out.copyPages(src, pages.map((p) => p - 1));
        const turn = Number(o.rot) || 0;
        copied.forEach((p) => {
          if (turn) p.setRotation(PDFLib.degrees((p.getRotation().angle + turn) % 360));
          out.addPage(p);
        });
        ctx.progress(it, 90);
        return [{ name: `${CD.baseName(it.file.name)}-edited.pdf`, blob: await toBlob(out) }];
      },
    },
    {
      id: 'pdf-stamp', group: 'pdf', icon: '№', title: 'Numbers & watermark',
      desc: 'Add page numbers at the bottom and/or a diagonal text watermark to every page.',
      accepts: ['pdf'], mode: 'each', action: 'Add to PDF',
      options: [
        { id: 'nums', type: 'check', label: 'Add page numbers at the bottom', value: true },
        { id: 'numfmt', type: 'select', label: 'Number style', value: 'of', choices: [['n', '1, 2, 3 …'], ['of', 'Page 1 of 3']] },
        { id: 'wm', type: 'text', label: 'Watermark text (blank = none)', value: '', placeholder: 'for example DRAFT' },
        { id: 'opacity', type: 'range', label: 'Watermark strength', value: 18, min: 5, max: 60, unit: '%' },
      ],
      validate(o) {
        if (!o.nums && !(o.wm || '').trim()) throw new Error('turn on page numbers, or type watermark text');
      },
      async runOne(it, o, ctx) {
        const doc = await loadPdf(it);
        const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
        const pages = doc.getPages();
        const total = pages.length;
        const wm = CD.winAnsi((o.wm || '').trim());
        pages.forEach((page, i) => {
          const { width, height } = page.getSize();
          if (wm) {
            const size = Math.min(96, (width * 0.8) / (wm.length * 0.62));
            const w = bold.widthOfTextAtSize(wm, size);
            const th = (45 * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
            const cx = width / 2, cy = height / 2;
            // anchor = centre - along-text half width - up-vector a third of the size
            page.drawText(wm, {
              x: cx - (w / 2) * c + (size / 3) * s,
              y: cy - (w / 2) * s - (size / 3) * c,
              size, font: bold, rotate: PDFLib.degrees(45),
              color: PDFLib.rgb(0.5, 0.5, 0.5), opacity: (o.opacity || 18) / 100,
            });
          }
          if (o.nums) {
            const label = o.numfmt === 'of' ? `Page ${i + 1} of ${total}` : String(i + 1);
            const w = font.widthOfTextAtSize(label, 10);
            page.drawText(label, { x: width / 2 - w / 2, y: 24, size: 10, font, color: PDFLib.rgb(0.3, 0.3, 0.3) });
          }
          ctx.progress(it, ((i + 1) / total) * 100);
        });
        return [{ name: `${CD.baseName(it.file.name)}-stamped.pdf`, blob: await toBlob(doc) }];
      },
    },
  ]);
})();
