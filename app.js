/* =========================================================
   فسيفساء — مكتبة مراجع شخصية بسيطة
   كل شيء يُحفظ على جهاز المستخدم (IndexedDB) ويعمل دون إنترنت.
   ========================================================= */
'use strict';

const APP_VERSION = '2.7.0';
const DB_NAME = 'fusayfisa';
const DB_VERSION = 1; // نفس قاعدة البيانات السابقة حتى لا تضيع المراجع المحفوظة

/* ---------- أدوات صغيرة ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const icon = (n) => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
/** معرّف آمن (حروف وأرقام وشرطات فقط) — يمنع حقن كود عبر نسخة احتياطية معدّلة */
const safeId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const safeNum = (v, d = 1) => (Number.isFinite(+v) && +v > 0 ? +v : d);
/** روابط خارجية: http/https فقط (لا javascript: ولا data:) */
const safeHref = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; } };
/** أنواع ملفات آمن فتحها داخل المتصفح. غيرها (HTML/SVG/XML/سكربت) قد يشغّل كوداً بصلاحيات الموقع، فتُفتح كتنزيل فقط */
const SAFE_OPEN = /^(image\/(jpeg|png|gif|webp|avif|bmp)|application\/pdf|text\/plain|video\/(mp4|webm|quicktime)|audio\/[a-z0-9.+-]+)$/i;
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
const S = { items: new Map(), groups: new Map(), q: '', group: null, settings: {}, unlocked: false, priv: false, pgroup: 'anime', ptype: null, sem: null };

/* ---------- القسم الخاص: الأنمي والصور النسائية (بالغات فقط) ---------- */
const PRIVATE = {
  // الأنواع كلها يضيفها المستخدم بنفسه من زر «+ نوع» (تُحفظ في customTypes)
  anime: { label: 'الأنمي', pin: 'anime', types: [] },
  women: { label: 'صور نسائية', pin: 'adult woman', adult: true, types: [] },
};
/** «الكل» في القسم الخاص: يعرض الأنمي والصور النسائية معاً */
const ALL = 'all';
/** الأقسام الخاصة كلها: الأساسية + الأقسام التي أضافها المستخدم (تُحفظ على الجهاز فقط) */
const PG = () => ({ ...PRIVATE, ...Object.fromEntries((S.settings.customGroups || []).map((c) => [c.id, { label: c.name, pin: c.name, types: [], custom: true }])) });
/** القسم الذي تُحفظ فيه الإضافات: في «الكل» تُحفظ للأنمي مبدئياً ثم يوزعها التحليل حسب محتواها */
const saveGroup = () => (PG()[S.pgroup] ? S.pgroup : 'anime');
const isPrivate = (i) => i.space === 'private' || i.sectionId === 'private';
const UNSORTED = 'غير مصنف';
/** القسم الفعلي لصورة خاصة: اليدوي أولاً، ثم ما حدده الذكاء، ثم مكان الرفع */
const groupOf = (i) => i.pgroupManual || i.auto?.group || i.pgroup || 'anime';
/** أنواع الصورة: إذا عدّلها المستخدم يدوياً فهي المعتمدة، وإلا التلقائية + النوع المختار عند الرفع */
const tagsOf = (i) => {
  const ok = new Set(typesOf(groupOf(i))); // تظهر فقط الأنواع الموجودة حالياً في القسم
  if (Array.isArray(i.mtags)) return i.mtags.filter((t) => ok.has(t));
  const t = [...(i.auto?.group === groupOf(i) ? i.auto.tags : [])];
  if (i.ptype && !t.includes(i.ptype)) t.push(i.ptype);
  return t.filter((x) => ok.has(x));
};
const analyzed = (i) => !!i.emb;
/** غير مصنف: حُللت ولم يُعرف قسمها بثقة، أو ليس لها أي نوع */
const isUnsorted = (i) => !PG()[groupOf(i)]?.custom && ((analyzed(i) && !i.pgroupManual && !i.auto?.group) || (typesOf(groupOf(i)).length > 0 && !tagsOf(i).length && (analyzed(i) || Array.isArray(i.mtags))));
const typesOf = (g) => [...(PG()[g]?.types || []).map(([t]) => t), ...((S.settings.customTypes || {})[g] || [])];
async function hashPass(pass, salt) {
  const data = new TextEncoder().encode(`${salt}:${pass}`);
  if (crypto.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let h = 2166136261; for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return 'fnv' + h.toString(16);
}
async function setSetting(key, value) { S.settings[key] = value; await DB.put('settings', { key, value }); }
async function setPassword(p) { p = digitsAscii(p.trim()); const salt = uid(); await setSetting('privateSalt', salt); await setSetting('privateHash', await hashPass(p, salt)); }
// الأرقام العربية (١٢٣) والإنجليزية (123) تُعامل كأنها نفس الشيء: كيبورد الجوال العربي يكتب ١٢٣١ بدل 1231
const digitsAscii = (p) => String(p).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6F0);
const digitsArabic = (p) => String(p).replace(/[0-9]/g, (d) => String.fromCharCode(0x660 + +d));
const checkPassword = async (p) => {
  if (!S.settings.privateHash) return false;
  for (const c of new Set([p, p.trim(), digitsAscii(p), digitsAscii(p.trim()), digitsArabic(digitsAscii(p.trim()))])) {
    if ((await hashPass(c, S.settings.privateSalt)) === S.settings.privateHash) return true;
  }
  return false;
};

/* ---------- Pinterest: يفتح صفحة النتائج فقط ---------- */
function openPinterest() {
  const text = $('#q').value.trim();
  let parts = [text];
  const g = S.priv ? PG()[S.pgroup] : null;
  if (g) {
    const t = g.types.find((x) => x[0] === S.ptype);
    parts = [g.pin, t?.[1] || (S.ptype !== UNSORTED && S.ptype) || '', text];
  }
  const q = parts.filter(Boolean).join(' ').trim();
  if (!q || (!g && !text)) { toast('اكتب كلمة في البحث أولاً', 'err'); $('#q').focus(); return; }
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
  // الصور الجاهزة القديمة كان المصدر مكتوباً في الملاحظة: صار في «•••» فقط
  items.forEach((i) => { if (i.source?.page && (i.notes || '').startsWith('المصدر: Wikimedia Commons')) { i.notes = ''; DB.put('images', i).catch(() => {}); } });
  S.items = new Map(items.map((i) => [i.id, i]));
  S.groups = new Map(groups.map((g) => [g.id, g]));
}
const newest = (a, b) => b.createdAt - a.createdAt;
const noteOf = (i) => i.notes || i.description || '';
const hayCache = new WeakMap();
let groupNames = new Map();
function rebuildGroupIndex() {
  groupNames = new Map();
  S.groups.forEach((g) => g.imageIds.forEach((id) => groupNames.set(id, (groupNames.get(id) || '') + ' ' + g.name)));
}
function matches(item, q) {
  const words = normalize(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const key = (groupNames.get(item.id) || '') + (isPrivate(item) ? ` ${PG()[groupOf(item)]?.label || ''} ${tagsOf(item).join(' ')}${isUnsorted(item) ? ' ' + UNSORTED : ''}` : '');
  let c = hayCache.get(item);
  if (!c || c.key !== key) { c = { key, hay: normalize(`${item.name} ${noteOf(item)} ${item.text?.body || ''} ${key}`) }; hayCache.set(item, c); }
  return words.every((w) => c.hay.includes(w));
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
  const pp = S.items.get(id)?.packPath;
  if (pp) await setSetting('packDeleted', [...new Set([...(S.settings.packDeleted || []), pp])]);
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
/* نسخة جديدة نزلت: نعيد التحميل مرة واحدة. إذا كانت نافذة مفتوحة (إضافة أو عرض صورة) ننتظر إغلاقها حتى لا يضيع شيء */
let updatePending = false, reloading = false;
function applyUpdate() {
  if (reloading) return;
  if (modals.length) { updatePending = true; return; }
  reloading = true; updatePending = false;
  location.reload();
}
window.addEventListener('popstate', () => {
  const m = modals.pop();
  if (!m) return;
  m.wrap.classList.remove('show');
  setTimeout(() => m.wrap.remove(), 220);
  if (!modals.length) document.body.classList.remove('modal-open');
  m.onClose?.();
  if (!modals.length && updatePending) { applyUpdate(); return; }
  if (!modals.length && AI.dirty) { AI.dirty = false; render(); }
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
const fmtMB = (b) => `${(b / 1048576).toFixed(b > 104857600 ? 0 : 1)} ميجا`;
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
const matchPrivateType = (folder) => typesOf(saveGroup()).map((t) => [t]).find(([t]) => normalize(t) === normalize(folder))?.[0] || null;

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
    ${!S.priv && S.settings.packImported !== PACK_VERSION ? `<button type="button" class="link pack-btn" data-pack ${packRunning ? 'disabled' : ''}>${packRunning ? 'مكتبة السيارات والصور العامة قيد التحميل…' : 'أكمل تحميل مكتبة السيارات والصور العامة'}</button>` : ''}
    <div class="summary" hidden></div>
    <div class="chosen" hidden></div>
    <div class="opts" hidden>
      <label class="field" data-group-field><span>المجموعة</span><select class="input" name="group"></select></label>
      <label class="field"><span>الاسم (اختياري)</span><input class="input" name="name" maxlength="120" autocomplete="off"></label>
      <label class="field"><span>ملاحظة (اختياري)</span><textarea class="input" name="note" maxlength="2000"></textarea></label>
    </div>
    ${S.priv ? `<p class="dest">تُحفظ في: <b>${S.pgroup === ALL ? 'القسم الخاص (تتوزع تلقائياً حسب محتواها)' : esc(PG()[S.pgroup].label)}${S.ptype ? ' › ' + esc(S.ptype) : ''}</b></p>` : ''}
    ${S.priv && (S.pgroup === ALL || PG()[S.pgroup].adult) ? '<label class="check"><input type="checkbox" name="adult"><span>أؤكد أن الصور لنساء بالغات (18 سنة فأكثر)</span></label>' : ''}
    <div class="progress" hidden><div class="bar"><i></i></div><span></span><button type="button" class="link" data-stop>إيقاف الحفظ</button></div>
    <button class="btn" type="submit" disabled>حفظ</button>
  </form>`);
  const $n = (s) => $(s, node);
  const save = $n('[type=submit]');
  $n('[data-pack]')?.addEventListener('click', async () => { await closeModal(); importPack(); });

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
    const need = ok.reduce((a, i) => a + (i.size || 0), 0) * 1.15;
    navigator.storage?.estimate?.().then(({ usage = 0, quota = 0 }) => {
      if (!quota || !summary.isConnected) return;
      const free = quota - usage;
      if (need > free) summary.insertAdjacentHTML('beforeend', `<span class="bad">تنبيه: المساحة المتاحة للموقع (${fmtMB(free)}) أقل من حجم هذه الصور (${fmtMB(need)}). قد يتوقف الحفظ قبل النهاية.</span>`);
    }).catch(() => {});
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
    let saved = 0, dup = 0, stopped = false;
    $('[data-stop]', prog).onclick = () => { stopped = true; label.textContent = 'جاري الإيقاف…'; };
    const failed = items.filter((i) => i.error).map((i) => `${i.name}: ${i.error}`);
    for (let i = 0; i < list.length; i++) {
      if (stopped) { failed.push(`أُوقف الحفظ: ${list.length - i} لم تُحفظ (المحفوظ قبلها سليم)`); break; }
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
          extra = { ...extra, space: 'private', pgroup: saveGroup(), ...(PG()[saveGroup()].custom ? { pgroupManual: saveGroup() } : {}), ptype: t || (S.ptype !== UNSORTED && S.ptype) || null, adultConfirmed: !!node.elements.adult?.checked };
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
    if (saved) aiKick();
  };
  openModal(node, { onClose: () => urls.forEach(URL.revokeObjectURL) });
}
/* ---------- الصور الجاهزة (بطلب المستخدم): صور حرة الترخيص من Wikimedia Commons ---------- */
const PACK_VERSION = 1;
const PACK_BASE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
/** تحميل الصور الجاهزة. bg=true: في الخلفية تلقائياً (شريط صغير أسفل الشاشة)، وإلا نافذة بتقدم ونتيجة */
let packRunning = false;
async function importPack(bg = false) {
  if (packRunning) return;
  packRunning = true;
  let stopped = false;
  let node = null, bar, label;
  const pbar = $('#packStatus');
  if (bg) {
    pbar.hidden = false;
    pbar.innerHTML = '<span>جاري تحميل مكتبة السيارات والصور العامة…</span><button type="button" class="link">إيقاف</button>';
    label = $('span', pbar);
    $('button', pbar).onclick = async () => { stopped = true; label.textContent = 'جاري الإيقاف…'; await setSetting('packStopped', true); };
  } else {
    node = el(`<div class="sheet"><div class="sheet-head"><h2>الصور الجاهزة</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
      <p class="p-note">تُنزَّل الصور من Wikimedia Commons (صور حرة الترخيص) وتُحفظ في مجموعتين: «سيارات» و«عامة». الحجم التقريبي 60–80 ميجا، يُفضّل الواي فاي.</p>
      <div class="progress"><div class="bar"><i></i></div><span>جاري التحضير…</span><button type="button" class="link" data-stop>إيقاف</button></div></div>`);
    openModal(node);
    bar = $('.bar i', node); label = $('.progress span', node);
    $('[data-stop]', node).onclick = () => { stopped = true; label.textContent = 'جاري الإيقاف…'; };
    await setSetting('packStopped', false);
  }
  let pack;
  try { pack = await (await fetch('packs/starter.json', { cache: 'no-store' })).json(); }
  catch { label.textContent = 'تعذّر تحميل القائمة. تحقق من الإنترنت.'; packRunning = false; if (bg) setTimeout(() => { pbar.hidden = true; }, 4000); return; }
  // الموجود لا يُنزّل من جديد، والمحذوف بيدك لا يرجع
  const have = new Set([...S.items.values()].map((i) => i.packPath).filter(Boolean));
  const deleted = new Set(S.settings.packDeleted || []);
  const all = Object.entries(pack.groups).flatMap(([g, rows]) => rows.map((r) => [g, ...(Array.isArray(r) ? r : [r])]));
  const list = all.filter(([, path]) => !have.has(path) && !deleted.has(path));
  const known = new Set([...S.items.values()].map((i) => i.hash).filter(Boolean));
  const created = [];
  let saved = 0, dup = 0;
  const failed = [];
  for (let i = 0; i < list.length; i++) {
    if (stopped) break;
    const [gname, path, license, author] = list[i];
    label.textContent = `${bg ? 'تحميل مكتبة السيارات والصور العامة' : 'جاري الإضافة'} ${i + 1} من ${list.length}…`;
    if (bar) bar.style.width = `${Math.round((i / list.length) * 100)}%`;
    try {
      const res = await fetch(PACK_BASE + path);
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      if (!/^image\//.test(blob.type)) throw new Error('not-image');
      const hash = await hashBlob(blob);
      if (known.has(hash)) { dup++; continue; }
      known.add(hash);
      const g = findOrCreateGroup(gname, created);
      if (created.length) { await DB.batch(['collections'], (st) => created.forEach((x) => st('collections').put(x))); created.length = 0; }
      const file = decodeURIComponent(path.split('/').slice(-2)[0]);
      const name = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      const page = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;
      await saveFile(new File([blob], `${name}.jpg`, { type: blob.type }), name, '', g.id, { hash, packPath: path, source: { site: 'Wikimedia Commons', page, license: license || '', author: author || '' } });
      saved++;
      if (bg && saved % 20 === 0 && !modals.length && !S.priv) render(); // تظهر الصور تدريجياً
    } catch (err) {
      failed.push(`صورة ${i + 1}: ${err?.name === 'QuotaExceededError' ? 'المساحة ممتلئة' : err?.message === 'not-image' ? 'الملف ليس صورة' : 'تعذّر التنزيل'}`);
      if (err?.name === 'QuotaExceededError') break;
    }
  }
  if (!stopped && !failed.length) await setSetting('packImported', PACK_VERSION);
  packRunning = false;
  keepDataSafe();
  if (bg) {
    label.textContent = stopped ? 'أُوقف التحميل. تقدر تكمله من «إضافة».' : failed.length ? `تم تحميل ${saved}، وتعذّر ${failed.length} (يكمل تلقائياً المرة القادمة)` : `تم تحميل المكتبة: ${saved} صورة`;
    $('button', pbar).remove();
    setTimeout(() => { pbar.hidden = true; }, 5000);
    if (!modals.length && !S.priv) render();
  } else {
    await closeModal();
    showResult(saved, dup, failed.length > 12 ? [...failed.slice(0, 12), `و${failed.length - 12} غيرها`] : failed);
    location.hash = '#/'; render();
    if (failed.length) toast('لإكمال الناقص فقط: «إضافة» ثم زر الصور الجاهزة مرة أخرى', '');
  }
  if (saved) aiKick();
}

function showResult(saved, dup, failed, dupLabel = 'مكررة تم تخطيها') {
  const node = el(`<div class="sheet"><div class="sheet-head"><h2>انتهى الحفظ</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <ul class="result">
      <li><b>${saved}</b> حُفظت</li>
      ${dup ? `<li><b>${dup}</b> ${dupLabel}</li>` : ''}
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
    await addEntry('fusayfisa-backup.json', new Blob([JSON.stringify({ app: 'fusayfisa', format: 2, exportedAt: Date.now(), items: items.map(({ emb, ...r }) => r), groups, customTypes: S.unlocked ? S.settings.customTypes || {} : {}, customGroups: S.unlocked ? S.settings.customGroups || [] : [] })])); // البصمات تُعاد حسابها بعد الاسترجاع
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
    await setSetting('lastBackup', { at: Date.now(), count: items.length });
    toast(`جُهّزت النسخة: ${items.length} مرجع`, 'ok');
    render();
  } catch (err) { console.error(err); toast('تعذّر تجهيز النسخة الاحتياطية', 'err'); }
}
async function restoreBackup({ file, entries }, node) {
  const prog = $('.progress', node), bar = $('.bar i', prog), label = $('span', prog);
  prog.hidden = false;
  try {
    const byName = new Map(entries.map((e) => [e.name, e]));
    const data = JSON.parse(await (await zipEntryBlob(file, byName.get('fusayfisa-backup.json'))).text());
    if (data.app !== 'fusayfisa' || !Array.isArray(data.items)) throw new Error('bad');
    // تنقية: أي سجل معرّفه أو حقوله غير سليمة يُتجاهل (نسخة معدّلة لا تقدر تحقن كوداً)
    const KINDS = new Set(['image', 'file', 'text']);
    data.items = data.items.filter((r) => r && typeof r === 'object' && safeId(r.id) && KINDS.has(r.kind)).map((r) => ({
      ...r, width: safeNum(r.width), height: safeNum(r.height), name: String(r.name ?? ''), notes: String(r.notes ?? ''),
      mime: typeof r.mime === 'string' ? r.mime.slice(0, 100) : '', source: r.source && safeHref(r.source.page) ? r.source : undefined,
      mtags: Array.isArray(r.mtags) ? r.mtags.map(String) : undefined, pgroupManual: safeId(r.pgroupManual) ? r.pgroupManual : undefined,
      pgroup: safeId(r.pgroup) ? r.pgroup : undefined, emb: undefined,
    }));
    data.groups = (Array.isArray(data.groups) ? data.groups : []).filter((g) => g && safeId(g.id)).map((g) => ({
      ...g, name: String(g.name ?? '').slice(0, 60), imageIds: Array.isArray(g.imageIds) ? g.imageIds.filter(safeId) : [], coverId: safeId(g.coverId) ? g.coverId : null,
    }));
    data.customGroups = (Array.isArray(data.customGroups) ? data.customGroups : []).filter((c) => c && safeId(c.id) && c.id !== ALL && !PRIVATE[c.id]).map((c) => ({ id: c.id, name: String(c.name ?? '').slice(0, 60) }));
    data.customTypes = data.customTypes && typeof data.customTypes === 'object' ? Object.fromEntries(Object.entries(data.customTypes).filter(([k, v]) => safeId(k) && Array.isArray(v)).map(([k, v]) => [k, v.map((x) => String(x).slice(0, 60))])) : null;
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
    if (data.customTypes) { // الأنواع التي أضافها المستخدم
      const ct = { ...(S.settings.customTypes || {}) };
      for (const [k, v] of Object.entries(data.customTypes)) ct[k] = [...new Set([...(ct[k] || []), ...v])];
      await setSetting('customTypes', ct);
    }
    if (data.customGroups?.length) { // الأقسام الخاصة التي أضافها المستخدم
      const cg = [...(S.settings.customGroups || [])];
      for (const c of data.customGroups) if (!cg.some((x) => x.id === c.id)) cg.push(c);
      await setSetting('customGroups', cg);
    }
    for (const g of data.groups || []) {
      const cur = S.groups.get(g.id);
      const merged = cur ? { ...cur, imageIds: [...new Set([...cur.imageIds, ...g.imageIds])] } : g;
      await DB.put('collections', merged); S.groups.set(merged.id, merged);
    }
    await closeModal();
    showResult(n, skipped, [], 'موجودة في مكتبتك مسبقاً');
    render();
    if (n) aiKick();
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
  if (blob) fileURL = URL.createObjectURL(item.kind === 'image' || SAFE_OPEN.test(blob.type) ? blob : new Blob([blob], { type: 'application/octet-stream' }));

  let media;
  if (item.kind === 'image' && fileURL) media = `<img src="${fileURL}" alt="${esc(item.name)}">`;
  else if (item.kind === 'text') media = `<div class="v-text">${esc(item.text?.body || '')}</div>`;
  else media = `<div class="v-file">${icon('file')}<b>${esc(item.fileName || item.name)}</b>${fileURL ? `<a class="btn" href="${fileURL}" target="_blank" rel="noopener" download="${esc(item.fileName || item.name)}">${icon('external')} فتح الملف</a>` : '<span>الملف غير متوفر</span>'}</div>`;

  const canShareFile = blob && navigator.canShare?.({ files: [new File([blob], item.fileName || 'file', { type: blob.type })] });
  const canShare = canShareFile || !!navigator.share;
  const canCopyImage = item.kind === 'image' && blob && window.ClipboardItem && navigator.clipboard?.write;

  // عرض مثل Pinterest: الصورة فقط مع زرين صغيرين، وتحتها مزيد من الصور. باقي الخيارات في قائمة «•••»
  const node = el(`<div class="viewer pin">
    <div class="v-media">${media}
      <button class="pv-btn pv-back" type="button" data-close aria-label="رجوع">${icon('x')}</button>
      <button class="pv-btn pv-more" type="button" aria-label="خيارات">•••</button>
      <button class="pv-btn pv-fav ${item.favorite ? 'on' : ''}" type="button" aria-label="مفضلة">${icon('heart')}</button>
    </div>
    <section class="v-similar" aria-label="مزيد من الصور"></section></div>`);
  const panel = el(`<div class="sheet v-sheet"><div class="sheet-head"><h2>خيارات</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
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
      <div class="v-class"></div>
      ${safeHref(item.source?.page) ? `<p class="v-src">المصدر: <a href="${esc(safeHref(item.source.page))}" target="_blank" rel="noopener">${esc(item.source.site || 'رابط')}</a>${item.source.license ? ` · ${esc(item.source.license)}` : ''}${item.source.author ? ` · ${esc(item.source.author)}` : ''}</p>` : ''}
    </div></div>`);
  $('.pv-more', node).onclick = () => openModal(panel);
  $('.pv-fav', node).onclick = () => $('[data-a=fav]', panel).click();

  // حفظ الاسم والملاحظة تلقائياً أثناء الكتابة
  const saved = $('.saved', panel);
  const autosave = debounce(async () => {
    try {
      await updateItem(id, { name: panel.querySelector('[name=name]').value.trim() || item.name, notes: panel.querySelector('[name=note]').value.trim(), description: '' });
      changed = true;
      saved.textContent = 'تم الحفظ تلقائياً';
    } catch (err) { toast(friendlyError(err), 'err'); }
  }, 500);
  $$('[name=name], [name=note]', panel).forEach((f) => { f.oninput = () => { saved.textContent = ''; autosave(); }; });

  const groupsBox = $('.v-groups', panel);
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

  // القسم الخاص: تعديل القسم والأنواع يدوياً (التعديل اليدوي هو المعتمد)
  const classBox = $('.v-class', panel);
  const paintClass = () => {
    classBox.innerHTML = '';
    const cur = S.items.get(id);
    if (!cur || !isPrivate(cur)) return;
    const g = groupOf(cur), tags = tagsOf(cur);
    const how = Array.isArray(cur.mtags) || cur.pgroupManual ? 'مصنفة يدوياً' : analyzed(cur) ? (cur.auto?.group ? 'مصنفة تلقائياً حسب محتواها' : 'لم يتأكد التحليل من قسمها: اختر لها يدوياً') : 'لم تُحلل بعد';
    classBox.append(el(`<div class="label">التصنيف · <span class="muted">${esc(how)}</span></div>`));
    const seg = el(`<div class="seg2 small">${Object.entries(PG()).map(([k, v]) => `<button type="button" data-g="${esc(k)}" class="${k === g ? 'on' : ''}">${esc(v.label)}</button>`).join('')}</div>`);
    $$('[data-g]', seg).forEach((b) => { b.onclick = async () => {
      if (b.dataset.g === g) return;
      await updateItem(id, { pgroupManual: b.dataset.g, mtags: [] }); changed = true; paintClass();
    }; });
    classBox.append(seg);
    const box = el('<div class="v-groups"></div>');
    typesOf(g).forEach((t) => {
      const on = tags.includes(t);
      const b = el(`<button type="button" class="chip ${on ? 'on' : ''}" aria-pressed="${on}">${on ? icon('check') : ''}${esc(t)}</button>`);
      b.onclick = async () => {
        const now = tagsOf(S.items.get(id));
        await updateItem(id, { mtags: on ? now.filter((x) => x !== t) : [...now, t], pgroupManual: groupOf(S.items.get(id)) });
        changed = true; paintClass();
      };
      box.append(b);
    });
    classBox.append(box);
    if (Array.isArray(cur.mtags) || cur.pgroupManual) {
      const r = el('<button type="button" class="link muted">إرجاع للتصنيف التلقائي</button>');
      r.onclick = async () => { await updateItem(id, { mtags: undefined, pgroupManual: undefined, ptype: null }); changed = true; paintClass(); };
      classBox.append(r);
    }
  };
  paintClass();

  // الصور المشابهة حسب المحتوى (وليست عشوائية)
  const simBox = $('.v-similar', node);
  const paintSimilar = async () => {
    const cur = S.items.get(id);
    if (!cur || cur.kind !== 'image') return;
    simBox.innerHTML = '<h3>مزيد من الصور</h3>';
    if (!cur.emb) { simBox.append(el(`<p class="muted">${AI.failed ? 'لم تُحلل هذه الصورة بعد (يحتاج اتصالاً بالإنترنت لأول مرة).' : 'جاري تحليل الصورة لإيجاد المشابه لها…'}</p>`)); return; }
    try { await aiMod(); } catch { simBox.append(el('<p class="muted">تعذّر تحميل أداة التحليل.</p>')); return; }
    // مثل Pinterest: الأقرب شبهاً أولاً ثم الأبعد (من نفس المساحة فقط، مرتبة حسب التشابه وليست عشوائية)
    const sim = similarTo(cur, 60, 0);
    if (!sim.length) { simBox.append(el('<p class="muted">لا توجد صور أخرى بعد.</p>')); return; }
    const go = (sid) => { closeModal().then(() => openItem(sid)); };
    simBox.append(gridEl(sim.map((x) => x[1]), go));
  };
  paintSimilar();

  $('.acts', panel).onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const cur = S.items.get(id);
    if (a === 'fav') {
      const fav = !cur.favorite;
      await updateItem(id, { favorite: fav, favoritedAt: fav ? Date.now() : null });
      changed = true;
      b.classList.toggle('on', fav);
      $('.pv-fav', node).classList.toggle('on', fav);
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
      while (modals.length) await closeModal();
    }
  };

  openModal(node, { cls: 'view', onClose: () => { if (fileURL) setTimeout(() => URL.revokeObjectURL(fileURL), 1000); if (changed) render(); } });
}

/* ---------- الذكاء المحلي: التحليل في الخلفية، الصور المشابهة، البحث بالمعنى ---------- */
const AI = { mod: null, running: false, failed: false, labels: null, done: 0, total: 0, dl: null };
// حدود معايرة على 88 صورة حقيقية (انظر ai.js)
const SIM_MIN = 0.6;    // تشابه صورتين: 0.6 ≈ أعلى 4٪ من الأزواج
const SIM_HIGH = 0.75;  // نفس الشخص/الشخصية/الجلسة غالباً ≈ 0.78–0.92، ونساء مختلفات ≈ 0.63
const SEM_MIN = 0.18;   // أقل تطابق بين عبارة البحث والصورة
const SEM_Z = 2.0;      // ويجب أن تتميز الصورة عن باقي المكتبة (z مقاوم: الوسيط و MAD)
async function aiMod() {
  if (!AI.mod) {
    AI.mod = await import('./ai.js');
    AI.mod.setProgressHandler((got, total) => { AI.dl = total ? [got, total] : null; aiStatus(); });
  }
  return AI.mod;
}
const needsAI = (i) => i.kind === 'image' && (!i.emb || i.aiv !== AI.mod?.MODEL_TAG);
function aiStatus() {
  const bar = $('#aiStatus');
  if (!bar) return;
  if (!AI.running) { bar.hidden = true; return; }
  bar.hidden = false;
  const dl = AI.dl && AI.dl[0] < AI.dl[1] ? ` · تنزيل نموذج التحليل لأول مرة ${Math.round((AI.dl[0] / AI.dl[1]) * 100)}٪` : '';
  bar.textContent = `تحليل محتوى الصور ${AI.done} من ${AI.total}${dl}`;
}
async function aiLabels(m) {
  if (AI.labels) return AI.labels;
  const r = await m.labelEmbeddings(S.settings.aiLabels);
  if (r.save) await setSetting('aiLabels', r.save);
  return (AI.labels = r.labels);
}
/** يحلل الصور التي ليس لها بصمة. يعمل في الخلفية، ويمكن استدعاؤه أكثر من مرة بأمان. */
async function aiIndex() {
  if (AI.running) return;
  let m;
  try { m = await aiMod(); } catch (e) { console.warn('AI unavailable', e); AI.failed = true; return; }
  let todo = [...S.items.values()].filter(needsAI).sort(newest);
  if (!todo.length) return;
  AI.running = true; AI.done = 0; AI.total = todo.length; aiStatus();
  let changedView = false;
  try {
    let labels = null;
    for (let n = 0; n < todo.length; n++) {
      const it = S.items.get(todo[n].id);
      if (!it) { AI.done++; continue; }
      const t = await DB.get('thumbs', it.id) || await DB.get('files', it.id);
      if (!t?.blob) { AI.done++; continue; }
      let emb;
      try { emb = await m.embedImage(t.blob); } catch (e) { console.warn('embed failed', it.id, e); AI.done++; continue; }
      const patch = { emb, aiv: m.MODEL_TAG };
      if (isPrivate(it)) {
        labels ||= await aiLabels(m);
        const c = m.classify(emb, labels);
        patch.auto = { group: c.group, tags: c.tags, p: c.detail };
      }
      const cur = S.items.get(it.id);
      if (!cur) { AI.done++; continue; }
      const rec = { ...cur, ...patch };
      await DB.put('images', rec);
      S.items.set(rec.id, rec);
      AI.done++; changedView = true;
      aiStatus();
      if (n % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      if (n === todo.length - 1) { // صور أضيفت أثناء التحليل
        const more = [...S.items.values()].filter((x) => needsAI(x) && !todo.some((y) => y.id === x.id));
        if (more.length) { todo = todo.concat(more); AI.total = todo.length; }
      }
    }
  } catch (e) {
    console.error('AI index error', e);
    AI.failed = true;
    toast('تعذّر تحليل الصور الآن (تحقق من الإنترنت لأول تنزيل)، سيُعاد المحاولة لاحقاً', 'err');
  } finally {
    AI.running = false; aiStatus();
    if (changedView) { if (modals.length) AI.dirty = true; else render(); }
  }
}
const aiKick = () => setTimeout(() => aiIndex(), 300);

/** أقرب الصور شبهاً لصورة معينة، من نفس المساحة فقط (العامة مع العامة، والخاصة مع الخاصة) */
function similarTo(item, limit = 30, min = SIM_MIN) {
  if (!item.emb || !AI.mod) return [];
  const priv = isPrivate(item);
  const out = [];
  S.items.forEach((o) => {
    if (o.id === item.id || !o.emb || isPrivate(o) !== priv) return;
    const s = AI.mod.dot(item.emb, o.emb);
    if (s >= min) out.push([s, o]);
  });
  return out.sort((a, b) => b[0] - a[0]).slice(0, limit);
}

/** البحث بالمعنى: يحوّل العبارة إلى بصمة ويقارنها ببصمات الصور. النتيجة في S.sem ثم إعادة العرض. */
async function semSearch(q) {
  S.sem = { q, pending: true, scores: new Map(), en: null };
  try {
    const m = await aiMod();
    const en = m.toEnglish(normalize(q));
    if (!en) { S.sem = { q, pending: false, scores: new Map(), en: null }; if (S.q === q) render(); return; }
    const embs = await m.embedTexts([en, `a photo of ${en}`, `an anime illustration of ${en}`, `a character with ${en}`, `a woman wearing ${en}`]);
    const qe = new Float32Array(embs[0].length);
    embs.forEach((e) => e.forEach((v, i) => { qe[i] += v; }));
    const n = Math.hypot(...qe) || 1; qe.forEach((v, i) => { qe[i] = v / n; });
    const scores = new Map();
    S.items.forEach((i) => { if (i.emb) scores.set(i.id, m.dot(qe, i.emb)); });
    // الوسيط والانحراف المطلق الوسيط: لا يتأثران إذا كانت نسبة كبيرة من الصور مطابقة
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] ?? 0; };
    const v = [...scores.values()], mean = med(v), sd = Math.max(0.005, 1.4826 * med(v.map((x) => Math.abs(x - mean))));
    if (S.q === q) S.sem = { q, pending: false, scores, en, mean, sd };
  } catch (e) {
    console.warn('semantic search failed', e);
    if (S.q === q) S.sem = { q, pending: false, scores: new Map(), en: null, failed: true };
  }
  if (S.q === q) render();
}
/** يطبق البحث (نص + معنى) على قائمة: المطابق بالنص أولاً ثم الأقرب بالمعنى */
function applySearch(list) {
  if (!S.q) return list;
  rebuildGroupIndex();
  const text = list.filter((i) => matches(i, S.q));
  if (S.sem?.q !== S.q) semSearch(S.q);
  const sc = S.sem?.q === S.q ? S.sem.scores : null;
  if (!sc || !sc.size) return text;
  const ids = new Set(text.map((i) => i.id));
  const { mean, sd } = S.sem;
  // مكتبة صغيرة جداً: المتوسط والانحراف غير موثوقين، نكتفي بالحد المطلق مع هامش أعلى
  const zOk = sc.size >= 12 ? (s) => (s - mean) / sd >= SEM_Z : (s) => s >= SEM_MIN + 0.03;
  const sem = list.filter((i) => !ids.has(i.id) && sc.has(i.id)).map((i) => [sc.get(i.id), i])
    .filter(([s]) => s >= SEM_MIN && zOk(s)).sort((a, b) => b[0] - a[0]).slice(0, 60).map((x) => x[1]);
  return [...text, ...sem];
}
const searchPending = () => S.q && S.sem?.q === S.q && S.sem.pending;

/* ---------- الصفحات ---------- */
function cardHTML(i) {
  let top;
  if (i.kind === 'image') top = `<span class="ph" style="aspect-ratio:${safeNum(i.width)} / ${safeNum(i.height)}"><img data-id="${esc(i.id)}" alt="" decoding="async"></span>`;
  else if (i.kind === 'text') top = `<span class="textph">${esc((i.text?.body || '').slice(0, 220))}</span>`;
  else top = `<span class="fileph">${icon('file')}<small>${esc(ext(i.fileName || i.name))}</small></span>`;
  const note = noteOf(i);
  return `<button class="card" type="button" data-id="${esc(i.id)}" aria-label="${esc(i.name)}">${top}
    ${i.kind === 'image' ? '' : `<span class="name">${esc(i.name || 'بدون اسم')}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}`}
    ${i.favorite ? `<span class="heart">${icon('heart')}</span>` : ''}</button>`;
}
/** شبكة بأعمدة متوازنة تحافظ على أبعاد الصور، وتُضاف البطاقات تدريجياً */
function gridEl(list, onOpen) {
  const w = onOpen ? Math.min(innerWidth, 1100) : ($('#main').clientWidth || innerWidth);
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
  grid.onclick = (e) => { const c = e.target.closest('.card'); if (c) (onOpen ? onOpen(c.dataset.id) : openItem(c.dataset.id, list)); };
  return grid;
}
function footerEl() {
  const lb = S.settings.lastBackup;
  const when = lb ? `آخر نسخة: ${new Date(lb.at).toLocaleDateString('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' })} (${lb.count} مرجع)` : 'لم تحفظ نسخة احتياطية بعد';
  const f = el(`<div class="foot"><button type="button" class="link muted">حفظ نسخة احتياطية من مكتبتك</button><span>${when}</span><span>لاسترجاعها: اضغط «إضافة» واختر ملف النسخة. الاسترجاع يضيف ولا يحذف شيئاً.</span></div>`);
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

  if (S.q) list = applySearch(list);

  if (!list.length) {
    if (S.q) main.append(searchPending() ? emptyEl('جاري البحث في محتوى الصور…', '', false) : emptyEl('لا توجد نتائج', 'لا توجد صورة في مكتبتك تطابق هذا البحث.', false));
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
  if (S.pgroup !== ALL && !PG()[S.pgroup]) S.pgroup = 'anime';
  const g = PG()[S.pgroup];
  const head = el(`<div class="p-head"><div class="seg2 tabs">${[...Object.entries(PG()), [ALL, { label: 'الكل' }]].map(([k, v]) => `<button type="button" data-g="${esc(k)}" class="${k === S.pgroup ? 'on' : ''}">${esc(v.label)}</button>`).join('')}<button type="button" data-newg aria-label="إضافة قسم">${icon('plus')}</button></div>
    <div class="p-tools">${g?.custom ? '<button type="button" class="link muted" data-rename>تعديل الاسم</button><button type="button" class="link muted" data-delg>حذف القسم</button>' : ''}${S.pgroup !== ALL && S.ptype && S.ptype !== UNSORTED && typesOf(S.pgroup).includes(S.ptype) ? '<button type="button" class="link muted" data-renamet>تعديل اسم النوع</button><button type="button" class="link muted" data-delt>حذف النوع</button>' : ''}<button type="button" class="link muted" data-pass>تغيير كلمة المرور</button><button type="button" class="chip" data-exit>خروج</button></div></div>`);
  $$('[data-g]', head).forEach((b) => { b.onclick = () => { S.pgroup = b.dataset.g; S.ptype = null; render(); }; });
  $('[data-newg]', head).onclick = async () => {
    const name = await askName('قسم جديد', 'مثال: رسومات، خلفيات، أفكار');
    if (!name) return;
    if (Object.values(PG()).some((v) => normalize(v.label) === normalize(name)) || normalize(name) === normalize('الكل')) return toast('يوجد قسم بهذا الاسم', 'err');
    const id = 'c' + Date.now().toString(36);
    await setSetting('customGroups', [...(S.settings.customGroups || []), { id, name }]);
    S.pgroup = id; S.ptype = null; render();
  };
  if (g?.custom) {
    $('[data-rename]', head).onclick = async () => {
      const name = await askName('اسم القسم', g.label);
      if (!name || normalize(name) === normalize(g.label)) return;
      if (Object.values(PG()).some((v) => normalize(v.label) === normalize(name))) return toast('يوجد قسم بهذا الاسم', 'err');
      await setSetting('customGroups', S.settings.customGroups.map((c) => (c.id === S.pgroup ? { ...c, name } : c)));
      render();
    };
    $('[data-delg]', head).onclick = async () => {
      const id = S.pgroup;
      const inside = [...S.items.values()].filter((i) => isPrivate(i) && groupOf(i) === id);
      if (!(await confirmBox(`حذف قسم «${g.label}»؟${inside.length ? ` صوره (${inside.length}) لن تُحذف، بل ترجع للتوزيع التلقائي بين الأنمي والصور النسائية.` : ''}`, 'حذف'))) return;
      for (const i of inside) await updateItem(i.id, { pgroup: 'anime', pgroupManual: undefined, mtags: undefined, ptype: null });
      const ct = { ...(S.settings.customTypes || {}) }; delete ct[id];
      await setSetting('customTypes', ct);
      await setSetting('customGroups', S.settings.customGroups.filter((c) => c.id !== id));
      S.pgroup = 'anime'; S.ptype = null; render();
    };
  }
  const typeItems = () => [...S.items.values()].filter((i) => isPrivate(i) && groupOf(i) === S.pgroup);
  if ($('[data-renamet]', head)) $('[data-renamet]', head).onclick = async () => {
    const from = S.ptype, name = await askName('اسم النوع', from);
    if (!name || normalize(name) === normalize(from)) return;
    if (typesOf(S.pgroup).some((t) => normalize(t) === normalize(name))) return toast('يوجد نوع بهذا الاسم', 'err');
    const ct = { ...(S.settings.customTypes || {}) };
    ct[S.pgroup] = (ct[S.pgroup] || []).map((t) => (t === from ? name : t));
    await setSetting('customTypes', ct);
    for (const i of typeItems()) {
      const patch = {};
      if (Array.isArray(i.mtags) && i.mtags.includes(from)) patch.mtags = i.mtags.map((t) => (t === from ? name : t));
      if (i.ptype === from) patch.ptype = name;
      if (Object.keys(patch).length) await updateItem(i.id, patch);
    }
    S.ptype = name; render();
  };
  if ($('[data-delt]', head)) $('[data-delt]', head).onclick = async () => {
    const t = S.ptype;
    if (!(await confirmBox(`حذف نوع «${t}»؟ الصور نفسها لن تُحذف.`, 'حذف'))) return;
    const ct = { ...(S.settings.customTypes || {}) };
    ct[S.pgroup] = (ct[S.pgroup] || []).filter((x) => x !== t);
    await setSetting('customTypes', ct);
    for (const i of typeItems()) {
      const patch = {};
      if (Array.isArray(i.mtags) && i.mtags.includes(t)) patch.mtags = i.mtags.filter((x) => x !== t);
      if (i.ptype === t) patch.ptype = null;
      if (Object.keys(patch).length) await updateItem(i.id, patch);
    }
    S.ptype = null; render();
  };
  $('[data-pass]', head).onclick = () => changePassword();
  $('[data-exit]', head).onclick = () => { S.priv = false; S.unlocked = false; S.ptype = null; render(); scrollTo(0, 0); };
  main.append(head);
  if (g?.adult) main.append(el('<p class="p-note">صور فوتوغرافية لنساء بالغات (18 سنة فأكثر) فقط، ومنفصلة تماماً عن الأنمي.</p>'));
  if (g?.custom) main.append(el('<p class="p-note">قسم خاص بك: كل ما تضيفه هنا يبقى فيه ولا ينقله التوزيع التلقائي. أضف له أنواعاً من زر «+ نوع».</p>'));
  else main.append(el('<p class="p-note">تتوزع الصور تلقائياً حسب محتواها: أي رسم (أنمي، مانجا، كرتون، رسم رقمي) يذهب للأنمي، وأي صورة حقيقية (حتى الكوسبلاي) تذهب للصور النسائية. ما لم يتأكد منه التحليل يظهر في «غير مصنف»، وتعديلك اليدوي هو المعتمد دائماً. الأنواع تضيفها أنت من زر «+ نوع»، واضغط على أي نوع لتعديل اسمه أو حذفه.</p>'));

  const all = [...S.items.values()].filter((i) => isPrivate(i) && (S.pgroup === ALL || groupOf(i) === S.pgroup));
  const count = (t) => (t === UNSORTED ? all.filter(isUnsorted).length : all.filter((i) => tagsOf(i).includes(t)).length);
  const types = el('<div class="groups"></div>');
  const chip = (t, label = t) => {
    const n = t ? count(t) : all.length;
    const b = el(`<button type="button" class="chip ${S.ptype === t ? 'on' : ''} ${n ? '' : 'zero'}">${esc(label)} <small>${n}</small></button>`);
    b.onclick = () => { S.ptype = t; render(); };
    types.append(b);
  };
  chip(null, 'كل الأنواع');
  if (count(UNSORTED) || S.ptype === UNSORTED) chip(UNSORTED);
  const shown = S.pgroup === ALL ? [...new Set(Object.keys(PG()).flatMap(typesOf))] : typesOf(S.pgroup);
  shown.forEach((t) => chip(t));
  const nb = el(`<button type="button" class="chip ghost">${icon('plus')} نوع</button>`);
  if (S.pgroup !== ALL) types.append(nb);
  nb.onclick = async () => {
    const name = await askName('نوع جديد', S.pgroup === 'anime' ? 'مثال: ون بيس' : S.pgroup === 'women' ? 'مثال: فساتين سهرة' : 'اسم النوع');
    if (!name || typesOf(S.pgroup).some((t) => normalize(t) === normalize(name))) return;
    const ct = { ...(S.settings.customTypes || {}) };
    ct[S.pgroup] = [...(ct[S.pgroup] || []), name];
    await setSetting('customTypes', ct);
    S.ptype = name; render();
  };
  main.append(types);
  if (S.pgroup !== ALL && S.ptype && S.ptype !== UNSORTED && typesOf(S.pgroup).includes(S.ptype)) {
    const ab = el(`<button type="button" class="btn light type-add">${icon('plus')}<span>إضافة صور إلى «${esc(S.ptype)}»</span></button>`);
    ab.onclick = () => openTypePicker(S.pgroup, S.ptype);
    main.append(ab);
  }

  const waiting = all.filter((i) => i.kind === 'image' && !analyzed(i)).length;
  if (waiting && AI.running) main.append(el(`<p class="p-note">يجري تحليل ${waiting} صورة وتوزيعها على الأنواع تلقائياً…</p>`));
  else if (waiting && AI.failed) main.append(el(`<p class="p-note">لم تُحلل ${waiting} صورة بعد: افتح الموقع وأنت متصل بالإنترنت مرة لتنزيل نموذج التحليل.</p>`));

  let list = all.filter((i) => !S.ptype || (S.ptype === UNSORTED ? isUnsorted(i) : tagsOf(i).includes(S.ptype))).sort(newest);
  if (S.q) list = applySearch(list);
  if (!list.length) {
    if (S.q) main.append(searchPending() ? emptyEl('جاري البحث في محتوى الصور…', '', false) : emptyEl('لا توجد نتائج', 'لا توجد صورة هنا تطابق هذا البحث.', false));
    else if (S.ptype && all.length) main.append(emptyEl('لا توجد صور من هذا النوع', S.ptype === UNSORTED ? 'كل الصور مصنفة.' : 'اضغط «إضافة صور» فوق واختر من صورك صورة أو أكثر، أو أضف صوراً جديدة.', false));
    else main.append(emptyEl('لا توجد صور هنا بعد', 'ابحث في Pinterest، احفظ الصورة على جهازك، ثم اضغط «إضافة».', true));
    return;
  }
  main.append(gridEl(list), footerEl());
}

/** إضافة صور موجودة إلى نوع: اختيار صورة أو أكثر بالضغط عليها.
    الترتيب: الأشبه بالنوع أولاً (حسب صور النوع الموجودة، ثم اسم النوع إن فهمه التحليل)، وليس عشوائياً */
async function openTypePicker(group, type) {
  const pool = [...S.items.values()].filter((i) => isPrivate(i) && i.kind === 'image' && groupOf(i) === group && !tagsOf(i).includes(type)).sort(newest);
  const members = [...S.items.values()].filter((i) => isPrivate(i) && groupOf(i) === group && tagsOf(i).includes(type));
  const sel = new Set();
  const node = el(`<div class="sheet picker"><div class="sheet-head"><h2>إضافة إلى «${esc(type)}»</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <p class="p-note pk-how">${pool.length ? 'اضغط على الصور لاختيارها، صورة أو أكثر، ثم «إضافة».' : 'كل صور هذا القسم موجودة في هذا النوع، أو لا توجد صور بعد.'}</p>
    <div class="pk-bar"><button type="button" class="chip" data-like hidden>الأشبه بما اخترت</button><button type="button" class="link muted" data-allsel>تحديد الكل</button></div>
    <div class="pk-grid"></div>
    <div class="pk-foot"><button class="btn" type="button" data-ok disabled>إضافة</button></div></div>`);
  const grid = $('.pk-grid', node), ok = $('[data-ok]', node), like = $('[data-like]', node), allBtn = $('[data-allsel]', node), how = $('.pk-how', node);
  if (!pool.length) { allBtn.hidden = true; ok.hidden = true; }
  const paint = () => {
    ok.disabled = !sel.size;
    ok.textContent = sel.size ? `إضافة ${sel.size} ${sel.size === 1 ? 'صورة' : sel.size === 2 ? 'صورتين' : sel.size <= 10 ? 'صور' : 'صورة'}` : 'إضافة';
    like.hidden = !sel.size || !AI.mod;
    allBtn.textContent = sel.size === pool.length && pool.length ? 'إلغاء التحديد' : 'تحديد الكل';
  };
  let order = pool, shown = 0;
  const cell = (i) => {
    const b = el(`<button type="button" class="pk ${sel.has(i.id) ? 'on' : ''}" data-id="${i.id}" aria-pressed="${sel.has(i.id)}"><img data-id="${i.id}" alt="" decoding="async"><span class="tick">${icon('check')}</span></button>`);
    const img = $('img', b); io ? io.observe(img) : loadThumb(img);
    return b;
  };
  const more = () => { order.slice(shown, shown + 60).forEach((i) => grid.append(cell(i))); shown += 60; };
  const draw = () => { grid.innerHTML = ''; shown = 0; more(); };
  node.addEventListener('scroll', () => { if (shown < order.length && node.scrollTop + node.clientHeight > node.scrollHeight - 600) more(); });
  grid.onclick = (e) => {
    const b = e.target.closest('.pk'); if (!b) return;
    const id = b.dataset.id, on = !sel.has(id);
    on ? sel.add(id) : sel.delete(id);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    paint();
  };
  allBtn.onclick = () => {
    const all = sel.size !== pool.length;
    sel.clear(); if (all) pool.forEach((i) => sel.add(i.id));
    $$('.pk', grid).forEach((b) => { b.classList.toggle('on', all); b.setAttribute('aria-pressed', all); });
    paint();
  };
  /** ترتيب حسب الشبه: متوسط بصمات صور مرجعية (+ وصف نصي إن وُجد) */
  const rank = (refs, textEmb) => {
    const embs = refs.map((i) => i.emb).filter(Boolean);
    if (textEmb) embs.push(textEmb);
    if (!embs.length) return false;
    const c = new Float32Array(embs[0].length);
    embs.forEach((e) => e.forEach((v, k) => { c[k] += v; }));
    const n = Math.hypot(...c) || 1; c.forEach((v, k) => { c[k] = v / n; });
    const dot = (a) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * c[k]; return s; };
    order = [...pool].sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || ((b.emb ? dot(b.emb) : -9) - (a.emb ? dot(a.emb) : -9)));
    draw(); return true;
  };
  like.onclick = () => { rank(pool.filter((i) => sel.has(i.id)).concat(members)); node.scrollTop = 0; };
  ok.onclick = async () => {
    ok.disabled = true;
    for (const id of sel) {
      const i = S.items.get(id); if (!i) continue;
      const now = tagsOf(i);
      await updateItem(id, { mtags: now.includes(type) ? now : [...now, type], pgroupManual: groupOf(i) });
    }
    const n = sel.size;
    await closeModal();
    S.pgroup = group; S.ptype = type; render();
    toast(`أُضيفت ${n} ${n === 1 ? 'صورة' : n === 2 ? 'صورتين' : n <= 10 ? 'صور' : 'صورة'} إلى «${type}»`, 'ok');
  };
  draw(); paint();
  openModal(node);
  if (!pool.length) return;
  // الترتيب الذكي: صور النوع الموجودة أولاً، وإن كان النوع جديداً فاسمه (إن كان مفهوماً للتحليل)
  try {
    const m = await aiMod();
    let te = null;
    const en = m.toEnglish(normalize(type));
    if (en) { const e = await m.embedTexts([en, `a photo of ${en}`, `an anime illustration of ${en}`]); te = new Float32Array(e[0].length); e.forEach((x) => x.forEach((v, k) => { te[k] += v; })); }
    if (members.some((i) => i.emb) || te) {
      if (rank(members, te)) how.textContent = 'مرتبة: الأشبه بـ«' + type + '» أولاً. اضغط على الصور لاختيارها، صورة أو أكثر.';
    } else how.textContent = 'النوع جديد: اختر أول الصور، ثم اضغط «الأشبه بما اخترت» لتظهر الصور المشابهة لها أولاً.';
    paint();
  } catch (e) { console.warn('picker rank failed', e); }
}

/* النقطة الخفيفة ← نص التعريف ← كلمة «كيف» ← كلمة المرور (الافتراضية 1231) */
function openAbout() {
  const node = el(`<div class="sheet about"><div class="sheet-head"><h2>عن فسيفساء</h2><button class="x" type="button" data-close aria-label="إغلاق">${icon('x')}</button></div>
    <p>فسيفساء مكتبتك الشخصية للمراجع. تجمع فيها الصور والملفات التي تحب الرجوع إليها: أفكار للرسم، صور سيارات، تصاميم، مستندات، أو أي شيء يلهمك، كل ذلك في مكان واحد مرتب وهادئ.</p>
    <p>طريقة الاستخدام بسيطة: اضغط «إضافة»، اختر صورة أو ملفاً من جهازك، ثم اضغط «حفظ». الاسم والملاحظة اختياريان، وتستطيع كتابتهما أو تعديلهما لاحقاً من داخل المرجع نفسه، فكل تعديل يُحفظ تلقائياً.</p>
    <p>اضغط على أي مرجع لتراه بحجم أكبر. من هناك تضيفه إلى المفضلة، أو تنسخه، أو تشاركه، أو تحذفه. وتجد كل ما أضفته إلى المفضلة في صفحة المفضلة أسفل الشاشة.</p>
    <p>اكتب في مربع البحث ليظهر لك ما يطابق الاسم أو الملاحظة فوراً. وإن لم تجد ما تريد في مكتبتك، اضغط زر Pinterest ليفتح لك نتائج البحث هناك، فتحفظ الصورة التي يحق لك حفظها على جهازك ثم تضيفها إلى فسيفساء.</p>
    <p>المجموعات اختيارية تماماً؛ أنشئ مجموعة باسم فقط، ثم أضف إليها المراجع من داخل كل مرجع. هذا <span data-how>كيف</span> تبقى مكتبتك منظمة دون أي تعقيد.</p>
    <p>كل مراجعك محفوظة على جهازك وحده: لا حسابات، ولا تُرفع صورك لأي خادم أو جهة، وتحليلها يتم داخل جهازك. يحتاج الموقع اتصالاً بالإنترنت أول مرة فقط لتنزيل ملفات التشغيل ونموذج التحليل (~66 ميجا) والخطوط، ثم يعمل دون إنترنت، ويُفضّل إضافته إلى الشاشة الرئيسية في الجوال ليبقى محفوظاً بشكل أفضل.</p>
  </div>`);
  $('[data-how]', node).onclick = () => openPassword();
  openModal(node);
}
const DEFAULT_PASS = '1231';
async function openPassword() {
  // بطلب المستخدم: كلمة المرور تُعاد إلى 1231 مرة واحدة (بعدها يستطيع تغييرها من «تغيير كلمة المرور»)
  if (!S.settings.privateHash || !S.settings.passReset1231) { await setPassword(DEFAULT_PASS); await setSetting('passReset1231', true); }
  const has = true;
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
  aiKick();
  // مكتبة السيارات والصور العامة: تُحمّل تلقائياً مرة واحدة على كل جهاز (إلا إذا أوقفها المستخدم)
  if (S.settings.packImported !== PACK_VERSION && !S.settings.packStopped && navigator.onLine) setTimeout(() => importPack(true), 1500);

  // العمل دون إنترنت بعد أول زيارة
  if ('serviceWorker' in navigator && window.isSecureContext) {
    // عند نزول نسخة جديدة: إعادة تحميل الصفحة مرة واحدة تلقائياً حتى لا يبقى المستخدم على نسخة قديمة
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) applyUpdate(); });
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then((r) => {
      r.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(() => {}); });
    }).catch(() => {});
  }
}
init();
