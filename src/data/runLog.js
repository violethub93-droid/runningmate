import { Platform, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 러닝 로그 — 현장 테스트 개선점을 체감이 아닌 데이터로 판단하기 위한 기록.
// 정적 프로토타입 v10과 같은 스키마를 쓰되 케이던스 축을 추가했다(ver 11).
// ver 12: 고도·고도정확도 축 추가 — 경사 코칭을 GPS 고도로 할 수 있는지 판단할 근거.

const STORAGE_KEY = 'rm_history_v1';
const MAX_RUNS = 40;              // 보관할 최근 러닝 수
const MAX_BYTES = 4 * 1024 * 1024; // 이 크기를 넘으면 오래된 러닝의 샘플부터 비운다

export const SAMPLE_FORMAT =
  '[t초, 거리m, 페이스 초/km(-1 없음), 케이던스 spm(-1 없음), GPS정확도 m(-1 없음), 일시정지 0/1, 고도m(null 없음), 고도정확도m(null 없음)]';

export function createRunLog({ persona, targetPaceSec, targetDistanceKm, settings }) {
  return {
    ver: 12,
    date: new Date().toISOString(),
    platform: Platform.OS,
    persona,
    targetSec: targetPaceSec,
    goalKm: targetDistanceKm,
    // 어떤 코칭 파라미터로 달렸는지 — 현장 테스트 결과를 설정과 함께 해석하기 위해
    settings: settings || null,
    sampleFormat: SAMPLE_FORMAT,
    samples: [],
    speech: [],
    pauses: [],
    result: null,
    _lastSpeakAt: -1, // 발화 간격(gap) 계산용 — 저장 직전에 제거
  };
}

export function addSample(
  log,
  { t, distanceKm, paceSec, cadenceSpm, accuracyM, paused, altitudeM, altitudeAccM }
) {
  if (!log) return;
  log.samples.push([
    Math.round(t),
    Math.round((distanceKm || 0) * 1000),
    paceSec > 0 ? Math.round(paceSec) : -1,
    cadenceSpm > 0 ? Math.round(cadenceSpm) : -1,
    accuracyM != null ? Math.round(accuracyM) : -1,
    paused ? 1 : 0,
    // 고도는 음수(해수면 아래)가 정상값이라 -1을 '없음'으로 쓸 수 없다 → null.
    // 경사 3%를 100m 구간에서 보려면 3m 차이를 읽어야 해서 0.1m까지 남긴다.
    altitudeM != null ? Math.round(altitudeM * 10) / 10 : null,
    altitudeAccM != null ? Math.round(altitudeAccM * 10) / 10 : null,
  ]);
}

// 고도 요약 — 샘플을 전부 파싱하지 않고도 'GPS 고도가 경사 판정에 쓸 만한가'를
// 한눈에 보기 위한 집계. 없으면(브라우저가 altitude를 안 주면) have=0으로 드러난다.
function summarizeAltitude(samples) {
  const alts = [];
  const accs = [];
  for (const s of samples) {
    if (s[6] != null) alts.push(s[6]);
    if (s[7] != null) accs.push(s[7]);
  }
  if (!alts.length) return { have: 0, missing: samples.length };
  const sorted = [...alts].sort((a, b) => a - b);
  const accSorted = [...accs].sort((a, b) => a - b);
  return {
    have: alts.length,
    missing: samples.length - alts.length,
    minM: sorted[0],
    maxM: sorted[sorted.length - 1],
    spanM: +(sorted[sorted.length - 1] - sorted[0]).toFixed(1),
    accMedM: accSorted.length ? accSorted[Math.floor(accSorted.length / 2)] : null,
  };
}

export function addSpeech(log, { t, sit, text, src }) {
  if (!log) return;
  const gap = log._lastSpeakAt < 0 ? 0 : Math.round(t - log._lastSpeakAt);
  log._lastSpeakAt = t;
  log.speech.push({ t: Math.round(t), sit, gap, txt: text, src });
}

export function openPause(log, { t, reason }) {
  if (!log) return;
  log.pauses.push({ t: Math.round(t), reason, dur: null });
}

export function closePause(log, { durSec }) {
  if (!log || !log.pauses.length) return;
  const last = log.pauses[log.pauses.length - 1];
  if (last.dur == null) last.dur = Math.round(durSec);
}

export function finalizeRunLog(log, { elapsedSec, distanceKm, avgPaceSec, goalReached }) {
  if (!log) return null;
  log.result = {
    km: +distanceKm.toFixed(2),
    sec: Math.round(elapsedSec),
    avg: avgPaceSec > 0 ? Math.round(avgPaceSec) : null,
    spoken: log.speech.length,
    pauses: log.pauses.length,
    goal: !!goalReached,
  };
  log.altitude = summarizeAltitude(log.samples);
  return log;
}

export async function loadHistory() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveRun(log) {
  if (!log) return false;
  try {
    const { _lastSpeakAt, ...clean } = log;
    const history = await loadHistory();
    history.push(clean);
    while (history.length > MAX_RUNS) history.shift();

    // 용량이 커지면 오래된 러닝의 샘플 배열부터 비워 발화 로그·결과는 지킨다
    let serialized = JSON.stringify(history);
    for (let i = 0; i < history.length - 1 && serialized.length > MAX_BYTES; i++) {
      if (history[i].samples && history[i].samples.length) {
        history[i].samples = [];
        serialized = JSON.stringify(history);
      }
    }

    await AsyncStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export async function clearHistory() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// 웹에서는 파일 다운로드, 네이티브에서는 공유 시트로 내보낸다.
export async function exportJSON(data, prefix) {
  const json = JSON.stringify(data, null, 1);
  const filename = `runningmate_${prefix}_${stamp()}.json`;

  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
    return { ok: true, filename };
  }

  try {
    await Share.share({ message: json, title: filename });
    return { ok: true, filename };
  } catch {
    return { ok: false, filename };
  }
}

export async function exportRun(log) {
  return exportJSON(log, 'run');
}

export async function exportHistory() {
  const history = await loadHistory();
  if (!history.length) return { ok: false, empty: true };
  return exportJSON(history, 'history');
}
