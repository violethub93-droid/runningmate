import AsyncStorage from '@react-native-async-storage/async-storage';

// 코칭 파라미터 — 정적 프로토타입 v10의 설정 UI와 동일한 항목·기본값.
// 3차 현장 테스트에서 확정된 고정 기본값(민감도 보통·체크인 75초·시작 침묵 30초·전역 간격 20초)을 따른다.
// Setup 화면과 엔진이 같은 정의를 참조하도록 여기 한 곳에만 둔다.

export const DEFAULTS = {
  persona: 'coach',
  targetDistanceKm: 3,
  targetPaceSec: 360,      // 6'00"/km
  judgeBasis: 'blend',     // current | blend | avg
  sensSec: 15,             // 목표 페이스 대비 허용 편차(초)
  globalGapSec: 20,        // 페이스 코칭 전역 최소 발화 간격
  checkinSec: 75,          // 주기적 체크인 간격
  warmupSec: 30,           // 시작 후 침묵 구간
  pauseSec: 10,            // 이 시간만큼 저속 지속 시 자동 일시정지
  resumeSec: 2.5,          // 이 시간만큼 이동 지속 시 자동 재시작
  bgmBpm: 0,               // 케이던스 동기화 BGM (0 = 끄기)
};

// 자동 일시정지/재시작 속도 임계 — 분리해서 히스테리시스를 만든다(걷기엔 안 멈추게)
export const PAUSE_SPEED_MPS = 0.6;
export const RESUME_SPEED_MPS = 1.0;

// 거리 이벤트는 타이밍이 생명 — 전역 간격 대신 짧은 간격만 요구
export const DIST_EVENT_GAP_MS = 2500;
// 재시작 멘트 직후 페이스 코칭 보류
export const RESUME_GUARD_MS = 3500;

export const GOAL_RANGE = { min: 1, max: 15, step: 0.5 };
export const PACE_RANGE = { min: 180, max: 600, step: 10 };

export const OPTIONS = {
  judgeBasis: [
    { v: 'current', label: '현재' },
    { v: 'blend', label: '혼합(권장)' },
    { v: 'avg', label: '평균' },
  ],
  sensSec: [
    { v: 10, label: '민감 ±10' },
    { v: 15, label: '보통 ±15' },
    { v: 25, label: '둔감 ±25' },
  ],
  globalGapSec: [
    { v: 12, label: '12초' },
    { v: 20, label: '20초' },
    { v: 30, label: '30초' },
  ],
  checkinSec: [
    { v: 45, label: '45초' },
    { v: 75, label: '75초' },
    { v: 120, label: '120초' },
  ],
  warmupSec: [
    { v: 15, label: '15초' },
    { v: 20, label: '20초' },
    { v: 30, label: '30초' },
  ],
  pauseSec: [
    { v: 7, label: '빠름 7초' },
    { v: 10, label: '보통 10초' },
    { v: 15, label: '여유 15초' },
  ],
  resumeSec: [
    { v: 1.5, label: '민감 1.5초' },
    { v: 2.5, label: '보통 2.5초' },
    { v: 4, label: '둔감 4초' },
  ],
  bgmBpm: [
    { v: 0, label: '끄기' },
    { v: 150, label: '150' },
    { v: 160, label: '160' },
    { v: 170, label: '170' },
    { v: 180, label: '180' },
  ],
};

export const BASIS_LABEL = {
  current: '현재 페이스 (스무딩)',
  blend: '현재+평균 혼합 판단',
  avg: '평균 페이스 기준 판단',
};

// 마지막에 쓴 설정을 기억한다 — 현장에서 매번 7개 항목을 다시 고르지 않게.
const SETTINGS_KEY = 'rm_settings_v1';

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw);
    // 저장된 값 중 현재 정의에 있는 키만 채택 (스키마가 바뀌어도 안전하게)
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (saved[k] !== undefined) out[k] = saved[k];
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(cfg) {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
  } catch {
    /* 저장 실패는 러닝을 막을 이유가 아니다 */
  }
}

// 기본값과 다른 항목만 골라 요약 문자열로 (접힌 상태에서 무엇이 바뀌었는지 보여주기 위해)
export function changedSummary(cfg) {
  const label = (field, v) => OPTIONS[field]?.find((o) => o.v === v)?.label ?? String(v);
  const names = {
    judgeBasis: '판단', sensSec: '민감도', globalGapSec: '발화간격',
    checkinSec: '체크인', warmupSec: '워밍업', pauseSec: '정지', resumeSec: '재시작',
  };
  const diffs = Object.keys(names)
    .filter((k) => cfg[k] !== DEFAULTS[k])
    .map((k) => `${names[k]} ${label(k, cfg[k])}`);
  return diffs;
}

export function paceLabel(sec) {
  if (!sec || sec <= 0) return "--'--";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}'${String(s).padStart(2, '0')}`;
}

export function clockLabel(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
