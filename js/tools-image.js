/* Convert Desk: image tools. */
(function () {
  const CD = window.CD;
  const fmtFor = (name) => {
    const e = CD.ext(name);
    return e === 'jpg' || e === 'jpeg' ? 'jpg' : e === 'webp' ? 'webp' : 'png';
  };
  CD.register([
    {
      id: 'img-compress', group: 'image', icon: 'ZIP', title: 'Compress and resize',
      desc: 'Smaller JPG or WebP for photos, or PNG if you need it lossless. Set a quality and an optional max width.',
      accepts: ['image'], mode: 'each', action: 'Compress',
      options: [
        { id: 'to', type: 'select', label: 'Save as', value: 'jpg', choices: [['jpg', 'JPG (smallest for photos)'], ['webp', 'WebP (smaller still)'], ['png', 'PNG (lossless, usually bigger)']] },
        { id: 'q', type: 'range', label: 'Quality (JPG and WebP)', value: 75, min: 30, max: 100, unit: '%' },
        { id: 'maxW', type: 'select', label: 'Max width', value: '1600', choices: [['0', 'Keep original size'], ['2560', '2560 px'], ['1600', '1600 px'], ['1080', '1080 px'], ['720', '720 px']] },
      ],
      async runOne(it, o, ctx) {
        const img = await CD.loadImage(it.file);
        ctx.progress(it, 50);
        const maxW = Number(o.maxW) || 0;
        const cv = CD.drawCanvas(img, { maxW: maxW || undefined, fill: o.to === 'png' ? null : '#ffffff' });
        const blob = await CD.canvasBlob(cv, CD.mimeFor(o.to), o.q / 100);
        const note = blob.size > it.file.size ? 'Bigger than the original. Try a lower quality or a smaller width.' : '';
        return [{ name: CD.baseName(it.file.name) + '-compressed.' + o.to, blob, note }];
      },
    },
    {
      id: 'img-rotate', group: 'image', icon: '⟳', title: 'Rotate and flip',
      desc: 'Turn a picture a quarter turn, upside down, or flip it. Keeps the same file type.',
      accepts: ['image'], mode: 'each', action: 'Apply',
      options: [
        { id: 'op', type: 'select', label: 'Action', value: 'cw', choices: [['cw', 'Rotate right (90°)'], ['ccw', 'Rotate left (90°)'], ['180', 'Upside down (180°)'], ['fh', 'Flip left to right'], ['fv', 'Flip top to bottom']] },
      ],
      async runOne(it, o, ctx) {
        const fmt = fmtFor(it.file.name);
        const img = await CD.loadImage(it.file);
        ctx.progress(it, 50);
        const rotate = { cw: 90, ccw: 270, '180': 180, fh: 0, fv: 0 }[o.op];
        const cv = CD.drawCanvas(img, { rotate, flipH: o.op === 'fh', flipV: o.op === 'fv', fill: fmt === 'png' ? null : '#ffffff' });
        const blob = await CD.canvasBlob(cv, CD.mimeFor(fmt), 0.92);
        const tag = { cw: 'rotated-right', ccw: 'rotated-left', '180': 'upside-down', fh: 'flipped-h', fv: 'flipped-v' }[o.op];
        return [{ name: CD.baseName(it.file.name) + '-' + tag + '.' + fmt, blob }];
      },
    },
    {
      id: 'img-crop', group: 'image', icon: '⌗', title: 'Crop',
      desc: 'Cut a border off each side, in percent of the picture. Keeps the same file type.',
      accepts: ['image'], mode: 'each', action: 'Crop',
      options: [
        { id: 'l', type: 'number', label: 'Cut from left (%)', value: 10, min: 0, max: 90 },
        { id: 't', type: 'number', label: 'Cut from top (%)', value: 10, min: 0, max: 90 },
        { id: 'r', type: 'number', label: 'Cut from right (%)', value: 10, min: 0, max: 90 },
        { id: 'b', type: 'number', label: 'Cut from bottom (%)', value: 10, min: 0, max: 90 },
      ],
      validate(o) {
        const v = (x) => Number(x) || 0;
        if (v(o.l) + v(o.r) >= 100 || v(o.t) + v(o.b) >= 100) throw new Error('left and right, or top and bottom, must add up to less than 100%');
        if (!v(o.l) && !v(o.r) && !v(o.t) && !v(o.b)) throw new Error('set at least one side to cut');
      },
      async runOne(it, o, ctx) {
        const fmt = fmtFor(it.file.name);
        const img = await CD.loadImage(it.file);
        ctx.progress(it, 50);
        const f = (x) => (Number(x) || 0) / 100;
        const cv = CD.drawCanvas(img, { crop: { l: f(o.l), t: f(o.t), r: f(o.r), b: f(o.b) }, fill: fmt === 'png' ? null : '#ffffff' });
        const blob = await CD.canvasBlob(cv, CD.mimeFor(fmt), 0.92);
        return [{ name: CD.baseName(it.file.name) + '-cropped.' + fmt, blob }];
      },
    },
  ]);
})();
