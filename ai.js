/* =========================================================
   فسيفساء — الذكاء المحلي (MobileCLIP يعمل داخل المتصفح)
   - يحوّل كل صورة إلى «بصمة معنى» (embedding) تُحفظ معها.
   - من البصمات: الصور المشابهة، البحث بالمعنى، والتصنيف التلقائي.
   - لا تُرسل أي صورة لأي خادم. يُنزَّل النموذج مرة واحدة (~66 ميجا) ثم يعمل دون إنترنت.
   ========================================================= */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1';
const MODEL = 'Xenova/mobileclip_s0';
export const MODEL_TAG = 'mobileclip_s0-fp16@2';

let T = null, proc = null, vis = null, tok = null, txt = null;
let visP = null, txtP = null;
const progress = {};
let onProgress = () => {};
export function setProgressHandler(fn) { onProgress = fn || (() => {}); }
const pc = (p) => {
  if (!p.file || !/\.onnx$/.test(p.file)) return;
  if (p.status === 'progress') progress[p.file] = [p.loaded || 0, p.total || 0];
  if (p.status === 'done' && progress[p.file]) progress[p.file][0] = progress[p.file][1];
  const v = Object.values(progress);
  onProgress(v.reduce((a, x) => a + x[0], 0), v.reduce((a, x) => a + x[1], 0));
};

async function lib() {
  if (!T) {
    T = await import(LIB);
    T.env.allowLocalModels = false;
    T.env.useBrowserCache = true; // النموذج يُحفظ في ذاكرة المتصفح بعد أول تنزيل
    if (T.env.backends?.onnx?.wasm) T.env.backends.onnx.wasm.numThreads = 1;
  }
  return T;
}
export function loadVision() {
  visP ||= (async () => {
    await lib();
    [proc, vis] = await Promise.all([
      T.AutoProcessor.from_pretrained(MODEL),
      // تنبيه: نسخة q8 من نموذج الرؤية تعطي نتائج عشوائية (اختُبر)، لذلك fp16 (~23 ميجا)
      T.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'fp16', progress_callback: pc }),
    ]);
  })().catch((e) => { visP = null; throw e; });
  return visP;
}
export function loadText() {
  txtP ||= (async () => {
    await lib();
    [tok, txt] = await Promise.all([
      T.AutoTokenizer.from_pretrained(MODEL),
      T.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', progress_callback: pc }),
    ]);
  })().catch((e) => { txtP = null; throw e; });
  return txtP;
}

function unit(data) {
  let n = 0;
  for (let i = 0; i < data.length; i++) n += data[i] * data[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] / n;
  return out;
}
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export async function embedImage(blob) {
  await loadVision();
  const image = await T.RawImage.fromBlob(blob);
  const { image_embeds } = await vis(await proc(image));
  return unit(image_embeds.data);
}
export async function embedTexts(texts) {
  await loadText();
  const inputs = tok(texts, { padding: 'max_length', truncation: true });
  const { text_embeds } = await txt(inputs);
  const d = text_embeds.dims[1];
  return texts.map((_, i) => unit(text_embeds.data.subarray(i * d, (i + 1) * d)));
}

/* ---------- التصنيف: كل «سؤال» له إجابات متنافية، وكل إجابة لها عدة أوصاف ----------
   النتيجة تُقبل فقط إذا كانت واثقة (أعلى احتمال ≥ min). غير ذلك: لا تصنيف (غير مصنف). */
// الأوصاف والحدود معايرة على 88 صورة حقيقية (48 رسم/أنمي، 40 صورة بشرية منها كوسبلاي وصور قديمة)
export const QUESTIONS = [
  { id: 'kind', min: 0.7, answers: { // 87/88 صحيح، 1 غير متأكد، 0 خطأ
    anime: ['an anime illustration', 'a manga style drawing of a character', 'a digital painting of a fantasy character', 'a cartoon drawing', 'a 2D illustration'],
    photo: ['a photograph of a real woman', 'a real photo of a person', 'a photo of a cosplayer in costume at a convention', 'a real person wearing a wig and costume', 'an old black and white photograph of a woman', 'a selfie of a woman'],
  } },
  { id: 'agender', group: 'anime', min: 0.62, answers: { // 15/18 صحيح، 3 غير متأكد، 0 خطأ
    'شخصيات نسائية': ['an anime girl', 'a female anime character', 'an anime woman with long hair'],
    'شخصيات رجالية': ['an anime boy', 'a male anime character', 'an anime man'],
    'الخلفيات': ['anime background scenery with no people', 'an anime landscape without characters'],
  } },
  { id: 'aframe', group: 'anime', min: 0.8, answers: { // 7/19 صحيح، 11 غير متأكد، 1 خطأ: يصنف فقط إذا كان واثقاً جداً
    'البورتريه': ['a close-up drawing of a character face'],
    'من الخصر للأعلى': ['a drawing of the upper body of a character'],
    'الجسم كاملاً': ['a full body drawing of a character with feet visible', 'a character standing, legs and shoes visible'],
  } },
  { id: 'wframe', group: 'women', min: 0.8, answers: { // 14/29 صحيح، 13 غير متأكد، 2 خطأ
    'بورتريه': ['a close-up photo of a face'],
    'من الخصر للأعلى': ['a photo of the upper body of a woman'],
    'الجسم كاملاً': ['a full body shot of a woman with her feet visible', 'a woman standing, legs and shoes visible'],
  } },
  { id: 'wshoot', group: 'women', min: 0.62, answers: { // 9/10 صحيح، 1 غير متأكد، 0 خطأ
    'تصوير احترافي': ['a professional photoshoot with studio lighting', 'a professional fashion magazine photo'],
    'تصوير طبيعي': ['a casual candid phone photo', 'an amateur everyday snapshot', 'a mirror selfie'],
  } },
  { id: 'wplace', group: 'women', min: 0.62, answers: { // 24/26 صحيح، 1 غير متأكد، 1 خطأ
    'استوديو': ['a photo taken in a studio with a plain backdrop'],
    'خارجي': ['a photo taken outdoors in the street or nature'],
  } },
];

let labelCache = null; // { qid: { answer: [emb...] } }
/** يرجع أوصاف التصنيف كبصمات. saved: نسخة محفوظة سابقاً. save: نسخة جديدة للحفظ (أو null). */
export async function labelEmbeddings(saved) {
  const sig = MODEL_TAG + JSON.stringify(QUESTIONS);
  if (labelCache) return { labels: labelCache, save: null };
  if (saved && saved.sig === sig) {
    labelCache = {};
    for (const [qid, q] of Object.entries(saved.data)) { labelCache[qid] = {}; for (const k in q) labelCache[qid][k] = q[k].map((a) => Float32Array.from(a)); }
    return { labels: labelCache, save: null };
  }
  const flat = [];
  QUESTIONS.forEach((q) => Object.entries(q.answers).forEach(([a, ps]) => ps.forEach((p) => flat.push([q.id, a, p]))));
  const embs = await embedTexts(flat.map((x) => x[2]));
  labelCache = {};
  flat.forEach(([qid, a], i) => { ((labelCache[qid] ||= {})[a] ||= []).push(embs[i]); });
  const data = {};
  for (const [qid, q] of Object.entries(labelCache)) { data[qid] = {}; for (const k in q) data[qid][k] = q[k].map((e) => Array.from(e, (x) => +x.toFixed(5))); }
  return { labels: labelCache, save: { sig, data } };
}

/** احتمالات كل إجابة لسؤال واحد (softmax على أعلى تشابه لكل إجابة، بمقياس CLIP) */
export function answer(emb, labels, q) {
  const names = Object.keys(q.answers);
  const sims = names.map((n) => Math.max(...labels[q.id][n].map((e) => dot(emb, e))));
  const ex = sims.map((s) => Math.exp(100 * s));
  const sum = ex.reduce((a, b) => a + b, 0);
  const probs = ex.map((x) => x / sum);
  const best = probs.indexOf(Math.max(...probs));
  return { label: probs[best] >= q.min ? names[best] : null, p: probs[best], probs: Object.fromEntries(names.map((n, i) => [n, +probs[i].toFixed(3)])) };
}

/** يصنّف صورة من القسم الخاص: هل هي أنمي أم صورة بشرية، ثم الأنواع الفرعية */
export function classify(emb, labels) {
  const k = answer(emb, labels, QUESTIONS[0]);
  const group = k.label === 'anime' ? 'anime' : k.label === 'photo' ? 'women' : null;
  const tags = [];
  const detail = { kind: k.probs };
  if (group) {
    for (const q of QUESTIONS.slice(1)) {
      if (q.group !== group) continue;
      const a = answer(emb, labels, q);
      detail[q.id] = a.probs;
      if (a.label) tags.push(a.label);
    }
  }
  return { group, tags, detail };
}

/* ---------- البحث بالمعنى: كلمات عربية شائعة ← إنجليزي (النموذج يفهم الإنجليزية) ---------- */
const AR = {
  'شعر': 'hair', 'احمر': 'red', 'اسود': 'black', 'ابيض': 'white', 'اشقر': 'blonde', 'بني': 'brown', 'ازرق': 'blue', 'اخضر': 'green', 'اصفر': 'yellow',
  'وردي': 'pink', 'بنفسجي': 'purple', 'رمادي': 'gray', 'برتقالي': 'orange', 'ذهبي': 'golden', 'فضي': 'silver', 'قصير': 'short', 'طويل': 'long', 'مموج': 'wavy',
  'ناعم': 'straight', 'مجعد': 'curly', 'ضفيره': 'braid', 'ذيل حصان': 'ponytail', 'غره': 'bangs', 'عيون': 'eyes', 'عين': 'eye', 'نظارات': 'glasses', 'نظاره': 'glasses',
  'فستان': 'dress', 'تنوره': 'skirt', 'بنطلون': 'pants', 'جينز': 'jeans', 'قميص': 'shirt', 'جاكيت': 'jacket', 'معطف': 'coat', 'هودي': 'hoodie', 'بدله': 'suit',
  'كيمونو': 'kimono', 'زي مدرسي': 'school uniform', 'مدرسي': 'school uniform', 'درع': 'armor', 'قبعه': 'hat', 'حجاب': 'hijab', 'عبايه': 'abaya', 'كعب': 'high heels',
  'حذاء': 'shoes', 'سيف': 'sword', 'مسدس': 'gun', 'سلاح': 'weapon', 'سحر': 'magic', 'نار': 'fire', 'ماء': 'water', 'بحر': 'sea', 'شاطئ': 'beach', 'سماء': 'sky',
  'ليل': 'night', 'نهار': 'daytime', 'غروب': 'sunset', 'مطر': 'rain', 'ثلج': 'snow', 'زهور': 'flowers', 'ورد': 'roses', 'شجر': 'trees', 'غابه': 'forest',
  'مدينه': 'city', 'شارع': 'street', 'غرفه': 'room', 'سرير': 'bed', 'مطبخ': 'kitchen', 'مقهى': 'cafe', 'سياره': 'car', 'سيارات': 'cars', 'دراجه': 'motorcycle',
  'قطه': 'cat', 'قط': 'cat', 'كلب': 'dog', 'حصان': 'horse', 'طائر': 'bird', 'تنين': 'dragon', 'جناح': 'wings', 'اجنحه': 'wings',
  'بنت': 'girl', 'فتاه': 'girl', 'بنات': 'girls', 'امراه': 'woman', 'نساء': 'women', 'ولد': 'boy', 'رجل': 'man', 'رجال': 'men', 'طفل': 'child', 'شخصيه': 'character',
  'شخصيات': 'characters', 'نسائيه': 'female', 'رجاليه': 'male', 'ثنائي': 'couple', 'مجموعه': 'group of people',
  'ابتسامه': 'smiling', 'يبتسم': 'smiling', 'تبتسم': 'smiling', 'ضحك': 'laughing', 'حزين': 'sad', 'حزينه': 'sad', 'غاضب': 'angry', 'غاضبه': 'angry', 'بكاء': 'crying',
  'جالس': 'sitting', 'جالسه': 'sitting', 'واقف': 'standing', 'واقفه': 'standing', 'نايم': 'sleeping', 'نائمه': 'sleeping', 'يركض': 'running', 'قتال': 'fighting',
  'رقص': 'dancing', 'وقفه': 'pose', 'وجه': 'face', 'يد': 'hand', 'ايدي': 'hands', 'ظهر': 'back view', 'جانبي': 'side view', 'من فوق': 'from above', 'من تحت': 'from below',
  'بورتريه': 'portrait', 'كامل': 'full body', 'نصفي': 'half body', 'استوديو': 'studio', 'خارجي': 'outdoors', 'داخلي': 'indoors', 'سيلفي': 'selfie', 'مرايه': 'mirror',
  'مكياج': 'makeup', 'احمر شفاه': 'red lipstick', 'اكسسوارات': 'accessories', 'مجوهرات': 'jewelry', 'قلاده': 'necklace', 'اقراط': 'earrings',
  'رياضه': 'sports', 'نادي': 'gym', 'رسم': 'drawing', 'لوحه': 'painting', 'خلفيه': 'background', 'ظلام': 'dark', 'ملون': 'colorful', 'ابيض واسود': 'black and white',
  'كلاسيكي': 'retro 90s', 'قديم': 'old', 'حديث': 'modern', 'كيوت': 'cute', 'جميل': 'beautiful', 'جميله': 'beautiful', 'انمي': 'anime', 'كرتون': 'cartoon',
  'حمراء': 'red', 'سوداء': 'black', 'بيضاء': 'white', 'زرقاء': 'blue', 'خضراء': 'green', 'صفراء': 'yellow', 'شقراء': 'blonde', 'كستنائي': 'auburn',
  'فاتح': 'light', 'غامق': 'dark', 'داكن': 'dark', 'ترتدي': 'wearing', 'لابسه': 'wearing', 'لابس': 'wearing', 'تلبس': 'wearing', 'يلبس': 'wearing',
  'منظر طبيعي': 'landscape scenery', 'منظر': 'scenery', 'طبيعه': 'nature', 'من الخلف': 'from behind', 'من الامام': 'front view', 'اذان قطه': 'cat ears', 'اذان': 'ears',
  'ذيل': 'tail', 'قرون': 'horns', 'مريله': 'apron', 'خادمه': 'maid', 'ساحره': 'witch', 'روبوت': 'robot', 'كوسبلاي': 'cosplay', 'باروكه': 'wig', 'مظله': 'umbrella',
  'ساعه': 'watch', 'مسجد': 'mosque', 'قران': 'quran', 'جبل': 'mountain', 'صحراء': 'desert', 'قمر': 'moon', 'شمس': 'sun', 'نجوم': 'stars', 'فضاء': 'space',
};
const PRE = ['وبال', 'وال', 'بال', 'لل', 'ال', 'و', 'ب'];
const SUF = ['هم', 'ها', 'ه', 'ي'];
function lookup(w) {
  const tries = [w];
  for (const p of PRE) if (w.startsWith(p) && w.length - p.length >= 2) tries.push(w.slice(p.length));
  for (const t of [...tries]) for (const f of SUF) if (t.endsWith(f) && t.length - f.length >= 2) tries.push(t.slice(0, -f.length));
  for (const t of tries) if (AR[t]) return AR[t];
  return null;
}
/** يحوّل عبارة البحث العربية إلى إنجليزية كلمة بكلمة. يرجع null إذا لم يفهم أغلبها. */
export function toEnglish(qNorm) {
  const words = qNorm.split(' ').filter(Boolean);
  const out = [];
  let known = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^[a-z0-9'\-]+$/i.test(w)) { out.push({ en: w, latin: true }); known++; continue; }
    const two = i + 1 < words.length ? lookup(`${w} ${words[i + 1]}`) || AR[`${w} ${words[i + 1]}`] : null;
    if (two) { out.push({ en: two }); known += 2; i++; continue; }
    const en = lookup(w);
    if (en) { out.push({ en }); known++; }
  }
  if (!out.length || known < Math.ceil(words.length / 2)) return null;
  if (out.every((x) => x.latin)) return out.map((x) => x.en).join(' ');
  // العربية: الموصوف قبل الصفة (شعر أحمر) والإنجليزية بالعكس (red hair)
  return out.map((x) => x.en).reverse().join(' ');
}
