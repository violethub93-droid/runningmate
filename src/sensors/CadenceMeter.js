import { Platform } from 'react-native';
import { DeviceMotion } from 'expo-sensors';

// 케이던스(분당 걸음 수) 측정.
//
// ★웹에서는 expo-sensors를 쓰지 않고 `devicemotion` 이벤트를 직접 듣는다. 이유 두 가지:
//  ① expo-sensors 56의 웹 모듈(ExponentAccelerometer/DeviceMotion.web.js)에는
//     `addListener`가 없어 DeviceSensor.addListener가 곧바로 TypeError로 죽는다.
//     기존 코드는 이 오류를 try/catch로 삼켜서 원인 없이 조용히 실패하고 있었다.
//  ② 설령 붙더라도 웹 `Accelerometer`는 가속도계가 아니다 —
//     `deviceorientation`(기울기 각도, 라디안)을 가속도 이벤트로 흘려보내기 때문에
//     x·y·z가 m/s²가 아니라 각도라서 착지 충격이 잡힐 수 없다.
//  `devicemotion`의 accelerationIncludingGravity는 m/s²로, 네이티브 DeviceMotion과
//  단위가 같아 판정 로직을 한 벌만 유지하면 된다.
// ★iOS 13+ Safari는 requestPermission()을 '사용자 탭 안에서' 호출하지 않으면 이벤트를
//  하나도 주지 않는다. 오류도 없이 조용히 죽으므로 시작 버튼 핸들러 첫 줄에서 요청할 것.
//  (11차까지 케이던스가 전 구간 -1이었던 원인)

const IS_WEB = Platform.OS === 'web';
const FIRST_EVENT_MS = 2000; // 이 안에 첫 이벤트가 없으면 센서 없음으로 본다

const WINDOW_MS = 4000;   // 피크를 세는 창
const MIN_STEP_MS = 200;  // 불응기 — 착지 충격의 2차 진동을 걸음으로 중복 계수하지 않게 (>240spm 차단)
const MIN_SPAN_MS = 3000; // 창이 이만큼 차기 전엔 값을 내지 않는다
const MIN_SAMPLES = 30;   // 한 걸음(≈0.35초)에 여러 표본이 필요 — 너무 느린 센서는 신뢰 못 함
const MIN_PEAKS = 4;
const MIN_AMPL = 1.0;     // 진폭(표준편차, m/s²)이 이 미만이면 달리는 게 아니다 → 0
const SMOOTH_N = 5;       // 중앙값 평활 창
const MAX_SPM = 240;
const EMIT_MS = 500;      // 값 갱신 주기

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// iOS의 모션 권한 요청. 반드시 사용자 제스처(onPress) 안에서 호출해야 한다 —
// await로 다른 권한 팝업을 먼저 띄우면 제스처 자격이 만료돼 영영 이벤트가 오지 않는다.
// iOS가 아니면 요청 API 자체가 없으므로 granted로 본다.
export async function requestMotionPermission() {
  try {
    if (IS_WEB) {
      const req =
        (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) || null;
      if (!req) return 'granted'; // iOS 외 브라우저는 권한 개념이 없다
      return await req.call(DeviceMotionEvent);
    }
    const { status } = await DeviceMotion.requestPermissionsAsync();
    return status;
  } catch (e) {
    return `error:${e?.message || e}`;
  }
}

export class CadenceMeter {
  constructor() {
    this.buf = [];        // { m: 가속도 크기, t: ms }
    this.recent = [];     // 최근 spm 추정치 — 중앙값 평활용
    this.sub = null;
    this.onValue = null;
    this.lastEmitMs = 0;
    // 아래는 전부 러닝 로그용 진단값 — 다음 현장 테스트에서 '센서가 살아있었나'를
    // 추측이 아니라 데이터로 판단하기 위해 남긴다.
    this.events = 0;
    this.firstEventMs = 0;
    this.lastEventMs = 0;
    this.permission = 'unasked';
    this.available = null;
    this.error = null;
    this.maxSpm = 0;
  }

  // onStatus(available) — 첫 이벤트를 기다려 가용 여부가 확정되면 호출된다.
  // start 자체는 즉시 반환한다: 재개 직후 '다시 가볼까요' 멘트를 붙잡으면 안 되기 때문.
  start(onValue, onStatus) {
    if (this.sub) return true; // 재시작(수동 정지 해제) 시 중복 구독 방지
    this.onValue = onValue;
    try {
      if (IS_WEB) {
        if (typeof DeviceMotionEvent === 'undefined') {
          this.available = false;
          this.error = 'devicemotion 미지원 브라우저';
          return false;
        }
        const handler = (e) => this._onMotion(e);
        window.addEventListener('devicemotion', handler);
        this.sub = { remove: () => window.removeEventListener('devicemotion', handler) };
      } else {
        DeviceMotion.setUpdateInterval(20);
        this.sub = DeviceMotion.addListener((e) => this._onMotion(e));
      }
    } catch (e) {
      this.error = String(e?.message || e);
      this.available = false;
      return false;
    }

    // 가용 여부는 '이벤트가 실제로 오는가'로 판단한다. 권한 거부·센서 없음·
    // 데스크톱 모두 여기서 걸러지고, 구독은 그대로 두어 늦게 오는 기기도 살린다.
    setTimeout(() => {
      this.available = this.events > 0;
      if (!this.available) this.error ||= '모션 이벤트 없음(권한 거부 또는 센서 없음)';
      onStatus?.(this.available);
    }, FIRST_EVENT_MS);
    return true;
  }

  stop() {
    this.sub?.remove();
    this.sub = null;
    this.buf = [];
    this.recent = [];
  }

  _onMotion(e) {
    // 중력 포함 가속도를 우선 쓴다. 없으면 선형 가속도로 대체 —
    // 평균을 빼고 판정하므로 중력 오프셋 유무는 결과에 영향이 없다.
    const a = e?.accelerationIncludingGravity || e?.acceleration;
    if (!a || a.x == null || a.y == null || a.z == null) return;

    const now = Date.now();
    this.events += 1;
    if (!this.firstEventMs) this.firstEventMs = now;
    this.lastEventMs = now;

    this.buf.push({ m: Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z), t: now });
    while (this.buf.length && now - this.buf[0].t > WINDOW_MS) this.buf.shift();

    if (now - this.lastEmitMs < EMIT_MS) return;
    this.lastEmitMs = now;

    const spm = this._estimate(now);
    this.recent.push(spm);
    if (this.recent.length > SMOOTH_N) this.recent.shift();
    const out = median(this.recent);
    if (out > this.maxSpm) this.maxSpm = out;
    this.onValue?.(out);
  }

  _estimate(now) {
    const buf = this.buf;
    if (buf.length < MIN_SAMPLES) return 0;
    const span = buf[buf.length - 1].t - buf[0].t;
    if (span < MIN_SPAN_MS) return 0;

    const mean = buf.reduce((s, b) => s + b.m, 0) / buf.length;
    const sd = Math.sqrt(buf.reduce((s, b) => s + (b.m - mean) ** 2, 0) / buf.length);
    // 정지 상태에선 신호가 평평하다. 이 문턱이 없으면 센서 노이즈의 미세한
    // 극대점들이 그대로 '걸음'으로 세어져 멈춰 있어도 케이던스가 잡힌다.
    if (sd < MIN_AMPL) return 0;

    const th = mean + sd * 0.5;
    let peaks = 0;
    let firstPeakT = 0;
    let lastPeakT = 0;
    for (let i = 1; i < buf.length - 1; i++) {
      const b = buf[i];
      if (b.m < th) continue;
      if (b.m < buf[i - 1].m || b.m < buf[i + 1].m) continue;
      if (lastPeakT && b.t - lastPeakT < MIN_STEP_MS) continue;
      if (!firstPeakT) firstPeakT = b.t;
      lastPeakT = b.t;
      peaks += 1;
    }
    if (peaks < MIN_PEAKS) return 0;

    // ★환산은 표본 개수가 아니라 '실제 걸음 간격'으로 한다.
    //  이전 코드는 창 길이를 1초로 가정하고 peaks×60을 썼는데 실제 창은 2.5초여서
    //  값이 2.5배 부풀었다(170spm → 420 → 상한 220). 그래서 cadence_low(<160)가
    //  달리는 동안엔 수학적으로 발화 불가능했다.
    const stepSpanSec = (lastPeakT - firstPeakT) / 1000;
    if (stepSpanSec <= 0) return 0;
    const spm = ((peaks - 1) / stepSpanSec) * 60;
    return Math.min(Math.round(spm), MAX_SPM);
  }

  // 러닝 로그에 남길 진단 요약 — 센서가 붙었는지, 표본 속도가 충분했는지
  stats() {
    const span = this.lastEventMs - this.firstEventMs;
    return {
      perm: this.permission,
      avail: this.available,
      events: this.events,
      hz: span > 0 ? +(this.events / (span / 1000)).toFixed(1) : 0,
      maxSpm: this.maxSpm,
      ...(this.error ? { err: this.error } : {}),
    };
  }
}
