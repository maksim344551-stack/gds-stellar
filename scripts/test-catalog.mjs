// Проверка модуля src/catalog.js без браузера: node scripts/test-catalog.mjs
// Живая проверка против настоящей базы (только чтение публичным ключом): LIVE=1 node scripts/test-catalog.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProducts, applyCatalog, loadCatalog } from '../src/catalog.js';
import { FLAVORS } from '../src/data.js';

const ok = (rows) => async () => ({ ok: true, status: 200, json: async () => rows });
const quiet = (fn) => async (...a) => {
  const w = console.warn;
  console.warn = () => {};
  try { return await fn(...a); } finally { console.warn = w; }
};

test('parseProducts: принимает нормальные строки и отбрасывает негодные', () => {
  const m = parseProducts([
    { slug: 'altair', description: '  Мята.  ' },
    { slug: 'Bad_Slug', description: 'x' },
    { slug: 'vega', description: '' },
    { slug: 'naos', description: 5 },
    { slug: 'x'.repeat(65), description: 'x' },
    { slug: 'long', description: 'я'.repeat(4001) },
    null,
    'строка',
  ]);
  assert.deepEqual([...m.keys()], ['altair']);
  assert.equal(m.get('altair').description, 'Мята.');
});

test('parseProducts: не массив даёт null', () => {
  assert.equal(parseProducts({}), null);
  assert.equal(parseProducts(null), null);
});

test('parseProducts: убирает управляющие, невидимые и bidi-знаки', () => {
  const dirty = ['A', String.fromCharCode(0x200b), 'B', String.fromCharCode(0x202e), 'C', String.fromCharCode(7), 'D'].join('');
  const m = parseProducts([{ slug: 'mira', description: dirty }]);
  assert.equal(m.get('mira').description, 'ABCD');
});

test('parseProducts: разметка остаётся текстом (экранирует textContent на странице)', () => {
  const m = parseProducts([{ slug: 'mira', description: '<img src=x onerror=alert(1)>' }]);
  assert.equal(m.get('mira').description, '<img src=x onerror=alert(1)>');
});

test('applyCatalog: меняет только совпавшие по id вкусы и считает изменения', () => {
  const flavors = [{ id: 'altair', desc: 'старое' }, { id: 'vega', desc: 'как было' }, { id: 'auris', desc: 'папайя' }];
  const cat = new Map([['altair', { description: 'новое' }], ['vega', { description: 'как было' }], ['isida', { description: 'другое' }]]);
  assert.equal(applyCatalog(flavors, cat), 1);
  assert.equal(flavors[0].desc, 'новое');
  assert.equal(flavors[2].desc, 'папайя'); // auris в базе называется isida: не сопоставляется, пока владелец не решит
});

test('applyCatalog: без каталога ничего не меняет', () => {
  const flavors = [{ id: 'altair', desc: 'старое' }];
  assert.equal(applyCatalog(flavors, null), 0);
  assert.equal(flavors[0].desc, 'старое');
});

test('loadCatalog: успешный ответ превращается в Map', async () => {
  const m = await loadCatalog({ fetchImpl: ok([{ slug: 'altair', description: 'Мята.' }]), url: 'https://x.example', key: 'k' });
  assert.equal(m.get('altair').description, 'Мята.');
});

test('loadCatalog: заголовок apikey, без cookie и без referrer', async () => {
  let seen;
  await loadCatalog({
    fetchImpl: async (u, init) => { seen = { u, init }; return { ok: true, json: async () => [] }; },
    url: 'https://x.example', key: 'KEY',
  });
  assert.match(seen.u, /^https:\/\/x\.example\/rest\/v1\/products\?select=slug,description/);
  assert.equal(seen.init.headers.apikey, 'KEY');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.referrerPolicy, 'no-referrer');
});

test('loadCatalog: HTTP-ошибка, исключение и мусор в ответе дают null', quiet(async () => {
  const bad = { ok: false, status: 500, json: async () => ({}) };
  assert.equal(await loadCatalog({ fetchImpl: async () => bad, url: 'https://x.example', key: 'k' }), null);
  assert.equal(await loadCatalog({ fetchImpl: async () => { throw new Error('сеть'); }, url: 'https://x.example', key: 'k' }), null);
  assert.equal(await loadCatalog({ fetchImpl: ok({ message: 'нет' }), url: 'https://x.example', key: 'k' }), null);
  assert.equal(await loadCatalog({ fetchImpl: ok([]), url: '', key: 'k' }), null);
}));

test('loadCatalog: зависший запрос обрывается по таймауту', quiet(async () => {
  const hang = (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('прервано'))));
  const t0 = Date.now();
  assert.equal(await loadCatalog({ fetchImpl: hang, url: 'https://x.example', key: 'k', timeoutMs: 60 }), null);
  assert.ok(Date.now() - t0 < 1000);
}));

test('data.js: у каждого вкуса есть id и desc (то, что подставляет catalog.js)', () => {
  for (const f of FLAVORS) {
    assert.match(f.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.equal(typeof f.desc, 'string');
  }
});

test('LIVE: настоящая база отдаёт описания, они подставляются во вкусы', { skip: !process.env.LIVE }, async () => {
  const cat = await loadCatalog({ timeoutMs: 8000 });
  assert.ok(cat instanceof Map, 'ответ базы получен');
  const copy = FLAVORS.map((f) => ({ ...f }));
  const changed = applyCatalog(copy, cat);
  const known = FLAVORS.filter((f) => cat.has(f.id)).length;
  console.log(`  в базе вкусов: ${cat.size}; совпало с data.js: ${known}; описаний изменилось: ${changed}`);
  assert.ok(known >= 9, 'совпадают минимум 9 вкусов (десятый называется иначе: isida/auris)');
});
