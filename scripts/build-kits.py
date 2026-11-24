"""Генерирует манифесты китов из содержимого public/kits (запуск: python scripts/build-kits.py).

- breakbeat/kit.json — та же раскладка, что у dnb, с поправкой на состав файлов;
- pool.json          — пул сэмплов SampleRadar по категориям (для замены звуков в уроке);
- sr-*/kit.json      — готовые киты из хитов SampleRadar;
- index.json         — список китов для приложения.
"""
import json
import os
import re

K = 'public/kits'


def dump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write('\n')


# --- fingerdrum.io: breakbeat повторяет раскладку dnb
with open(f'{K}/dnb/kit.json', encoding='utf-8') as f:
    dnb = json.load(f)
dnb['name'] = 'Студийный DnB-кит (fingerdrum.io)'
bb = json.loads(json.dumps(dnb))
bb['id'] = 'breakbeat'
bb['name'] = 'Breakbeat-кит (fingerdrum.io)'
for p in bb['pads']:
    for layer in p['layers']:
        layer['files'] = [x for x in layer['files'] if os.path.exists(f'{K}/breakbeat/{x}')]
        assert layer['files'], p
dump(dnb, f'{K}/dnb/kit.json')
dump(bb, f'{K}/breakbeat/kit.json')

# --- пул SampleRadar
files = sorted(os.listdir(f'{K}/sampleradar')) if os.path.isdir(f'{K}/sampleradar') else []


def cat(pattern):
    return ['sampleradar/' + x for x in files if re.search(pattern, x)]


if files:
    pool = {
        'license': 'SampleRadar (MusicRadar / Future Music): royalty-free, без права перераспространения. '
                   'Файлы не хранятся в git — их качает scripts/fetch-samples.mjs',
        'categories': {
            'kicks': {'gain': 0.85, 'files': cat(r' Kick ')},
            'snares': {'gain': 0.85, 'files': cat(r' Snare ')},
            'hats': {'gain': 0.6, 'files': cat(r' Hat ')},
            'cymbals': {'gain': 0.55, 'files': cat(r' Cymbal ')},
            'perc': {'gain': 0.75, 'files': cat(r' (Perc|Tamb) ')},
        },
        'sounds': {
            'kick': 'kicks', 'snare': 'snares', 'hat': 'hats', 'openhat': 'hats',
            'ride': 'cymbals', 'crash': 'cymbals', 'bell': 'cymbals',
            'rim': 'perc', 'clap': 'perc', 'tomlow': 'perc', 'tommid': 'perc', 'tomhigh': 'perc', 'shaker': 'perc',
        },
    }
    dump(pool, f'{K}/pool.json')
    print({k: len(v['files']) for k, v in pool['categories'].items()})

# --- готовые киты SampleRadar
COLOR = {
    'kick': '#ff5a3c', 'snare': '#ffc23c', 'hat': '#3cd6ff', 'rim': '#ffe9a8', 'clap': '#ff8fd0',
    'openhat': '#6fa8ff', 'ride': '#7dffb0', 'crash': '#c79bff', 'bell': '#a9ffd8',
    'tomlow': '#ff9a6b', 'tommid': '#ff9a6b', 'tomhigh': '#ff9a6b', 'shaker': '#d8d8d8',
}
NAME = {
    'kick': 'Kick', 'snare': 'Snare', 'hat': 'Hat', 'rim': 'Rim', 'clap': 'Clap', 'openhat': 'Open hat',
    'ride': 'Ride', 'crash': 'Crash', 'bell': 'Ride bell', 'tomlow': 'Perc low', 'tommid': 'Perc mid',
    'tomhigh': 'Perc high', 'shaker': 'Tamb',
}
LAYOUT = ['kick', 'snare', 'snare', 'kick', 'hat', 'rim', 'clap', 'hat',
          'openhat', 'ride', 'crash', 'bell', 'tomlow', 'tommid', 'tomhigh', 'shaker']
GAIN = {'kick': 0.85, 'snare': 0.85, 'hat': 0.6, 'openhat': 0.55, 'ride': 0.55, 'crash': 0.55, 'bell': 0.55}
COMMON = {
    'rim': 'D_B Perc 07', 'clap': 'D_B Snare 11', 'tomlow': 'D_B Perc 05', 'tommid': 'D_B Perc 11',
    'tomhigh': 'D_B Perc 10', 'shaker': 'D_B Tamb 02', 'bell': 'D_B Cymbal 11',
}
SR_KITS = [
    ('sr-dnb', 'DnB (SampleRadar)', {
        'kick': 'D_B Kick 12', 'snare': 'D_B Snare 01', 'hat': 'D_B Hat 10', 'openhat': 'D_B Hat 12',
        'ride': 'D_B Cymbal 13', 'crash': 'D_B Cymbal 15'}),
    ('sr-dnb2', 'DnB 2 (SampleRadar)', {
        'kick': 'D_B Kick 08', 'snare': 'D_B Snare 06', 'hat': 'D_B Hat 08', 'openhat': 'D_B Hat 05',
        'ride': 'D_B Cymbal 06', 'crash': 'D_B Cymbal 01', 'clap': 'D_B Snare 15'}),
    ('sr-jungle', 'Jungle (SampleRadar)', {
        'kick': 'Jungle Kick 02', 'snare': 'Jungle Snare 01', 'hat': 'Jungle Hat 02', 'openhat': 'Jungle Hat 01',
        'ride': 'D_B Cymbal 07', 'crash': 'D_B Cymbal 03', 'clap': 'Jungle Snare 09'}),
    ('sr-jungle2', 'Jungle 2 (SampleRadar)', {
        'kick': 'Jungle Kick 07', 'snare': 'Jungle Snare 06', 'hat': 'Jungle Hat 05', 'openhat': 'Jungle Hat 09',
        'ride': 'D_B Cymbal 14', 'crash': 'D_B Cymbal 05', 'clap': 'Jungle Snare 16'}),
    ('sr-jumpup', 'Jump Up (SampleRadar)', {
        'kick': 'Jump Up Kick 05', 'snare': 'Jump Up Snare 01', 'hat': 'D_B Hat 11', 'openhat': 'D_B Hat 07',
        'ride': 'D_B Cymbal 12', 'crash': 'D_B Cymbal 10', 'clap': 'Jump Up Snare 03'}),
]
for kit_id, name, picks in SR_KITS:
    m = {**COMMON, **picks}
    pads = []
    for i, sound in enumerate(LAYOUT):
        if files:
            assert m[sound] + '.wav' in files, m[sound]
        pad = {
            'pad': i + 1, 'sound': sound, 'name': NAME[sound], 'color': COLOR[sound],
            'gain': GAIN.get(sound, 0.75),
            'layers': [{'upTo': 127, 'files': [f'../sampleradar/{m[sound]}.wav']}],
        }
        if sound in ('hat', 'openhat'):
            pad['choke'] = 'hh'
        pads.append(pad)
    dump({'id': kit_id, 'name': name, 'type': 'oneshot', 'pads': pads}, f'{K}/{kit_id}/kit.json')

index = [{'id': i, 'name': n, 'kind': 'oneshot', 'requires': 'sampleradar'} for i, n, _ in SR_KITS]
index += [
    {'id': 'breakbeat', 'name': 'Breakbeat-кит (fingerdrum.io)', 'kind': 'oneshot'},
    {'id': 'dnb', 'name': 'Студийный DnB-кит (fingerdrum.io)', 'kind': 'oneshot'},
    {'id': 'amen', 'name': 'Amen break (слайсы)', 'kind': 'slices'},
]
dump(index, f'{K}/index.json')
print('kits:', [k['id'] for k in index])
