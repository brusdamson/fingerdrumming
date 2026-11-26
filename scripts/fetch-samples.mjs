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
// Брейки для китов-слайсов (в подпапку beats), роллы и джангл-FX — как отдельные звуки для пэдов.
const WANT_BEATS = /^(Sped Up Break|Jungle Beat|DnB Beat|Jump Up Beat) .*\.wav$/i;
const WANT_ROLLS = /^Roll \d+\.wav$/i;
const WANT_FX = /^(Jungle FX|Stab|Sub Drop).*\.wav$/i;
const BEATS = join(DEST, 'beats');

const have = existsSync(DEST) && readdirSync(DEST).some((f) => WANT.test(f)) && existsSync(BEATS);
if (have && !process.argv.includes('--force')) {
  console.log(`Сэмплы уже на месте: ${DEST} (перекачать: npm run samples -- --force)`);
  process.exit(0);
}

// npm run samples -- --zip <путь> — взять уже скачанный архив вместо загрузки.
const zipArg = process.argv.indexOf('--zip');
const localZip = zipArg > 0 ? process.argv[zipArg + 1] : null;
const tmp = mkdtempSync(join(tmpdir(), 'padwork-samples-'));
const zip = localZip ?? join(tmp, 'pack.zip');
try {
  if (!localZip) {
    console.log(`Скачиваю пак (≈250 МБ) со страницы ${PAGE} …`);
    const res = await fetch(URL);
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  }

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
  mkdirSync(BEATS, { recursive: true });
  let n = 0;
  const copy = (dir, test, dest) => {
    if (!dir) return;
    for (const f of readdirSync(dir)) {
      if (test.test(f)) {
        copyFileSync(join(dir, f), join(dest, f));
        n++;
      }
    }
  };
  copy(hits, WANT, DEST);
  const beats = findDir(out, 'Beats');
  copy(beats, WANT_BEATS, BEATS);
  copy(beats, WANT_ROLLS, DEST);
  copy(findDir(out, 'FX'), WANT_FX, DEST);
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
