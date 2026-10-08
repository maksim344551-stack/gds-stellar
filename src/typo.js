// Русская типографика: неразрывные пробелы после коротких слов, перед тире и в числах с единицами.
const NBSP = ' ';

const SHORT = [
  'а', 'в', 'во', 'вы', 'да', 'до', 'за', 'из', 'к', 'ко', 'на', 'над', 'не', 'ни', 'но', 'о', 'об', 'от',
  'по', 'под', 'при', 'про', 'с', 'со', 'у', 'и', 'я', 'мы', 'он', 'их', 'без', 'для', 'или', 'что', 'как', 'это',
];
const SHORT_RE = new RegExp(`(^|[\\s(«„"—–-])(${SHORT.join('|')})\\s+(?=\\S)`, 'giu');
const UNIT_RE = /(\d)\s+(г|кг|мл|л|шт|лет|года|год|₽|руб\.?|%|мм|см|м)(?![\p{L}])/giu;
const DASH_RE = /\s+([—–])(?=\s)/gu;
const PHONE_RE = /(\+?\d)\s(?=\d)/g;

export function nb(text) {
  return text
    .replace(DASH_RE, `${NBSP}$1`)
    .replace(SHORT_RE, (_, lead, word) => `${lead}${word}${NBSP}`)
    .replace(SHORT_RE, (_, lead, word) => `${lead}${word}${NBSP}`) // цепочки вроде «и в» ловятся со второго прохода
    .replace(UNIT_RE, `$1${NBSP}$2`)
    .replace(/(\d)\s(?=\d{3}(?!\d))/g, `$1${NBSP}`);
}

export function nbPhone(text) {
  return text.replace(PHONE_RE, `$1${NBSP}`);
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'SVG', 'CODE']);

export function typografDOM(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      for (let p = n.parentElement; p && p !== root.parentElement; p = p.parentElement) {
        if (SKIP.has(p.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        if (p.hasAttribute('data-notypo')) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => { n.nodeValue = nb(n.nodeValue); });
}
