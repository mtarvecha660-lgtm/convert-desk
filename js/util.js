/* Convert Desk: shared helpers. Everything runs in the page; no network. */
(function () {
  const CD = (window.CD = window.CD || {});
  CD.tools = [];
  CD.register = (list) => list.forEach((t) => CD.tools.push(t));

  CD.ext = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  CD.baseName = (name) => String(name).replace(/\.[^./\\]+$/, '') || 'file';
  CD.human = (b) => {
    if (b == null) return '';
    if (b >= 1048576) return (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + ' MB';
    if (b >= 1024) return Math.max(1, Math.round(b / 1024)) + ' KB';
    return b + ' B';
  };
  CD.change = (from, to) => {
    if (!from) return '';
    const p = Math.round(((to - from) / from) * 100);
    return (p > 0 ? '+' : '') + p + '%';
  };
  CD.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CD.tick = () => new Promise((r) => setTimeout(r, 0));

  const KIND_EXT = {
    image: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'],
    pdf: ['pdf'],
    csv: ['csv'],
    xlsx: ['xlsx', 'xls'],
    docx: ['docx'],
    json: ['json'],
    text: ['txt', 'md', 'log', 'srt', 'xml', 'html', 'htm'],
  };
  CD.kindOf = (file) => {
    const e = CD.ext(file.name), t = file.type || '';
    for (const k of Object.keys(KIND_EXT)) if (KIND_EXT[k].includes(e)) return k;
    if (t.startsWith('image/') && /jpeg|png|webp|bmp|gif/.test(t)) return 'image';
    if (t === 'application/pdf') return 'pdf';
    if (t === 'text/csv') return 'csv';
    return null;
  };
  // accept string for <input type=file> from a tool's kinds
  CD.acceptFor = (kinds) => {
    if (kinds === 'any') return '';
    const out = [];
    kinds.forEach((k) => KIND_EXT[k] && KIND_EXT[k].forEach((e) => out.push('.' + e)));
    return out.join(',');
  };
  CD.accepts = (tool, item) => {
    if (tool.accepts === 'any') return true;
    if (!Array.isArray(tool.accepts)) return false;
    return !!item.kind && tool.accepts.includes(item.kind);
  };

  // Page spec "1-3, 7" -> [1,2,3,7]; 1-based, validated against total.
  CD.parsePages = (spec, total) => {
    const s = String(spec || '').trim();
    if (!s) return Array.from({ length: total }, (_, i) => i + 1);
    const out = [];
    for (const part of s.split(',')) {
      const p = part.trim();
      if (!p) continue;
      const m = p.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) throw new Error(`"${p}" is not a page number or range`);
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b < 1 || a > total || b > total) throw new Error(`pages must be between 1 and ${total}`);
      if (b < a) throw new Error(`"${p}" runs backwards`);
      for (let i = a; i <= b; i++) out.push(i);
    }
    if (!out.length) throw new Error('no pages selected');
    return out;
  };

  CD.loadImage = (file) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("couldn't read this image")); };
      img.src = url;
    });

  // Draw an image with optional crop (fractions), scale/maxW/maxH, rotation (deg), flips, background fill.
  CD.drawCanvas = (img, o = {}) => {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const c = o.crop || {};
    const sx = Math.round(W * (c.l || 0)), sy = Math.round(H * (c.t || 0));
    const sw = Math.max(1, Math.round(W * (1 - (c.l || 0) - (c.r || 0))));
    const sh = Math.max(1, Math.round(H * (1 - (c.t || 0) - (c.b || 0))));
    let scale = o.scale || 1;
    if (o.maxW && sw * scale > o.maxW) scale = o.maxW / sw;
    if (o.maxH && sh * scale > o.maxH) scale = o.maxH / sh;
    const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
    const rot = (((o.rotate || 0) % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const cv = document.createElement('canvas');
    cv.width = swap ? dh : dw;
    cv.height = swap ? dw : dh;
    const x = cv.getContext('2d');
    if (o.fill) { x.fillStyle = o.fill; x.fillRect(0, 0, cv.width, cv.height); }
    x.save();
    x.translate(cv.width / 2, cv.height / 2);
    x.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
    x.rotate((rot * Math.PI) / 180);
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    x.restore();
    return cv;
  };
  CD.canvasBlob = (cv, mime, quality) =>
    new Promise((resolve, reject) =>
      cv.toBlob((b) => {
        if (!b) return reject(new Error("this browser couldn't save that image type"));
        if (b.type !== mime) return reject(new Error(`this browser can't save ${mime.split('/')[1]} files`));
        resolve(b);
      }, mime, quality)
    );
  CD.mimeFor = (ext) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'image/png');

  // pdf-lib and pdf.js only accept WinAnsi text with standard fonts; replace the rest.
  CD.winAnsi = (s) => String(s).replace(/\r/g, '').replace(/\t/g, '    ').replace(/[^\x09\x0a\x20-\x7e\xa0-\xff]/g, '?');

  CD.download = (blob, name) => {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 15000);
  };
  CD.zip = async (results) => {
    const z = new JSZip();
    const seen = {};
    for (const r of results) {
      let n = r.name, i = 1;
      while (seen[n]) n = r.name.replace(/(\.[^.]+)?$/, `_${i++}$1`);
      seen[n] = 1;
      z.file(n, r.blob);
    }
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  };
  CD.readText = (file) => file.text();
})();
