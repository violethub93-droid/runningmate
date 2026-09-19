#!/usr/bin/env node
// 음성 클립 3중 점검 (음성부 소유)
//
// 클립이 실제로 재생되려면 세 곳이 모두 맞아야 한다. 하나라도 빠지면 오류 없이 조용히 TTS로 폴백된다.
//   [1] src/data/mentData.js  — audioKeys 블록이 참조하는 키 (일반 클립 + 마일스톤)
//   [2] src/data/audioMap.js  — 키 -> require('../../assets/audio/<파일>')
//   [3] assets/audio/*.mp3    — 실제 파일
//
// 사용: 저장소 루트에서 `node scripts/check-audio.js`
//       (경로는 이 파일 위치 기준이라 어느 cwd에서 실행해도 같은 저장소를 본다)
//
// 종료 코드:
//   0 = 통과
//   1 = 불일치 (조용한 TTS 폴백 / 죽은 항목 / 디스크에 없는 파일 / 중복 키)
//   2 = 점검 불가 (파일 읽기 실패, 또는 파싱 결과가 비정상이라 통과 판정을 믿을 수 없음)
//
// 디스크에만 있고 audioMap이 가리키지 않는 파일은 정보로만 출력하고 실패로 치지 않는다.
// Metro는 require된 파일만 번들에 넣으므로 배포물에는 포함되지 않는다
// (예: 되돌리기용으로 남겨둔 cadence_low_coach_01.mp3).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUDIO_MAP = path.join(ROOT, 'src', 'data', 'audioMap.js');
const MENT_DATA = path.join(ROOT, 'src', 'data', 'mentData.js');
const AUDIO_DIR = path.join(ROOT, 'assets', 'audio');

function fatal(msg) {
  console.error('점검 불가:', msg);
  process.exit(2);
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    fatal(`${path.relative(ROOT, p)} 를 읽을 수 없음 (${e.code || e.message})`);
  }
}

const am = readText(AUDIO_MAP);
const md = readText(MENT_DATA);

// [2] audioMap: key: require('../../assets/audio/<file>')
const amEntries = [
  ...am.matchAll(/['"]?([A-Za-z0-9_]+)['"]?\s*:\s*require\(\s*['"]\.\.\/\.\.\/assets\/audio\/([^'"]+)['"]\s*\)/g),
].map(m => ({ key: m[1], file: m[2] }));

// 파싱 누락 방지: 오디오 require 줄 수와 파싱된 항목 수가 다르면 정규식이 일부를 놓친 것
const rawRequireCount = (am.match(/require\(\s*['"]\.\.\/\.\.\/assets\/audio\//g) || []).length;
if (amEntries.length === 0) fatal('audioMap.js에서 오디오 항목을 하나도 파싱하지 못함');
if (rawRequireCount !== amEntries.length) {
  fatal(`audioMap.js의 오디오 require ${rawRequireCount}줄 중 ${amEntries.length}개만 파싱됨 — 형식이 바뀌었는지 확인`);
}

// [1] mentData: 모든 audioKeys 블록 안의 문자열 (중첩된 coach:{1:..} 마일스톤 구조 포함)
const refs = new Set();
let blockCount = 0;
for (const m of md.matchAll(/audioKeys\s*:\s*\{/g)) {
  const start = md.indexOf('{', m.index);
  let depth = 0;
  let end = -1;
  for (let j = start; j < md.length; j++) {
    if (md[j] === '{') depth++;
    else if (md[j] === '}') {
      depth--;
      if (depth === 0) { end = j; break; }
    }
  }
  if (end < 0) fatal(`mentData.js의 audioKeys 블록(offset ${m.index})이 닫히지 않음`);
  blockCount++;
  for (const s of md.slice(start, end).matchAll(/['"]([^'"]+)['"]/g)) refs.add(s[1]);
}
if (blockCount === 0 || refs.size === 0) fatal('mentData.js에서 audioKeys 참조를 하나도 찾지 못함');

// [3] 디스크
let files;
try {
  files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
} catch (e) {
  fatal(`assets/audio 를 읽을 수 없음 (${e.code || e.message})`);
}
const fileSet = new Set(files); // 대소문자 구분 비교 — Windows에선 통과해도 Linux 빌드에선 깨지는 경우를 잡는다

const amKeySet = new Set(amEntries.map(a => a.key));
const amFileSet = new Set(amEntries.map(a => a.file));

const fallback = [...refs].filter(r => !amKeySet.has(r));
const dead = [...amKeySet].filter(k => !refs.has(k));
const missing = amEntries.filter(a => !fileSet.has(a.file)).map(a => a.file);
const dupKeys = amEntries.map(a => a.key).filter((k, i, arr) => arr.indexOf(k) !== i);
const orphan = files.filter(f => !amFileSet.has(f));

const milestone = [...refs].filter(r => r.startsWith('milestone_')).length;
console.log('[1] mentData 참조 키      :', refs.size, `(일반 ${refs.size - milestone} + 마일스톤 ${milestone})`);
console.log('[2] audioMap require 항목 :', amEntries.length);
console.log('[3] assets/audio mp3 파일 :', files.length);
console.log('');
console.log('X 조용한 TTS 폴백 (mentData 참조O / audioMap 없음):', fallback);
console.log('X 죽은 항목 (audioMap 있음 / mentData 참조X)      :', dead);
console.log('X audioMap이 가리키는데 디스크에 없는 파일        :', missing);
console.log('X audioMap 중복 키 (뒤 항목이 앞을 덮어씀)         :', dupKeys);
console.log('- 디스크에만 있는 파일 (미연결, 정보)            :', orphan);
console.log('');

const problems = fallback.length + dead.length + missing.length + dupKeys.length;
if (problems > 0) {
  console.log(`결과: 불일치 ${problems}건 — 종료 코드 1`);
  process.exit(1);
}
console.log('결과: 통과');
