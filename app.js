/* =========================================================
   فسيفساء | FUSAYFISA — منطق التطبيق
   مكتبة صور ومراجع شخصية تعمل محلياً (IndexedDB) ودون إنترنت.
   ========================================================= */
'use strict';

const APP_VERSION = '1.0.0';
const DB_NAME = 'fusayfisa';
const DB_VERSION = 1;
const SHELL_FILES = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

/* =========================================================
   1) أدوات عامة
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
/** توحيد النص العربي للبحث: إزالة التشكيل والتطويل وتوحيد الهمزات والتاء المربوطة */
function normalize(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}
const num = (n) => Number(n).toLocaleString('ar-u-nu-latn');
const fmtDate = (ts) => new Date(ts).toLocaleDateString('ar-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' });
function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  const u = ['بايت', 'ك.ب', 'م.ب', 'ج.ب'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n).trim() + '…' : String(s));
function isHttpUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
function splitKeywords(s) {
  return [...new Set(String(s || '').split(/[,،\n]+/).map((k) => k.trim()).filter(Boolean))];
}
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function dataURLToBlob(dataURL) {
  const res = await fetch(dataURL);
  return res.blob();
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('<textarea style="position:fixed;opacity:0"></textarea>');
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el(`<a href="${url}" download="${esc(name)}"></a>`);
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* =========================================================
   2) قاعدة البيانات IndexedDB
   المخازن: images (بيانات وصفية) / files (الملف الأصلي) / thumbs (مصغرات)
   sections / categories / subjects (السيارات) / collections / settings
   ========================================================= */
const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('المتصفح لا يدعم التخزين المحلي IndexedDB'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const mk = (n, keyPath = 'id') => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath }); };
        ['images', 'files', 'thumbs', 'sections', 'categories', 'subjects', 'collections'].forEach((n) => mk(n));
        mk('settings', 'key');
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => { this.db.close(); location.reload(); };
        resolve();
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => toast('أغلق النوافذ الأخرى المفتوحة لفسيفساء ثم أعد المحاولة', 'error');
    });
  },
  _run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      let result;
      const tx = this.db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      if (r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('أُلغيت العملية'));
    });
  },
  get(s, k) { return this._run(s, 'readonly', (st) => st.get(k)); },
  all(s) { return this._run(s, 'readonly', (st) => st.getAll()); },
  put(s, v) { return this._run(s, 'readwrite', (st) => st.put(v)); },
  del(s, k) { return this._run(s, 'readwrite', (st) => st.delete(k)); },
  clear(s) { return this._run(s, 'readwrite', (st) => st.clear()); },
  /** كتابة ذرية على عدة مخازن */
  batch(stores, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      fn((name) => tx.objectStore(name));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('أُلغيت العملية'));
    });
  },
};
function dbErrorMessage(err) {
  if (err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''))) return 'مساحة التخزين في المتصفح ممتلئة. احذف بعض الصور أو صدّر نسخة احتياطية.';
  return (err && err.message) || 'حدث خطأ غير متوقع';
}

/* =========================================================
   3) البيانات الافتراضية والإعدادات
   ========================================================= */
const DEFAULT_SETTINGS = {
  theme: 'auto',
  gridSize: 'medium',
  privateShowInList: false,
  sectionVisible: {},
  profileName: '',
  avatar: null,
  storageNoticeDismissed: false,
  privateHash: null,
  privateSalt: null,
  seeded: false,
};

/** خيارات التصفية: [القيمة، التسمية العربية، مصطلح البحث الإنجليزي] */
const HAIR_COLORS = [['black', 'أسود', 'black hair'], ['brown', 'بني', 'brown hair'], ['blonde', 'أشقر', 'blonde hair'], ['red', 'أحمر', 'red hair'], ['white', 'أبيض', 'white hair'], ['silver', 'فضي', 'silver hair'], ['pink', 'وردي', 'pink hair'], ['blue', 'أزرق', 'blue hair'], ['green', 'أخضر', 'green hair'], ['purple', 'بنفسجي', 'purple hair'], ['multi', 'متعدد الألوان', 'multicolor hair']];
const HAIR_LENGTH = [['short', 'قصير', 'short hair'], ['medium', 'متوسط', 'medium length hair'], ['long', 'طويل', 'long hair'], ['tied', 'مربوط', 'tied hair'], ['covered', 'مغطى', 'covered hair']];
const EYE_COLORS = [['brown', 'بني', 'brown eyes'], ['black', 'أسود', 'dark eyes'], ['blue', 'أزرق', 'blue eyes'], ['green', 'أخضر', 'green eyes'], ['hazel', 'عسلي', 'hazel eyes'], ['gray', 'رمادي', 'gray eyes'], ['red', 'أحمر', 'red eyes'], ['purple', 'بنفسجي', 'purple eyes'], ['gold', 'ذهبي', 'golden eyes']];
const ANGLES = [['front', 'أمامية', 'front view'], ['side', 'جانبية', 'side view'], ['three-quarter', 'ثلاثة أرباع', 'three quarter view'], ['high', 'من الأعلى', 'high angle'], ['low', 'من الأسفل', 'low angle'], ['back', 'خلفية', 'back view'], ['closeup', 'قريبة', 'close up']];

const FILTER_SETS = {
  anime: [
    { key: 'style', label: 'نوع الرسم', options: [['classic', 'كلاسيكي', '90s anime style'], ['modern', 'حديث', 'modern anime style'], ['chibi', 'تشيبي', 'chibi'], ['semi-real', 'شبه واقعي', 'semi realistic anime'], ['watercolor', 'ألوان مائية', 'watercolor anime'], ['lineart', 'خطوط فقط', 'lineart'], ['cel', 'تظليل مسطح', 'cel shading']] },
    { key: 'hairColor', label: 'لون الشعر', options: HAIR_COLORS },
    { key: 'hairLength', label: 'طول الشعر', options: HAIR_LENGTH },
    { key: 'eyeColor', label: 'لون العينين', options: EYE_COLORS },
    { key: 'clothing', label: 'الملابس', options: [['school', 'زي مدرسي', 'school uniform'], ['casual', 'كاجوال', 'casual outfit'], ['formal', 'رسمي', 'formal outfit'], ['kimono', 'تقليدي ياباني', 'kimono'], ['fantasy', 'خيالي', 'fantasy outfit'], ['armor', 'درع وقتال', 'armor'], ['military', 'عسكري', 'military uniform'], ['sport', 'رياضي', 'sportswear'], ['winter', 'شتوي', 'winter outfit']] },
    { key: 'angle', label: 'زاوية التصوير', options: ANGLES },
    { key: 'pose', label: 'وضعية الشخصية', options: [['standing', 'وقوف', 'standing pose'], ['sitting', 'جلوس', 'sitting pose'], ['action', 'حركة', 'dynamic pose'], ['fighting', 'قتال', 'fighting pose'], ['running', 'ركض', 'running pose'], ['casual', 'عفوية', 'casual pose']] },
    { key: 'background', label: 'نوع الخلفية', options: [['plain', 'بسيطة', 'simple background'], ['nature', 'طبيعة', 'nature background'], ['city', 'مدينة', 'city background'], ['indoor', 'داخلية', 'indoor background'], ['fantasy', 'خيالية', 'fantasy background'], ['night', 'ليلية', 'night background']] },
    { key: 'work', label: 'اسم الأنمي أو الشخصية', type: 'text', placeholder: 'مثال: Naruto' },
  ],
  women: [
    { key: 'skinTone', label: 'لون البشرة', options: [['light', 'فاتحة', ''], ['wheat', 'حنطية', ''], ['tan', 'سمراء', ''], ['dark', 'داكنة', '']] },
    { key: 'hairColor', label: 'لون الشعر', options: HAIR_COLORS },
    { key: 'hairLength', label: 'طول الشعر', options: HAIR_LENGTH },
    { key: 'eyeColor', label: 'لون العينين', options: EYE_COLORS.slice(0, 6) },
    { key: 'clothing', label: 'نوع الملابس', options: [['casual', 'كاجوال', 'casual outfit'], ['formal', 'رسمي', 'formal outfit'], ['modest', 'محتشم', 'modest fashion'], ['evening', 'فستان سهرة', 'evening dress'], ['traditional', 'تقليدي', 'traditional dress'], ['sport', 'رياضي', 'sportswear'], ['winter', 'شتوي', 'winter outfit'], ['abaya', 'عباية', 'abaya']] },
    { key: 'photoStyle', label: 'أسلوب التصوير', options: [['professional', 'احترافي', 'professional photography'], ['natural', 'طبيعي', 'natural photography'], ['fashion', 'أزياء', 'fashion photography'], ['daily', 'يومي', 'lifestyle photography'], ['art', 'فني', 'fine art photography'], ['editorial', 'صحفي', 'editorial photography']] },
    { key: 'angle', label: 'زاوية الكاميرا', options: ANGLES },
    { key: 'lighting', label: 'الإضاءة', options: [['natural', 'طبيعية', 'natural light'], ['studio', 'استوديو', 'studio lighting'], ['golden', 'الساعة الذهبية', 'golden hour'], ['soft', 'ناعمة', 'soft light'], ['dramatic', 'درامية', 'dramatic lighting'], ['night', 'ليلية', 'night photography']] },
    { key: 'background', label: 'الخلفية', options: [['studio', 'استوديو', 'studio background'], ['outdoor', 'خارجية', 'outdoor'], ['indoor', 'داخلية', 'indoor'], ['nature', 'طبيعة', 'nature'], ['city', 'مدينة', 'city street'], ['plain', 'سادة', 'plain background']] },
    { key: 'imageType', label: 'نوع الصورة', options: [['portrait', 'بورتريه', 'portrait'], ['full', 'كامل الجسم', 'full body'], ['half', 'من الخصر إلى الأعلى', 'half body'], ['closeup', 'قريبة للوجه', 'close up']] },
  ],
};

const TEXT_TYPES = {
  ayah: { label: 'آية قرآنية' },
  hadith: { label: 'حديث نبوي' },
  dhikr: { label: 'ذكر' },
  dua: { label: 'دعاء' },
  general: { label: 'عبارة عامة' },
};
const SURAHS = ['الفاتحة', 'البقرة', 'آل عمران', 'النساء', 'المائدة', 'الأنعام', 'الأعراف', 'الأنفال', 'التوبة', 'يونس', 'هود', 'يوسف', 'الرعد', 'إبراهيم', 'الحجر', 'النحل', 'الإسراء', 'الكهف', 'مريم', 'طه', 'الأنبياء', 'الحج', 'المؤمنون', 'النور', 'الفرقان', 'الشعراء', 'النمل', 'القصص', 'العنكبوت', 'الروم', 'لقمان', 'السجدة', 'الأحزاب', 'سبأ', 'فاطر', 'يس', 'الصافات', 'ص', 'الزمر', 'غافر', 'فصلت', 'الشورى', 'الزخرف', 'الدخان', 'الجاثية', 'الأحقاف', 'محمد', 'الفتح', 'الحجرات', 'ق', 'الذاريات', 'الطور', 'النجم', 'القمر', 'الرحمن', 'الواقعة', 'الحديد', 'المجادلة', 'الحشر', 'الممتحنة', 'الصف', 'الجمعة', 'المنافقون', 'التغابن', 'الطلاق', 'التحريم', 'الملك', 'القلم', 'الحاقة', 'المعارج', 'نوح', 'الجن', 'المزمل', 'المدثر', 'القيامة', 'الإنسان', 'المرسلات', 'النبأ', 'النازعات', 'عبس', 'التكوير', 'الانفطار', 'المطففين', 'الانشقاق', 'البروج', 'الطارق', 'الأعلى', 'الغاشية', 'الفجر', 'البلد', 'الشمس', 'الليل', 'الضحى', 'الشرح', 'التين', 'العلق', 'القدر', 'البينة', 'الزلزلة', 'العاديات', 'القارعة', 'التكاثر', 'العصر', 'الهمزة', 'الفيل', 'قريش', 'الماعون', 'الكوثر', 'الكافرون', 'النصر', 'المسد', 'الإخلاص', 'الفلق', 'الناس'];
const AYAH_COUNTS = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6];
const GRADINGS = ['صحيح', 'حسن', 'ضعيف', 'موضوع', 'غير محدد'];

/** ألوان البحث اللوني */
const COLORS = [
  ['red', 'أحمر', '#C0392B'], ['orange', 'برتقالي', '#E67E22'], ['yellow', 'أصفر', '#E9C46A'], ['green', 'أخضر', '#4F8A4B'],
  ['blue', 'أزرق', '#2F6FA8'], ['purple', 'بنفسجي', '#7D4E9E'], ['pink', 'وردي', '#E38FB0'], ['brown', 'بني', '#7B5236'],
  ['white', 'أبيض', '#F4F2EE'], ['gray', 'رمادي', '#8D9196'], ['black', 'أسود', '#1E1F21'],
];
const colorLabel = (k) => (COLORS.find((c) => c[0] === k) || [])[1] || '';

function seedData() {
  const sections = [
    { id: 'cars', name: 'السيارات', type: 'cars', icon: 'car', order: 1, desc: 'صور السيارات وتفاصيلها وتعديلاتها', pinPrefix: 'car', allowText: false, builtin: true },
    { id: 'religious', name: 'الديني', type: 'generic', icon: 'book', order: 2, desc: 'القرآن الكريم والأذكار والأدعية والتذكير', pinPrefix: '', allowText: true, builtin: true },
    { id: 'private', name: 'المساحة الخاصة', type: 'private', icon: 'lock', order: 3, desc: 'مراجع الأنمي والتصوير الفوتوغرافي', pinPrefix: '', allowText: false, builtin: true },
  ];
  const categories = [];
  let order = 0;
  const add = (sectionId, parentId, name, en, extra = {}) => {
    const id = 'cat_' + uid().replace(/-/g, '').slice(0, 10);
    categories.push({ id, sectionId, parentId, name, en, order: order++, ...extra });
    return id;
  };
  const tree = (sectionId, spec) => spec.forEach(([name, en, children = [], extra = {}]) => {
    const id = add(sectionId, null, name, en, extra);
    children.forEach(([n, e]) => add(sectionId, id, n, e));
  });

  tree('cars', [
    ['الخارجية', 'exterior', [['الواجهة الأمامية', 'front view'], ['الخلفية', 'rear view'], ['الجوانب', 'side profile'], ['زوايا مختلفة', 'different angles'], ['أثناء القيادة', 'driving shot'], ['في أماكن مختلفة', 'photoshoot location']]],
    ['الداخلية', 'interior', [['لوحة القيادة', 'dashboard'], ['المقاعد', 'seats'], ['عجلة القيادة', 'steering wheel'], ['الشاشة', 'infotainment screen'], ['الكونسول الوسطي', 'center console'], ['الأبواب', 'door panel'], ['تفاصيل المقصورة', 'cabin details']]],
    ['التعديلات', 'modified', [['تعديلات الهيكل', 'body kit'], ['إضافات خارجية', 'exterior accessories'], ['إضافات داخلية', 'interior accessories'], ['تعديلات الإضاءة', 'custom lights'], ['الأداء والمظهر', 'performance tuning']]],
    ['الجنوط', 'wheels rims', [['جنوط رياضية', 'sport rims'], ['جنوط أصلية', 'oem wheels'], ['ألوان الجنوط', 'rim colors'], ['مقاسات وتصاميم', 'rim designs sizes']]],
    ['الألوان', 'color', [['الأبيض', 'white'], ['الأسود', 'black'], ['الرمادي', 'gray'], ['الفضي', 'silver'], ['الأحمر', 'red'], ['الأزرق', 'blue'], ['ألوان أخرى', 'custom color']]],
  ]);
  tree('religious', [
    ['القرآن الكريم', 'quran', [['آيات مختارة', 'quran verse'], ['سور', 'surah'], ['آيات حسب الموضوع', 'quran verses about'], ['صور الآيات', 'quran calligraphy']]],
    ['الأذكار', 'adhkar', [['أذكار الصباح', 'morning adhkar'], ['أذكار المساء', 'evening adhkar'], ['أذكار النوم', 'sleep adhkar'], ['أذكار الاستيقاظ', 'waking up dua'], ['أذكار الصلاة', 'after prayer adhkar'], ['أذكار متنوعة', 'dhikr']]],
    ['الأدعية', 'dua', [['أدعية من القرآن', 'quranic dua'], ['أدعية من السنة', 'sunnah dua'], ['أدعية عامة', 'islamic dua'], ['أدعية المناسبات', 'dua for occasions']]],
    ['التذكير', 'islamic reminder', [['تذكيرات إيمانية', 'islamic reminders'], ['فوائد قصيرة', 'islamic quotes'], ['بطاقات دينية', 'islamic cards design']]],
  ]);
  tree('private', [
    ['الأنمي', 'anime', [
      ['شخصيات أنمي نسائية', 'anime girl character'], ['شخصيات أنمي رجالية', 'anime boy character'], ['شخصيات رئيسية', 'anime main character'],
      ['شخصيات ثانوية', 'anime side character'], ['شخصيات أصلية', 'anime original character oc'], ['تصاميم الشخصيات', 'anime character design sheet'],
      ['الملابس والأزياء', 'anime outfit'], ['تسريحات الشعر', 'anime hairstyle'], ['الوجوه والتعابير', 'anime facial expressions'],
      ['الوقفات والحركات', 'anime pose reference'], ['الرسم الكامل للجسم', 'anime full body'], ['من الخصر إلى الأعلى', 'anime half body'],
      ['البورتريه', 'anime portrait'], ['الخلفيات', 'anime background scenery'], ['المشاهد', 'anime scene'], ['أساليب الرسم', 'anime art style'],
      ['الأنمي الكلاسيكي', 'classic 90s anime'], ['الأنمي الحديث', 'modern anime'], ['الأنمي الخيالي', 'fantasy anime art'], ['أنمي الأكشن', 'action anime'],
      ['أنمي المغامرات', 'adventure anime'], ['أنمي الرومانسية', 'romance anime'], ['أنمي الحياة اليومية', 'slice of life anime'], ['أنمي الكوميديا', 'comedy anime'],
      ['أنمي الغموض', 'mystery anime'], ['أنمي الخيال العلمي', 'sci-fi anime'], ['أنمي الفانتازيا', 'fantasy anime'],
    ], { filters: 'anime', desc: 'مكتبة أنمي واسعة بكل الأنواع والأساليب' }],
    ['صور بشرية نسائية', 'adult woman', [
      ['صور بورتريه', 'portrait photography'], ['صور كاملة للجسم', 'full body photography'], ['من الخصر إلى الأعلى', 'half body portrait'],
      ['زوايا مختلفة', 'camera angles'], ['تصوير احترافي', 'professional photoshoot'], ['تصوير طبيعي', 'natural photography'], ['تصوير أزياء', 'fashion photography'],
      ['تصوير يومي', 'everyday lifestyle'], ['تصوير خارجي', 'outdoor photoshoot'], ['تصوير داخل الاستوديو', 'studio photoshoot'], ['تصوير فني', 'fine art portrait'],
      ['الملابس', 'outfit'], ['تسريحات الشعر', 'hairstyle'], ['المكياج', 'makeup look'], ['الوقفات والحركات', 'pose reference'], ['الوجوه والتعابير', 'facial expression'],
    ], { filters: 'women', adultOnly: true, desc: 'صور فوتوغرافية لنساء بالغات (18 سنة فأكثر) فقط' }],
  ]);
  const subjects = [{ id: 'car_' + uid().replace(/-/g, '').slice(0, 10), sectionId: 'cars', name: 'Hyundai Elantra 2020', coverId: null, createdAt: Date.now() }];
  return { sections, categories, subjects };
}

/* =========================================================
   4) حالة التطبيق في الذاكرة
   ========================================================= */
const S = {
  images: new Map(),
  sections: [],
  categories: new Map(),
  subjects: new Map(),
  collections: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  unlocked: false,
  ctx: {},
  offlineReady: false,
  swState: 'unknown',
};
const UI = { browser: {}, search: {}, fav: { q: '', section: '', sort: 'new' }, collectionReorder: {} };

async function loadAll() {
  const [images, sections, cats, subjects, cols, settings] = await Promise.all(['images', 'sections', 'categories', 'subjects', 'collections', 'settings'].map((s) => DB.all(s)));
  S.images = new Map(images.map((i) => [i.id, i]));
  S.sections = sections.sort((a, b) => a.order - b.order);
  S.categories = new Map(cats.map((c) => [c.id, c]));
  S.subjects = new Map(subjects.map((s) => [s.id, s]));
  S.collections = new Map(cols.map((c) => [c.id, c]));
  S.settings = { ...DEFAULT_SETTINGS };
  settings.forEach((r) => { S.settings[r.key] = r.value; });
}
async function setSetting(key, value) {
  S.settings[key] = value;
  await DB.put('settings', { key, value });
}
async function ensureSeed() {
  if (S.settings.seeded) return;
  const { sections, categories, subjects } = seedData();
  await DB.batch(['sections', 'categories', 'subjects', 'settings'], (st) => {
    sections.forEach((s) => st('sections').put(s));
    categories.forEach((c) => st('categories').put(c));
    subjects.forEach((s) => st('subjects').put(s));
    st('settings').put({ key: 'seeded', value: true });
  });
  await loadAll();
}

/* ---------- مساعدات التصنيفات ---------- */
const sectionById = (id) => S.sections.find((s) => s.id === id);
function catsOf(sectionId, parentId = null) {
  return [...S.categories.values()].filter((c) => c.sectionId === sectionId && (c.parentId ?? null) === parentId).sort((a, b) => a.order - b.order);
}
function catChain(id) {
  const chain = [];
  let c = S.categories.get(id);
  while (c) { chain.unshift(c); c = c.parentId ? S.categories.get(c.parentId) : null; }
  return chain;
}
const catRoot = (id) => catChain(id)[0] || null;
function catDescendants(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of S.categories.values()) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; }
  }
  return out;
}
function catFilters(id) {
  for (const c of catChain(id).reverse()) if (c.filters && FILTER_SETS[c.filters]) return FILTER_SETS[c.filters];
  return null;
}
const isAdultOnly = (id) => catChain(id).some((c) => c.adultOnly);
const catPathLabel = (id) => catChain(id).map((c) => c.name).join(' › ');

/* ---------- الرؤية والخصوصية ---------- */
const canSee = (img) => img.sectionId !== 'private' || S.unlocked;
const sectionVisible = (id) => (id === 'private' ? !!S.settings.privateShowInList : S.settings.sectionVisible?.[id] !== false);
const byNewest = (a, b) => b.createdAt - a.createdAt;
function visibleImages() { return [...S.images.values()].filter(canSee).sort(byNewest); }

/* ---------- البحث المحلي ---------- */
const hayCache = new WeakMap();
function haystack(img) {
  if (hayCache.has(img)) return hayCache.get(img);
  const parts = [img.name, img.description, (img.keywords || []).join(' '), img.notes, img.fileName, img.sourceUrl];
  const sec = sectionById(img.sectionId); if (sec) parts.push(sec.name);
  if (img.categoryId) catChain(img.categoryId).forEach((c) => parts.push(c.name, c.en));
  if (img.subjectId && S.subjects.get(img.subjectId)) parts.push(S.subjects.get(img.subjectId).name);
  if (img.color) parts.push(colorLabel(img.color.name));
  if (img.attrs) {
    const fs = catFilters(img.categoryId) || [];
    for (const [k, v] of Object.entries(img.attrs)) {
      const f = fs.find((x) => x.key === k);
      const opt = f?.options?.find((o) => o[0] === v);
      parts.push(opt ? `${opt[1]} ${opt[2]}` : v);
    }
  }
  if (img.text) parts.push(img.text.body, img.text.source, img.text.surah, TEXT_TYPES[img.text.type]?.label);
  for (const c of S.collections.values()) if (c.imageIds.includes(img.id)) parts.push(c.name);
  const hay = normalize(parts.filter(Boolean).join(' '));
  hayCache.set(img, hay);
  return hay;
}
/** مسح نصوص البحث المخزنة مؤقتاً (عند تغيير أسماء التصنيفات أو المجموعات) */
function hayCache_clear() { for (const img of S.images.values()) hayCache.delete(img); }
function matchQuery(img, q) {
  const tokens = normalize(q).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const hay = haystack(img);
  return tokens.every((t) => hay.includes(t));
}

/* ---------- Pinterest ---------- */
function buildPinQuery({ sectionId, subjectId, categoryId, text, attrs }) {
  const parts = [];
  const sec = sectionById(sectionId);
  const subj = subjectId ? S.subjects.get(subjectId) : null;
  if (subj) parts.push(subj.name);
  else if (sec?.pinPrefix) parts.push(sec.pinPrefix);
  if (text) parts.push(text.trim());
  if (categoryId) {
    const chain = catChain(categoryId);
    chain.forEach((c) => c.en && parts.push(c.en));
    if (chain.some((c) => c.adultOnly) && !/adult/i.test(parts.join(' '))) parts.unshift('adult woman');
    const fs = catFilters(categoryId) || [];
    for (const [k, v] of Object.entries(attrs || {})) {
      if (!v) continue;
      const f = fs.find((x) => x.key === k);
      if (f?.type === 'text') parts.push(v);
      else { const o = f?.options?.find((x) => x[0] === v); if (o?.[2]) parts.push(o[2]); }
    }
  }
  // إزالة الكلمات المكررة مع الحفاظ على الترتيب
  const seen = new Set();
  return parts.join(' ').split(/\s+/).filter((w) => { const k = w.toLowerCase(); if (!w || seen.has(k)) return false; seen.add(k); return true; }).join(' ');
}
const pinterestUrl = (q) => 'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(q);
function openPinterest(q) {
  if (!q || !q.trim()) return toast('اكتب عبارة بحث أو اختر تصنيفاً أولاً', 'error');
  if (!navigator.onLine) return toast('البحث في Pinterest يحتاج اتصالاً بالإنترنت', 'error');
  window.open(pinterestUrl(q), '_blank', 'noopener');
}
function pinBox(q, note = '') {
  const box = el(`<div class="pin-box">
    <div>${icon('globe')} بحث خارجي في Pinterest: ${q ? `<code>${esc(q)}</code>` : '<span class="muted">اختر تصنيفاً أو اكتب عبارة</span>'}
    ${note ? `<div class="hint">${note}</div>` : ''}</div>
    <button class="btn small ghost" type="button">${icon('external')} فتح النتائج</button></div>`);
  $('button', box).onclick = () => openPinterest(q);
  return box;
}

/* =========================================================
   5) معالجة الصور وحفظها
   ========================================================= */
async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch { /* نجرب الطريقة البديلة */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { resolve(im); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`تعذّرت قراءة "${file.name}" — الصيغة غير مدعومة في هذا المتصفح`)); };
    im.src = url;
  });
}
function canvasToBlob(canvas, type, q) { return new Promise((r) => canvas.toBlob(r, type, q)); }
function colorNameFromRGB(r, g, b) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.88) return 'white';
  if (l < 0.13) return 'black';
  if (s < 0.16) return 'gray';
  let h;
  const R = r / 255, G = g / 255, B = b / 255;
  if (max === R) h = 60 * (((G - B) / d) % 6); else if (max === G) h = 60 * ((B - R) / d + 2); else h = 60 * ((R - G) / d + 4);
  if (h < 0) h += 360;
  if (h < 15 || h >= 345) return l < 0.3 ? 'brown' : 'red';
  if (h < 40) return l < 0.45 ? 'brown' : 'orange';
  if (h < 65) return l < 0.35 ? 'brown' : 'yellow';
  if (h < 170) return 'green';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}
async function processFile(file) {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|svg)$/i.test(file.name)) throw new Error(`"${file.name}" ليس ملف صورة`);
  const bmp = await decodeImage(file);
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  if (!w || !h) throw new Error(`تعذّرت قراءة أبعاد "${file.name}"`);
  const scale = Math.min(1, 560 / w);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let thumb = await canvasToBlob(c, 'image/webp', 0.82);
  if (!thumb || thumb.type !== 'image/webp') thumb = await canvasToBlob(c, 'image/jpeg', 0.85);
  // اللون الغالب: تصويت على ألوان عينة صغيرة
  const sc = document.createElement('canvas'); sc.width = sc.height = 24;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0, 24, 24);
  const data = sctx.getImageData(0, 0, 24, 24).data;
  const votes = {};
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const n = colorNameFromRGB(data[i], data[i + 1], data[i + 2]);
    const v = (votes[n] ||= { n: 0, r: 0, g: 0, b: 0 });
    v.n++; v.r += data[i]; v.g += data[i + 1]; v.b += data[i + 2];
  }
  const top = Object.entries(votes).sort((a, b) => b[1].n - a[1].n)[0];
  const color = top ? { name: top[0], hex: '#' + [top[1].r, top[1].g, top[1].b].map((x) => Math.round(x / top[1].n).toString(16).padStart(2, '0')).join('') } : null;
  if (bmp.close) bmp.close();
  return { width: w, height: h, thumb, color };
}
async function addImageRecord(meta, file) {
  const p = await processFile(file);
  const now = Date.now();
  const id = uid();
  const rec = {
    ...meta, id, kind: 'image', width: p.width, height: p.height, color: p.color,
    mime: file.type || 'image/*', size: file.size, fileName: file.name, createdAt: now, updatedAt: now,
    favoritedAt: meta.favorite ? now : null,
  };
  const blob = file instanceof Blob ? file.slice(0, file.size, file.type) : file;
  await DB.batch(['images', 'files', 'thumbs'], (st) => {
    st('images').put(rec);
    st('files').put({ id, blob });
    st('thumbs').put({ id, blob: p.thumb });
  });
  S.images.set(id, rec);
  return rec;
}
async function addTextRecord(meta) {
  const now = Date.now();
  const rec = { ...meta, id: uid(), kind: 'text', createdAt: now, updatedAt: now, favoritedAt: meta.favorite ? now : null };
  await DB.put('images', rec);
  S.images.set(rec.id, rec);
  return rec;
}
async function updateImage(id, patch) {
  const old = S.images.get(id);
  if (!old) throw new Error('الصورة غير موجودة');
  const rec = { ...old, ...patch, updatedAt: Date.now() };
  await DB.put('images', rec);
  S.images.set(id, rec);
  return rec;
}
async function toggleFavorite(id) {
  const img = S.images.get(id);
  const fav = !img.favorite;
  await updateImage(id, { favorite: fav, favoritedAt: fav ? Date.now() : null });
  toast(fav ? 'أُضيفت إلى المفضلة' : 'أُزيلت من المفضلة', 'ok');
  return fav;
}
async function deleteImages(ids) {
  const set = new Set(ids);
  const touchedCols = [...S.collections.values()].filter((c) => c.imageIds.some((x) => set.has(x)));
  const touchedSubs = [...S.subjects.values()].filter((s) => set.has(s.coverId));
  await DB.batch(['images', 'files', 'thumbs', 'collections', 'subjects'], (st) => {
    ids.forEach((id) => { st('images').delete(id); st('files').delete(id); st('thumbs').delete(id); });
    touchedCols.forEach((c) => {
      c.imageIds = c.imageIds.filter((x) => !set.has(x));
      if (set.has(c.coverId)) c.coverId = null;
      st('collections').put(c);
    });
    touchedSubs.forEach((s) => { s.coverId = null; st('subjects').put(s); });
  });
  ids.forEach((id) => {
    S.images.delete(id);
    const u = thumbURLs.get(id);
    if (typeof u === 'string') URL.revokeObjectURL(u);
    thumbURLs.delete(id);
  });
}
async function setImageCollections(imageId, colIds) {
  const want = new Set(colIds);
  const changed = [];
  for (const c of S.collections.values()) {
    const has = c.imageIds.includes(imageId);
    if (want.has(c.id) && !has) { c.imageIds.push(imageId); changed.push(c); }
    if (!want.has(c.id) && has) { c.imageIds = c.imageIds.filter((x) => x !== imageId); if (c.coverId === imageId) c.coverId = null; changed.push(c); }
  }
  if (changed.length) await DB.batch(['collections'], (st) => changed.forEach((c) => { c.updatedAt = Date.now(); st('collections').put(c); }));
  hayCache_clear();
}

/* ---------- عناوين الصور المصغرة (تحميل عند الحاجة) ---------- */
const thumbURLs = new Map();
function thumbURL(id) {
  if (thumbURLs.has(id)) return Promise.resolve(thumbURLs.get(id));
  const p = DB.get('thumbs', id).then((r) => {
    const u = r ? URL.createObjectURL(r.blob) : null;
    thumbURLs.set(id, u);
    return u;
  }).catch(() => null);
  thumbURLs.set(id, p);
  return p;
}
async function loadThumbInto(img) {
  const u = await thumbURL(img.dataset.id);
  if (!img.isConnected) return;
  if (u) {
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => img.closest('.card, .s-item, .pick')?.classList.add('broken');
    img.src = u;
  } else img.closest('.card, .s-item, .pick')?.classList.add('broken');
}
const lazyIO = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { lazyIO.unobserve(e.target); loadThumbInto(e.target); } }), { rootMargin: '600px 0px' })
  : null;
function lazy(img) { if (lazyIO) lazyIO.observe(img); else loadThumbInto(img); }
function lazyAll(root) { $$('img[data-id]', root).forEach(lazy); }

/* =========================================================
   6) عناصر الواجهة المشتركة
   ========================================================= */
function toast(msg, type = '', action = null) {
  const t = el(`<div class="toast ${type}" role="status">${type === 'ok' ? icon('check') : ''}<span>${esc(msg)}</span></div>`);
  if (action) {
    const b = el(`<button type="button">${esc(action.label)}</button>`);
    b.onclick = () => { action.run(); t.remove(); };
    t.append(b);
  }
  $('#toasts').append(t);
  setTimeout(() => t.remove(), action ? 9000 : type === 'error' ? 5000 : 2600);
}

/* ---------- النوافذ المنبثقة مع دعم زر الرجوع ---------- */
const modals = [];
let pendingClose = [];
function openModal(node, { onClose, cls = '' } = {}) {
  const wrap = el(`<div class="modal-wrap ${cls}" role="dialog" aria-modal="true"><div class="modal-backdrop"></div></div>`);
  wrap.append(node);
  $('#modalRoot').append(wrap);
  document.body.classList.add('modal-open');
  const m = { wrap, onClose, prevFocus: document.activeElement };
  modals.push(m);
  history.pushState({ fsfModal: modals.length }, '');
  $('.modal-backdrop', wrap).onclick = () => closeModal();
  $$('[data-close]', node).forEach((b) => { b.onclick = (e) => { e.preventDefault(); closeModal(); }; });
  requestAnimationFrame(() => {
    wrap.classList.add('show');
    const f = $('[autofocus]', node) || $('.dlg-head .icon-btn, [data-close]', node);
    f?.focus({ preventScroll: true });
  });
  return m;
}
/** إغلاق النافذة العليا؛ يرجع وعداً يكتمل بعد معالجة التاريخ */
function closeModal() {
  if (!modals.length) return Promise.resolve();
  return new Promise((resolve) => { pendingClose.push(resolve); history.back(); });
}
function removeTopModal() {
  const m = modals.pop();
  if (!m) return;
  m.wrap.classList.remove('show');
  setTimeout(() => m.wrap.remove(), 220);
  if (!modals.length) document.body.classList.remove('modal-open');
  try { m.onClose?.(); } catch (e) { console.error(e); }
  m.prevFocus?.focus?.({ preventScroll: true });
  const r = pendingClose.shift();
  if (r) setTimeout(r, 0);
}
window.addEventListener('popstate', () => { if (modals.length) removeTopModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modals.length) closeModal(); });

function confirmDialog({ title = 'تأكيد', message = '', confirmText = 'تأكيد', danger = false, requireText = '', check = null }) {
  return new Promise((resolve) => {
    let ok = false;
    const node = el(`<form class="dialog small" novalidate>
      <header class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
      <div class="dlg-body"><p>${message}</p>
        ${check ? `<label class="check"><input type="checkbox" name="chk"> <span>${esc(check.label)}</span></label>` : ''}
        ${requireText ? `<label class="field"><span>اكتب «${esc(requireText)}» للتأكيد</span><input class="input" name="rt" autocomplete="off" autofocus></label>` : ''}
      </div>
      <footer class="dlg-foot"><button type="button" class="btn ghost" data-close>إلغاء</button>
      <button type="submit" class="btn ${danger ? 'danger' : 'primary'}" ${requireText ? 'disabled' : ''}>${esc(confirmText)}</button></footer></form>`);
    const submit = $('[type=submit]', node);
    if (requireText) $('[name=rt]', node).oninput = (e) => { submit.disabled = e.target.value.trim() !== requireText; };
    node.onsubmit = (e) => {
      e.preventDefault();
      if (requireText && $('[name=rt]', node).value.trim() !== requireText) return;
      ok = true;
      if (check) check.checked = $('[name=chk]', node).checked;
      closeModal();
    };
    openModal(node, { onClose: () => resolve(ok) });
  });
}
function promptDialog({ title, label, value = '', placeholder = '', confirmText = 'حفظ', textarea = false, extra = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const node = el(`<form class="dialog small" novalidate>
      <header class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
      <div class="dlg-body"><label class="field"><span>${esc(label)} <b class="req">*</b></span>
        ${textarea ? `<textarea class="input" name="v" placeholder="${esc(placeholder)}" autofocus>${esc(value)}</textarea>` : `<input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120" autofocus>`}
      </label>${extra}<p class="err" hidden>هذا الحقل مطلوب</p></div>
      <footer class="dlg-foot"><button type="button" class="btn ghost" data-close>إلغاء</button><button type="submit" class="btn primary">${esc(confirmText)}</button></footer></form>`);
    node.onsubmit = (e) => {
      e.preventDefault();
      const v = $('[name=v]', node).value.trim();
      if (!v) { $('.err', node).hidden = false; return; }
      result = { value: v, form: node };
      closeModal();
    };
    openModal(node, { onClose: () => resolve(result) });
  });
}

function emptyState(title, text, withAdd = true) {
  return `<div class="empty">${icon('image')}<h3>${esc(title)}</h3><p>${esc(text)}</p>${withAdd ? `<button class="btn primary" type="button" data-act="add">${icon('plus')} إضافة صورة</button>` : ''}</div>`;
}
function favBtn(img) {
  return `<button class="fav-btn ${img.favorite ? 'on' : ''}" type="button" data-fav="${img.id}" aria-label="${img.favorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}" aria-pressed="${!!img.favorite}">${icon('heart')}</button>`;
}
function textSourceLine(img) {
  const t = img.text || {};
  if (t.type === 'ayah') return `سورة ${t.surah} — الآية ${t.ayah}${t.ayahTo && t.ayahTo !== t.ayah ? '–' + t.ayahTo : ''}`;
  if (t.type === 'hadith') return `${t.source || 'المصدر غير محدد'}${t.grading ? ' — الدرجة: ' + t.grading : ''}`;
  if (t.type === 'general') return 'عبارة عامة — ليست نصاً شرعياً';
  return t.source ? `المصدر: ${t.source}` : 'المصدر غير محدد';
}
function cardEl(img) {
  if (img.kind === 'text') {
    const t = img.text || {};
    return el(`<article class="card text-card t-${t.type}" data-id="${img.id}" tabindex="0" role="button" aria-label="${esc(img.name)}">
      <span class="badge t-${t.type}">${esc(TEXT_TYPES[t.type]?.label || 'نص')}</span>
      <p class="tc-body">${esc(trunc(t.body || '', 260))}</p>
      <span class="tc-src">${esc(textSourceLine(img))}</span>${favBtn(img)}</article>`);
  }
  const node = el(`<article class="card" data-id="${img.id}" tabindex="0" role="button" aria-label="${esc(img.name)}">
    <div class="ph" style="aspect-ratio:${img.width} / ${img.height};background:${esc(img.color?.hex || '')}"><img alt="${esc(img.name)}" data-id="${img.id}" decoding="async"></div>
    <div class="cap">${esc(img.name)}</div>${favBtn(img)}</article>`);
  lazy($('img', node));
  return node;
}
const textRatio = (img) => 0.55 + Math.min(260, (img.text?.body || '').length) / 160;

/** ربط النقر على البطاقات (فتح العارض والمفضلة) بأسلوب التفويض */
function bindCardEvents(root, getIds) {
  root.addEventListener('click', async (e) => {
    const fb = e.target.closest('[data-fav]');
    if (fb) {
      e.stopPropagation();
      const fav = await toggleFavorite(fb.dataset.fav);
      $$(`[data-fav="${fb.dataset.fav}"]`).forEach((b) => { b.classList.toggle('on', fav); b.setAttribute('aria-pressed', fav); });
      root.dispatchEvent(new CustomEvent('favchange'));
      return;
    }
    const card = e.target.closest('[data-id].card, .s-item[data-id]');
    if (card) openViewer(card.dataset.id, getIds());
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card[data-id]')) { e.preventDefault(); openViewer(e.target.dataset.id, getIds()); }
  });
}

/* ---------- شبكة Masonry مع تحميل تدريجي ---------- */
const activeGrids = new Set();
class Masonry {
  constructor(container, items, opts = {}) {
    this.c = container;
    this.items = items;
    this.opts = opts;
    this.c.classList.add('masonry');
    bindCardEvents(this.c, () => this.items.map((i) => i.id));
    this.render();
    activeGrids.add(this);
  }
  colCount() {
    const w = this.c.clientWidth || window.innerWidth - 32;
    const size = S.settings.gridSize || 'medium';
    const target = { small: 140, medium: 200, large: 320 }[size];
    const max = { small: 8, medium: 6, large: 4 }[size];
    const min = size === 'large' ? 1 : 2;
    return Math.min(max, Math.max(min, Math.round(w / target)));
  }
  setItems(items) { this.items = items; this.render(); }
  render(keep = 0) {
    this.io?.disconnect();
    this.c.innerHTML = '';
    if (!this.items.length) { this.c.innerHTML = this.opts.empty || emptyState('لا توجد صور هنا بعد', 'أضف صوراً من جهازك لتظهر في هذا المكان.'); return; }
    this.n = this.colCount();
    this.c.style.setProperty('--gap', S.settings.gridSize === 'small' ? '8px' : '12px');
    const wrap = el('<div class="m-cols"></div>');
    this.cols = Array.from({ length: this.n }, () => el('<div class="m-col"></div>'));
    wrap.append(...this.cols);
    this.heights = new Array(this.n).fill(0);
    this.shown = 0;
    this.sentinel = el('<div class="sentinel"></div>');
    this.c.append(wrap, this.sentinel);
    this.more(Math.max(keep, 36));
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver((en) => { if (en[0].isIntersecting) this.more(); }, { rootMargin: '900px 0px' });
      this.io.observe(this.sentinel);
    } else this.more(this.items.length);
  }
  more(count = 30) {
    if (this.shown >= this.items.length) return;
    const batch = this.items.slice(this.shown, this.shown + count);
    for (const img of batch) {
      const ratio = img.kind === 'text' ? textRatio(img) : img.height / img.width;
      let k = 0;
      for (let i = 1; i < this.n; i++) if (this.heights[i] < this.heights[k] - 0.01) k = i;
      this.cols[k].append(cardEl(img));
      this.heights[k] += ratio + (img.kind === 'text' ? 0 : 0.18);
    }
    this.shown += batch.length;
    if (this.shown >= this.items.length) this.io?.disconnect();
    else requestAnimationFrame(() => {
      if (!this.sentinel.isConnected) return;
      const r = this.sentinel.getBoundingClientRect();
      if (r.top < innerHeight + 900) this.more();
    });
  }
  relayout() { if (this.items.length && this.colCount() !== this.n) this.render(this.shown); }
  destroy() { this.io?.disconnect(); activeGrids.delete(this); }
}
window.addEventListener('resize', debounce(() => activeGrids.forEach((g) => g.c.isConnected ? g.relayout() : g.destroy()), 180));

/** شريط أفقي مختصر */
function stripEl(items) {
  const strip = el('<div class="strip"></div>');
  items.forEach((img) => {
    if (img.kind === 'text') {
      strip.append(el(`<button type="button" class="s-item text" data-id="${img.id}">${esc(trunc(img.text?.body || '', 90))}</button>`));
    } else {
      const w = Math.round(168 * Math.min(1.6, Math.max(0.6, img.width / img.height)));
      const b = el(`<button type="button" class="s-item" data-id="${img.id}" style="width:${w}px;background:${esc(img.color?.hex || '')}" aria-label="${esc(img.name)}"><img alt="" data-id="${img.id}"></button>`);
      lazy($('img', b));
      strip.append(b);
    }
  });
  bindCardEvents(strip, () => items.map((i) => i.id));
  return strip;
}
async function coverImgHTML(imageId, fallbackIcon) {
  const img = imageId && S.images.get(imageId);
  if (!img || !canSee(img)) return icon(fallbackIcon);
  if (img.kind === 'text') return `<span style="font-family:var(--font-quran);padding:14px;font-size:.95rem;text-align:center">${esc(trunc(img.text?.body || '', 70))}</span>`;
  const u = await thumbURL(imageId);
  return u ? `<img src="${u}" alt="">` : icon(fallbackIcon);
}

/* =========================================================
   7) التوجيه بين الصفحات (hash routing)
   ========================================================= */
const routes = [
  [/^\/$/, renderHome],
  [/^\/search$/, renderSearch],
  [/^\/favorites$/, renderFavorites],
  [/^\/recent$/, renderRecent],
  [/^\/collections$/, renderCollections],
  [/^\/collection\/([^/]+)$/, renderCollection],
  [/^\/settings$/, renderSettings],
  [/^\/s\/([^/]+)$/, renderSection],
  [/^\/car\/([^/]+)$/, renderCar],
];
function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1)) || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', params: new URLSearchParams(qs || '') };
}
function go(hash) { location.hash = hash; }
let routing = 0;
async function router({ keepScroll = false } = {}) {
  const token = ++routing;
  const y = scrollY;
  activeGrids.forEach((g) => g.destroy());
  const { path, params } = parseHash();
  const main = $('#main');
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    const frag = el('<div class="view"></div>');
    try {
      await fn(frag, m.slice(1), params);
    } catch (err) {
      console.error(err);
      frag.innerHTML = `<div class="empty">${icon('info')}<h3>تعذّر عرض الصفحة</h3><p>${esc(err.message)}</p><a class="btn primary" href="#/">العودة للرئيسية</a></div>`;
    }
    if (token !== routing) return;
    main.replaceChildren(frag);
    lazyAll(frag);
    $$('.masonry', frag).forEach((m2) => m2.__grid?.relayout());
    updateNav(path);
    scrollTo(0, keepScroll ? y : 0);
    return;
  }
  go('#/');
}
const rerender = () => router({ keepScroll: true });
function updateNav(path) {
  $$('#bottomNav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === path || (a.dataset.nav !== '/' && path.startsWith(a.dataset.nav))));
}
/** بعد إدراج الصفحة في المستند يجب إعادة حساب الأعمدة لأن العرض كان صفراً */
function mountGrid(container, items, opts) {
  const g = new Masonry(container, items, opts);
  container.__grid = g;
  return g;
}

/* =========================================================
   8) الصفحات
   ========================================================= */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'صباح الخير' : h < 18 ? 'مساء النور' : 'مساء الخير';
}
function sectionCount(id) { let n = 0; for (const i of S.images.values()) if (i.sectionId === id) n++; return n; }

/* ---------- الرئيسية ---------- */
async function renderHome(v) {
  S.ctx = {};
  const name = S.settings.profileName;
  const all = [...S.images.values()].filter((i) => i.sectionId !== 'private').sort(byNewest);
  const feed = all.filter((i) => sectionVisible(i.sectionId));
  v.append(el(`<section class="hero">
    <div><p class="eyebrow">${greeting()}${name ? '، ' + esc(name) : ''}</p>
      <h1>كل فكرة لها صورة،<br>وكل صورة لها مكان.</h1>
      <p class="lead">مكتبتك البصرية الخاصة: احفظ صورك ومراجعك، ونظّمها في أقسام وتصنيفات ومجموعات، وارجع إليها متى شئت — حتى دون إنترنت.</p>
      <div class="hero-actions"><button class="btn primary" type="button" data-act="add">${icon('plus')} أضف صوراً</button>
      <a class="btn ghost" href="#/search">${icon('search')} ابحث في مكتبتك</a></div>
      <div class="quick-links">${S.sections.filter((s) => sectionVisible(s.id)).map((s) => `<a class="chip" href="#/s/${s.id}">${icon(s.icon)} ${esc(s.name)}</a>`).join('')}
      <a class="chip" href="#/collections">${icon('layers')} المجموعات</a><a class="chip" href="#/favorites">${icon('heart')} المفضلة</a></div>
    </div>
    <div class="hero-art" aria-hidden="true">${'<span></span>'.repeat(12)}</div></section>`));

  if (!S.settings.storageNoticeDismissed) {
    const n = el(`<div class="notice info home-notice">${icon('info')}<div class="grow">تُحفظ صورك على <b>هذا الجهاز وهذا المتصفح فقط</b>، ولا تتم مزامنتها تلقائياً مع أجهزتك الأخرى. صدّر نسخة احتياطية من الإعدادات بين حين وآخر.</div><button class="icon-btn" type="button" aria-label="إخفاء التنبيه">${icon('x')}</button></div>`);
    $('button', n).onclick = async () => { await setSetting('storageNoticeDismissed', true); n.remove(); };
    v.append(n);
  }

  v.append(el(`<div class="block-title"><h2>الأقسام</h2></div>`));
  const grid = el('<div class="section-grid"></div>');
  S.sections.filter((s) => sectionVisible(s.id)).forEach((s) => {
    grid.append(el(`<a class="section-card" href="#/s/${s.id}"><span class="sc-ic">${icon(s.icon)}</span><span><h3>${esc(s.name)}</h3><p>${esc(s.desc || '')}</p></span><span class="count">${s.id === 'private' ? icon('lock') : num(sectionCount(s.id)) + ' عنصر'}</span></a>`));
  });
  if (!grid.children.length) grid.append(el('<p class="muted">كل الأقسام مخفية. يمكنك إظهارها من الإعدادات.</p>'));
  v.append(grid);

  if (all.length) {
    v.append(el(`<div class="block-title"><h2>${icon('clock')} أحدث الإضافات</h2><a class="link-btn" href="#/recent">عرض الكل</a></div>`));
    v.append(stripEl(all.slice(0, 14)));
    const favs = all.filter((i) => i.favorite).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
    v.append(el(`<div class="block-title"><h2>${icon('heart')} المفضلة</h2><a class="link-btn" href="#/favorites">عرض الكل</a></div>`));
    if (favs.length) v.append(stripEl(favs.slice(0, 14)));
    else v.append(el('<p class="muted small">اضغط رمز القلب على أي صورة لتظهر هنا.</p>'));
  }
  v.append(el(`<div class="block-title"><h2>${icon('grid')} المكتبة</h2><span class="muted small">${num(feed.length)} عنصر</span></div>`));
  const g = el('<div></div>');
  v.append(g);
  mountGrid(g, feed, { empty: emptyState('مكتبتك فارغة الآن', 'ابدأ بإضافة صور من جهازك أو معرض الصور، ثم نظّمها في الأقسام والمجموعات.') });
}

/* ---------- أحدث الإضافات ---------- */
async function renderRecent(v) {
  S.ctx = {};
  const items = visibleImages();
  v.append(el(`<div class="page-head"><div><h1>أحدث الإضافات</h1><p class="sub">${num(items.length)} عنصر، الأحدث أولاً${S.unlocked ? '' : ' (محتوى المساحة الخاصة غير معروض)'}</p></div></div>`));
  const g = el('<div></div>'); v.append(g); mountGrid(g, items);
}

/* ---------- القسم ---------- */
async function renderSection(v, [id]) {
  const sec = sectionById(id);
  if (!sec) { v.innerHTML = emptyState('القسم غير موجود', 'ربما حُذف هذا القسم.', false); return; }
  if (sec.type === 'cars') return renderCarsHome(v, sec);
  if (sec.type === 'private' && !S.unlocked) return renderLock(v);
  return renderBrowser(v, { section: sec });
}

/* ---------- صفحة السيارات ---------- */
async function renderCarsHome(v, sec) {
  S.ctx = { sectionId: sec.id };
  const cars = [...S.subjects.values()].filter((s) => s.sectionId === sec.id).sort((a, b) => b.createdAt - a.createdAt);
  const imgs = [...S.images.values()].filter((i) => i.sectionId === sec.id).sort(byNewest);
  v.append(el(`<div class="page-head"><div><div class="crumbs"><a href="#/">الرئيسية</a> › <span>${esc(sec.name)}</span></div><h1>${icon('car')} ${esc(sec.name)}</h1><p class="sub">${esc(sec.desc)}</p></div>
    <div class="actions"><button class="btn primary" type="button" data-new-car>${icon('plus')} إضافة سيارة</button><button class="btn ghost" type="button" data-act="add">${icon('image')} إضافة صورة</button><button class="btn ghost" type="button" data-manage>${icon('list')} إدارة التصنيفات</button></div></div>`));
  $('[data-new-car]', v).onclick = () => newCarFlow();
  $('[data-manage]', v).onclick = () => openCategoryManager(sec.id);

  const tb = el(`<div class="toolbar"><div class="search-input grow">${icon('search')}<input class="input" type="search" placeholder="ابحث عن سيارة… مثل Elantra" aria-label="بحث عن سيارة"></div>
    <button class="btn ghost" type="button">${icon('globe')} ابحث عنها في Pinterest</button></div>`);
  v.append(tb);
  v.append(el(`<div class="block-title"><h2>السيارات المحفوظة</h2><span class="muted small">${num(cars.length)} سيارة</span></div>`));
  const grid = el('<div class="cards-grid"></div>');
  v.append(grid);
  const cardsData = [];
  for (const c of cars) {
    const own = imgs.filter((i) => i.subjectId === c.id);
    const cover = await coverImgHTML(c.coverId || own[0]?.id, 'car');
    cardsData.push({ c, node: el(`<a class="cover-card" href="#/car/${c.id}"><div class="cv">${cover}</div><div class="cc-body"><h3 dir="auto">${esc(c.name)}</h3><p>${num(own.length)} صورة</p></div></a>`) });
  }
  const paintCars = (q = '') => {
    grid.innerHTML = '';
    const list = cardsData.filter((x) => matchText(x.c.name, q));
    list.forEach((x) => grid.append(x.node));
    if (!list.length) grid.append(el(`<div class="empty" style="grid-column:1/-1">${icon('car')}<h3>${q ? 'لا توجد سيارة بهذا الاسم' : 'لا توجد سيارات بعد'}</h3><p>${q ? 'جرّب اسماً آخر أو أضفها كسيارة جديدة.' : 'أضف أول سيارة لتبدأ بتنظيم صورها.'}</p></div>`));
  };
  paintCars();
  const inp = $('input', tb);
  inp.oninput = debounce(() => paintCars(inp.value), 120);
  $('button', tb).onclick = () => openPinterest(inp.value.trim() ? `${inp.value.trim()} car` : '');

  v.append(el(`<div class="block-title"><h2>${icon('clock')} أحدث صور السيارات</h2></div>`));
  v.append(imgs.length ? stripEl(imgs.slice(0, 16)) : el('<p class="muted small">لا توجد صور سيارات بعد.</p>'));
  const favs = imgs.filter((i) => i.favorite);
  v.append(el(`<div class="block-title"><h2>${icon('heart')} مفضلة السيارات</h2></div>`));
  v.append(favs.length ? stripEl(favs.slice(0, 16)) : el('<p class="muted small">لا توجد سيارات في المفضلة بعد.</p>'));
}
const matchText = (text, q) => { const t = normalize(q).split(' ').filter(Boolean); const h = normalize(text); return t.every((x) => h.includes(x)); };
async function newCarFlow() {
  const r = await promptDialog({ title: 'إضافة سيارة', label: 'اسم السيارة والطراز والسنة', placeholder: 'مثال: Toyota Camry 2022', confirmText: 'إضافة' });
  if (!r) return null;
  const dup = [...S.subjects.values()].find((s) => normalize(s.name) === normalize(r.value));
  if (dup) { toast('هذه السيارة موجودة مسبقاً', 'error'); go(`#/car/${dup.id}`); return dup; }
  const car = { id: 'car_' + uid().replace(/-/g, '').slice(0, 10), sectionId: 'cars', name: r.value, coverId: null, createdAt: Date.now() };
  await DB.put('subjects', car);
  S.subjects.set(car.id, car);
  toast('أُضيفت السيارة', 'ok');
  go(`#/car/${car.id}`);
  return car;
}
async function renderCar(v, [id]) {
  const car = S.subjects.get(id);
  if (!car) { v.innerHTML = emptyState('السيارة غير موجودة', 'ربما حُذفت.', false); return; }
  return renderBrowser(v, { section: sectionById(car.sectionId), subject: car });
}

/* ---------- المتصفح العام للأقسام (الديني، المساحة الخاصة، صفحة السيارة، الأقسام الجديدة) ---------- */
async function renderBrowser(v, { section, subject = null }) {
  const key = subject ? 'car:' + subject.id : 'sec:' + section.id;
  const st = (UI.browser[key] ||= { top: null, child: null, q: '', attrs: {}, showFilters: false });
  const isPrivate = section.type === 'private';
  const tops = catsOf(section.id);
  if (isPrivate && !st.top && tops[0]) st.top = tops[0].id;
  if (st.top && !S.categories.has(st.top)) { st.top = null; st.child = null; }
  if (st.child && !S.categories.has(st.child)) st.child = null;

  const crumbs = subject
    ? `<a href="#/">الرئيسية</a> › <a href="#/s/${section.id}">${esc(section.name)}</a> › <span dir="auto">${esc(subject.name)}</span>`
    : `<a href="#/">الرئيسية</a> › <span>${esc(section.name)}</span>`;
  const head = el(`<div class="page-head"><div><div class="crumbs">${crumbs}</div>
      <h1 dir="auto">${icon(subject ? 'car' : section.icon)} ${esc(subject ? subject.name : section.name)}</h1>
      <p class="sub">${esc(subject ? 'صور السيارة مقسمة حسب الخارجية والداخلية والتعديلات والجنوط والألوان' : section.desc || '')}</p></div>
    <div class="actions">
      <button class="btn primary" type="button" data-act="add">${icon('plus')} ${section.allowText ? 'إضافة صورة أو نص' : 'إضافة صورة'}</button>
      <button class="btn ghost" type="button" data-manage>${icon('list')} التصنيفات</button>
      ${subject ? `<button class="icon-btn" type="button" data-rename aria-label="تعديل اسم السيارة" title="تعديل الاسم">${icon('edit')}</button><button class="icon-btn" type="button" data-del aria-label="حذف السيارة" title="حذف السيارة">${icon('trash')}</button>` : ''}
      ${isPrivate ? `<button class="btn ghost" type="button" data-lock>${icon('lock')} قفل</button>` : ''}
      ${!section.builtin ? `<button class="icon-btn" type="button" data-sec-edit aria-label="تعديل القسم" title="تعديل القسم">${icon('edit')}</button>` : ''}
    </div></div>`);
  v.append(head);
  $('[data-manage]', head).onclick = () => openCategoryManager(section.id);
  if (isPrivate) $('[data-lock]', head).onclick = () => { S.unlocked = false; toast('تم قفل المساحة الخاصة', 'ok'); go('#/'); };
  if (subject) {
    $('[data-rename]', head).onclick = async () => {
      const r = await promptDialog({ title: 'تعديل اسم السيارة', label: 'الاسم', value: subject.name });
      if (!r) return;
      subject.name = r.value; await DB.put('subjects', subject); hayCache_clear(); toast('تم الحفظ', 'ok'); rerender();
    };
    $('[data-del]', head).onclick = async () => {
      const check = { label: 'احذف صور هذه السيارة أيضاً', checked: false };
      const ok = await confirmDialog({ title: 'حذف السيارة', message: `سيتم حذف «${esc(subject.name)}». إن لم تختر حذف الصور فستبقى في قسم السيارات بدون سيارة محددة.`, confirmText: 'حذف', danger: true, check });
      if (!ok) return;
      const ids = [...S.images.values()].filter((i) => i.subjectId === subject.id).map((i) => i.id);
      if (check.checked) await deleteImages(ids);
      else for (const iid of ids) await updateImage(iid, { subjectId: null });
      await DB.del('subjects', subject.id); S.subjects.delete(subject.id);
      toast('حُذفت السيارة', 'ok'); go('#/s/cars');
    };
  }
  if (!section.builtin) $('[data-sec-edit]', head).onclick = () => editSectionFlow(section);

  if (isPrivate) {
    const gt = el('<div class="group-tabs" role="tablist"></div>');
    tops.forEach((t) => {
      const n = [...S.images.values()].filter((i) => i.sectionId === section.id && catDescendants(t.id).has(i.categoryId)).length;
      const b = el(`<button type="button" role="tab" class="group-tab ${st.top === t.id ? 'active' : ''}"><b>${esc(t.name)}</b><small>${esc(t.desc || '')} · ${num(n)}</small></button>`);
      b.onclick = () => { st.top = t.id; st.child = null; st.attrs = {}; rerender(); };
      gt.append(b);
    });
    v.append(gt);
    if (st.top && isAdultOnly(st.top)) v.append(el(`<div class="notice" style="margin-bottom:14px">${icon('info')}<div class="grow">هذا القسم مخصص للصور الفوتوغرافية لنساء بالغات (18 سنة فأكثر) فقط، ومنفصل عن صور الأنمي. خيارات المظهر أدوات تصنيف بصرية للصور فقط، ولا تعني استنتاج هوية أي شخص أو أصله.</div></div>`));
  }

  const tb = el(`<div class="toolbar"><div class="search-input grow">${icon('search')}<input class="input" type="search" value="${esc(st.q)}" placeholder="${isPrivate && st.top && FILTER_SETS.anime === catFilters(st.top) ? 'ابحث باسم أنمي أو شخصية أو وصف…' : 'ابحث داخل هذا القسم…'}" aria-label="بحث داخل القسم"></div></div>`);
  v.append(tb);
  const tabsBox = el('<div></div>');
  const chipsBox = el('<div></div>');
  const filtersBox = el('<div></div>');
  const pinWrap = el('<div></div>');
  const count = el('<p class="result-count"></p>');
  const gridBox = el('<div></div>');
  v.append(tabsBox, chipsBox, filtersBox, pinWrap, count, gridBox);

  const scoped = () => [...S.images.values()].filter((i) => i.sectionId === section.id && (!subject || i.subjectId === subject.id));
  const grid = mountGrid(gridBox, [], { empty: emptyState('لا توجد عناصر هنا بعد', subject ? 'أضف صوراً لهذه السيارة واختر التصنيف المناسب.' : 'أضف صوراً واختر هذا القسم وتصنيفه.') });

  function items() {
    const cat = st.child || st.top;
    const set = cat ? catDescendants(cat) : null;
    const fs = cat ? catFilters(cat) || [] : [];
    return scoped().filter((i) => {
      if (set && !set.has(i.categoryId)) return false;
      for (const [k, val] of Object.entries(st.attrs)) {
        if (!val) continue;
        const f = fs.find((x) => x.key === k);
        const have = i.attrs?.[k];
        if (f?.type === 'text') { if (!have || !normalize(have).includes(normalize(val))) return false; } else if (have !== val) return false;
      }
      return matchQuery(i, st.q);
    }).sort(byNewest);
  }
  function paint() {
    const cat = st.child || st.top;
    S.ctx = { sectionId: section.id, subjectId: subject?.id || null, categoryId: cat || null };
    // التبويبات الرئيسية
    tabsBox.innerHTML = '';
    if (!isPrivate) {
      const tabs = el('<div class="tabs" role="tablist"></div>');
      const all = scoped();
      const mk = (id, label, n) => {
        const b = el(`<button type="button" role="tab" class="tab ${st.top === id ? 'active' : ''}">${esc(label)}<span class="n">${num(n)}</span></button>`);
        b.onclick = () => { st.top = id; st.child = null; st.attrs = {}; paint(); };
        tabs.append(b);
      };
      mk(null, 'الكل', all.length);
      tops.forEach((t) => { const d = catDescendants(t.id); mk(t.id, t.name, all.filter((i) => d.has(i.categoryId)).length); });
      tabsBox.append(tabs);
    }
    // التصنيفات الفرعية
    chipsBox.innerHTML = '';
    if (st.top) {
      const kids = catsOf(section.id, st.top);
      if (kids.length) {
        const chips = el('<div class="chips"></div>');
        const mk = (id, label) => {
          const b = el(`<button type="button" class="chip ${st.child === id ? 'active' : ''}">${esc(label)}</button>`);
          b.onclick = () => { st.child = id; paint(); };
          chips.append(b);
        };
        mk(null, 'الكل');
        kids.forEach((k) => mk(k.id, k.name));
        chipsBox.append(chips);
      }
    }
    // خيارات التصفية الخاصة بالتصنيف
    filtersBox.innerHTML = '';
    const fs = cat ? catFilters(cat) : null;
    if (fs) {
      const active = Object.values(st.attrs).filter(Boolean).length;
      const toggle = el(`<button type="button" class="btn small ghost" style="margin-bottom:10px">${icon('filter')} خيارات البحث${active ? ` (${num(active)})` : ''}</button>`);
      toggle.onclick = () => { st.showFilters = !st.showFilters; paint(); };
      filtersBox.append(toggle);
      if (st.showFilters) {
        const box = el(`<div class="filters"><div class="filters-grid"></div><div class="f-foot"><span class="hint">تُطبَّق على صور مكتبتك وتُضاف إلى عبارة بحث Pinterest.</span><button type="button" class="link-btn">مسح الخيارات</button></div></div>`);
        const fg = $('.filters-grid', box);
        fs.forEach((f) => {
          if (f.type === 'text') {
            const l = el(`<label><span>${esc(f.label)}</span><input class="input" value="${esc(st.attrs[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" dir="auto"></label>`);
            $('input', l).oninput = debounce((e) => { st.attrs[f.key] = e.target.value.trim(); paintResults(); }, 250);
            fg.append(l);
          } else {
            const l = el(`<label><span>${esc(f.label)}</span><select class="select"><option value="">الكل</option>${f.options.map((o) => `<option value="${o[0]}" ${st.attrs[f.key] === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`);
            $('select', l).onchange = (e) => { st.attrs[f.key] = e.target.value; paint(); };
            fg.append(l);
          }
        });
        $('.f-foot button', box).onclick = () => { st.attrs = {}; paint(); };
        filtersBox.append(box);
      }
    }
    paintResults();
  }
  function paintResults() {
    const cat = st.child || st.top;
    const list = items();
    count.textContent = `${num(list.length)} عنصر`;
    pinWrap.innerHTML = '';
    const q = buildPinQuery({ sectionId: section.id, subjectId: subject?.id, categoryId: cat, text: st.q, attrs: st.attrs });
    pinWrap.append(pinBox(subject || cat || st.q ? q : '', section.id === 'religious' ? 'تحقّق من صحة أي نص ديني تجده خارجياً ومن مصدره قبل حفظه.' : 'يفتح Pinterest في نافذة جديدة. احفظ ما يُسمح لك بحفظه يدوياً، ثم أضفه هنا.'));
    grid.setItems(list);
    lazyAll(gridBox);
  }
  $('input', tb).oninput = debounce((e) => { st.q = e.target.value; paintResults(); }, 180);
  paint();
}

/* ---------- قفل المساحة الخاصة ---------- */
async function hashPass(pass, salt) {
  const data = new TextEncoder().encode(`${salt}:${pass}`);
  if (crypto.subtle) {
    const d = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261; // بديل بسيط عند غياب crypto.subtle (اتصال غير آمن)
  for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  return 'fnv' + h.toString(16);
}
async function setPrivatePassword(pass) {
  const salt = uid();
  await setSetting('privateSalt', salt);
  await setSetting('privateHash', await hashPass(pass, salt));
}
async function checkPrivatePassword(pass) {
  return S.settings.privateHash && (await hashPass(pass, S.settings.privateSalt)) === S.settings.privateHash;
}
const PRIVATE_NOTICE = 'هذه ميزة إخفاء بسيطة داخل واجهة الموقع وليست حماية أمنية حقيقية؛ فالموقع يعمل داخل المتصفح ويمكن لمن يملك الوصول إلى جهازك فحص بياناته. لا تحفظ هنا معلومات حساسة أو سرية.';
function renderLock(v) {
  S.ctx = {};
  const has = !!S.settings.privateHash;
  const box = el(`<section class="lock"><div class="lock-ic">${icon('lock')}</div><h1>المساحة الخاصة</h1>
    <p class="muted">${has ? 'أدخل كلمة المرور لعرض المحتوى.' : 'أنشئ كلمة مرور لهذه المساحة (4 أحرف على الأقل).'}</p>
    <form novalidate><input class="input" type="password" name="p" placeholder="كلمة المرور" autocomplete="${has ? 'current-password' : 'new-password'}" autofocus aria-label="كلمة المرور">
    ${has ? '' : '<input class="input" type="password" name="p2" placeholder="تأكيد كلمة المرور" autocomplete="new-password" aria-label="تأكيد كلمة المرور">'}
    <p class="err" hidden></p><button class="btn primary block" type="submit">${icon('unlock')} ${has ? 'فتح' : 'إنشاء وفتح'}</button></form>
    <div class="notice">${icon('info')}<div class="grow small">${PRIVATE_NOTICE}</div></div></section>`);
  const form = $('form', box), err = $('.err', box);
  const fail = (m) => { err.textContent = m; err.hidden = false; box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const p = form.p.value;
    if (has) {
      if (!(await checkPrivatePassword(p))) return fail('كلمة المرور غير صحيحة');
    } else {
      if (p.length < 4) return fail('كلمة المرور قصيرة جداً');
      if (p !== form.p2.value) return fail('كلمتا المرور غير متطابقتين');
      await setPrivatePassword(p);
    }
    S.unlocked = true;
    hayCache_clear();
    toast('تم فتح المساحة الخاصة', 'ok');
    if (parseHash().path === '/s/private') rerender(); else go('#/s/private');
  };
  v.append(box);
}

/* ---------- البحث ---------- */
async function renderSearch(v, _m, params) {
  S.ctx = {};
  const st = UI.search;
  if (params.has('q')) st.q = params.get('q');
  st.q ||= ''; st.section ||= ''; st.cat ||= ''; st.col ||= ''; st.color ||= ''; st.kind ||= ''; st.fav ||= false;
  v.append(el(`<div class="page-head"><div><h1>البحث</h1><p class="sub">ابحث في مكتبتك بالاسم أو الوصف أو الكلمات المفتاحية أو التصنيف أو المجموعة أو اللون، أو انتقل إلى Pinterest.</p></div></div>`));
  const box = el(`<div>
    <div class="search-input big">${icon('search')}<input class="input" type="search" name="q" value="${esc(st.q)}" placeholder="ماذا تبحث عنه؟" aria-label="عبارة البحث" autofocus></div>
    <div class="filters" style="margin-top:12px"><div class="filters-grid">
      <label><span>القسم</span><select class="select" name="section"></select></label>
      <label><span>التصنيف</span><select class="select" name="cat"></select></label>
      <label><span>المجموعة</span><select class="select" name="col"></select></label>
      <label><span>النوع</span><select class="select" name="kind"><option value="">الكل</option><option value="image">صور</option><option value="text">نصوص</option></select></label>
    </div>
    <div style="margin-top:12px"><span class="hint">اللون الغالب في الصورة:</span><div class="chips wrap" data-colors></div></div>
    <div class="f-foot"><label class="check"><input type="checkbox" name="fav"> المفضلة فقط</label><button type="button" class="link-btn" data-reset>مسح كل الخيارات</button></div></div>
    <div data-pin></div><p class="result-count"></p><div data-grid></div><div data-kw></div></div>`);
  v.append(box);
  const f = (n) => $(`[name=${n}]`, box);
  const secSel = f('section'), catSel = f('cat'), colSel = f('col');
  secSel.innerHTML = '<option value="">كل الأقسام</option>' + S.sections.filter((s) => s.id !== 'private' || S.unlocked).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  colSel.innerHTML = '<option value="">كل المجموعات</option>' + [...S.collections.values()].map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const fillCats = () => {
    catSel.innerHTML = '<option value="">كل التصنيفات</option>' + (st.section ? catOptionsHTML(st.section, st.cat) : '');
    catSel.disabled = !st.section;
  };
  secSel.value = st.section; fillCats(); colSel.value = st.col; f('kind').value = st.kind; f('fav').checked = st.fav;
  const colorsBox = $('[data-colors]', box);
  const paintColors = () => {
    colorsBox.innerHTML = '';
    COLORS.forEach(([k, label, hex]) => {
      const b = el(`<button type="button" class="chip ${st.color === k ? 'active' : ''}"><span class="sw" style="background:${hex}"></span>${label}</button>`);
      b.onclick = () => { st.color = st.color === k ? '' : k; paintColors(); paint(); };
      colorsBox.append(b);
    });
  };
  paintColors();
  const gridBox = $('[data-grid]', box);
  const grid = mountGrid(gridBox, [], { empty: `<div class="empty">${icon('search')}<h3>لا توجد نتائج</h3><p>جرّب كلمات أخرى أو خفّف خيارات التصفية، أو ابحث في Pinterest.</p></div>` });
  function paint() {
    const any = st.q.trim() || st.section || st.cat || st.col || st.color || st.kind || st.fav;
    const col = st.col ? S.collections.get(st.col) : null;
    const catSet = st.cat ? catDescendants(st.cat) : null;
    const list = !any ? [] : visibleImages().filter((i) =>
      (!st.section || i.sectionId === st.section) && (!catSet || catSet.has(i.categoryId)) && (!col || col.imageIds.includes(i.id)) &&
      (!st.color || i.color?.name === st.color) && (!st.kind || i.kind === st.kind) && (!st.fav || i.favorite) && matchQuery(i, st.q));
    $('.result-count', box).textContent = any ? `${num(list.length)} نتيجة` : '';
    const pin = $('[data-pin]', box);
    pin.innerHTML = '';
    if (any) pin.append(pinBox(buildPinQuery({ sectionId: st.section, categoryId: st.cat, text: st.q }), 'البحث الخارجي مرتبط بالقسم والتصنيف المحددين، ويحتاج اتصالاً بالإنترنت.'));
    if (any) { gridBox.hidden = false; grid.setItems(list); lazyAll(gridBox); } else gridBox.hidden = true;
    const kw = $('[data-kw]', box);
    kw.innerHTML = '';
    if (!any) {
      const counts = {};
      visibleImages().forEach((i) => (i.keywords || []).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
      if (top.length) {
        kw.append(el(`<div class="block-title"><h2>${icon('tag')} كلماتك المفتاحية</h2></div>`));
        const chips = el('<div class="chips wrap"></div>');
        top.forEach(([k, n]) => { const b = el(`<button type="button" class="chip">${esc(k)} <span class="muted small">${num(n)}</span></button>`); b.onclick = () => { st.q = k; f('q').value = k; syncUrl(); paint(); }; chips.append(b); });
        kw.append(chips);
      } else kw.append(el(`<div class="empty">${icon('search')}<h3>ابدأ البحث</h3><p>اكتب كلمة أو اختر قسماً أو لوناً لعرض النتائج من مكتبتك.</p></div>`));
    }
  }
  const syncUrl = () => history.replaceState(history.state, '', '#/search' + (st.q ? '?q=' + encodeURIComponent(st.q) : ''));
  f('q').oninput = debounce((e) => { st.q = e.target.value; syncUrl(); paint(); }, 160);
  secSel.onchange = () => { st.section = secSel.value; st.cat = ''; fillCats(); paint(); };
  catSel.onchange = () => { st.cat = catSel.value; paint(); };
  colSel.onchange = () => { st.col = colSel.value; paint(); };
  f('kind').onchange = (e) => { st.kind = e.target.value; paint(); };
  f('fav').onchange = (e) => { st.fav = e.target.checked; paint(); };
  $('[data-reset]', box).onclick = () => { Object.assign(st, { q: '', section: '', cat: '', col: '', color: '', kind: '', fav: false }); syncUrl(); rerender(); };
  paint();
}
function catOptionsHTML(sectionId, selected = '', includeNone = false) {
  let html = includeNone ? '<option value="">بدون تصنيف</option>' : '';
  const walk = (parent, depth) => catsOf(sectionId, parent).forEach((c) => {
    html += `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${' '.repeat(depth)}${depth ? '– ' : ''}${esc(c.name)}</option>`;
    walk(c.id, depth + 1);
  });
  walk(null, 0);
  return html;
}

/* ---------- المفضلة ---------- */
async function renderFavorites(v) {
  S.ctx = {};
  const st = UI.fav;
  v.append(el(`<div class="page-head"><div><h1>${icon('heart')} المفضلة</h1><p class="sub">كل ما وضعت عليه علامة القلب${S.unlocked ? '' : ' (محتوى المساحة الخاصة غير معروض)'}.</p></div></div>`));
  const tb = el(`<div class="toolbar"><div class="search-input grow">${icon('search')}<input class="input" type="search" value="${esc(st.q)}" placeholder="ابحث داخل المفضلة…" aria-label="بحث داخل المفضلة"></div>
    <select class="select" style="width:auto" aria-label="القسم"><option value="">كل الأقسام</option>${S.sections.filter((s) => s.id !== 'private' || S.unlocked).map((s) => `<option value="${s.id}" ${st.section === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <select class="select" style="width:auto" aria-label="الترتيب"><option value="new">الأحدث أولاً</option><option value="old" ${st.sort === 'old' ? 'selected' : ''}>الأقدم أولاً</option></select></div>`);
  v.append(tb);
  const count = el('<p class="result-count"></p>'), gb = el('<div></div>');
  v.append(count, gb);
  const grid = mountGrid(gb, [], { empty: `<div class="empty">${icon('heart')}<h3>لا توجد عناصر في المفضلة</h3><p>اضغط رمز القلب على أي صورة لإضافتها هنا.</p></div>` });
  const paint = () => {
    const list = visibleImages().filter((i) => i.favorite && (!st.section || i.sectionId === st.section) && matchQuery(i, st.q))
      .sort((a, b) => (st.sort === 'old' ? 1 : -1) * ((a.favoritedAt || a.createdAt) - (b.favoritedAt || b.createdAt)));
    count.textContent = `${num(list.length)} عنصر`;
    grid.setItems(list); lazyAll(gb);
  };
  const [inp, sec, sort] = [$('input', tb), ...$$('select', tb)];
  inp.oninput = debounce(() => { st.q = inp.value; paint(); }, 160);
  sec.onchange = () => { st.section = sec.value; paint(); };
  sort.onchange = () => { st.sort = sort.value; paint(); };
  gb.addEventListener('favchange', paint);
  paint();
}

/* ---------- المجموعات ---------- */
async function renderCollections(v) {
  S.ctx = {};
  const cols = [...S.collections.values()].sort((a, b) => b.createdAt - a.createdAt);
  v.append(el(`<div class="page-head"><div><h1>${icon('layers')} المجموعات</h1><p class="sub">مجلدات خاصة تجمع فيها صوراً من أي قسم، مثل «سيارات أحلامي» أو «صور مرجعية للرسم».</p></div>
    <div class="actions"><button class="btn primary" type="button" data-new>${icon('folder-plus')} مجموعة جديدة</button></div></div>`));
  $('[data-new]', v).onclick = async () => { const c = await collectionForm(); if (c) go(`#/collection/${c.id}`); };
  if (!cols.length) { v.append(el(`<div class="empty">${icon('layers')}<h3>لا توجد مجموعات بعد</h3><p>أنشئ مجموعة ثم أضف إليها الصور من صفحة المجموعة أو من نافذة عرض الصورة.</p></div>`)); return; }
  const grid = el('<div class="cards-grid"></div>');
  for (const c of cols) {
    const visibleIds = c.imageIds.filter((id) => S.images.has(id) && canSee(S.images.get(id)));
    const cover = await coverImgHTML(c.coverId && visibleIds.includes(c.coverId) ? c.coverId : visibleIds[0], 'layers');
    grid.append(el(`<a class="cover-card" href="#/collection/${c.id}"><div class="cv">${cover}</div><div class="cc-body"><h3>${esc(c.name)}</h3><p>${num(visibleIds.length)} عنصر${c.description ? ' · ' + esc(trunc(c.description, 40)) : ''}</p></div></a>`));
  }
  v.append(grid);
}
async function collectionForm(col = null) {
  return new Promise((resolve) => {
    let saved = null;
    const node = el(`<form class="dialog small" novalidate>
      <header class="dlg-head"><h2>${col ? 'تعديل المجموعة' : 'مجموعة جديدة'}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
      <div class="dlg-body">
        <label class="field"><span>اسم المجموعة <b class="req">*</b></span><input class="input" name="name" maxlength="80" value="${esc(col?.name || '')}" placeholder="مثال: أفكار إلنترا" autofocus></label>
        <label class="field"><span>الوصف</span><textarea class="input" name="desc" maxlength="400">${esc(col?.description || '')}</textarea></label>
        ${col ? '<div class="field"><span>الغلاف</span><div class="row2" style="align-items:center"><div class="cover-prev" style="width:96px;height:72px;border-radius:10px;overflow:hidden;background:var(--surface-2);display:grid;place-items:center"></div><button type="button" class="btn ghost small" data-cover>اختيار الغلاف من صور المجموعة</button></div></div>' : ''}
        <p class="err" hidden>اكتب اسماً للمجموعة</p></div>
      <footer class="dlg-foot"><button type="button" class="btn ghost" data-close>إلغاء</button><button type="submit" class="btn primary">حفظ</button></footer></form>`);
    let coverId = col?.coverId || null;
    const paintCover = async () => { const p = $('.cover-prev', node); if (p) p.innerHTML = await coverImgHTML(coverId || col.imageIds[0], 'image'); };
    if (col) {
      paintCover();
      $('[data-cover]', node).onclick = async () => {
        const ids = col.imageIds.filter((id) => S.images.has(id) && canSee(S.images.get(id)));
        if (!ids.length) return toast('أضف صوراً إلى المجموعة أولاً', 'error');
        const picked = await pickImages({ title: 'اختيار الغلاف', ids, single: true });
        if (picked?.length) { coverId = picked[0]; paintCover(); }
      };
    }
    node.onsubmit = async (e) => {
      e.preventDefault();
      const name = node.elements.name.value.trim();
      if (!name) { $('.err', node).hidden = false; return; }
      const c = col || { id: uid(), imageIds: [], createdAt: Date.now(), coverId: null };
      Object.assign(c, { name, description: node.elements.desc.value.trim(), coverId, updatedAt: Date.now() });
      try { await DB.put('collections', c); S.collections.set(c.id, c); hayCache_clear(); saved = c; toast('حُفظت المجموعة', 'ok'); closeModal(); } catch (err) { toast(dbErrorMessage(err), 'error'); }
    };
    openModal(node, { onClose: () => resolve(saved) });
  });
}
async function renderCollection(v, [id]) {
  const col = S.collections.get(id);
  if (!col) { v.innerHTML = emptyState('المجموعة غير موجودة', 'ربما حُذفت.', false); return; }
  S.ctx = { collectionId: id };
  const reorder = !!UI.collectionReorder[id];
  const items = col.imageIds.map((x) => S.images.get(x)).filter((i) => i && canSee(i));
  const hidden = col.imageIds.filter((x) => S.images.has(x)).length - items.length;
  v.append(el(`<div class="page-head"><div><div class="crumbs"><a href="#/collections">المجموعات</a> › <span>${esc(col.name)}</span></div><h1>${esc(col.name)}</h1>
    <p class="sub">${col.description ? esc(col.description) + ' · ' : ''}${num(items.length)} عنصر${hidden ? ` · ${num(hidden)} عنصر مخفي (المساحة الخاصة مقفلة)` : ''}</p></div>
    <div class="actions"><button class="btn primary" type="button" data-add-imgs>${icon('plus')} إضافة صور</button>
    <button class="btn ${reorder ? 'primary' : 'ghost'}" type="button" data-reorder>${icon('list')} ${reorder ? 'إنهاء الترتيب' : 'ترتيب وإزالة'}</button>
    <button class="icon-btn" type="button" data-edit aria-label="تعديل المجموعة" title="تعديل">${icon('edit')}</button>
    <button class="icon-btn" type="button" data-del aria-label="حذف المجموعة" title="حذف">${icon('trash')}</button></div></div>`));
  $('[data-reorder]', v).onclick = () => { UI.collectionReorder[id] = !reorder; rerender(); };
  $('[data-edit]', v).onclick = async () => { if (await collectionForm(col)) rerender(); };
  $('[data-del]', v).onclick = async () => {
    if (!(await confirmDialog({ title: 'حذف المجموعة', message: `ستُحذف المجموعة «${esc(col.name)}» فقط، وتبقى صورها محفوظة في المكتبة.`, confirmText: 'حذف المجموعة', danger: true }))) return;
    await DB.del('collections', id); S.collections.delete(id); hayCache_clear(); toast('حُذفت المجموعة', 'ok'); go('#/collections');
  };
  $('[data-add-imgs]', v).onclick = async () => {
    const ids = visibleImages().map((i) => i.id).filter((x) => !col.imageIds.includes(x));
    if (!ids.length) return toast('لا توجد صور أخرى لإضافتها', 'error');
    const picked = await pickImages({ title: `إضافة صور إلى «${col.name}»`, ids });
    if (!picked?.length) return;
    col.imageIds.push(...picked); col.updatedAt = Date.now();
    await DB.put('collections', col); hayCache_clear();
    toast(`أُضيف ${num(picked.length)} عنصر`, 'ok'); rerender();
  };
  if (!items.length) { v.append(el(`<div class="empty">${icon('layers')}<h3>المجموعة فارغة</h3><p>أضف إليها صوراً من مكتبتك.</p></div>`)); return; }
  if (reorder) {
    v.append(el('<p class="hint" style="margin-bottom:10px">استخدم الأسهم لتغيير الترتيب، وزر الحذف لإزالة العنصر من المجموعة فقط.</p>'));
    const list = el('<div class="reorder-list"></div>');
    const save = async () => { col.updatedAt = Date.now(); await DB.put('collections', col); };
    items.forEach((img, idx) => {
      const row = el(`<div class="reorder-row"><span class="idx">${num(idx + 1)}</span><span class="thumb">${img.kind === 'text' ? icon('text') : `<img data-id="${img.id}" alt="">`}</span><span class="name" dir="auto">${esc(img.name)}</span>
        <button class="icon-btn" type="button" data-up aria-label="تحريك للأعلى" ${idx === 0 ? 'disabled' : ''}>${icon('up')}</button>
        <button class="icon-btn" type="button" data-down aria-label="تحريك للأسفل" ${idx === items.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button class="icon-btn" type="button" data-rm aria-label="إزالة من المجموعة">${icon('x')}</button></div>`);
      const move = async (dir) => {
        const a = col.imageIds.indexOf(img.id), b = col.imageIds.indexOf(items[idx + dir].id);
        [col.imageIds[a], col.imageIds[b]] = [col.imageIds[b], col.imageIds[a]];
        await save(); rerender();
      };
      $('[data-up]', row).onclick = () => move(-1);
      $('[data-down]', row).onclick = () => move(1);
      $('[data-rm]', row).onclick = async () => { col.imageIds = col.imageIds.filter((x) => x !== img.id); if (col.coverId === img.id) col.coverId = null; await save(); hayCache_clear(); toast('أُزيل من المجموعة', 'ok'); rerender(); };
      list.append(row);
    });
    v.append(list);
  } else {
    const gb = el('<div></div>'); v.append(gb); mountGrid(gb, items);
  }
}
/** نافذة اختيار صور من قائمة معرفات */
function pickImages({ title, ids, single = false }) {
  return new Promise((resolve) => {
    const sel = new Set();
    let result = null;
    const node = el(`<div class="dialog wide"><header class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
      <div class="dlg-body"><div class="search-input">${icon('search')}<input class="input" type="search" placeholder="تصفية…" aria-label="تصفية"></div><div class="picker-grid"></div></div>
      <footer class="dlg-foot"><span class="grow muted small" data-n></span><button type="button" class="btn ghost" data-close>إلغاء</button><button type="button" class="btn primary" data-ok disabled>${single ? 'اختيار' : 'إضافة المحدد'}</button></footer></div>`);
    const grid = $('.picker-grid', node);
    const paint = (q = '') => {
      grid.innerHTML = '';
      ids.map((x) => S.images.get(x)).filter((i) => i && matchQuery(i, q)).slice(0, 400).forEach((img) => {
        const b = el(img.kind === 'text'
          ? `<button type="button" class="pick text ${sel.has(img.id) ? 'sel' : ''}" data-pid="${img.id}"><span class="tick">${icon('check')}</span>${esc(trunc(img.text?.body || '', 80))}</button>`
          : `<button type="button" class="pick ${sel.has(img.id) ? 'sel' : ''}" data-pid="${img.id}" aria-label="${esc(img.name)}"><span class="tick">${icon('check')}</span><img data-id="${img.id}" alt=""></button>`);
        grid.append(b);
      });
      lazyAll(grid);
    };
    grid.onclick = (e) => {
      const b = e.target.closest('[data-pid]'); if (!b) return;
      const id = b.dataset.pid;
      if (single) { sel.clear(); $$('.pick.sel', grid).forEach((x) => x.classList.remove('sel')); }
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      b.classList.toggle('sel', sel.has(id));
      $('[data-ok]', node).disabled = !sel.size;
      $('[data-n]', node).textContent = sel.size ? `تم تحديد ${num(sel.size)}` : '';
    };
    $('input', node).oninput = debounce((e) => paint(e.target.value), 150);
    $('[data-ok]', node).onclick = () => { result = [...sel]; closeModal(); };
    paint();
    openModal(node, { onClose: () => resolve(result) });
  });
}

/* ---------- إدارة التصنيفات ---------- */
function openCategoryManager(sectionId) {
  const sec = sectionById(sectionId);
  let changed = false;
  const node = el(`<div class="dialog wide"><header class="dlg-head"><h2>تصنيفات «${esc(sec.name)}»</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
    <div class="dlg-body"><p class="hint">عدّل الأسماء مباشرة، وأضف تصنيفات رئيسية أو فرعية. «مصطلح Pinterest» كلمة إنجليزية تُضاف تلقائياً إلى البحث الخارجي. يُحفظ كل تعديل فوراً.</p><div class="cat-tree"></div></div>
    <footer class="dlg-foot"><button type="button" class="btn ghost" data-add-top>${icon('plus')} تصنيف رئيسي</button><span class="grow"></span><button type="button" class="btn primary" data-close>تم</button></footer></div>`);
  const tree = $('.cat-tree', node);
  const save = async (c) => { await DB.put('categories', c); S.categories.set(c.id, c); changed = true; hayCache_clear(); };
  const addCat = async (parentId) => {
    const siblings = catsOf(sectionId, parentId);
    const c = { id: 'cat_' + uid().replace(/-/g, '').slice(0, 10), sectionId, parentId, name: 'تصنيف جديد', en: '', order: (siblings.at(-1)?.order ?? 0) + 1 };
    await save(c); paint();
    $(`[data-cid="${c.id}"] .input`, tree)?.select();
  };
  const move = async (c, dir) => {
    const sib = catsOf(sectionId, c.parentId ?? null);
    const i = sib.findIndex((x) => x.id === c.id), j = i + dir;
    if (j < 0 || j >= sib.length) return;
    const o = sib[j];
    [c.order, o.order] = [o.order, c.order];
    if (c.order === o.order) c.order += dir;
    await save(c); await save(o); paint();
  };
  const remove = async (c) => {
    const ids = catDescendants(c.id);
    const n = [...S.images.values()].filter((i) => ids.has(i.categoryId)).length;
    const ok = await confirmDialog({ title: 'حذف التصنيف', message: `سيُحذف «${esc(c.name)}»${ids.size > 1 ? ' وتصنيفاته الفرعية' : ''}.${n ? ` ستُنقل ${num(n)} صورة إلى ${c.parentId ? 'التصنيف الأعلى' : '«بدون تصنيف»'} ولن تُحذف.` : ''}`, confirmText: 'حذف', danger: true });
    if (!ok) return;
    const moved = [...S.images.values()].filter((i) => ids.has(i.categoryId));
    await DB.batch(['categories', 'images'], (st) => {
      ids.forEach((id) => st('categories').delete(id));
      moved.forEach((i) => { i.categoryId = c.parentId || null; i.updatedAt = Date.now(); st('images').put(i); });
    });
    ids.forEach((id) => S.categories.delete(id));
    Object.values(UI.browser).forEach((b) => { if (ids.has(b.top)) b.top = null; if (ids.has(b.child)) b.child = null; });
    changed = true; hayCache_clear(); toast('حُذف التصنيف', 'ok'); paint();
  };
  const row = (c, depth) => {
    const r = el(`<div class="cat-row" data-cid="${c.id}">
      <input class="input" value="${esc(c.name)}" aria-label="اسم التصنيف" maxlength="60">
      <input class="input en" value="${esc(c.en || '')}" placeholder="مصطلح Pinterest" aria-label="مصطلح البحث في Pinterest" maxlength="80">
      <button class="icon-btn" type="button" data-up aria-label="تقديم">${icon('up')}</button><button class="icon-btn" type="button" data-down aria-label="تأخير">${icon('down')}</button>
      ${depth === 0 ? `<button class="icon-btn" type="button" data-child aria-label="إضافة تصنيف فرعي" title="تصنيف فرعي">${icon('plus')}</button>` : ''}
      <button class="icon-btn" type="button" data-rm aria-label="حذف التصنيف">${icon('trash')}</button></div>`);
    const [nm, en] = $$('input', r);
    nm.onchange = async () => { const val = nm.value.trim(); if (!val) { nm.value = c.name; return toast('الاسم لا يمكن أن يكون فارغاً', 'error'); } c.name = val; await save(c); };
    en.onchange = async () => { c.en = en.value.trim(); await save(c); };
    $('[data-up]', r).onclick = () => move(c, -1);
    $('[data-down]', r).onclick = () => move(c, 1);
    $('[data-child]', r)?.addEventListener('click', () => addCat(c.id));
    $('[data-rm]', r).onclick = () => remove(c);
    return r;
  };
  function paint() {
    tree.innerHTML = '';
    catsOf(sectionId).forEach((top) => {
      const nodeEl = el('<div class="cat-node"></div>');
      nodeEl.append(row(top, 0));
      const kids = catsOf(sectionId, top.id);
      if (kids.length) { const k = el('<div class="cat-children"></div>'); kids.forEach((c) => k.append(row(c, 1))); nodeEl.append(k); }
      tree.append(nodeEl);
    });
    if (!tree.children.length) tree.append(el('<p class="muted">لا توجد تصنيفات. أضف تصنيفاً رئيسياً.</p>'));
  }
  $('[data-add-top]', node).onclick = () => addCat(null);
  paint();
  openModal(node, { onClose: () => { if (changed) rerender(); } });
}

/* ---------- الأقسام الجديدة ---------- */
async function newSectionFlow() {
  const r = await promptDialog({ title: 'قسم جديد', label: 'اسم القسم', placeholder: 'مثال: الديكور', confirmText: 'إنشاء',
    extra: '<label class="field"><span>وصف قصير</span><input class="input" name="d" maxlength="120"></label><label class="field"><span>مصطلح Pinterest الأساسي (اختياري)</span><input class="input" name="pin" dir="ltr" placeholder="interior design"></label>' });
  if (!r) return;
  const sec = { id: 'sec_' + uid().replace(/-/g, '').slice(0, 10), name: r.value, type: 'generic', icon: 'grid', order: Math.max(0, ...S.sections.map((s) => s.order)) + 1, desc: r.form.d.value.trim(), pinPrefix: r.form.pin.value.trim(), allowText: false, builtin: false };
  await DB.put('sections', sec); S.sections.push(sec);
  toast('أُنشئ القسم — أضف له تصنيفات من زر «التصنيفات»', 'ok');
  go(`#/s/${sec.id}`);
}
async function editSectionFlow(sec) {
  const r = await promptDialog({ title: 'تعديل القسم', label: 'اسم القسم', value: sec.name,
    extra: `<label class="field"><span>وصف قصير</span><input class="input" name="d" maxlength="120" value="${esc(sec.desc || '')}"></label><label class="field"><span>مصطلح Pinterest الأساسي</span><input class="input" name="pin" dir="ltr" value="${esc(sec.pinPrefix || '')}"></label>
    <p class="hint">لحذف القسم استخدم صفحة الإعدادات › الأقسام.</p>` });
  if (!r) return;
  Object.assign(sec, { name: r.value, desc: r.form.d.value.trim(), pinPrefix: r.form.pin.value.trim() });
  await DB.put('sections', sec); hayCache_clear(); rerender();
}
async function deleteSection(sec) {
  const imgs = [...S.images.values()].filter((i) => i.sectionId === sec.id);
  const ok = await confirmDialog({ title: 'حذف القسم', message: `سيُحذف قسم «${esc(sec.name)}» وتصنيفاته${imgs.length ? ` و${num(imgs.length)} صورة بداخله نهائياً` : ''}.`, confirmText: 'حذف نهائي', danger: true, requireText: imgs.length ? 'حذف' : '' });
  if (!ok) return false;
  await deleteImages(imgs.map((i) => i.id));
  const cats = [...S.categories.values()].filter((c) => c.sectionId === sec.id);
  await DB.batch(['categories', 'sections'], (st) => { cats.forEach((c) => st('categories').delete(c.id)); st('sections').delete(sec.id); });
  cats.forEach((c) => S.categories.delete(c.id));
  S.sections = S.sections.filter((s) => s.id !== sec.id);
  toast('حُذف القسم', 'ok');
  return true;
}

/* =========================================================
   9) نموذج الإضافة والتعديل
   ========================================================= */
function openImageForm({ id = null, preset = {}, onSaved = null } = {}) {
  const editing = !!id;
  const rec = editing ? S.images.get(id) : null;
  const ctx = editing ? { ...rec } : { sectionId: preset.sectionId ?? S.ctx.sectionId ?? '', subjectId: preset.subjectId ?? S.ctx.subjectId ?? '', categoryId: preset.categoryId ?? S.ctx.categoryId ?? '' };
  if (ctx.sectionId && !sectionById(ctx.sectionId)) ctx.sectionId = '';
  if (ctx.sectionId === 'private' && !S.unlocked) { ctx.sectionId = ''; ctx.categoryId = ''; }
  let kind = editing ? rec.kind : 'image';
  const files = [];
  const previewURLs = [];
  const t = rec?.text || {};
  const inCols = editing ? [...S.collections.values()].filter((c) => c.imageIds.includes(id)).map((c) => c.id) : (S.ctx.collectionId ? [S.ctx.collectionId] : []);

  const node = el(`<form class="dialog form-dialog" novalidate>
    <header class="dlg-head"><h2>${editing ? 'تعديل البيانات' : 'إضافة إلى المكتبة'}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
    <div class="dlg-body">
      <div class="seg" data-kind hidden><button type="button" data-k="image">${icon('image')} صورة</button><button type="button" data-k="text">${icon('text')} نص</button></div>
      ${editing ? '' : `<div class="f-files"><div class="drop">${icon('upload')}<p>اختر صوراً من جهازك أو من معرض الصور، أو اسحبها إلى هنا.</p>
        <div class="btns"><label class="btn primary file-btn">${icon('image')} اختيار صور<input type="file" accept="image/*" multiple name="files"></label>
        <label class="btn ghost file-btn">${icon('camera')} التقاط صورة<input type="file" accept="image/*" capture="environment" name="cam"></label></div>
        <p class="hint">يمكنك اختيار عدة صور دفعة واحدة.</p></div><div class="previews"></div></div>`}
      <div class="f-text" hidden>
        <label class="field"><span>نوع النص <b class="req">*</b></span><select class="select" name="ttype">${Object.entries(TEXT_TYPES).map(([k, v]) => `<option value="${k}" ${t.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="field"><span>النص <b class="req">*</b></span><textarea class="input" name="tbody" dir="rtl" style="font-family:var(--font-quran);font-size:1.15rem;min-height:120px">${esc(t.body || '')}</textarea></label>
        <div class="row2" data-ayah><label class="field"><span>السورة <b class="req">*</b></span><select class="select" name="surah"><option value="">اختر السورة</option>${SURAHS.map((s, i) => `<option value="${s}" ${t.surah === s ? 'selected' : ''}>${num(i + 1)}. ${s}</option>`).join('')}</select></label>
          <div class="row2"><label class="field"><span>من الآية <b class="req">*</b></span><input class="input" name="ayah" type="number" min="1" inputmode="numeric" value="${esc(t.ayah || '')}"></label><label class="field"><span>إلى الآية</span><input class="input" name="ayahTo" type="number" min="1" inputmode="numeric" value="${esc(t.ayahTo || '')}"></label></div></div>
        <label class="field" data-src><span>المصدر <b class="req" data-src-req>*</b></span><input class="input" name="tsource" value="${esc(t.source || '')}" placeholder="مثال: صحيح البخاري، رقم الحديث"></label>
        <label class="field" data-grade><span>درجة الحديث</span><select class="select" name="grading"><option value="">غير مذكورة</option>${GRADINGS.map((g) => `<option ${t.grading === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <div class="notice">${icon('info')}<div class="grow small">انقل النص كما هو من مصدر موثوق. فسيفساء لا تتحقق من النصوص، وتعرض «العبارات العامة» منفصلة بوضوح عن النصوص الشرعية.</div></div>
      </div>
      <label class="field"><span data-name-label>الاسم</span><input class="input" name="name" maxlength="140" value="${esc(rec?.name || '')}" dir="auto"></label>
      <p class="hint" data-multi hidden>عند اختيار عدة صور: إن تركت الاسم فارغاً يُستخدم اسم كل ملف، وإن كتبت اسماً يُضاف إليه رقم تسلسلي.</p>
      <label class="field"><span>الوصف</span><textarea class="input" name="description" maxlength="2000" dir="auto">${esc(rec?.description || '')}</textarea></label>
      <label class="field"><span>الكلمات المفتاحية</span><input class="input" name="keywords" value="${esc((rec?.keywords || []).join('، '))}" placeholder="افصل بينها بفاصلة: أسود، رياضي، ليلي" dir="auto"></label>
      <div class="row2"><label class="field"><span>القسم <b class="req">*</b></span><select class="select" name="sectionId"></select></label>
        <label class="field" data-subject hidden><span>السيارة</span><select class="select" name="subjectId"></select></label></div>
      <label class="field"><span>التصنيف</span><select class="select" name="categoryId"></select></label>
      <div class="filters" data-attrs hidden><p class="hint" style="margin-bottom:8px">خيارات التصنيف (اختيارية — تساعدك على البحث والتصفية لاحقاً)</p><div class="filters-grid"></div></div>
      <label class="check" data-adult hidden><input type="checkbox" name="adult" ${editing && rec.adultConfirmed ? 'checked' : ''}><span>أؤكد أن الصورة لامرأة بالغة (18 سنة أو أكثر). <b class="req">*</b></span></label>
      <label class="field"><span>رابط المصدر (اختياري)</span><input class="input" name="sourceUrl" type="url" dir="ltr" value="${esc(rec?.sourceUrl || '')}" placeholder="https://"></label>
      <label class="field"><span>ملاحظات خاصة</span><textarea class="input" name="notes" maxlength="4000" dir="auto">${esc(rec?.notes || '')}</textarea></label>
      <fieldset class="field" style="border:0;padding:0;margin:0"><span style="font-weight:600;font-size:.88rem">المجموعات</span><div class="chips wrap" data-cols></div></fieldset>
      <label class="check"><input type="checkbox" name="favorite" ${rec?.favorite ? 'checked' : ''}> <span>إضافة إلى المفضلة</span></label>
      <p class="err" data-err hidden></p>
      ${editing ? '' : '<p class="hint">تُحفظ الصور على هذا الجهاز وهذا المتصفح فقط، ولا تتم مزامنتها تلقائياً مع أجهزتك الأخرى.</p>'}
    </div>
    <footer class="dlg-foot"><div class="progress" hidden><div class="bar"><i></i></div><span></span></div>
      <button type="button" class="btn ghost" data-close>إلغاء</button><button type="submit" class="btn primary">${editing ? 'حفظ التعديلات' : 'حفظ'}</button></footer></form>`);

  const F = (n) => node.elements[n];
  const secSel = F('sectionId'), subSel = F('subjectId'), catSel = F('categoryId');
  let attrs = { ...(rec?.attrs || {}) };

  secSel.innerHTML = '<option value="">اختر القسم</option>' + S.sections.filter((s) => s.id !== 'private' || S.unlocked).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  secSel.value = ctx.sectionId || '';

  function fillSubjects() {
    const sec = sectionById(secSel.value);
    const show = sec?.type === 'cars';
    $('[data-subject]', node).hidden = !show;
    if (!show) return;
    const cur = subSel.value || ctx.subjectId || '';
    subSel.innerHTML = '<option value="">بدون سيارة محددة</option>' + [...S.subjects.values()].filter((s) => s.sectionId === sec.id).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') + '<option value="__new">+ سيارة جديدة…</option>';
    subSel.value = S.subjects.has(cur) ? cur : '';
  }
  function fillCats() {
    const cur = catSel.value || ctx.categoryId || '';
    catSel.innerHTML = secSel.value ? catOptionsHTML(secSel.value, cur, true) : '<option value="">اختر القسم أولاً</option>';
    catSel.disabled = !secSel.value;
    if (S.categories.get(cur)?.sectionId === secSel.value) catSel.value = cur; else catSel.value = '';
  }
  function fillAttrs() {
    const fs = catSel.value ? catFilters(catSel.value) : null;
    const box = $('[data-attrs]', node);
    box.hidden = !fs;
    $('[data-adult]', node).hidden = !(catSel.value && isAdultOnly(catSel.value));
    if (!fs) return;
    const grid = $('.filters-grid', box);
    grid.innerHTML = '';
    fs.forEach((f) => {
      if (f.type === 'text') {
        const l = el(`<label><span>${esc(f.label)}</span><input class="input" value="${esc(attrs[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" dir="auto"></label>`);
        $('input', l).oninput = (e) => { attrs[f.key] = e.target.value.trim(); };
        grid.append(l);
      } else {
        const l = el(`<label><span>${esc(f.label)}</span><select class="select"><option value="">—</option>${f.options.map((o) => `<option value="${o[0]}" ${attrs[f.key] === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></label>`);
        $('select', l).onchange = (e) => { attrs[f.key] = e.target.value; };
        grid.append(l);
      }
    });
  }
  function syncKind() {
    const sec = sectionById(secSel.value);
    const allowText = !!sec?.allowText;
    if (!allowText && kind === 'text' && !editing) kind = 'image';
    const seg = $('[data-kind]', node);
    seg.hidden = !allowText || editing;
    $$('[data-k]', seg).forEach((b) => b.classList.toggle('active', b.dataset.k === kind));
    $('.f-files', node) && ($('.f-files', node).hidden = kind !== 'image');
    $('.f-text', node).hidden = kind !== 'text';
    $('[data-name-label]', node).innerHTML = kind === 'text' ? 'العنوان (اختياري)' : 'الاسم';
    syncTextType();
  }
  function syncTextType() {
    const tt = F('ttype').value;
    $('[data-ayah]', node).hidden = tt !== 'ayah';
    $('[data-src]', node).hidden = tt === 'ayah' || tt === 'general';
    $('[data-src-req]', node).hidden = tt !== 'hadith';
    $('[data-grade]', node).hidden = tt !== 'hadith';
  }
  function fillCols() {
    const box = $('[data-cols]', node);
    box.innerHTML = '';
    [...S.collections.values()].forEach((c) => {
      const b = el(`<button type="button" class="chip ${inCols.includes(c.id) ? 'active' : ''}" aria-pressed="${inCols.includes(c.id)}">${esc(c.name)}</button>`);
      b.onclick = () => { const i = inCols.indexOf(c.id); if (i >= 0) inCols.splice(i, 1); else inCols.push(c.id); fillCols(); };
      box.append(b);
    });
    const nb = el(`<button type="button" class="chip">${icon('plus')} مجموعة جديدة</button>`);
    nb.onclick = async () => { const c = await collectionForm(); if (c) { inCols.push(c.id); fillCols(); } };
    box.append(nb);
  }

  secSel.onchange = () => { ctx.categoryId = ''; attrs = {}; fillSubjects(); fillCats(); fillAttrs(); syncKind(); };
  subSel.onchange = async () => {
    if (subSel.value !== '__new') return;
    subSel.value = '';
    const r = await promptDialog({ title: 'سيارة جديدة', label: 'اسم السيارة والطراز والسنة', placeholder: 'مثال: Toyota Camry 2022', confirmText: 'إضافة' });
    if (!r) return;
    const car = { id: 'car_' + uid().replace(/-/g, '').slice(0, 10), sectionId: 'cars', name: r.value, coverId: null, createdAt: Date.now() };
    await DB.put('subjects', car); S.subjects.set(car.id, car);
    ctx.subjectId = car.id; fillSubjects(); subSel.value = car.id;
  };
  catSel.onchange = () => { fillAttrs(); };
  F('ttype').onchange = syncTextType;
  $$('[data-k]', node).forEach((b) => { b.onclick = () => { kind = b.dataset.k; syncKind(); }; });

  // اختيار الملفات والمعاينة
  const addFiles = (list) => {
    for (const f of list) {
      if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) { toast(`تم تجاهل "${f.name}" لأنه ليس صورة`, 'error'); continue; }
      files.push(f);
    }
    paintPreviews();
  };
  function paintPreviews() {
    const box = $('.previews', node);
    if (!box) return;
    previewURLs.forEach((u) => URL.revokeObjectURL(u)); previewURLs.length = 0;
    box.innerHTML = '';
    files.forEach((f, i) => {
      const u = URL.createObjectURL(f); previewURLs.push(u);
      const pv = el(`<div class="pv"><img src="${u}" alt="${esc(f.name)}"><button type="button" aria-label="إزالة">${icon('x')}</button></div>`);
      $('button', pv).onclick = () => { files.splice(i, 1); paintPreviews(); };
      box.append(pv);
    });
    $('[data-multi]', node).hidden = files.length < 2;
    if (files.length === 1 && !F('name').value.trim()) F('name').placeholder = files[0].name.replace(/\.[^.]+$/, '');
  }
  if (!editing) {
    F('files').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    F('cam').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    const drop = $('.drop', node);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
    if (preset.files) addFiles(preset.files);
  }

  fillSubjects(); fillCats(); fillAttrs(); fillCols(); syncKind();

  const errBox = $('[data-err]', node);
  const fail = (m) => { errBox.textContent = m; errBox.hidden = false; errBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); return false; };

  node.onsubmit = async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const sectionId = secSel.value;
    if (!sectionId) return fail('اختر القسم');
    const categoryId = catSel.value || null;
    if (categoryId && isAdultOnly(categoryId) && kind === 'image' && !F('adult').checked) return fail('يجب تأكيد أن الصورة لامرأة بالغة (18 سنة أو أكثر) — هذا القسم للبالغات فقط');
    const sourceUrl = F('sourceUrl').value.trim();
    if (sourceUrl && !isHttpUrl(sourceUrl)) return fail('رابط المصدر غير صالح؛ يجب أن يبدأ بـ http:// أو https://');
    const fsAttrs = categoryId ? catFilters(categoryId) : null;
    const cleanAttrs = {};
    if (fsAttrs) fsAttrs.forEach((f) => { if (attrs[f.key]) cleanAttrs[f.key] = attrs[f.key]; });
    const base = {
      description: F('description').value.trim(),
      keywords: splitKeywords(F('keywords').value),
      notes: F('notes').value.trim(),
      sourceUrl,
      sectionId,
      subjectId: sectionById(sectionId)?.type === 'cars' ? (subSel.value && subSel.value !== '__new' ? subSel.value : null) : null,
      categoryId,
      attrs: cleanAttrs,
      favorite: F('favorite').checked,
      adultConfirmed: !!(categoryId && isAdultOnly(categoryId) && F('adult').checked),
    };
    let text = null;
    if (kind === 'text') {
      const type = F('ttype').value, body = F('tbody').value.trim();
      if (!body) return fail('اكتب النص');
      text = { type, body };
      if (type === 'ayah') {
        const surah = F('surah').value, ayah = parseInt(F('ayah').value, 10), ayahTo = parseInt(F('ayahTo').value, 10) || null;
        if (!surah) return fail('اختر اسم السورة');
        const max = AYAH_COUNTS[SURAHS.indexOf(surah)];
        if (!ayah || ayah < 1 || ayah > max) return fail(`رقم الآية غير صحيح — سورة ${surah} عدد آياتها ${max}`);
        if (ayahTo && (ayahTo < ayah || ayahTo > max)) return fail('نطاق الآيات غير صحيح');
        Object.assign(text, { surah, ayah, ayahTo });
      } else if (type === 'hadith') {
        const source = F('tsource').value.trim();
        if (!source) return fail('اذكر مصدر الحديث (مثل: صحيح مسلم، رقم الحديث)');
        Object.assign(text, { source, grading: F('grading').value || '' });
      } else if (type !== 'general') {
        text.source = F('tsource').value.trim();
      }
    }

    const submitBtn = $('[type=submit]', node);
    const prog = $('.progress', node);
    submitBtn.disabled = true;
    try {
      if (editing) {
        const patch = { ...base, name: F('name').value.trim() || rec.name };
        if (rec.kind === 'text') { patch.text = text; patch.name = F('name').value.trim() || trunc(text.body, 50); }
        if (patch.favorite !== !!rec.favorite) patch.favoritedAt = patch.favorite ? Date.now() : null;
        await updateImage(id, patch);
        await setImageCollections(id, inCols);
        toast('حُفظت التعديلات', 'ok');
      } else if (kind === 'text') {
        const r = await addTextRecord({ ...base, name: F('name').value.trim() || trunc(text.body, 50), text });
        await setImageCollections(r.id, inCols);
        toast('حُفظ النص', 'ok');
      } else {
        if (!files.length) { submitBtn.disabled = false; return fail('اختر صورة واحدة على الأقل'); }
        const typed = F('name').value.trim();
        prog.hidden = false;
        let okCount = 0;
        const errors = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          $('span', prog).textContent = `جاري حفظ ${num(i + 1)} من ${num(files.length)}…`;
          $('.bar i', prog).style.width = `${Math.round((i / files.length) * 100)}%`;
          const name = typed ? (files.length > 1 ? `${typed} ${i + 1}` : typed) : f.name.replace(/\.[^.]+$/, '');
          try {
            const r = await addImageRecord({ ...base, name }, f);
            await setImageCollections(r.id, inCols);
            okCount++;
          } catch (err) {
            errors.push(`${f.name}: ${dbErrorMessage(err)}`);
            if (err?.name === 'QuotaExceededError') break;
          }
        }
        $('.bar i', prog).style.width = '100%';
        if (errors.length) toast(`حُفظت ${num(okCount)} صورة، وتعذّر حفظ ${num(errors.length)}: ${errors[0]}`, 'error');
        else toast(okCount > 1 ? `حُفظت ${num(okCount)} صور` : 'حُفظت الصورة', 'ok');
        if (!okCount) { submitBtn.disabled = false; prog.hidden = true; return; }
        requestPersistence();
      }
      hayCache_clear();
      await closeModal();
      if (onSaved) onSaved(); else rerender();
    } catch (err) {
      console.error(err);
      submitBtn.disabled = false;
      fail(dbErrorMessage(err));
    }
  };
  openModal(node, { onClose: () => previewURLs.forEach((u) => URL.revokeObjectURL(u)) });
}
let persistAsked = false;
async function requestPersistence() {
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* اختياري */ }
}

/* =========================================================
   10) عارض الصور
   ========================================================= */
function openViewer(startId, ids) {
  ids = ids.filter((x) => S.images.has(x));
  let idx = Math.max(0, ids.indexOf(startId));
  let fullURL = null;
  let dirty = false;
  const node = el(`<div class="viewer">
    <header class="v-head"><button class="icon-btn" type="button" data-close aria-label="رجوع" title="رجوع">${icon('back')}</button><div class="v-title" dir="auto"></div><span class="v-count"></span></header>
    <div class="v-stage"><button class="v-nav prev" type="button" aria-label="السابق">${icon('chev-right')}</button><div class="v-media"></div><button class="v-nav next" type="button" aria-label="التالي">${icon('chev-left')}</button></div>
    <aside class="v-info"></aside></div>`);
  const media = $('.v-media', node), info = $('.v-info', node);

  async function paint() {
    const img = S.images.get(ids[idx]);
    if (!img) return closeModal();
    $('.v-title', node).textContent = img.name;
    $('.v-count', node).textContent = `${idx + 1} / ${ids.length}`;
    $('.prev', node).disabled = idx === 0;
    $('.next', node).disabled = idx >= ids.length - 1;
    if (fullURL) { URL.revokeObjectURL(fullURL); fullURL = null; }
    media.innerHTML = '';
    if (img.kind === 'text') {
      media.append(el(`<div class="v-text ${img.text?.type === 'general' ? 'general' : ''}">${esc(img.text?.body || '')}</div>`));
    } else {
      const thumb = await thumbURL(img.id);
      const im = el(`<img alt="${esc(img.name)}" ${thumb ? `src="${thumb}"` : ''}>`);
      media.append(im);
      const f = await DB.get('files', img.id);
      if (f && ids[idx] === img.id) { fullURL = URL.createObjectURL(f.blob); im.src = fullURL; }
    }
    const sec = sectionById(img.sectionId), subj = img.subjectId ? S.subjects.get(img.subjectId) : null;
    const fs = img.categoryId ? catFilters(img.categoryId) || [] : [];
    const attrChips = Object.entries(img.attrs || {}).map(([k, val]) => {
      const f = fs.find((x) => x.key === k); const o = f?.options?.find((x) => x[0] === val);
      return `<span class="chip static"><span class="muted small">${esc(f?.label || k)}:</span> ${esc(o ? o[1] : val)}</span>`;
    }).join('');
    const cols = [...S.collections.values()].filter((c) => c.imageIds.includes(img.id));
    info.innerHTML = `
      <div><h2 dir="auto">${esc(img.name)}</h2>
        <div class="crumbs" style="margin-top:6px">${sec ? `<a href="#/s/${sec.id}" data-nav>${esc(sec.name)}</a>` : 'بدون قسم'}${subj ? ` › <a href="#/car/${subj.id}" data-nav dir="auto">${esc(subj.name)}</a>` : ''}${img.categoryId && S.categories.has(img.categoryId) ? ' › ' + esc(catPathLabel(img.categoryId)) : ''}</div></div>
      <div class="v-actions">
        <button class="btn ghost ${img.favorite ? 'on' : ''}" type="button" data-a="fav">${icon('heart')} ${img.favorite ? 'في المفضلة' : 'المفضلة'}</button>
        <button class="btn ghost" type="button" data-a="edit">${icon('edit')} تعديل</button>
        <button class="btn ghost" type="button" data-a="cols">${icon('layers')} المجموعات</button>
        ${img.kind === 'image' ? `<button class="btn ghost" type="button" data-a="dl">${icon('download')} تنزيل</button>` : `<button class="btn ghost" type="button" data-a="copytext">${icon('copy')} نسخ النص</button>`}
        ${subj && img.kind === 'image' ? `<button class="btn ghost" type="button" data-a="cover">${icon('car')} غلاف السيارة</button>` : ''}
        ${img.sourceUrl ? `<button class="btn ghost" type="button" data-a="copy">${icon('copy')} نسخ رابط المصدر</button><a class="btn ghost" href="${esc(img.sourceUrl)}" target="_blank" rel="noopener noreferrer">${icon('external')} الصورة الأصلية</a>` : ''}
        <button class="btn danger-ghost" type="button" data-a="del">${icon('trash')} حذف</button>
      </div>
      <dl class="meta">
        ${img.kind === 'text' ? `<div><dt>النوع والمصدر</dt><dd><span class="badge t-${img.text?.type}">${esc(TEXT_TYPES[img.text?.type]?.label || '')}</span> ${esc(textSourceLine(img))}</dd></div>` : ''}
        ${img.description ? `<div><dt>الوصف</dt><dd dir="auto" style="white-space:pre-wrap">${esc(img.description)}</dd></div>` : ''}
        ${img.keywords?.length ? `<div><dt>الكلمات المفتاحية</dt><dd class="chips wrap">${img.keywords.map((k) => `<a class="chip" href="#/search?q=${encodeURIComponent(k)}" data-nav>${esc(k)}</a>`).join('')}</dd></div>` : ''}
        ${attrChips ? `<div><dt>خيارات التصنيف</dt><dd class="chips wrap">${attrChips}</dd></div>` : ''}
        ${cols.length ? `<div><dt>ضمن المجموعات</dt><dd class="chips wrap">${cols.map((c) => `<a class="chip" href="#/collection/${c.id}" data-nav>${esc(c.name)}</a>`).join('')}</dd></div>` : ''}
        ${img.notes ? `<div><dt>ملاحظات</dt><dd class="notes" dir="auto">${esc(img.notes)}</dd></div>` : ''}
        ${img.sourceUrl ? `<div><dt>رابط المصدر</dt><dd class="src-line">${esc(img.sourceUrl)}</dd></div>` : ''}
        <div><dt>تاريخ الإضافة</dt><dd>${fmtDate(img.createdAt)}${img.updatedAt && img.updatedAt - img.createdAt > 60000 ? ` · آخر تعديل ${fmtDate(img.updatedAt)}` : ''}</dd></div>
        ${img.kind === 'image' ? `<div><dt>الملف</dt><dd class="small"><span dir="ltr">${num(img.width)}×${num(img.height)}</span> · ${fmtBytes(img.size)}${img.color ? ` · <span class="chip static" style="min-height:26px"><span class="sw" style="background:${esc(img.color.hex)}"></span>${colorLabel(img.color.name)}</span>` : ''}</dd></div>` : ''}
      </dl>`;
  }

  const step = (d) => { const n = idx + d; if (n >= 0 && n < ids.length) { idx = n; paint(); } };
  $('.prev', node).onclick = () => step(-1);
  $('.next', node).onclick = () => step(1);
  const onKey = (e) => {
    if (modals.at(-1)?.wrap !== node.parentElement) return;
    if (e.key === 'ArrowRight') step(-1);
    if (e.key === 'ArrowLeft') step(1);
  };
  document.addEventListener('keydown', onKey);
  let sx = null, sy = null;
  const stage = $('.v-stage', node);
  stage.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx > 0 ? 1 : -1);
    sx = null;
  });

  info.addEventListener('click', async (e) => {
    const nav = e.target.closest('a[data-nav]');
    if (nav) { e.preventDefault(); const h = nav.getAttribute('href'); await closeModal(); go(h); return; }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const img = S.images.get(ids[idx]);
    const a = b.dataset.a;
    if (a === 'fav') { await toggleFavorite(img.id); dirty = true; paint(); }
    if (a === 'edit') openImageForm({ id: img.id, onSaved: () => { dirty = true; paint(); } });
    if (a === 'cols') { if (await collectionsDialog(img.id)) { dirty = true; paint(); } }
    if (a === 'dl') {
      const f = await DB.get('files', img.id);
      if (!f) return toast('تعذّر العثور على الملف', 'error');
      const ext = (img.fileName?.match(/\.[^.]+$/) || ['.' + (f.blob.type.split('/')[1] || 'jpg')])[0];
      downloadBlob(f.blob, (img.name || 'image') + ext);
    }
    if (a === 'copytext') { await copyText(`${img.text.body}\n— ${textSourceLine(img)}`); toast('نُسخ النص', 'ok'); }
    if (a === 'copy') { await copyText(img.sourceUrl); toast('نُسخ رابط المصدر', 'ok'); }
    if (a === 'cover') { const s = S.subjects.get(img.subjectId); s.coverId = img.id; await DB.put('subjects', s); dirty = true; toast('عُيّنت غلافاً للسيارة', 'ok'); }
    if (a === 'del') {
      const ok = await confirmDialog({ title: 'حذف نهائي', message: `سيُحذف «${esc(img.name)}» نهائياً من هذا الجهاز ومن كل المجموعات. لا يمكن التراجع.`, confirmText: 'حذف نهائي', danger: true });
      if (!ok) return;
      await deleteImages([img.id]);
      dirty = true;
      toast('حُذف العنصر', 'ok');
      ids.splice(idx, 1);
      if (!ids.length) return closeModal();
      if (idx >= ids.length) idx = ids.length - 1;
      paint();
    }
  });

  openModal(node, {
    cls: 'viewer-wrap',
    onClose: () => {
      document.removeEventListener('keydown', onKey);
      if (fullURL) URL.revokeObjectURL(fullURL);
      if (dirty) rerender();
    },
  });
  paint();
}
function collectionsDialog(imageId) {
  return new Promise((resolve) => {
    const cur = [...S.collections.values()].filter((c) => c.imageIds.includes(imageId)).map((c) => c.id);
    let saved = false;
    const node = el(`<div class="dialog small"><header class="dlg-head"><h2>المجموعات</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
      <div class="dlg-body"><p>اختر المجموعات التي يظهر فيها هذا العنصر:</p><div class="chips wrap"></div></div>
      <footer class="dlg-foot"><button type="button" class="btn ghost" data-close>إلغاء</button><button type="button" class="btn primary" data-ok>حفظ</button></footer></div>`);
    const box = $('.chips', node);
    const paint = () => {
      box.innerHTML = '';
      [...S.collections.values()].forEach((c) => {
        const b = el(`<button type="button" class="chip ${cur.includes(c.id) ? 'active' : ''}" aria-pressed="${cur.includes(c.id)}">${esc(c.name)}</button>`);
        b.onclick = () => { const i = cur.indexOf(c.id); if (i >= 0) cur.splice(i, 1); else cur.push(c.id); paint(); };
        box.append(b);
      });
      const nb = el(`<button type="button" class="chip">${icon('plus')} مجموعة جديدة</button>`);
      nb.onclick = async () => { const c = await collectionForm(); if (c) { cur.push(c.id); paint(); } };
      box.append(nb);
    };
    paint();
    $('[data-ok]', node).onclick = async () => { await setImageCollections(imageId, cur); saved = true; toast('حُفظت المجموعات', 'ok'); closeModal(); };
    openModal(node, { onClose: () => resolve(saved) });
  });
}

/* =========================================================
   11) الإعدادات
   ========================================================= */
async function renderSettings(v, _m, params) {
  S.ctx = {};
  v.append(el(`<div class="page-head"><div><h1>${icon('settings')} الإعدادات</h1><p class="sub">المظهر، الأقسام، المساحة الخاصة، البيانات والنسخ الاحتياطي.</p></div></div>`));
  const wrap = el('<div class="settings"></div>');
  v.append(wrap);

  // الحساب المحلي
  const prof = el(`<section class="set-card" id="profile"><h2>${icon('user')} الحساب المحلي</h2><p class="hint">اسم وصورة تظهر في الواجهة على هذا الجهاز فقط.</p>
    <div class="profile-row"><span class="avatar" data-av></span>
      <label class="field" style="flex:1;min-width:180px"><span>الاسم</span><input class="input" name="pname" maxlength="40" value="${esc(S.settings.profileName)}" placeholder="اسمك"></label>
      <label class="btn ghost small file-btn">${icon('image')} تغيير الصورة<input type="file" accept="image/*"></label>
      <button class="btn ghost small" type="button" data-rm-av ${S.settings.avatar ? '' : 'hidden'}>إزالة الصورة</button></div></section>`);
  wrap.append(prof);
  const paintAv = () => { const u = S.settings.avatar ? URL.createObjectURL(S.settings.avatar) : null; $('[data-av]', prof).innerHTML = u ? `<img src="${u}" alt="">` : icon('user'); };
  paintAv();
  $('[name=pname]', prof).onchange = async (e) => { await setSetting('profileName', e.target.value.trim()); applyProfile(); toast('حُفظ الاسم', 'ok'); };
  $('input[type=file]', prof).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const bmp = await decodeImage(f);
      const c = document.createElement('canvas'); c.width = c.height = 160;
      const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, s = Math.min(w, h);
      c.getContext('2d').drawImage(bmp, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 160, 160);
      await setSetting('avatar', await canvasToBlob(c, 'image/jpeg', 0.9));
      paintAv(); applyProfile(); $('[data-rm-av]', prof).hidden = false; toast('حُفظت الصورة', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('[data-rm-av]', prof).onclick = async (e) => { await setSetting('avatar', null); paintAv(); applyProfile(); e.target.hidden = true; };

  // المظهر
  const look = el(`<section class="set-card"><h2>${icon('sun')} المظهر</h2>
    <div class="set-row"><div class="lbl"><b>الوضع</b><small>النهاري أو الليلي أو حسب إعداد الجهاز</small></div><div class="seg" data-theme-seg>
      <button type="button" data-v="light">${icon('sun')} نهاري</button><button type="button" data-v="dark">${icon('moon')} ليلي</button><button type="button" data-v="auto">تلقائي</button></div></div>
    <div class="set-row"><div class="lbl"><b>حجم عرض الصور</b><small>عدد الأعمدة في الشبكة</small></div><div class="seg" data-grid-seg>
      <button type="button" data-v="small">صغير</button><button type="button" data-v="medium">متوسط</button><button type="button" data-v="large">كبير</button></div></div>
    <div class="set-row"><div class="lbl"><b>اللغة</b><small>الواجهة الإنجليزية مخطط لها في إصدار قادم</small></div><select class="select" style="width:auto" aria-label="اللغة"><option>العربية</option><option disabled>English — قريباً</option></select></div></section>`);
  wrap.append(look);
  const segs = (sel, key, after) => {
    const box = $(sel, look);
    const paint = () => $$('button', box).forEach((b) => b.classList.toggle('active', b.dataset.v === S.settings[key]));
    $$('button', box).forEach((b) => { b.onclick = async () => { await setSetting(key, b.dataset.v); paint(); after?.(); }; });
    paint();
  };
  segs('[data-theme-seg]', 'theme', applyTheme);
  segs('[data-grid-seg]', 'gridSize');

  // الأقسام
  const secs = el(`<section class="set-card"><h2>${icon('grid')} الأقسام</h2><p class="hint">تحكّم في ظهور الأقسام في الصفحة الرئيسية، أو أنشئ أقساماً جديدة.</p><div data-rows></div>
    <div style="margin-top:12px"><button class="btn ghost small" type="button" data-new-sec>${icon('plus')} قسم جديد</button></div></section>`);
  wrap.append(secs);
  S.sections.filter((s) => s.id !== 'private').forEach((s) => {
    const r = el(`<div class="set-row"><div class="lbl"><b>${esc(s.name)}</b><small>${num(sectionCount(s.id))} عنصر${s.builtin ? '' : ' · قسم أنشأته'}</small></div>
      <span style="display:flex;gap:8px;align-items:center">${s.builtin ? '' : `<button class="icon-btn" type="button" data-del aria-label="حذف القسم">${icon('trash')}</button>`}
      <label class="switch"><input type="checkbox" ${sectionVisible(s.id) ? 'checked' : ''} aria-label="إظهار ${esc(s.name)}"><i></i></label></span></div>`);
    $('input', r).onchange = async (e) => { await setSetting('sectionVisible', { ...S.settings.sectionVisible, [s.id]: e.target.checked }); toast(e.target.checked ? 'سيظهر القسم' : 'أُخفي القسم من الرئيسية', 'ok'); };
    $('[data-del]', r)?.addEventListener('click', async () => { if (await deleteSection(s)) rerender(); });
    $('[data-rows]', secs).append(r);
  });
  $('[data-new-sec]', secs).onclick = newSectionFlow;

  // المساحة الخاصة
  const priv = el(`<section class="set-card"><h2>${icon('lock')} المساحة الخاصة</h2>
    <div class="set-row"><div class="lbl"><b>إظهارها في قائمة الأقسام</b><small>عند الإخفاء لا تظهر إلا من هنا. تطلب كلمة المرور دائماً.</small></div><label class="switch"><input type="checkbox" ${S.settings.privateShowInList ? 'checked' : ''} aria-label="إظهار المساحة الخاصة"><i></i></label></div>
    <div class="set-row"><div class="lbl"><b>الحالة</b><small>${S.unlocked ? 'مفتوحة في هذه الجلسة' : 'مقفلة'} · ${S.settings.privateHash ? 'كلمة المرور معيّنة' : 'لم تُعيَّن كلمة مرور بعد'}</small></div>
      <span style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost small" href="#/s/private">${icon('unlock')} فتح المساحة</a>${S.unlocked ? `<button class="btn ghost small" type="button" data-lock>${icon('lock')} قفل الآن</button>` : ''}
      <button class="btn ghost small" type="button" data-pass>${S.settings.privateHash ? 'تغيير كلمة المرور' : 'تعيين كلمة مرور'}</button></span></div>
    <div class="notice" style="margin-top:8px">${icon('info')}<div class="grow small">${PRIVATE_NOTICE}</div></div></section>`);
  wrap.append(priv);
  $('.switch input', priv).onchange = async (e) => { await setSetting('privateShowInList', e.target.checked); toast('حُفظ', 'ok'); };
  $('[data-lock]', priv)?.addEventListener('click', () => { S.unlocked = false; toast('قُفلت المساحة الخاصة', 'ok'); rerender(); });
  $('[data-pass]', priv).onclick = changePasswordFlow;

  // التخزين والبيانات
  const data = el(`<section class="set-card"><h2>${icon('download')} البيانات والتخزين</h2><p class="hint">كل البيانات محفوظة في هذا المتصفح على هذا الجهاز. لا توجد مزامنة تلقائية.</p>
    <div class="stat-grid" data-stats></div><div data-quota></div>
    <div class="set-row"><div class="lbl"><b>تخزين دائم</b><small data-persist>جاري الفحص…</small></div><button class="btn ghost small" type="button" data-persist-btn>طلب التخزين الدائم</button></div>
    <div class="set-row"><div class="lbl"><b>نسخة احتياطية</b><small>ملف JSON يحتوي كل الصور والبيانات، يمكن استيراده على جهاز آخر.</small></div>
      <span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary small" type="button" data-export>${icon('download')} تصدير</button>
      <label class="btn ghost small file-btn">${icon('upload')} استيراد<input type="file" accept="application/json,.json"></label></span></div>
    <div class="set-row"><div class="lbl"><b>حذف كل الصور</b><small>يحذف الصور والنصوص فقط، ويُبقي الأقسام والتصنيفات والمجموعات.</small></div><button class="btn danger-ghost small" type="button" data-wipe>${icon('trash')} حذف الصور</button></div>
    <div class="set-row"><div class="lbl"><b>إعادة ضبط فسيفساء</b><small>يحذف كل شيء ويعيد المشروع إلى حالته الأولى.</small></div><button class="btn danger small" type="button" data-reset>إعادة الضبط</button></div></section>`);
  wrap.append(data);
  const imgs = [...S.images.values()];
  const bytes = imgs.reduce((a, i) => a + (i.size || 0), 0);
  $('[data-stats]', data).innerHTML = [
    [num(imgs.filter((i) => i.kind === 'image').length), 'صورة'], [num(imgs.filter((i) => i.kind === 'text').length), 'نص'],
    [num(S.collections.size), 'مجموعة'], [num(imgs.filter((i) => i.favorite).length), 'في المفضلة'], [fmtBytes(bytes), 'حجم الصور الأصلية'],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><small>${s}</small></div>`).join('');
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage = 0, quota = 0 }) => {
      const pct = quota ? Math.min(100, (usage / quota) * 100) : 0;
      $('[data-quota]', data).innerHTML = `<p class="small muted" style="margin-top:12px">المساحة المستخدمة في المتصفح: <b>${fmtBytes(usage)}</b>${quota ? ` من أصل ${fmtBytes(quota)} متاحة تقريباً (${pct.toFixed(1)}%)` : ''}</p><div class="meter"><i style="width:${Math.max(1, pct)}%"></i></div>`;
    }).catch(() => {});
  }
  const paintPersist = async () => {
    const ok = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    $('[data-persist]', data).textContent = ok ? 'مفعّل: لن يحذف المتصفح بياناتك تلقائياً عند امتلاء الجهاز.' : 'غير مفعّل: قد يحذف المتصفح البيانات عند امتلاء الجهاز أو بعد فترة طويلة دون استخدام (خصوصاً في Safari). ثبّت الموقع على الشاشة الرئيسية وصدّر نسخة احتياطية.';
    $('[data-persist-btn]', data).hidden = ok || !navigator.storage?.persist;
  };
  paintPersist();
  $('[data-persist-btn]', data).onclick = async () => {
    const ok = await navigator.storage.persist().catch(() => false);
    toast(ok ? 'فُعّل التخزين الدائم' : 'لم يوافق المتصفح حالياً؛ تثبيت الموقع كتطبيق يزيد فرصة الموافقة', ok ? 'ok' : 'error');
    paintPersist();
  };
  $('[data-export]', data).onclick = exportBackup;
  $('input[type=file]', data).onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };
  $('[data-wipe]', data).onclick = async () => {
    if (!(await confirmDialog({ title: 'حذف كل الصور', message: `سيُحذف ${num(imgs.length)} عنصر نهائياً من هذا الجهاز. ننصح بتصدير نسخة احتياطية أولاً.`, confirmText: 'حذف الكل', danger: true, requireText: 'حذف' }))) return;
    await DB.batch(['images', 'files', 'thumbs', 'collections', 'subjects'], (st) => {
      ['images', 'files', 'thumbs'].forEach((n) => st(n).clear());
      S.collections.forEach((c) => { c.imageIds = []; c.coverId = null; st('collections').put(c); });
      S.subjects.forEach((s) => { s.coverId = null; st('subjects').put(s); });
    });
    thumbURLs.forEach((u) => typeof u === 'string' && URL.revokeObjectURL(u)); thumbURLs.clear();
    S.images.clear(); toast('حُذفت كل الصور', 'ok'); rerender();
  };
  $('[data-reset]', data).onclick = async () => {
    if (!(await confirmDialog({ title: 'إعادة ضبط فسيفساء', message: 'سيُحذف كل شيء: الصور، الأقسام الجديدة، التصنيفات المعدلة، المجموعات، الإعدادات وكلمة مرور المساحة الخاصة.', confirmText: 'إعادة الضبط', danger: true, requireText: 'إعادة ضبط' }))) return;
    await DB.batch(['images', 'files', 'thumbs', 'sections', 'categories', 'subjects', 'collections', 'settings'], (st) => ['images', 'files', 'thumbs', 'sections', 'categories', 'subjects', 'collections', 'settings'].forEach((n) => st(n).clear()));
    try { localStorage.removeItem('fsf-theme'); } catch { /* */ }
    location.hash = '#/'; location.reload();
  };

  // العمل دون إنترنت
  const off = el(`<section class="set-card"><h2>${icon('wifi-off')} العمل دون إنترنت</h2><div class="set-row"><div class="lbl"><b data-off-title></b><small data-off-text></small></div><button class="btn ghost small" type="button" data-check>${icon('refresh')} فحص</button></div></section>`);
  wrap.append(off);
  const paintOff = async () => {
    const ready = await checkOfflineReady();
    $('[data-off-title]', off).innerHTML = `<span class="status-dot ${ready ? 'ok' : 'warn'}"></span>${ready ? 'جاهز للعمل دون إنترنت' : 'غير جاهز بعد'}`;
    $('[data-off-text]', off).textContent = ready
      ? 'خُزّنت ملفات الواجهة على هذا الجهاز. يمكنك فتح الموقع وتصفح مكتبتك والبحث فيها دون اتصال. البحث في Pinterest وحده يحتاج إنترنت.'
      : swUnsupportedReason() || 'يجري تخزين ملفات الواجهة الآن. افتح الموقع مرة واحدة وأنت متصل، ثم اضغط «فحص».';
  };
  paintOff();
  $('[data-check]', off).onclick = paintOff;

  // حول
  wrap.append(el(`<section class="set-card"><h2>${icon('info')} عن فسيفساء</h2>
    <p><b>فسيفساء | FUSAYFISA</b> — الإصدار ${APP_VERSION}</p><p class="muted" style="margin:6px 0 10px">«كل فكرة لها صورة، وكل صورة لها مكان». مكتبتك البصرية الخاصة، تجمع اهتماماتك وصورك وأفكارك في مكان واحد.</p>
    <ul class="small muted" style="margin:0;padding-inline-start:18px;display:grid;gap:4px">
      <li>كل الصور والبيانات تبقى في متصفحك على هذا الجهاز؛ لا تُرفع إلى أي خادم.</li>
      <li>البحث الخارجي يفتح صفحة نتائج Pinterest فقط، ولا يجلب الصور آلياً؛ احترم حقوق أصحاب الصور وشروط Pinterest.</li>
      <li>الموقع المنشور على GitHub Pages متاح للعامة، لكن صورك لا تُنشر لأنها مخزنة محلياً عندك فقط.</li>
    </ul></section>`));

  if (params.get('profile')) requestAnimationFrame(() => { prof.scrollIntoView({ block: 'start' }); $('[name=pname]', prof).focus({ preventScroll: true }); });
}
async function changePasswordFlow() {
  const has = !!S.settings.privateHash;
  const node = el(`<form class="dialog small" novalidate><header class="dlg-head"><h2>${has ? 'تغيير كلمة المرور' : 'تعيين كلمة مرور'}</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
    <div class="dlg-body">${has ? '<label class="field"><span>كلمة المرور الحالية</span><input class="input" type="password" name="old" autocomplete="current-password" autofocus></label>' : ''}
      <label class="field"><span>كلمة المرور الجديدة</span><input class="input" type="password" name="p1" autocomplete="new-password" ${has ? '' : 'autofocus'}></label>
      <label class="field"><span>تأكيد كلمة المرور</span><input class="input" type="password" name="p2" autocomplete="new-password"></label><p class="err" hidden></p></div>
    <footer class="dlg-foot"><button type="button" class="btn ghost" data-close>إلغاء</button><button type="submit" class="btn primary">حفظ</button></footer></form>`);
  const err = $('.err', node);
  node.onsubmit = async (e) => {
    e.preventDefault();
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (has && !(await checkPrivatePassword(node.old.value))) return fail('كلمة المرور الحالية غير صحيحة');
    if (node.p1.value.length < 4) return fail('كلمة المرور قصيرة جداً (4 أحرف على الأقل)');
    if (node.p1.value !== node.p2.value) return fail('كلمتا المرور غير متطابقتين');
    await setPrivatePassword(node.p1.value);
    toast('حُفظت كلمة المرور', 'ok');
    await closeModal();
    rerender();
  };
  openModal(node);
}

/* ---------- النسخ الاحتياطي ---------- */
async function exportBackup() {
  const privCount = [...S.images.values()].filter((i) => i.sectionId === 'private').length;
  let includePrivate = true;
  if (privCount && !S.unlocked) {
    const ok = await confirmDialog({ title: 'المساحة الخاصة مقفلة', message: `لتضمين ${num(privCount)} عنصر من المساحة الخاصة افتحها أولاً. هل تريد المتابعة بتصدير بقية المكتبة بدونها؟`, confirmText: 'تصدير بدونها' });
    if (!ok) return;
    includePrivate = false;
  }
  toast('جاري تجهيز النسخة الاحتياطية…');
  try {
    const settings = { ...S.settings, avatar: S.settings.avatar ? await blobToDataURL(S.settings.avatar) : null };
    const parts = [`{"app":"fusayfisa","format":1,"version":${JSON.stringify(APP_VERSION)},"exportedAt":${Date.now()},`,
      `"sections":${JSON.stringify(S.sections)},"categories":${JSON.stringify([...S.categories.values()])},"subjects":${JSON.stringify([...S.subjects.values()])},`,
      `"collections":${JSON.stringify([...S.collections.values()])},"settings":${JSON.stringify(settings)},"images":[`];
    let first = true;
    for (const img of S.images.values()) {
      if (!includePrivate && img.sectionId === 'private') continue;
      const obj = { ...img };
      if (img.kind === 'image') {
        const [f, t] = await Promise.all([DB.get('files', img.id), DB.get('thumbs', img.id)]);
        obj.__file = f ? await blobToDataURL(f.blob) : null;
        obj.__thumb = t ? await blobToDataURL(t.blob) : null;
      }
      parts.push((first ? '' : ',') + JSON.stringify(obj));
      first = false;
    }
    parts.push(']}');
    const d = new Date();
    downloadBlob(new Blob(parts, { type: 'application/json' }), `fusayfisa-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`);
    toast('جُهّزت النسخة الاحتياطية', 'ok');
  } catch (err) { toast('تعذّر التصدير: ' + dbErrorMessage(err), 'error'); }
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('الملف ليس نسخة احتياطية صالحة', 'error'); }
  if (data?.app !== 'fusayfisa' || !Array.isArray(data.images)) return toast('هذا الملف ليس نسخة احتياطية من فسيفساء', 'error');
  const mode = await new Promise((resolve) => {
    let r = null;
    const node = el(`<div class="dialog small"><header class="dlg-head"><h2>استيراد نسخة احتياطية</h2><button type="button" class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button></header>
      <div class="dlg-body"><p>تحتوي النسخة على ${num(data.images.length)} عنصر و${num((data.collections || []).length)} مجموعة. كيف تريد استيرادها؟</p>
      <p class="small"><b>دمج:</b> يضيفها إلى مكتبتك الحالية (العناصر المتطابقة تُستبدل).<br><b>استبدال:</b> يحذف مكتبتك الحالية كاملة ثم يستورد النسخة.</p></div>
      <footer class="dlg-foot"><button type="button" class="btn ghost" data-close>إلغاء</button><button type="button" class="btn danger-ghost" data-m="replace">استبدال</button><button type="button" class="btn primary" data-m="merge">دمج</button></footer></div>`);
    $$('[data-m]', node).forEach((b) => { b.onclick = () => { r = b.dataset.m; closeModal(); }; });
    openModal(node, { onClose: () => resolve(r) });
  });
  if (!mode) return;
  if (mode === 'replace' && !(await confirmDialog({ title: 'تأكيد الاستبدال', message: 'ستُحذف مكتبتك الحالية بالكامل قبل الاستيراد.', confirmText: 'استبدال', danger: true, requireText: 'استبدال' }))) return;
  toast('جاري الاستيراد… لا تغلق الصفحة');
  try {
    if (mode === 'replace') await DB.batch(['images', 'files', 'thumbs', 'sections', 'categories', 'subjects', 'collections'], (st) => ['images', 'files', 'thumbs', 'sections', 'categories', 'subjects', 'collections'].forEach((n) => st(n).clear()));
    await DB.batch(['sections', 'categories', 'subjects', 'collections'], (st) => {
      (data.sections || []).forEach((x) => st('sections').put(x));
      (data.categories || []).forEach((x) => st('categories').put(x));
      (data.subjects || []).forEach((x) => st('subjects').put(x));
      (data.collections || []).forEach((x) => {
        if (mode === 'merge' && S.collections.has(x.id)) x.imageIds = [...new Set([...S.collections.get(x.id).imageIds, ...x.imageIds])];
        st('collections').put(x);
      });
    });
    let n = 0;
    for (const raw of data.images) {
      const { __file, __thumb, ...rec } = raw;
      const file = __file ? await dataURLToBlob(__file) : null;
      const thumb = __thumb ? await dataURLToBlob(__thumb) : null;
      await DB.batch(['images', 'files', 'thumbs'], (st) => {
        st('images').put(rec);
        if (file) st('files').put({ id: rec.id, blob: file });
        if (thumb) st('thumbs').put({ id: rec.id, blob: thumb });
      });
      thumbURLs.delete(rec.id);
      n++;
    }
    if (mode === 'replace' && data.settings) {
      const s = { ...data.settings };
      if (s.avatar) s.avatar = await dataURLToBlob(s.avatar);
      await DB.batch(['settings'], (st) => { st('settings').clear(); Object.entries(s).forEach(([key, value]) => st('settings').put({ key, value })); st('settings').put({ key: 'seeded', value: true }); });
    }
    await loadAll();
    S.unlocked = false;
    applyTheme(); applyProfile();
    toast(`اكتمل الاستيراد: ${num(n)} عنصر`, 'ok');
    go('#/'); rerender();
  } catch (err) {
    console.error(err);
    toast('تعذّر إكمال الاستيراد: ' + dbErrorMessage(err), 'error');
    await loadAll(); rerender();
  }
}

/* =========================================================
   12) العمل دون إنترنت (Service Worker)
   ========================================================= */
function swUnsupportedReason() {
  if (!('serviceWorker' in navigator)) return 'هذا المتصفح لا يدعم العمل دون إنترنت (Service Worker).';
  if (!window.isSecureContext) return 'العمل دون إنترنت يتطلب فتح الموقع عبر https (مثل GitHub Pages) أو localhost.';
  return '';
}
async function checkOfflineReady() {
  if (swUnsupportedReason() || !('caches' in window)) return false;
  try {
    if (!navigator.serviceWorker.controller) return false;
    const results = await Promise.all(SHELL_FILES.map((p) => caches.match(new URL(p, location.href).href)));
    S.offlineReady = results.every(Boolean);
    return S.offlineReady;
  } catch { return false; }
}
function registerSW() {
  if (swUnsupportedReason()) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => console.warn('SW:', err));
  navigator.serviceWorker.addEventListener('message', async (e) => {
    if (e.data?.type === 'SHELL_CACHED') {
      await sleep(300);
      let shown = false;
      try { shown = localStorage.getItem('fsf-offline-toast') === APP_VERSION; } catch { /* */ }
      if (!shown && (await checkOfflineReady())) {
        toast('أصبح فسيفساء جاهزاً للعمل دون إنترنت على هذا الجهاز', 'ok');
        try { localStorage.setItem('fsf-offline-toast', APP_VERSION); } catch { /* */ }
      }
    }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('يتوفر تحديث جديد لفسيفساء', '', { label: 'تحديث الآن', run: () => location.reload() });
  });
}

/* =========================================================
   13) التهيئة
   ========================================================= */
function applyTheme() {
  let t = S.settings.theme || 'auto';
  try { localStorage.setItem('fsf-theme', t); } catch { /* */ }
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
}
let avatarURL = null;
function applyProfile() {
  const a = $('#avatarBtn');
  if (avatarURL) URL.revokeObjectURL(avatarURL);
  avatarURL = S.settings.avatar ? URL.createObjectURL(S.settings.avatar) : null;
  a.innerHTML = avatarURL ? `<img src="${avatarURL}" alt="">` : icon('user');
  a.title = S.settings.profileName ? `الحساب المحلي: ${S.settings.profileName}` : 'الحساب المحلي';
}
function updateNetBanner() { $('#netBanner').hidden = navigator.onLine; }

async function init() {
  try {
    await DB.open();
    await loadAll();
    await ensureSeed();
  } catch (err) {
    console.error(err);
    $('#main').innerHTML = `<div class="empty">${icon('info')}<h3>تعذّر فتح مكتبة الصور</h3><p>${esc(dbErrorMessage(err))}. إن كنت تستخدم التصفح الخاص فجرّب نافذة عادية.</p></div>`;
    return;
  }
  applyTheme();
  applyProfile();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => S.settings.theme === 'auto' && applyTheme());

  // أزرار الإضافة في كل مكان
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="add"]');
    if (b) { e.preventDefault(); openImageForm(); }
  });
  $('#topSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    UI.search.q = q;
    go('#/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (parseHash().path === '/search') rerender();
  });
  // سحب وإفلات صور على الصفحة لفتح نموذج الإضافة مباشرة
  document.addEventListener('dragover', (e) => { if (!modals.length && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (modals.length || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    openImageForm({ preset: { files: e.dataTransfer.files } });
  });
  window.addEventListener('hashchange', () => {
    // تنظيف أي نوافذ متبقية عند التنقل
    while (modals.length) { const m = modals.pop(); m.wrap.remove(); try { m.onClose?.(); } catch { /* */ } }
    document.body.classList.remove('modal-open');
    router();
  });
  window.addEventListener('online', updateNetBanner);
  window.addEventListener('offline', updateNetBanner);
  updateNetBanner();
  await router();
  registerSW();
}
init();
