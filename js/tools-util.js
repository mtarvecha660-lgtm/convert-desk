/* Convert Desk: utilities (QR code, Base64, checksums). */
(function () {
  const CD = window.CD;
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ALGO = { 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-384': 'SHA-384', 'SHA-512': 'SHA-512' };

  CD.register([
    {
      id: 'qr', group: 'util', icon: 'QR', title: 'QR code',
      desc: 'Make a QR code from text or a link, saved as a PNG. Made on this device.',
      accepts: 'none', mode: 'form', action: 'Make QR code',
      options: [
        { id: 'text', type: 'textarea', label: 'Text or link', value: '', placeholder: 'https://example.com', rows: 3 },
        { id: 'size', type: 'select', label: 'Size', value: '768', choices: [['384', '384 px'], ['768', '768 px'], ['1024', '1024 px']] },
        { id: 'ec', type: 'select', label: 'Error correction', value: 'M', choices: [['L', 'Low (smallest code)'], ['M', 'Medium'], ['H', 'High (still scans when partly damaged)']] },
      ],
      async runForm(o) {
        const text = String(o.text || '').trim();
        if (!text) throw new Error('type some text or a link first');
        if (text.length > 1500) throw new Error('that is too long for a QR code (1,500 characters max)');
        if (!window.qrcode) throw new Error('the QR library did not load; reload the page');
        const q = qrcode(0, o.ec || 'M');
        q.addData(text);
        q.make();
        const n = q.getModuleCount();
        const margin = 4;
        const cell = Math.max(2, Math.floor(Number(o.size) / (n + 2 * margin)));
        const cv = document.createElement('canvas');
        cv.width = cv.height = (n + 2 * margin) * cell;
        const x = cv.getContext('2d');
        x.fillStyle = '#ffffff';
        x.fillRect(0, 0, cv.width, cv.height);
        x.fillStyle = '#000000';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          if (q.isDark(r, c)) x.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
        }
        const blob = await CD.canvasBlob(cv, 'image/png', 1);
        return [{ name: 'qr-code.png', blob, big: true, note: text.length > 60 ? text.slice(0, 60) + '…' : text }];
      },
    },
    {
      id: 'base64', group: 'util', icon: 'B64', title: 'Base64 text',
      desc: 'Encode text to Base64, or decode Base64 back to text. Works with any language.',
      accepts: 'none', mode: 'form', action: 'Convert',
      options: [
        { id: 'mode', type: 'select', label: 'Direction', value: 'encode', choices: [['encode', 'Text to Base64'], ['decode', 'Base64 to text']] },
        { id: 'text', type: 'textarea', label: 'Input', value: '', rows: 5, placeholder: 'Paste here' },
      ],
      async runForm(o) {
        const src = String(o.text || '');
        if (!src.trim()) throw new Error('paste some text first');
        let out;
        if (o.mode === 'decode') {
          let bin;
          try { bin = atob(src.replace(/\s+/g, '')); }
          catch (e) { throw new Error("that isn't valid Base64"); }
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          try { out = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
          catch (e) { throw new Error('these bytes are not UTF-8 text, so they cannot be shown as text'); }
        } else {
          let bin = '';
          new TextEncoder().encode(src).forEach((b) => { bin += String.fromCharCode(b); });
          out = btoa(bin);
        }
        return [{ name: o.mode === 'decode' ? 'decoded.txt' : 'encoded.txt', text: out, blob: new Blob([out], { type: 'text/plain' }) }];
      },
    },
    {
      id: 'hash', group: 'util', icon: '#', title: 'File checksum',
      desc: 'SHA-256, SHA-512, SHA-384 or SHA-1 of a file, to check a download. With no file, hashes the text you type.',
      accepts: 'any', mode: 'each', action: 'Compute',
      options: [
        { id: 'algo', type: 'select', label: 'Algorithm', value: 'SHA-256', choices: [['SHA-256', 'SHA-256'], ['SHA-512', 'SHA-512'], ['SHA-384', 'SHA-384'], ['SHA-1', 'SHA-1 (old)']] },
        { id: 'text', type: 'textarea', label: 'Text to hash (used when no file is added)', value: '', rows: 3 },
      ],
      async runOne(it, o, ctx) {
        const buf = await it.file.arrayBuffer();
        ctx.progress(it, 70);
        const digest = hex(await crypto.subtle.digest(ALGO[o.algo] || 'SHA-256', buf));
        const line = `${o.algo}  ${digest}`;
        return [{ name: `${it.file.name}.${o.algo.replace('-', '').toLowerCase()}.txt`, text: `${line}\n${it.file.name}\n`, blob: new Blob([`${line}\n${it.file.name}\n`], { type: 'text/plain' }) }];
      },
      async runForm(o) {
        const src = String(o.text || '');
        if (!src.trim()) throw new Error('add a file, or type some text to hash');
        const digest = hex(await crypto.subtle.digest(ALGO[o.algo] || 'SHA-256', new TextEncoder().encode(src)));
        const out = `${o.algo}  ${digest}\n`;
        return [{ name: `text.${o.algo.replace('-', '').toLowerCase()}.txt`, text: out, blob: new Blob([out], { type: 'text/plain' }) }];
      },
    },
  ]);
})();
