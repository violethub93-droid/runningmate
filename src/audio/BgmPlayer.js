import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { Asset } from 'expo-asset';

// 케이던스 동기화 BGM — 16마디 루프를 무한 반복하고, 메이트가 말할 때 덕킹한다.
//
// 웹은 Web Audio로 직접 재생한다. <audio loop>는 AAC 인코더 패딩 때문에
// 반복마다 수십 ms 공백이 생기는데, AudioBufferSourceNode.loop은 샘플 단위로
// 이어 붙이므로 공백이 없다. 네이티브는 expo-av가 컨테이너의 갭리스 정보를
// 처리하므로 isLooping을 그대로 쓴다.

const SOURCES = {
  150: require('../../assets/bgm/bgm_150.m4a'),
  160: require('../../assets/bgm/bgm_160.m4a'),
  170: require('../../assets/bgm/bgm_170.m4a'),
  180: require('../../assets/bgm/bgm_180.m4a'),
};

export const BGM_LEVEL = 0.35;  // 평상시 볼륨
export const BGM_DUCK = 0.10;   // 발화 중 볼륨
const FADE_IN_MS = 1200;
const DUCK_DOWN_MS = 250;       // 말 시작 — 빠르게 비켜준다
const DUCK_UP_MS = 800;         // 말 끝 — 천천히 돌아온다

export class BgmPlayer {
  constructor() {
    this.bpm = 0;
    this.ready = false;
    this.stopped = false;
    this.ducked = false;
    this.paused = false;
    // web
    this.ctx = null; this.gain = null; this.node = null; this.buffer = null;
    // native
    this.sound = null; this.fadeTimer = null; this.level = 0;
  }

  get isWeb() { return Platform.OS === 'web'; }

  async start(bpm) {
    if (!bpm || !SOURCES[bpm]) return false;
    this.bpm = bpm;
    this.stopped = false;
    try {
      if (this.isWeb) await this._startWeb(bpm);
      else await this._startNative(bpm);
      this.ready = true;
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  async _startWeb(bpm) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('no AudioContext');
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});

    const asset = Asset.fromModule(SOURCES[bpm]);
    await asset.downloadAsync();
    const res = await fetch(asset.uri || asset.localUri);
    const buf = await res.arrayBuffer();
    this.buffer = await new Promise((resolve, reject) =>
      this.ctx.decodeAudioData(buf, resolve, reject)
    );
    if (this.stopped) return;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);

    this.node = this.ctx.createBufferSource();
    this.node.buffer = this.buffer;
    this.node.loop = true;              // 샘플 단위 무한 반복 — 공백 없음
    this.node.connect(this.gain);
    this.node.start();
    this._rampWeb(this._target(), FADE_IN_MS);
  }

  async _startNative(bpm) {
    const { sound } = await Audio.Sound.createAsync(SOURCES[bpm], {
      isLooping: true,
      volume: 0,
      shouldPlay: true,
    });
    if (this.stopped) { await sound.unloadAsync().catch(() => {}); return; }
    this.sound = sound;
    this._fadeNative(this._target(), FADE_IN_MS);
  }

  _rampWeb(target, ms) {
    if (!this.gain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + ms / 1000);
  }

  // expo-av에는 볼륨 램프가 없어 계단식으로 흉내낸다
  _fadeNative(target, ms) {
    if (!this.sound) return;
    clearInterval(this.fadeTimer);
    const steps = Math.max(1, Math.round(ms / 50));
    const from = this.level;
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      const v = from + (target - from) * (i / steps);
      this.level = v;
      this.sound?.setVolumeAsync(Math.max(0, Math.min(1, v))).catch(() => {});
      if (i >= steps) { clearInterval(this.fadeTimer); this.fadeTimer = null; this.level = target; }
    }, 50);
  }

  _ramp(target, ms) {
    if (this.isWeb) this._rampWeb(target, ms);
    else this._fadeNative(target, ms);
  }

  // 정지 상태가 덕킹보다 우선한다.
  // (정지 직후 재정비 멘트가 나가면서 덕킹이 걸리는데, 그때 볼륨이 되살아나면 안 됨)
  _target() {
    if (this.paused) return 0;
    return this.ducked ? BGM_DUCK : BGM_LEVEL;
  }

  // 메이트 발화 중에는 배경음을 낮춘다
  setDucked(on) {
    if (this.ducked === on) return;
    this.ducked = on;
    if (!this.ready || this.paused) return;
    this._ramp(this._target(), on ? DUCK_DOWN_MS : DUCK_UP_MS);
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    if (!this.ready) return;
    if (this.isWeb) this._rampWeb(0, 400);
    else { this._fadeNative(0, 400); setTimeout(() => this.sound?.pauseAsync().catch(() => {}), 450); }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (!this.ready) return;
    if (this.isWeb) {
      this.ctx?.resume().catch(() => {});
      this._rampWeb(this._target(), 800);
    } else {
      this.sound?.playAsync().catch(() => {});
      this._fadeNative(this._target(), 800);
    }
  }

  async stop() {
    this.stopped = true;
    this.ready = false;
    clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (this.isWeb) {
      try { this.node?.stop(); } catch {}
      this.node = null;
      try { await this.ctx?.close(); } catch {}
      this.ctx = null; this.gain = null; this.buffer = null;
    } else {
      try { await this.sound?.stopAsync(); } catch {}
      try { await this.sound?.unloadAsync(); } catch {}
      this.sound = null; this.level = 0;
    }
  }
}
