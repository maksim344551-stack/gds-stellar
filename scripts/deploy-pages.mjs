// Публикация сайта на GitHub Pages: собирает проект и force-пушит dist в ветку gh-pages.
// Запуск: npm run deploy   (нужен git с доступом к origin; без shell, аргументы — массивом)
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const remote = git(['remote', 'get-url', 'origin']);
// В GitHub Actions доступ к репозиторию даёт GITHUB_TOKEN: подставляем его в адрес только на время отправки (в журнале токен скрывается Actions)
const token = process.env.GITHUB_TOKEN;
const pushTarget = token && remote.startsWith('https://github.com/') ? remote.replace('https://github.com/', `https://x-access-token:${token}@github.com/`) : remote;
const sha = git(['rev-parse', '--short', 'HEAD']);

console.log('→ сборка');
await build({ root, logLevel: 'warn' });

if (existsSync(resolve(dist, '.git'))) rmSync(resolve(dist, '.git'), { recursive: true, force: true });
git(['init', '-q', '-b', 'gh-pages'], dist);
git(['add', '-A'], dist);
git(['-c', 'user.name=gds-deploy', '-c', 'user.email=deploy@users.noreply.github.com', 'commit', '-q', '-m', `deploy ${sha}`], dist);
console.log('→ публикация в gh-pages');
git(['push', '-q', '-f', pushTarget, 'gh-pages'], dist);
rmSync(resolve(dist, '.git'), { recursive: true, force: true });
console.log(`готово (${sha})`);
