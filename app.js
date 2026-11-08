/* Convert Desk: the page itself. Tools live in js/*.js and register with CD.register. */
(function () {
  const CD = window.CD;
  const $ = (s, el) => (el || document).querySelector(s);
  const app = $('#app');
  const picker = $('#picker');
  const GROUPS = [['convert', 'Convert'], ['image', 'Images'], ['pdf', 'PDF'], ['util', 'Utilities']];
  const ACCEPT_TEXT = {
    image: 'JPG, PNG, WebP, BMP, GIF', pdf: 'PDF', csv: 'CSV', xlsx: 'XLSX, XLS',
    docx: 'DOCX', json: 'JSON', text: 'TXT, MD, LOG, SRT, XML, HTML',
  };
  const BRAND = '<a class="brand" href="#/"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f5a300" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg><span>Convert Desk</span></a>';
  const S = (CD.app = { queue: [], results: [], tool: null, running: false, uid: 0 });

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdfjs/pdf.worker.min.js';

  /* ---------- theme ---------- */
  const themeBtn = $('#theme');
  function effectiveDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  themeBtn.addEventListener('click', () => {
    const next = effectiveDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('cd-theme', next); } catch (e) {}
  });
  try {
    const saved = localStorage.getItem('cd-theme');
    if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
  } catch (e) {}

  /* ---------- toasts ---------- */
  function toast(msg, bad) {
    const el = document.createElement('div');
    el.className = 'toast' + (bad ? ' bad' : '');
    el.setAttribute('role', bad ? 'alert' : 'status');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), bad ? 6000 : 3500);
    setTimeout(() => el.remove(), bad ? 6500 : 4000);
  }
  CD.toast = toast;

  /* ---------- queue ---------- */
  function addFiles(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    for (const f of files) {
      const kind = CD.kindOf(f);
      S.queue.push({
        id: ++S.uid, file: f, kind, status: 'ready', pct: 0, err: '',
        thumb: kind === 'image' ? URL.createObjectURL(f) : null,
      });
    }
    const n = files.length;
    if (S.tool) render();
    else {
      render();
      toast(`${n} file${n > 1 ? 's' : ''} added. Pick a tool.`);
    }
  }
  function removeItem(id) {
    const i = S.queue.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (S.queue[i].thumb) URL.revokeObjectURL(S.queue[i].thumb);
    S.queue.splice(i, 1);
    render();
  }
  function clearQueue() {
    S.queue.forEach((x) => x.thumb && URL.revokeObjectURL(x.thumb));
    S.queue = [];
    render();
  }
  function clearResults() {
    S.results.forEach((r) => r._url && URL.revokeObjectURL(r._url));
    S.results = [];
    render();
  }
  function toolFor(id) { return CD.tools.find((t) => t.id === id); }

  /* ---------- routing ---------- */
  function route() {
    const m = location.hash.match(/^#\/t\/([\w-]+)/);
    const tool = m ? toolFor(m[1]) : null;
    if (S.tool !== tool) {
      S.results.forEach((r) => r._url && URL.revokeObjectURL(r._url));
      S.results = [];
    }
    S.tool = tool || null;
    window.scrollTo(0, 0);
    render();
  }
  window.addEventListener('hashchange', route);

  /* ---------- rendering ---------- */
  const esc = CD.esc;
  function statusText(it) {
    if (it.status === 'working') return `${it.pct}%`;
    if (it.status === 'done') return 'done';
    if (it.status === 'error') return it.err;
    if (!it.kind) return 'type not supported by any tool here';
    return `${CD.human(it.file.size)} · ${KIND_LABEL(it.kind)}`;
  }
  function KIND_LABEL(k) {
    return { image: 'image', pdf: 'PDF', csv: 'CSV', xlsx: 'spreadsheet', docx: 'Word', json: 'JSON', text: 'text' }[k] || 'file';
  }
  function rowHtml(it, tool) {
    const dim = tool && tool.accepts !== 'any' && !CD.accepts(tool, it) ? ' dim' : '';
    const thumb = it.thumb ? `<img src="${it.thumb}" alt="">` : `<span>${(it.kind || '?').slice(0, 4).toUpperCase()}</span>`;
    return `<li class="row ${it.status}${dim}" data-qid="${it.id}">
      <div class="thumb">${thumb}</div>
      <div class="meta">
        <b class="nm">${esc(it.file.name)}</b>
        <small class="st">${esc(statusText(it))}</small>
        <div class="bar"><i style="width:${it.pct}%"></i></div>
      </div>
      <button class="x" type="button" data-rm="${it.id}" aria-label="Remove ${esc(it.file.name)}">×</button>
    </li>`;
  }
  function paintRow(it) {
    const el = document.querySelector(`[data-qid="${it.id}"]`);
    if (!el) return;
    el.className = `row ${it.status}` + (S.tool && S.tool.accepts !== 'any' && !CD.accepts(S.tool, it) ? ' dim' : '');
    el.querySelector('.bar i').style.width = it.pct + '%';
    el.querySelector('.st').textContent = statusText(it);
  }

  function fieldHtml(o) {
    const id = `o-${o.id}`;
    if (o.type === 'select') {
      return `<label class="field"><span>${esc(o.label)}</span><select id="${id}" name="${o.id}">${o.choices
        .map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(o.value) ? ' selected' : ''}>${esc(l)}</option>`)
        .join('')}</select></label>`;
    }
    if (o.type === 'range') {
      return `<label class="field"><span>${esc(o.label)} <output for="${id}">${o.value}${o.unit || ''}</output></span>
        <input id="${id}" name="${o.id}" type="range" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${o.value}" data-unit="${esc(o.unit || '')}"></label>`;
    }
    if (o.type === 'number') {
      return `<label class="field"><span>${esc(o.label)}</span><input id="${id}" name="${o.id}" type="number" inputmode="decimal" min="${o.min ?? ''}" max="${o.max ?? ''}" step="${o.step || 1}" value="${esc(o.value)}"></label>`;
    }
    if (o.type === 'textarea') {
      return `<label class="field"><span>${esc(o.label)}</span><textarea id="${id}" name="${o.id}" rows="${o.rows || 4}" placeholder="${esc(o.placeholder || '')}">${esc(o.value || '')}</textarea></label>`;
    }
    if (o.type === 'check') {
      return `<label class="check"><input id="${id}" name="${o.id}" type="checkbox"${o.value ? ' checked' : ''}><span>${esc(o.label)}</span></label>`;
    }
    return `<label class="field"><span>${esc(o.label)}</span><input id="${id}" name="${o.id}" type="text" placeholder="${esc(o.placeholder || '')}" value="${esc(o.value || '')}"></label>`;
  }
  function readOpts(tool) {
    const opts = {};
    (tool.options || []).forEach((o) => {
      const el = document.getElementById(`o-${o.id}`);
      if (!el) { opts[o.id] = o.value; return; }
      if (o.type === 'check') opts[o.id] = el.checked;
      else if (o.type === 'range' || o.type === 'number') opts[o.id] = el.value === '' ? null : Number(el.value);
      else opts[o.id] = el.value;
    });
    return opts;
  }

  function resultHtml(r, i) {
    if (r.text != null) {
      return `<li class="res res-text">
        <div class="meta"><b class="nm">${esc(r.name)}</b><small>${esc(r.note || '')}</small></div>
        <textarea readonly rows="${Math.min(10, Math.max(2, String(r.text).split('\n').length))}" aria-label="${esc(r.name)}">${esc(r.text)}</textarea>
        <div class="res-actions"><button class="btn sm ghost" type="button" data-copy="${i}">Copy</button>
        ${r.blob ? `<button class="btn sm" type="button" data-dl="${i}">Download</button>` : ''}</div>
      </li>`;
    }
    if (r.blob && r.blob.type.startsWith('image/') && !r._url) r._url = URL.createObjectURL(r.blob);
    const thumb = r._url ? `<img src="${r._url}" alt="">` : `<span>${esc((CD.ext(r.name) || 'FILE').toUpperCase())}</span>`;
    let size = CD.human(r.blob.size);
    if (r.from) size = `${CD.human(r.from)} → ${CD.human(r.blob.size)} <em class="chg">(${CD.change(r.from, r.blob.size)})</em>`;
    return `<li class="res">
      <div class="thumb">${thumb}</div>
      <div class="meta"><b class="nm">${esc(r.name)}</b><small>${size}</small>${r.note ? `<small class="note">${esc(r.note)}</small>` : ''}</div>
      <button class="btn sm" type="button" data-dl="${i}">Download</button>
    </li>`;
  }

  function resultsHtml() {
    if (!S.results.length) return '';
    const canShare = navigator.canShare && S.results.every((r) => r.blob);
    return `<section class="results" aria-label="Results">
      <div class="sec-head"><h2>Results <small>${S.results.length}</small></h2>
        <div class="row-btns">
          ${S.results.length > 1 && S.results.every((r) => r.blob) ? '<button class="btn sm" type="button" data-act="zip">Download all (ZIP)</button>' : ''}
          <button class="link" type="button" data-act="clear-res">Clear</button>
        </div></div>
      <ul class="res-list">${S.results.map(resultHtml).join('')}</ul>
    </section>`;
  }

  function dropHtml(tool, big) {
    const text = tool && tool.accepts !== 'any' && Array.isArray(tool.accepts)
      ? tool.accepts.map((k) => ACCEPT_TEXT[k]).join(' · ')
      : 'Any file';
    return `<button class="drop${big ? ' big' : ''}" id="drop" type="button" data-act="pick">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
      <strong>${big ? 'Drop files here, or tap to choose' : 'Add files'}</strong>
      <span>${esc(text)}</span>
    </button>`;
  }

  function homeHtml() {
    const n = S.queue.length;
    const fits = (t) => n && (t.accepts === 'any' || (Array.isArray(t.accepts) && S.queue.some((it) => CD.accepts(t, it))));
    const groups = GROUPS.map(([g, label]) => {
      const list = CD.tools.filter((t) => t.group === g);
      if (!list.length) return '';
      return `<section class="group"><h2>${label}</h2><div class="grid">${list
        .map((t) => {
          const cls = fits(t) ? ' fit' : n && !fits(t) ? ' dim' : '';
          return `<a class="card${cls}" href="#/t/${t.id}"><span class="tile g-${g}" aria-hidden="true">${esc(t.icon)}</span><b>${esc(t.title)}</b><small>${esc(t.desc)}</small></a>`;
        })
        .join('')}</div></section>`;
    }).join('');
    return `<section class="hero">
        <h1>Files, handled on your phone</h1>
        <p class="lede">Convert, compress, merge, split and edit files. Nothing is uploaded. It works offline once loaded.</p>
        ${dropHtml(null, true)}
        ${n ? `<div class="pending"><span>${n} file${n > 1 ? 's' : ''} ready. Pick a tool. Highlighted tools fit your files.</span><button class="link" type="button" data-act="clear">Clear</button></div>` : ''}
      </section>
      ${groups}`;
  }

  function toolHtml(tool) {
    const usesFiles = tool.accepts !== 'none';
    const n = S.queue.length;
    const fitting = usesFiles ? S.queue.filter((it) => CD.accepts(tool, it)).length : 0;
    const queueHtml = usesFiles
      ? `${n ? `<div class="qhead"><span>${n} file${n > 1 ? 's' : ''}${fitting < n ? ` · ${fitting} for this tool` : ''}</span><button class="link" type="button" data-act="clear">Clear all</button></div>` : ''}
         <ul class="queue">${S.queue.map((it) => rowHtml(it, tool)).join('')}</ul>
         ${n ? '' : dropHtml(tool, true)}
         ${n ? `<button class="drop slim" type="button" data-act="pick"><strong>+ Add more files</strong></button>` : ''}`
      : '';
    const opts = (tool.options || []).length ? `<div class="opts">${tool.options.map(fieldHtml).join('')}</div>` : '';
    return `<section class="tool">
      <p class="lede">${esc(tool.desc)}</p>
      ${queueHtml}
      ${opts}
      <div class="runbar">
        <button class="btn" type="button" data-act="run" ${S.running ? 'disabled' : ''}>${S.running ? 'Working…' : esc(tool.action || 'Run')}</button>
        <p class="status" id="status" aria-live="polite"></p>
      </div>
      ${resultsHtml()}
    </section>`;
  }

  function render() {
    const tool = S.tool;
    const head = $('#head');
    if (tool) {
      head.innerHTML = `<a class="back" href="#/" aria-label="Back to all tools">←</a><h1 class="ttl">${esc(tool.title)}</h1>`;
      app.innerHTML = toolHtml(tool);
      picker.accept = tool.accepts === 'any' ? '' : CD.acceptFor(tool.accepts || []);
    } else {
      head.innerHTML = BRAND;
      app.innerHTML = homeHtml();
      picker.accept = '';
    }
  }

  /* ---------- running ---------- */
  function setBusy(on) {
    S.running = on;
    const b = app.querySelector('[data-act="run"]');
    if (b) { b.disabled = on; b.textContent = on ? 'Working…' : (S.tool.action || 'Run'); }
  }
  function status(msg) { const s = $('#status'); if (s) s.textContent = msg; }
  function progressFor(it, p) { it.pct = Math.max(0, Math.min(100, Math.round(p))); paintRow(it); }

  async function run() {
    const tool = S.tool;
    if (!tool || S.running) return;
    let opts;
    try { opts = readOpts(tool); } catch (e) { return toast(e.message, true); }
    const items = tool.accepts === 'none' ? [] : S.queue.filter((it) => CD.accepts(tool, it));
    if (tool.accepts !== 'none' && !items.length && !tool.runForm) {
      toast(`Add ${(Array.isArray(tool.accepts) ? tool.accepts.map((k) => ACCEPT_TEXT[k]).join(' or ') : 'a file')} first.`, true);
      return picker.click();
    }
    if (tool.minFiles && items.length < tool.minFiles) return toast(`Add at least ${tool.minFiles} files.`, true);
    if (tool.validate) {
      try { tool.validate(opts, items); } catch (e) { return toast(e.message, true); }
    }
    const made = [];
    setBusy(true);
    try {
      if (!items.length && tool.runForm) {
        status('Working…');
        made.push(...(await tool.runForm(opts)));
      } else if (tool.mode === 'all') {
        items.forEach((it) => { it.status = 'working'; it.pct = 0; it.err = ''; paintRow(it); });
        status(`Working on ${items.length} files…`);
        try {
          const out = await tool.runAll(items, opts, { progress: progressFor });
          out.forEach((r) => {
            if (r.from === undefined) r.from = items.reduce((a, it) => a + it.file.size, 0);
            made.push(r);
          });
          items.forEach((it) => { it.status = 'done'; it.pct = 100; paintRow(it); });
        } catch (e) {
          items.forEach((it) => { it.status = 'error'; it.err = e.message || String(e); paintRow(it); });
          toast(e.message || String(e), true);
        }
      } else {
        let n = 0;
        for (const it of items) {
          n++;
          it.status = 'working'; it.pct = 0; it.err = ''; paintRow(it);
          status(`${n} of ${items.length}: ${it.file.name}`);
          try {
            const out = await tool.runOne(it, opts, { progress: progressFor });
            out.forEach((r) => {
              if (r.from === undefined) r.from = out.length === 1 ? it.file.size : null;
              made.push(r);
            });
            it.status = 'done'; it.pct = 100;
          } catch (e) {
            it.status = 'error';
            it.err = e.message || String(e);
            toast(`${it.file.name}: ${it.err}`, true);
          }
          paintRow(it);
          await CD.tick();
        }
      }
    } catch (e) {
      toast(e.message || String(e), true);
    }
    const hadResults = made.length > 0;
    S.results = made.concat(S.results);
    setBusy(false);
    render();
    if (hadResults) {
      const first = app.querySelector('.results');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast(`${made.length} file${made.length > 1 ? 's' : ''} ready.`);
    } else status('');
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied.'); }
    catch (e) {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); toast('Copied.'); } catch (_) { toast("Couldn't copy. Select the text and copy it.", true); }
      t.remove();
    }
  }

  /* ---------- events ---------- */
  app.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.rm) return removeItem(Number(t.dataset.rm));
    if (t.dataset.dl != null) {
      const r = S.results[Number(t.dataset.dl)];
      return r && r.blob && CD.download(r.blob, r.name);
    }
    if (t.dataset.copy != null) {
      const r = S.results[Number(t.dataset.copy)];
      return r && copyText(r.text);
    }
    switch (t.dataset.act) {
      case 'run': return run();
      case 'pick': return picker.click();
      case 'clear': return clearQueue();
      case 'clear-res': return clearResults();
      case 'zip': {
        try {
          const blob = await CD.zip(S.results);
          CD.download(blob, `convert-desk-${S.tool ? S.tool.id : 'files'}.zip`);
        } catch (err) { toast("Couldn't build the ZIP: " + err.message, true); }
        return;
      }
    }
  });
  picker.addEventListener('change', () => { addFiles(picker.files); picker.value = ''; });
  app.addEventListener('input', (e) => {
    if (e.target.type === 'range') {
      const out = app.querySelector(`output[for="${e.target.id}"]`);
      if (out) out.textContent = e.target.value + (e.target.dataset.unit || '');
    }
  });
  // drop files anywhere on the page
  document.addEventListener('dragover', (e) => { e.preventDefault(); const d = $('#drop'); if (d) d.classList.add('drag'); });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { const d = $('#drop'); if (d) d.classList.remove('drag'); } });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const d = $('#drop'); if (d) d.classList.remove('drag');
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
