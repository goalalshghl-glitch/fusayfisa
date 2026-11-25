/* =========================================================
   فسيفساء — مكتبة مراجع شخصية بسيطة
   كل شيء يُحفظ على جهاز المستخدم (IndexedDB) ويعمل دون إنترنت.
   ========================================================= */
'use strict';

const APP_VERSION = '2.0.0';
const DB_NAME = 'fusayfisa';
const DB_VERSION = 1; // نفس قاعدة البيانات السابقة حتى لا تضيع المراجع المحفوظة

/* ---------- أدوات صغيرة ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const icon = (n) => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
/** توحيد النص العربي للبحث (يتجاهل التشكيل والهمزات) */
function normalize(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
}
const ext = (name) => (String(name).match(/\.([a-z0-9]{1,6})$/i)?.[1] || 'ملف').toUpperCase();

function toast(msg, type = '') {
  const t = el(`<div class="toast ${type}">${type === 'ok' ? icon('check') : ''}<span>${esc(msg)}</span></div>`);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 4500 : 2200);
}

/* ---------- قاعدة البيانات ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        ['images', 'files', 'thumbs', 'sections', 'categories', 'subjects', 'collections'].forEach((n) => {
          if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' });
        });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      let out;
      const tx = this.db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  get(s, k) { return this.run(s, 'readonly', (st) => st.get(k)); },
  all(s) { return this.run(s, 'readonly', (st) => st.getAll()); },
  put(s, v) { return this.run(s, 'readwrite', (st) => st.put(v)); },
  del(s, k) { return this.run(s, 'readwrite', (st) => st.delete(k)); },
  batch(stores, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      fn((n) => tx.objectStore(n));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};
const friendlyError = (e) => (e?.name === 'QuotaExceededError' ? 'مساحة الجهاز المخصصة للموقع ممتلئة. احذف بعض المراجع ثم حاول مجدداً.' : 'تعذّر الحفظ، حاول مرة أخرى.');

/* ---------- الحالة ---------- */
const S = { items: new Map(), groups: new Map(), q: '', group: null };

async function loadAll() {
  const [items, groups] = await Promise.all([DB.all('images'), DB.all('collections')]);
  S.items = new Map(items.map((i) => [i.id, i]));
  S.groups = new Map(groups.map((g) => [g.id, g]));
}
const newest = (a, b) => b.createdAt - a.createdAt;
const noteOf = (i) => i.notes || i.description || '';
function matches(item, q) {
  const words = normalize(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = normalize(`${item.name} ${noteOf(item)} ${item.text?.body || ''}`);
  return words.every((w) => hay.includes(w));
}

/* ---------- حفظ المراجع ---------- */
async function readImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    return { bmp, w: bmp.width, h: bmp.height };
  } catch {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => resolve({ bmp: im, w: im.naturalWidth, h: im.naturalHeight, url });
      im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }
}
const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
async function makeThumb(img) {
  const scale = Math.min(1, 560 / img.w);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.w * scale)); c.height = Math.max(1, Math.round(img.h * scale));
  c.getContext('2d').drawImage(img.bmp, 0, 0, c.width, c.height);
  let b = await toBlob(c, 'image/webp', 0.82);
  if (!b || b.type !== 'image/webp') b = await toBlob(c, 'image/jpeg', 0.85);
  return b;
}
async function saveFile(file, name, note, groupId) {
  const id = uid();
  const now = Date.now();
  const rec = { id, name: name || file.name.replace(/\.[^.]+$/, ''), notes: note, favorite: false, createdAt: now, updatedAt: now, mime: file.type || '', size: file.size, fileName: file.name, kind: 'file' };
  let thumb = null;
  if (file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name)) {
    const img = await readImage(file);
    if (img && img.w && img.h) {
      rec.kind = 'image'; rec.width = img.w; rec.height = img.h;
      thumb = await makeThumb(img);
      img.bmp.close?.();
      if (img.url) URL.revokeObjectURL(img.url);
    }
  }
  const blob = file.slice(0, file.size, file.type);
  const group = groupId ? S.groups.get(groupId) : null;
  if (group) group.imageIds.push(id);
  await DB.batch(['images', 'files', 'thumbs', 'collections'], (st) => {
    st('images').put(rec);
    st('files').put({ id, blob });
    if (thumb) st('thumbs').put({ id, blob: thumb });
    if (group) st('collections').put(group);
  });
  S.items.set(id, rec);
}
async function updateItem(id, patch) {
  const rec = { ...S.items.get(id), ...patch, updatedAt: Date.now() };
  await DB.put('images', rec);
  S.items.set(id, rec);
  return rec;
}
async function deleteItem(id) {
  const groups = [...S.groups.values()].filter((g) => g.imageIds.includes(id));
  await DB.batch(['images', 'files', 'thumbs', 'collections'], (st) => {
    st('images').delete(id); st('files').delete(id); st('thumbs').delete(id);
    groups.forEach((g) => { g.imageIds = g.imageIds.filter((x) => x !== id); if (g.coverId === id) g.coverId = null; st('collections').put(g); });
  });
  S.items.delete(id);
  const u = thumbs.get(id);
  if (typeof u === 'string') URL.revokeObjectURL(u);
  thumbs.delete(id);
}
let persistAsked = false;
function keepDataSafe() {
  // نطلب من المتصفح عدم حذف بيانات الموقع تلقائياً
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
}

/* ---------- الصور المصغرة (تُحمّل عند ظهورها) ---------- */
const thumbs = new Map();
function thumbURL(id) {
  if (!thumbs.has(id)) {
    thumbs.set(id, DB.get('thumbs', id).then((r) => {
      const u = r ? URL.createObjectURL(r.blob) : null;
      thumbs.set(id, u);
      return u;
    }).catch(() => null));
  }
  return Promise.resolve(thumbs.get(id));
}
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  io.unobserve(e.target);
  loadThumb(e.target);
}), { rootMargin: '600px 0px' }) : null;
async function loadThumb(img) {
  const u = await thumbURL(img.dataset.id);
  if (!u) return;
  img.onload = () => img.classList.add('loaded');
  img.src = u;
}

/* ---------- النوافذ (زر الرجوع في الجوال يغلقها) ---------- */
const modals = [];
const waiting = [];
function openModal(node, { cls = '', onClose } = {}) {
  const wrap = el(`<div class="modal ${cls}" role="dialog" aria-modal="true"><div class="backdrop"></div></div>`);
  wrap.append(node);
  $('#modalRoot').append(wrap);
  document.body.classList.add('modal-open');
  modals.push({ wrap, onClose });
  history.pushState({ modal: modals.length }, '');
  $('.backdrop', wrap).onclick = () => closeModal();
  $$('[data-close]', node).forEach((b) => { b.onclick = () => closeModal(); });
  requestAnimationFrame(() => wrap.classList.add('show'));
}
function closeModal() {
  if (!modals.length) return Promise.resolve();
  return new Promise((r) => { waiting.push(r); history.back(); });
}
window.addEventListener('popstate', () => {
  const m = modals.pop();
  if (!m) return;
  m.wrap.classList.remove('show');
  setTimeout(() => m.wrap.remove(), 220);
  if (!modals.length) document.body.classList.remove('modal-open');
  m.onClose?.();
  waiting.shift()?.();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modals.length) closeModal(); });

function confirmBox(message, okText) {
  return new Promise((resolve) => {
    let ok = false;
    const node = el(`<div class="sheet"><div class="sheet-head"><h2>${esc(message)}</h2></div>
      <div class="row"><button class="btn light" type="button" data-close>إلغاء</button><button class="btn danger" type="button" data-ok>${esc(okText)}</button></div></div>`);
    $('[data-ok]', node).onclick = () => { ok = true; closeModal(); };
    openModal(node, { onClose: () => resolve(ok) });
  });
}
function askName(title, placeholder) {
  return new Promise((resolve) => {
    let val = null;
    const node = el(`<form class="sheet"><div class="sheet-head"><h2>${esc(title)}</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
      <label class="field"><input class="input" name="v" maxlength="60" placeholder="${esc(placeholder)}" autocomplete="off"></label>
      <button class="btn" type="submit" disabled>إنشاء</button></form>`);
    const inp = node.elements.v, btn = $('[type=submit]', node);
    inp.oninput = () => { btn.disabled = !inp.value.trim(); };
    node.onsubmit = (e) => { e.preventDefault(); val = inp.value.trim(); if (val) closeModal(); };
    openModal(node, { onClose: () => resolve(val) });
    setTimeout(() => inp.focus(), 250);
  });
}

/* ---------- إضافة مرجع: اختيار ← حفظ ← انتهى ---------- */
function openAdd(initialFiles) {
  const files = [];
  const urls = [];
  const node = el(`<form class="sheet" novalidate>
    <div class="sheet-head"><h2>إضافة مرجع</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <label class="pick">${icon('upload')}<b>اختر صورة أو ملف</b><span>يمكنك اختيار أكثر من واحد</span><input type="file" multiple name="f"></label>
    <div class="chosen" hidden></div>
    <label class="field"><span>الاسم (اختياري)</span><input class="input" name="name" maxlength="120" autocomplete="off"></label>
    <label class="field"><span>ملاحظة (اختياري)</span><textarea class="input" name="note" maxlength="2000"></textarea></label>
    <button class="btn" type="submit" disabled>حفظ</button>
  </form>`);
  const chosen = $('.chosen', node), save = $('[type=submit]', node), pick = $('.pick', node);
  const paint = () => {
    urls.forEach(URL.revokeObjectURL); urls.length = 0;
    chosen.innerHTML = '';
    files.forEach((f, i) => {
      let inner = `<span>${esc(ext(f.name))}</span>`;
      if (f.type.startsWith('image/')) { const u = URL.createObjectURL(f); urls.push(u); inner = `<img src="${u}" alt="">`; }
      const d = el(`<div>${inner}<button type="button" aria-label="إزالة">${icon('x')}</button></div>`);
      $('button', d).onclick = () => { files.splice(i, 1); paint(); };
      chosen.append(d);
    });
    chosen.hidden = !files.length;
    save.disabled = !files.length;
    save.textContent = files.length > 1 ? `حفظ (${files.length})` : 'حفظ';
  };
  const add = (list) => { files.push(...list); paint(); };
  node.elements.f.onchange = (e) => { add(e.target.files); e.target.value = ''; };
  pick.addEventListener('dragover', (e) => { e.preventDefault(); pick.classList.add('over'); });
  pick.addEventListener('dragleave', () => pick.classList.remove('over'));
  pick.addEventListener('drop', (e) => { e.preventDefault(); pick.classList.remove('over'); add(e.dataTransfer.files); });
  if (initialFiles) add(initialFiles);

  node.onsubmit = async (e) => {
    e.preventDefault();
    if (!files.length) return;
    save.disabled = true;
    const name = node.elements.name.value.trim(), note = node.elements.note.value.trim();
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      save.textContent = files.length > 1 ? `جاري الحفظ ${i + 1} من ${files.length}…` : 'جاري الحفظ…';
      try {
        await saveFile(files[i], name ? (files.length > 1 ? `${name} ${i + 1}` : name) : '', note, S.group);
        ok++;
      } catch (err) {
        console.error(err);
        toast(friendlyError(err), 'err');
        if (err?.name === 'QuotaExceededError') break;
      }
    }
    if (!ok) { save.disabled = false; save.textContent = 'حفظ'; return; }
    toast(ok > 1 ? `حُفظت ${ok} مراجع` : 'تم الحفظ', 'ok');
    keepDataSafe();
    await closeModal();
    if (location.hash.startsWith('#/fav')) location.hash = '#/'; else render();
  };
  openModal(node, { onClose: () => urls.forEach(URL.revokeObjectURL) });
}

/* ---------- عرض مرجع ---------- */
async function openItem(id, list) {
  const item = S.items.get(id);
  if (!item) return;
  let changed = false;
  let fileURL = null;
  const stored = await DB.get('files', id);
  const blob = stored?.blob || null;
  if (blob) fileURL = URL.createObjectURL(blob);

  let media;
  if (item.kind === 'image' && fileURL) media = `<img src="${fileURL}" alt="${esc(item.name)}">`;
  else if (item.kind === 'text') media = `<div class="v-text">${esc(item.text?.body || '')}</div>`;
  else media = `<div class="v-file">${icon('file')}<b>${esc(item.fileName || item.name)}</b>${fileURL ? `<a class="btn" href="${fileURL}" target="_blank" rel="noopener" download="${esc(item.fileName || item.name)}">${icon('external')} فتح الملف</a>` : '<span>الملف غير متوفر</span>'}</div>`;

  const canShareFile = blob && navigator.canShare?.({ files: [new File([blob], item.fileName || 'file', { type: blob.type })] });
  const canShare = canShareFile || !!navigator.share;
  const canCopyImage = item.kind === 'image' && blob && window.ClipboardItem && navigator.clipboard?.write;

  const node = el(`<div class="viewer">
    <div class="v-top"><button class="x" type="button" data-close aria-label="رجوع">${icon('x')}</button></div>
    <div class="v-media">${media}</div>
    <div class="v-panel">
      <label class="field"><input class="input name-in" name="name" value="${esc(item.name)}" maxlength="120" aria-label="اسم المرجع" placeholder="بدون اسم"></label>
      <label class="field"><textarea class="input" name="note" maxlength="2000" placeholder="اكتب ملاحظة…" aria-label="ملاحظة">${esc(noteOf(item))}</textarea></label>
      <p class="saved" aria-live="polite"></p>
      <div class="acts">
        <button class="act ${item.favorite ? 'on' : ''}" type="button" data-a="fav">${icon('heart')}<span>${item.favorite ? 'في المفضلة' : 'مفضلة'}</span></button>
        ${canShare ? `<button class="act" type="button" data-a="share">${icon('share')}<span>مشاركة</span></button>` : ''}
        <button class="act" type="button" data-a="copy">${icon('copy')}<span>نسخ</span></button>
        <button class="act del" type="button" data-a="del">${icon('trash')}<span>حذف</span></button>
      </div>
      <div class="v-groups"></div>
    </div></div>`);

  // حفظ الاسم والملاحظة تلقائياً أثناء الكتابة
  const saved = $('.saved', node);
  const autosave = debounce(async () => {
    try {
      await updateItem(id, { name: node.querySelector('[name=name]').value.trim() || item.name, notes: node.querySelector('[name=note]').value.trim(), description: '' });
      changed = true;
      saved.textContent = 'تم الحفظ تلقائياً';
    } catch (err) { toast(friendlyError(err), 'err'); }
  }, 500);
  $$('[name=name], [name=note]', node).forEach((f) => { f.oninput = () => { saved.textContent = ''; autosave(); }; });

  const groupsBox = $('.v-groups', node);
  const paintGroups = () => {
    groupsBox.innerHTML = '';
    if (!S.groups.size) return;
    groupsBox.append(el('<span class="label">في مجموعة:</span>'));
    S.groups.forEach((g) => {
      const on = g.imageIds.includes(id);
      const b = el(`<button type="button" class="chip ${on ? 'on' : ''}" aria-pressed="${on}">${on ? icon('check') : ''}${esc(g.name)}</button>`);
      b.onclick = async () => {
        if (on) g.imageIds = g.imageIds.filter((x) => x !== id); else g.imageIds.push(id);
        await DB.put('collections', g);
        changed = true;
        paintGroups();
      };
      groupsBox.append(b);
    });
  };
  paintGroups();

  $('.acts', node).onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const cur = S.items.get(id);
    if (a === 'fav') {
      const fav = !cur.favorite;
      await updateItem(id, { favorite: fav, favoritedAt: fav ? Date.now() : null });
      changed = true;
      b.classList.toggle('on', fav);
      $('span', b).textContent = fav ? 'في المفضلة' : 'مفضلة';
      toast(fav ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة', 'ok');
    }
    if (a === 'share') {
      try {
        const file = blob ? new File([blob], cur.fileName || `${cur.name}`, { type: blob.type }) : null;
        if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: cur.name, text: noteOf(cur) || undefined });
        else await navigator.share({ title: cur.name, text: [cur.name, noteOf(cur)].filter(Boolean).join('\n') });
      } catch (err) { if (err?.name !== 'AbortError') toast('تعذّرت المشاركة', 'err'); }
    }
    if (a === 'copy') {
      try {
        if (canCopyImage) {
          let png = blob;
          if (blob.type !== 'image/png') {
            const img = await readImage(blob);
            const c = document.createElement('canvas'); c.width = img.w; c.height = img.h;
            c.getContext('2d').drawImage(img.bmp, 0, 0);
            png = await toBlob(c, 'image/png');
          }
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
          toast('نُسخت الصورة', 'ok');
        } else {
          await navigator.clipboard.writeText([cur.name, noteOf(cur), cur.text?.body].filter(Boolean).join('\n'));
          toast('نُسخ الاسم والملاحظة', 'ok');
        }
      } catch {
        try { await navigator.clipboard.writeText([cur.name, noteOf(cur)].filter(Boolean).join('\n')); toast('نُسخ الاسم والملاحظة', 'ok'); } catch { toast('تعذّر النسخ', 'err'); }
      }
    }
    if (a === 'del') {
      if (!(await confirmBox('حذف هذا المرجع نهائياً؟', 'حذف'))) return;
      await deleteItem(id);
      changed = true;
      toast('حُذف المرجع', 'ok');
      closeModal();
    }
  };

  openModal(node, { cls: 'view', onClose: () => { if (fileURL) setTimeout(() => URL.revokeObjectURL(fileURL), 1000); if (changed) render(); } });
}

/* ---------- الصفحات ---------- */
function cardHTML(i) {
  let top;
  if (i.kind === 'image') top = `<span class="ph" style="aspect-ratio:${i.width} / ${i.height}"><img data-id="${i.id}" alt="" decoding="async"></span>`;
  else if (i.kind === 'text') top = `<span class="textph">${esc((i.text?.body || '').slice(0, 220))}</span>`;
  else top = `<span class="fileph">${icon('file')}<small>${esc(ext(i.fileName || i.name))}</small></span>`;
  const note = noteOf(i);
  return `<button class="card" type="button" data-id="${i.id}" aria-label="${esc(i.name)}">${top}
    <span class="name">${esc(i.name || 'بدون اسم')}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}
    ${i.favorite ? `<span class="heart">${icon('heart')}</span>` : ''}</button>`;
}
/** شبكة بأعمدة متوازنة تحافظ على أبعاد الصور، وتُضاف البطاقات تدريجياً */
function gridEl(list) {
  const w = $('#main').clientWidth || innerWidth;
  const n = w < 520 ? 2 : w < 820 ? 3 : w < 1050 ? 4 : 5;
  const grid = el('<div class="grid"></div>');
  const cols = Array.from({ length: n }, () => el('<div class="col"></div>'));
  grid.append(...cols);
  const h = new Array(n).fill(0);
  let shown = 0;
  const more = () => {
    list.slice(shown, shown + 40).forEach((i) => {
      const k = h.indexOf(Math.min(...h));
      const card = el(cardHTML(i));
      cols[k].append(card);
      h[k] += (i.kind === 'image' ? i.height / i.width : 0.8) + 0.2;
      const img = $('img', card);
      if (img) io ? io.observe(img) : loadThumb(img);
    });
    shown += 40;
  };
  more();
  if (shown < list.length) {
    const s = el('<div style="height:1px"></div>');
    const obs = new IntersectionObserver((e) => { if (e[0].isIntersecting) { more(); if (shown >= list.length) { obs.disconnect(); s.remove(); } } }, { rootMargin: '800px 0px' });
    requestAnimationFrame(() => { grid.after(s); obs.observe(s); });
  }
  grid.onclick = (e) => { const c = e.target.closest('.card'); if (c) openItem(c.dataset.id, list); };
  return grid;
}
function emptyEl(title, text, withAdd) {
  return el(`<div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p>${withAdd ? `<button class="add" type="button" data-add>${icon('plus')}<span>إضافة مرجع</span></button>` : ''}</div>`);
}

function render() {
  const fav = location.hash.startsWith('#/fav');
  const main = $('#main');
  main.innerHTML = '';
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === (fav ? '/fav' : '/')));
  if (S.group && !S.groups.has(S.group)) S.group = null;

  let list = [...S.items.values()];
  if (fav) {
    main.append(el('<h1 class="page-title">المفضلة</h1>'));
    list = list.filter((i) => i.favorite).sort((a, b) => (b.favoritedAt || b.createdAt) - (a.favoritedAt || a.createdAt));
  } else {
    // المجموعات: اختيارية تماماً
    const bar = el('<div class="groups" role="tablist"></div>');
    const chip = (id, label) => {
      const b = el(`<button type="button" class="chip ${S.group === id ? 'on' : ''}">${esc(label)}</button>`);
      b.onclick = () => { S.group = id; render(); };
      bar.append(b);
    };
    chip(null, 'الكل');
    [...S.groups.values()].sort((a, b) => a.createdAt - b.createdAt).forEach((g) => chip(g.id, g.name));
    const nb = el(`<button type="button" class="chip ghost">${icon('plus')} مجموعة</button>`);
    nb.onclick = async () => {
      const name = await askName('مجموعة جديدة', 'مثال: أفكار للرسم');
      if (!name) return;
      const g = { id: uid(), name, imageIds: [], coverId: null, createdAt: Date.now() };
      await DB.put('collections', g);
      S.groups.set(g.id, g);
      S.group = g.id;
      render();
    };
    bar.append(nb);
    main.append(bar);
    if (S.group) {
      const g = S.groups.get(S.group);
      list = g.imageIds.map((x) => S.items.get(x)).filter(Boolean);
      const gb = el(`<div class="group-bar"><span>${list.length} مرجع · أضف إليها من داخل أي مرجع</span><button class="link" type="button">حذف المجموعة</button></div>`);
      $('button', gb).onclick = async () => {
        if (!(await confirmBox(`حذف مجموعة «${g.name}»؟ المراجع نفسها لن تُحذف.`, 'حذف'))) return;
        await DB.del('collections', g.id);
        S.groups.delete(g.id);
        S.group = null;
        render();
      };
      main.append(gb);
    } else list.sort(newest);
  }

  if (S.q) list = list.filter((i) => matches(i, S.q));

  if (!list.length) {
    if (S.q) main.append(emptyEl('لا توجد نتائج', 'جرّب كلمة أخرى.', false));
    else if (fav) main.append(emptyEl('لا يوجد شيء في المفضلة', 'افتح أي مرجع واضغط «مفضلة».', false));
    else if (S.group) main.append(emptyEl('المجموعة فارغة', 'افتح أي مرجع واختر هذه المجموعة من أسفله.', false));
    else main.append(emptyEl('لا توجد مراجع بعد', 'اضغط «إضافة» لحفظ أول صورة أو ملف.', true));
    return;
  }
  main.append(gridEl(list));
}

/* ---------- التشغيل ---------- */
async function init() {
  try {
    await DB.open();
    await loadAll();
  } catch (err) {
    console.error(err);
    $('#main').append(emptyEl('تعذّر فتح المكتبة', 'إن كنت تستخدم التصفح الخاص، افتح الموقع في نافذة عادية.', false));
    return;
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-add]')) openAdd(); });
  $('#q').addEventListener('input', debounce((e) => { S.q = e.target.value; render(); }, 150));
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  window.addEventListener('hashchange', render);
  window.addEventListener('resize', debounce(() => { if (!modals.length) render(); }, 250));
  // سحب ملفات إلى الصفحة يفتح نافذة الإضافة مباشرة (على الكمبيوتر)
  document.addEventListener('dragover', (e) => { if (!modals.length) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (modals.length || !e.dataTransfer?.files?.length) return; e.preventDefault(); openAdd(e.dataTransfer.files); });
  render();

  // العمل دون إنترنت بعد أول زيارة
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
}
init();
