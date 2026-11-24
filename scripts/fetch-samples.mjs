// Скачивает DnB-пак SampleRadar (MusicRadar / Future Music) и кладёт барабанные хиты
// в public/kits/sampleradar. Сэмплы royalty-free, но распространять их нельзя,
// поэтому в git их нет — после клонирования репозитория выполни: npm run samples
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const URL = 'https://cdn.mos.musicradar.com/audio/musicradar-drum-and-bass-essentials-samples.zip';
const PAGE = 'https://www.musicradar.com/news/sampleradar-drum-and-bass-essentials-samples';
const DEST = join('public', 'kits', 'sampleradar');
// Берём только отдельные хиты этих серий (лупы, басы и FX приложению не нужны).
const WANT = /^(D_B|Jungle|Jump Up|Drum Machine) .*\.wav$/i;

if (existsSync(DEST) && readdirSync(DEST).some((f) => WANT.test(f)) && !process.argv.includes('--force')) {
  console.log(`Сэмплы уже на месте: ${DEST} (перекачать: npm run samples -- --force)`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'padwork-samples-'));
const zip = join(tmp, 'pack.zip');
try {
  console.log(`Скачиваю пак (≈250 МБ) со страницы ${PAGE} …`);
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

  console.log('Распаковываю…');
  const out = join(tmp, 'pack');
  mkdirSync(out);
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}'`], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', zip, '-d', out], { stdio: 'inherit' });
  }

  const hits = findDir(out, 'Drum Hits');
  if (!hits) throw new Error('В архиве не найдена папка «Drum Hits» — возможно, состав пака изменился.');
  mkdirSync(DEST, { recursive: true });
  let n = 0;
  for (const f of readdirSync(hits)) {
    if (WANT.test(f)) {
      copyFileSync(join(hits, f), join(DEST, f));
      n++;
    }
  }
  console.log(`Готово: ${n} файлов в ${DEST}. Перезагрузи страницу приложения.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function findDir(root, name) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(root, e.name);
    if (e.name === name) return p;
    const deeper = findDir(p, name);
    if (deeper) return deeper;
  }
  return null;
}
