import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Исходные тексты: известные опечатки не должны возвращаться. Список пополняется по результатам ревью.
const TYPOS = [/оберточ/i];
const SOURCES = ['index.html', 'src/data.js', 'src/ui.js', 'src/main.js', 'src/skins.js'];

test('в исходных текстах нет известных опечаток и заглушек', () => {
  for (const f of SOURCES) {
    const text = readFileSync(f, 'utf8');
    for (const re of TYPOS) expect(text, `${f}: ${re}`).not.toMatch(re);
    expect(text, `${f}: заглушка`).not.toMatch(/lorem ipsum|TODO|FIXME/i);
  }
});

test('у каждого вкуса есть название, перевод, описание и цвета', async () => {
  const { FLAVORS } = await import('../../src/data.js');
  expect(FLAVORS).toHaveLength(10);
  for (const f of FLAVORS) {
    for (const k of ['id', 'star', 'ru', 'desc', 'a', 'b', 'c']) expect(f[k], `${f.id}.${k}`).toBeTruthy();
    expect(f.desc).not.toMatch(/\s{2,}/);
  }
});
