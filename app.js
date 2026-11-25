/* =========================================================
   فسيفساء — مكتبة مراجع شخصية بسيطة
   كل شيء يُحفظ على جهاز المستخدم (IndexedDB) ويعمل دون إنترنت.
   ========================================================= */
'use strict';

const APP_VERSION = '2.2.0';
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
const S = { items: new Map(), groups: new Map(), q: '', group: null, settings: {}, unlocked: false, priv: false, pgroup: 'anime', ptype: null };

/* ---------- القسم الخاص: الأنمي والصور النسائية (بالغات فقط) ---------- */
const PRIVATE = {
  anime: { label: 'الأنمي', pin: 'anime', types: [
    ['شخصيات نسائية', 'girl character'], ['شخصيات رجالية', 'boy character'], ['شخصيات رئيسية', 'main character'], ['شخصيات ثانوية', 'side character'],
    ['شخصيات أصلية', 'original character oc'], ['تصاميم الشخصيات', 'character design sheet'], ['الملابس والأزياء', 'outfit'], ['تسريحات الشعر', 'hairstyle'],
    ['الوجوه والتعابير', 'facial expressions'], ['الوقفات والحركات', 'pose reference'], ['الجسم كاملاً', 'full body'], ['من الخصر للأعلى', 'half body'],
    ['البورتريه', 'portrait'], ['الخلفيات', 'background scenery'], ['المشاهد', 'scene'], ['أساليب الرسم', 'art style'], ['كلاسيكي', 'classic 90s'],
    ['حديث', 'modern'], ['خيالي', 'fantasy art'], ['أكشن', 'action'], ['مغامرات', 'adventure'], ['رومانسي', 'romance'], ['حياة يومية', 'slice of life'],
    ['كوميدي', 'comedy'], ['غموض', 'mystery'], ['خيال علمي', 'sci-fi'], ['فانتازيا', 'fantasy'],
  ] },
  women: { label: 'صور نسائية', pin: 'adult woman', adult: true, types: [
    ['بورتريه', 'portrait photography'], ['الجسم كاملاً', 'full body photography'], ['من الخصر للأعلى', 'half body portrait'], ['زوايا مختلفة', 'camera angles'],
    ['تصوير احترافي', 'professional photoshoot'], ['تصوير طبيعي', 'natural photography'], ['أزياء', 'fashion photography'], ['يومي', 'everyday lifestyle'],
    ['خارجي', 'outdoor photoshoot'], ['استوديو', 'studio photoshoot'], ['فني', 'fine art portrait'], ['الملابس', 'outfit'], ['تسريحات الشعر', 'hairstyle'],
    ['المكياج', 'makeup look'], ['الوقفات والحركات', 'pose reference'], ['الوجوه والتعابير', 'facial expression'],
  ] },
};
const isPrivate = (i) => i.space === 'private' || i.sectionId === 'private';
async function hashPass(pass, salt) {
  const data = new TextEncoder().encode(`${salt}:${pass}`);
  if (crypto.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let h = 2166136261; for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return 'fnv' + h.toString(16);
}
async function setSetting(key, value) { S.settings[key] = value; await DB.put('settings', { key, value }); }
async function setPassword(p) { const salt = uid(); await setSetting('privateSalt', salt); await setSetting('privateHash', await hashPass(p, salt)); }
const checkPassword = async (p) => !!S.settings.privateHash && (await hashPass(p, S.settings.privateSalt)) === S.settings.privateHash;

/* ---------- Pinterest: يفتح صفحة النتائج فقط ---------- */
function openPinterest() {
  const text = $('#q').value.trim();
  let parts = [text];
  if (S.priv) {
    const g = PRIVATE[S.pgroup];
    const t = g.types.find((x) => x[0] === S.ptype);
    parts = [g.pin, t?.[1] || '', text];
  }
  const q = parts.filter(Boolean).join(' ').trim();
  if (!q || (!S.priv && !text)) { toast('اكتب كلمة في البحث أولاً', 'err'); $('#q').focus(); return; }
  if (!navigator.onLine) return toast('Pinterest يحتاج اتصالاً بالإنترنت', 'err');
  window.open('https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(q), '_blank', 'noopener');
}

async function loadAll() {
  const [items, groups, settings, cats] = await Promise.all([DB.all('images'), DB.all('collections'), DB.all('settings'), DB.all('categories')]);
  S.settings = {};
  settings.forEach((r) => { S.settings[r.key] = r.value; });
  // مراجع المساحة الخاصة من النسخة السابقة: نحدد مجموعتها ونوعها
  const catMap = new Map(cats.map((c) => [c.id, c]));
  items.forEach((i) => {
    if (i.sectionId !== 'private' || i.pgroup) return;
    const c = catMap.get(i.categoryId), root = c?.parentId ? catMap.get(c.parentId) : c;
    i.pgroup = root && root.filters === 'anime' ? 'anime' : root ? 'women' : 'anime';
    if (c && c.parentId) i.ptype = c.name;
  });
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
async function saveFile(file, name, note, groupId, extra = {}) {
  const id = uid();
  const now = Date.now();
  const rec = { id, name: name || file.name.replace(/\.[^.]+$/, ''), notes: note, favorite: false, createdAt: now, updatedAt: now, mime: file.type || '', size: file.size, fileName: file.name, kind: 'file', ...extra };
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

/* =========================================================
   الاستيراد الجماعي: مئات الصور، ملفات ZIP، ومجلدات
   كل شيء يُقرأ داخل المتصفح ويُحفظ محلياً؛ لا رفع لأي جهة.
   ========================================================= */
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', mp4: 'video/mp4', mov: 'video/quicktime' };
const mimeOf = (name) => MIME[(name.split('.').pop() || '').toLowerCase()] || '';
const skipName = (path) => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/i.test(path) || /\/$/.test(path);
const parentFolder = (path) => { const parts = path.split('/').filter(Boolean); return parts.length > 1 ? parts[parts.length - 2] : ''; };

/** قراءة فهرس ملف ZIP دون تحميله كاملاً في الذاكرة */
async function readZip(file) {
  const tailStart = Math.max(0, file.size - 65557);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ملف ZIP غير صالح');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const utf8 = new TextDecoder('utf-8', { fatal: true }), latin = new TextDecoder('latin1');
  const out = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true), lho = cd.getUint32(p + 42, true);
    const bytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen);
    let name; try { name = utf8.decode(bytes); } catch { name = latin.decode(bytes); }
    out.push({ name, method, csize, usize, lho });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
async function zipEntryBlob(file, e) {
  const h = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer());
  const start = e.lho + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const raw = file.slice(start, start + e.csize);
  const type = mimeOf(e.name);
  if (e.method === 0) return new Blob([raw], { type });
  if (e.method === 8 && 'DecompressionStream' in window) {
    const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Blob([await new Response(stream).arrayBuffer()], { type });
  }
  throw new Error('طريقة ضغط غير مدعومة في هذا المتصفح');
}

/** تحويل أي مجموعة ملفات (صور، ملفات، ZIP، مجلد) إلى قائمة عناصر موحدة */
async function expandFiles(list) {
  const items = [];
  let backup = null;
  for (const f of list) {
    const path = f.webkitRelativePath || f.name;
    if (skipName(path)) continue;
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
      let entries;
      try { entries = await readZip(f); } catch (err) { items.push({ name: f.name, folder: '', size: f.size, error: err.message }); continue; }
      if (entries.some((e) => e.name === 'fusayfisa-backup.json')) { backup = { file: f, entries }; continue; }
      const zipFolder = f.name.replace(/\.zip$/i, '');
      entries.filter((e) => !skipName(e.name) && e.usize > 0).forEach((e) => {
        items.push({ name: e.name.split('/').pop(), folder: parentFolder(e.name) || zipFolder, size: e.usize, type: mimeOf(e.name), get: () => zipEntryBlob(f, e) });
      });
    } else {
      items.push({ name: f.name, folder: parentFolder(path), size: f.size, type: f.type || mimeOf(f.name), file: f, get: async () => f });
    }
  }
  return { items, backup };
}
async function hashBlob(blob) {
  if (!crypto.subtle) return `${blob.size}`;
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function findOrCreateGroup(name, created) {
  const key = normalize(name);
  for (const g of S.groups.values()) if (normalize(g.name) === key) return g;
  const g = { id: uid(), name: name.slice(0, 60), imageIds: [], coverId: null, createdAt: Date.now() };
  S.groups.set(g.id, g);
  created.push(g);
  return g;
}
const matchPrivateType = (folder) => PRIVATE[S.pgroup].types.find(([t]) => normalize(t) === normalize(folder))?.[0] || null;

/* ---------- نافذة الإضافة: اختيار ← معاينة ← حفظ ---------- */
function openAdd(initialFiles) {
  let items = [];
  let backup = null;
  const urls = [];
  const canFolder = 'webkitdirectory' in document.createElement('input') && !/iPhone|iPad|Android/i.test(navigator.userAgent);
  const node = el(`<form class="sheet" novalidate>
    <div class="sheet-head"><h2>إضافة مراجع</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <label class="pick">${icon('upload')}<b>اختر صوراً أو ملفات</b><span>اختر عشرات أو مئات الصور مرة واحدة، أو ملف ZIP</span><input type="file" multiple name="f"></label>
    ${canFolder ? '<label class="folder-btn">أو اختر مجلداً كاملاً<input type="file" name="dir" webkitdirectory multiple></label>' : ''}
    <div class="summary" hidden></div>
    <div class="chosen" hidden></div>
    <div class="opts" hidden>
      <label class="field" data-group-field><span>المجموعة</span><select class="input" name="group"></select></label>
      <label class="field"><span>الاسم (اختياري)</span><input class="input" name="name" maxlength="120" autocomplete="off"></label>
      <label class="field"><span>ملاحظة (اختياري)</span><textarea class="input" name="note" maxlength="2000"></textarea></label>
    </div>
    ${S.priv ? `<p class="dest">تُحفظ في: <b>${esc(PRIVATE[S.pgroup].label)}${S.ptype ? ' › ' + esc(S.ptype) : ''}</b></p>` : ''}
    ${S.priv && PRIVATE[S.pgroup].adult ? '<label class="check"><input type="checkbox" name="adult"><span>أؤكد أن الصور لنساء بالغات (18 سنة فأكثر)</span></label>' : ''}
    <div class="progress" hidden><div class="bar"><i></i></div><span></span></div>
    <button class="btn" type="submit" disabled>حفظ</button>
  </form>`);
  const $n = (s) => $(s, node);
  const save = $n('[type=submit]');

  function paint() {
    urls.forEach(URL.revokeObjectURL); urls.length = 0;
    const ok = items.filter((i) => !i.error);
    const summary = $n('.summary'), chosen = $n('.chosen');
    if (backup) {
      summary.hidden = false;
      summary.innerHTML = `<b>نسخة احتياطية من فسيفساء</b><span>سيتم استرجاع مراجعها ومجموعاتها إلى مكتبتك (بدون حذف أي شيء موجود).</span>`;
      chosen.hidden = true; $n('.opts').hidden = true;
      save.disabled = false; save.textContent = 'استرجاع النسخة';
      return;
    }
    const folders = {};
    ok.forEach((i) => { if (i.folder) folders[i.folder] = (folders[i.folder] || 0) + 1; });
    const fnames = Object.keys(folders);
    summary.hidden = !items.length;
    summary.innerHTML = items.length ? `<b>${ok.length} ${ok.length === 1 ? 'ملف' : 'ملفات'} جاهزة للحفظ</b>${fnames.length ? `<span>${fnames.slice(0, 8).map((f) => `${esc(f)} (${folders[f]})`).join('، ')}${fnames.length > 8 ? '…' : ''}</span>` : ''}${items.length - ok.length ? `<span class="bad">${items.length - ok.length} تعذّرت قراءتها</span>` : ''}<button type="button" class="link" data-clear>إلغاء الاختيار</button>` : '';
    $('[data-clear]', summary)?.addEventListener('click', () => { items = []; paint(); });
    chosen.innerHTML = '';
    ok.slice(0, 24).forEach((it) => {
      let inner = `<span>${esc(ext(it.name))}</span>`;
      if (it.file && (it.type || '').startsWith('image/')) { const u = URL.createObjectURL(it.file); urls.push(u); inner = `<img src="${u}" alt="" loading="lazy">`; }
      chosen.append(el(`<div>${inner}</div>`));
    });
    if (ok.length > 24) chosen.append(el(`<div class="more">+${ok.length - 24}</div>`));
    chosen.hidden = !ok.length;
    // خيارات المجموعة
    const opts = $n('.opts');
    opts.hidden = !ok.length;
    const gf = $n('[data-group-field]');
    gf.hidden = S.priv && !fnames.length;
    const sel = node.elements.group;
    const prev = sel.value;
    if (S.priv) {
      sel.innerHTML = '<option value="">النوع المحدد حالياً</option><option value="__folder">حسب أسماء المجلدات</option>';
      sel.value = fnames.length ? '__folder' : '';
      gf.querySelector('span').textContent = 'النوع';
    } else {
      sel.innerHTML = `<option value="">بدون مجموعة</option>${fnames.length ? '<option value="__folder">مجموعة لكل مجلد (تلقائي)</option>' : ''}${[...S.groups.values()].map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}<option value="__new">+ مجموعة جديدة…</option>`;
      sel.value = prev && [...sel.options].some((o) => o.value === prev) ? prev : fnames.length ? '__folder' : (S.group || '');
    }
    node.elements.name.closest('.field').hidden = ok.length > 1;
    save.disabled = !ok.length;
    save.textContent = ok.length > 1 ? `حفظ ${ok.length}` : 'حفظ';
  }
  node.elements.group.onchange = async (e) => {
    if (e.target.value !== '__new') return;
    const name = await askName('مجموعة جديدة', 'مثال: سيارات');
    if (!name) { e.target.value = ''; return; }
    const created = [];
    const g = findOrCreateGroup(name, created);
    if (created.length) await DB.put('collections', g);
    paint(); node.elements.group.value = g.id;
  };
  const add = async (list) => {
    save.disabled = true; save.textContent = 'جاري القراءة…';
    try {
      const r = await expandFiles([...list]);
      items.push(...r.items);
      if (r.backup) backup = r.backup;
    } catch (err) { toast('تعذّرت قراءة الملفات', 'err'); }
    paint();
  };
  node.elements.f.onchange = (e) => { add(e.target.files); e.target.value = ''; };
  if (node.elements.dir) node.elements.dir.onchange = (e) => { add(e.target.files); e.target.value = ''; };
  const pick = $n('.pick');
  pick.addEventListener('dragover', (e) => { e.preventDefault(); pick.classList.add('over'); });
  pick.addEventListener('dragleave', () => pick.classList.remove('over'));
  pick.addEventListener('drop', (e) => { e.preventDefault(); pick.classList.remove('over'); add(e.dataTransfer.files); });
  if (initialFiles) add(initialFiles);

  let busy = false;
  node.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (backup) { busy = true; save.disabled = true; await restoreBackup(backup, node); busy = false; return; }
    const list = items.filter((i) => !i.error);
    if (!list.length) return;
    if (node.elements.adult && !node.elements.adult.checked) return toast('هذا القسم للبالغات فقط: أكّد ذلك أولاً', 'err');
    busy = true; save.disabled = true;
    const prog = $n('.progress'), bar = $('.bar i', prog), label = $('span', prog);
    prog.hidden = false;
    const name = node.elements.name.value.trim(), note = node.elements.note.value.trim(), groupSel = node.elements.group.value;
    const known = new Set([...S.items.values()].map((i) => i.hash).filter(Boolean));
    const created = [];
    let saved = 0, dup = 0;
    const failed = items.filter((i) => i.error).map((i) => `${i.name}: ${i.error}`);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      label.textContent = `جاري الحفظ ${i + 1} من ${list.length}…`;
      bar.style.width = `${Math.round((i / list.length) * 100)}%`;
      try {
        const blob = await it.get();
        const hash = await hashBlob(blob);
        if (known.has(hash)) { dup++; continue; }
        known.add(hash);
        const file = blob instanceof File ? blob : new File([blob], it.name, { type: it.type || blob.type || '' });
        let groupId = null, extra = { hash };
        if (S.priv) {
          const t = groupSel === '__folder' ? matchPrivateType(it.folder) : null;
          extra = { ...extra, space: 'private', pgroup: S.pgroup, ptype: t || S.ptype || null, adultConfirmed: !!node.elements.adult?.checked };
        } else if (groupSel === '__folder') {
          if (it.folder) groupId = findOrCreateGroup(it.folder, created).id;
        } else if (groupSel) groupId = groupSel;
        if (created.length) { await DB.batch(['collections'], (st) => created.forEach((g) => st('collections').put(g))); created.length = 0; }
        await saveFile(file, list.length === 1 ? name : '', note, groupId, extra);
        saved++;
      } catch (err) {
        console.error(err);
        failed.push(`${it.name}: ${err?.name === 'QuotaExceededError' ? 'المساحة ممتلئة' : 'تعذّر الحفظ'}`);
        if (err?.name === 'QuotaExceededError') { failed.push('توقف الحفظ لامتلاء مساحة الجهاز'); break; }
      }
      if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0));
    }
    bar.style.width = '100%';
    keepDataSafe();
    await closeModal();
    if (list.length === 1 && saved === 1 && !failed.length) toast('تم الحفظ', 'ok');
    else showResult(saved, dup, failed);
    if (!S.priv && location.hash.startsWith('#/fav')) location.hash = '#/'; else render();
  };
  openModal(node, { onClose: () => urls.forEach(URL.revokeObjectURL) });
}
function showResult(saved, dup, failed) {
  const node = el(`<div class="sheet"><div class="sheet-head"><h2>انتهى الحفظ</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <ul class="result">
      <li><b>${saved}</b> حُفظت</li>
      ${dup ? `<li><b>${dup}</b> مكررة تم تخطيها</li>` : ''}
      ${failed.length ? `<li class="bad"><b>${failed.length}</b> لم تُحفظ</li>` : ''}
    </ul>
    ${failed.length ? `<details class="fails"><summary>عرض الملفات التي لم تُحفظ</summary><ul>${failed.slice(0, 200).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>` : ''}
    <button class="btn" type="button" data-close>تم</button></div>`);
  openModal(node);
}

/* ---------- النسخة الاحتياطية (ملف ZIP واحد) ---------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function exportBackup() {
  const items = [...S.items.values()].filter((i) => !isPrivate(i) || S.unlocked);
  if (!items.length) return toast('لا توجد مراجع لحفظها', 'err');
  toast('جاري تجهيز النسخة الاحتياطية…');
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const addEntry = async (path, blob) => {
    const data = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(data), name = enc.encode(path);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(lh, name, blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  };
  try {
    for (const it of items) {
      const f = await DB.get('files', it.id); if (f) await addEntry(`files/${it.id}`, f.blob);
      const t = await DB.get('thumbs', it.id); if (t) await addEntry(`thumbs/${it.id}`, t.blob);
    }
    const ids = new Set(items.map((i) => i.id));
    const groups = [...S.groups.values()].map((g) => ({ ...g, imageIds: g.imageIds.filter((x) => ids.has(x)) }));
    await addEntry('fusayfisa-backup.json', new Blob([JSON.stringify({ app: 'fusayfisa', format: 2, exportedAt: Date.now(), items, groups })]));
    const cdSize = central.reduce((a, p) => a + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length / 2, true); end.setUint16(10, central.length / 2, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const zip = new Blob([...parts, ...central, end], { type: 'application/zip' });
    const d = new Date();
    const a = el(`<a download="fusayfisa-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip"></a>`);
    a.href = URL.createObjectURL(zip);
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`جُهّزت النسخة: ${items.length} مرجع`, 'ok');
  } catch (err) { console.error(err); toast('تعذّر تجهيز النسخة الاحتياطية', 'err'); }
}
async function restoreBackup({ file, entries }, node) {
  const prog = $('.progress', node), bar = $('.bar i', prog), label = $('span', prog);
  prog.hidden = false;
  try {
    const byName = new Map(entries.map((e) => [e.name, e]));
    const data = JSON.parse(await (await zipEntryBlob(file, byName.get('fusayfisa-backup.json'))).text());
    if (data.app !== 'fusayfisa') throw new Error('bad');
    let n = 0, skipped = 0;
    for (let i = 0; i < data.items.length; i++) {
      const rec = data.items[i];
      label.textContent = `جاري الاسترجاع ${i + 1} من ${data.items.length}…`;
      bar.style.width = `${Math.round((i / data.items.length) * 100)}%`;
      if (S.items.has(rec.id)) { skipped++; continue; }
      const fe = byName.get(`files/${rec.id}`), te = byName.get(`thumbs/${rec.id}`);
      const blob = fe ? await zipEntryBlob(file, fe) : null, thumb = te ? await zipEntryBlob(file, te) : null;
      await DB.batch(['images', 'files', 'thumbs'], (st) => {
        st('images').put(rec);
        if (blob) st('files').put({ id: rec.id, blob: new Blob([blob], { type: rec.mime || '' }) });
        if (thumb) st('thumbs').put({ id: rec.id, blob: new Blob([thumb], { type: 'image/webp' }) });
      });
      S.items.set(rec.id, rec);
      n++;
    }
    for (const g of data.groups || []) {
      const cur = S.groups.get(g.id);
      const merged = cur ? { ...cur, imageIds: [...new Set([...cur.imageIds, ...g.imageIds])] } : g;
      await DB.put('collections', merged); S.groups.set(merged.id, merged);
    }
    await closeModal();
    showResult(n, skipped, []);
    render();
  } catch (err) {
    console.error(err);
    prog.hidden = true;
    toast('تعذّر استرجاع النسخة الاحتياطية', 'err');
  }
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
    if (!S.groups.size || isPrivate(item)) return;
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
function footerEl() {
  const f = el(`<div class="foot"><button type="button" class="link muted">حفظ نسخة احتياطية من مكتبتك</button><span>لاسترجاعها: اضغط «إضافة» واختر ملف النسخة.</span></div>`);
  $('button', f).onclick = exportBackup;
  return f;
}
function emptyEl(title, text, withAdd) {
  return el(`<div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p>${withAdd ? `<button class="add" type="button" data-add>${icon('plus')}<span>إضافة مرجع</span></button>` : ''}</div>`);
}

function render() {
  if (S.priv && S.unlocked) return renderPrivate();
  const fav = location.hash.startsWith('#/fav');
  const main = $('#main');
  main.innerHTML = '';
  document.body.classList.remove('in-private');
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === (fav ? '/fav' : '/')));
  if (S.group && !S.groups.has(S.group)) S.group = null;

  let list = [...S.items.values()].filter((i) => !isPrivate(i));
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
      list = g.imageIds.map((x) => S.items.get(x)).filter((i) => i && !isPrivate(i));
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
  main.append(gridEl(list), footerEl());
}

function renderPrivate() {
  const main = $('#main');
  main.innerHTML = '';
  document.body.classList.add('in-private');
  $$('.nav a').forEach((a) => a.classList.remove('on'));
  const g = PRIVATE[S.pgroup];
  const head = el(`<div class="p-head"><div class="seg2">${Object.entries(PRIVATE).map(([k, v]) => `<button type="button" data-g="${k}" class="${k === S.pgroup ? 'on' : ''}">${esc(v.label)}</button>`).join('')}</div>
    <div class="p-tools"><button type="button" class="link muted" data-pass>تغيير كلمة المرور</button><button type="button" class="chip" data-exit>خروج</button></div></div>`);
  $$('[data-g]', head).forEach((b) => { b.onclick = () => { S.pgroup = b.dataset.g; S.ptype = null; render(); }; });
  $('[data-exit]', head).onclick = () => { S.priv = false; S.unlocked = false; S.ptype = null; render(); scrollTo(0, 0); };
  $('[data-pass]', head).onclick = () => changePassword();
  main.append(head);
  if (g.adult) main.append(el('<p class="p-note">صور فوتوغرافية لنساء بالغات (18 سنة فأكثر) فقط، ومنفصلة تماماً عن الأنمي.</p>'));
  const types = el('<div class="groups"></div>');
  const chip = (t) => { const b = el(`<button type="button" class="chip ${S.ptype === t ? 'on' : ''}">${esc(t || 'الكل')}</button>`); b.onclick = () => { S.ptype = t; render(); }; types.append(b); };
  chip(null);
  g.types.forEach(([t]) => chip(t));
  main.append(types);
  let list = [...S.items.values()].filter((i) => isPrivate(i) && (i.pgroup || 'anime') === S.pgroup && (!S.ptype || i.ptype === S.ptype)).sort(newest);
  if (S.q) list = list.filter((i) => matches(i, S.q));
  if (!list.length) {
    main.append(emptyEl(S.q ? 'لا توجد نتائج' : 'لا توجد صور هنا بعد', S.q ? 'جرّب كلمة أخرى، أو ابحث عنها في Pinterest.' : 'ابحث في Pinterest، احفظ الصورة على جهازك، ثم اضغط «إضافة».', !S.q));
    return;
  }
  main.append(gridEl(list), footerEl());
}

/* النقطة الخفيفة ← نص التعريف ← كلمة «كيف» ← كلمة المرور */
function openAbout() {
  const node = el(`<div class="sheet about"><div class="sheet-head"><h2>عن فسيفساء</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <p>فسيفساء مكتبتك الشخصية للمراجع. تجمع فيها الصور والملفات التي تحب الرجوع إليها: أفكار للرسم، صور سيارات، تصاميم، مستندات، أو أي شيء يلهمك، كل ذلك في مكان واحد مرتب وهادئ.</p>
    <p>طريقة الاستخدام بسيطة: اضغط «إضافة»، اختر صورة أو ملفاً من جهازك، ثم اضغط «حفظ». الاسم والملاحظة اختياريان، وتستطيع كتابتهما أو تعديلهما لاحقاً من داخل المرجع نفسه، فكل تعديل يُحفظ تلقائياً.</p>
    <p>اضغط على أي مرجع لتراه بحجم أكبر. من هناك تضيفه إلى المفضلة، أو تنسخه، أو تشاركه، أو تحذفه. وتجد كل ما أضفته إلى المفضلة في صفحة المفضلة أسفل الشاشة.</p>
    <p>اكتب في مربع البحث ليظهر لك ما يطابق الاسم أو الملاحظة فوراً. وإن لم تجد ما تريد في مكتبتك، اضغط زر Pinterest ليفتح لك نتائج البحث هناك، فتحفظ الصورة التي يحق لك حفظها على جهازك ثم تضيفها إلى فسيفساء.</p>
    <p>المجموعات اختيارية تماماً؛ أنشئ مجموعة باسم فقط، ثم أضف إليها المراجع من داخل كل مرجع. هذا <span data-how>كيف</span> تبقى مكتبتك منظمة دون أي تعقيد.</p>
    <p>كل مراجعك محفوظة على جهازك وحده: لا حسابات، ولا خوادم، ولا رفع لأي جهة. والموقع يعمل دون إنترنت بعد فتحه أول مرة، ويُفضّل إضافته إلى الشاشة الرئيسية في الجوال ليبقى محفوظاً بشكل أفضل.</p>
  </div>`);
  $('[data-how]', node).onclick = () => openPassword();
  openModal(node);
}
function openPassword() {
  const has = !!S.settings.privateHash;
  const node = el(`<form class="sheet" novalidate><div class="sheet-head"><h2>${has ? 'كلمة المرور' : 'أنشئ كلمة مرور'}</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <label class="field"><input class="input" type="password" name="p" placeholder="كلمة المرور" autocomplete="${has ? 'current-password' : 'new-password'}"></label>
    ${has ? '' : '<label class="field"><input class="input" type="password" name="p2" placeholder="أعد كتابتها" autocomplete="new-password"></label>'}
    <p class="err" hidden></p><button class="btn" type="submit">${has ? 'دخول' : 'إنشاء ودخول'}</button>
    <p class="fine">إخفاء بسيط داخل الموقع وليس حماية أمنية؛ من يستخدم جهازك ومتصفحك قد يصل إلى بياناته.</p></form>`);
  const err = $('.err', node);
  const fail = (m) => { err.textContent = m; err.hidden = false; node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake'); };
  node.onsubmit = async (e) => {
    e.preventDefault();
    const p = node.elements.p.value;
    if (has) { if (!(await checkPassword(p))) return fail('كلمة المرور غير صحيحة'); }
    else {
      if (p.length < 4) return fail('أربعة أحرف على الأقل');
      if (p !== node.elements.p2.value) return fail('الكلمتان غير متطابقتين');
      await setPassword(p);
    }
    S.unlocked = true; S.priv = true; S.ptype = null; S.q = ''; $('#q').value = '';
    while (modals.length) await closeModal();
    render(); scrollTo(0, 0);
  };
  openModal(node);
  setTimeout(() => node.elements.p.focus(), 250);
}
function changePassword() {
  const node = el(`<form class="sheet" novalidate><div class="sheet-head"><h2>تغيير كلمة المرور</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <label class="field"><input class="input" type="password" name="old" placeholder="كلمة المرور الحالية" autocomplete="current-password"></label>
    <label class="field"><input class="input" type="password" name="p1" placeholder="كلمة المرور الجديدة" autocomplete="new-password"></label>
    <label class="field"><input class="input" type="password" name="p2" placeholder="أعد كتابة الجديدة" autocomplete="new-password"></label>
    <p class="err" hidden></p><button class="btn" type="submit">حفظ</button></form>`);
  const err = $('.err', node);
  node.onsubmit = async (e) => {
    e.preventDefault();
    const f = node.elements, fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!(await checkPassword(f.old.value))) return fail('كلمة المرور الحالية غير صحيحة');
    if (f.p1.value.length < 4) return fail('أربعة أحرف على الأقل');
    if (f.p1.value !== f.p2.value) return fail('الكلمتان غير متطابقتين');
    await setPassword(f.p1.value);
    toast('تم تغيير كلمة المرور', 'ok');
    closeModal();
  };
  openModal(node);
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
  window.addEventListener('hashchange', () => { if (S.priv) { S.priv = false; S.unlocked = false; } render(); });
  $('#dot').onclick = openAbout;
  $('#pin').onclick = openPinterest;
  $$('.nav a').forEach((a) => a.addEventListener('click', () => { if (S.priv && a.getAttribute('href') === location.hash) { S.priv = false; S.unlocked = false; render(); } }));
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
