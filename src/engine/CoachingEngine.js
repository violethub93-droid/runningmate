import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import {
  SITUATIONS,
  MILESTONES,
  CADENCE_THRESHOLD,
  FINAL_PUSH_RATIO,
  HALFWAY_RATIO,
  SLOPE_THRESHOLDS,
  milestoneFallbackText,
} from '../data/mentData';
import { DEFAULTS, DIST_EVENT_GAP_MS, RESUME_GUARD_MS } from '../data/settings';
import audioMap from '../data/audioMap';

// 오디오 세션 인터럽트/언로드로 didJustFinish가 영영 안 올 때를 대비한 최대 대기 시간
const PLAYBACK_TIMEOUT_MS = 15000;

export class CoachingEngine {
  constructor({ persona = 'coach', targetPaceSec, targetDistanceKm, settings, onGoalReached, onSpeak, onStateChange }) {
    this.persona = persona;
    this.targetPaceSec = targetPaceSec;
    this.targetDistanceKm = targetDistanceKm;
    // 코칭 파라미터 — Setup 화면에서 넘어온 값, 없으면 3차 테스트 확정 기본값
    this.cfg = { ...DEFAULTS, ...(settings || {}) };
    this.onGoalReached = onGoalReached;
    this.onSpeak = onSpeak; // 발화가 실제로 나갈 때 호출 — 러닝 로그 수집용
    this.onStateChange = onStateChange; // 말풍선/애니메이션용 발화 상태 통지
    this.lastSpoken = {};
    this.bags = {}; // 셔플백 — 모든 변형을 쓰기 전엔 같은 멘트를 반복하지 않는다
    this.lastVariantIndex = {};
    this.passedMilestones = new Set();
    this.halfwayPlayed = false;
    this.finalPushPlayed = false;
    this.goalReached = false;
    this.sound = null;
    this.isSpeaking = false;
    this.muted = false;
    // 경과 시간은 화면의 타이머(정지 시간 제외)를 단일 출처로 삼아 매 호출 시 전달받는다
    this.elapsedSec = 0;
    this.lastSpeakAtSec = -Infinity;
    this.recentDev = [];
    this.wasDeviated = false;
    this.guardUntil = 0; // v7: 재시작 우선 구간 — 이 시각까지 페이스 코칭 보류
    this.lastDistEventAt = -Infinity; // v8: 거리 이벤트 재발화 최소 간격 추적
    this.playToken = 0; // 재생 취소-안전성: 강제 발화가 선점하면 이전 재생의 뒤늦은 완료 콜백이 상태를 덮어쓰지 못하게 함

    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
  }

  // v8: 거리 기반 이벤트(완주/마일스톤/반환점/막바지) — RunningScreen의 GPS 콜백에서
  // 위치 갱신마다 직접 호출한다(타이밍 지연 최소화). evaluate()에서도 백업으로 재호출됨.
  async checkDistanceEvents({ distanceKm, elapsedSec }) {
    if (this.goalReached) return;
    if (elapsedSec != null) this.elapsedSec = elapsedSec;
    const now = Date.now();
    if (this.elapsedSec < this.cfg.warmupSec) return; // 시작 침묵 구간

    // 완주 — 최우선. 다른 멘트를 끊고서라도 반드시 재생(await 완료 후 종료 콜백)
    if (
      this.targetDistanceKm > 0 &&
      distanceKm >= this.targetDistanceKm
    ) {
      this.goalReached = true;
      await this._playSituationForced('goal', now);
      this.onGoalReached?.();
      return;
    }

    if (this.isSpeaking) return; // 재생 중이면 다음 GPS 갱신에서 재시도(곧 다시 들어옴)
    if (now - this.lastDistEventAt < DIST_EVENT_GAP_MS) return;

    const km = Math.floor(distanceKm);
    // 목표가 있으면 마지막 km는 완주 멘트가 대신 처리(마일스톤 중복 방지). 목표가 없으면("자유") 무제한.
    const mDue =
      km >= 1 &&
      !this.passedMilestones.has(km) &&
      (this.targetDistanceKm <= 0 || km < this.targetDistanceKm);
    const hDue =
      this.targetDistanceKm > 0 &&
      !this.halfwayPlayed &&
      distanceKm >= this.targetDistanceKm * HALFWAY_RATIO;
    const fDue =
      this.targetDistanceKm > 0 &&
      !this.finalPushPlayed &&
      distanceKm >= this.targetDistanceKm * FINAL_PUSH_RATIO;

    // v9: 마일스톤과 반환점/막바지가 겹치는 경우 — 새로 합성하지 않고
    // 기존 클립 두 개를 이어 재생하는 병합 멘트로 처리
    if (mDue && hDue) {
      this.passedMilestones.add(km);
      this.halfwayPlayed = true;
      this.lastDistEventAt = now;
      await this._playSequence(
        [this._pickMilestone(km), this._pickVariant('halfway', now)],
        `milestone_${km}km+halfway`
      );
      return;
    }
    if (mDue && fDue) {
      this.passedMilestones.add(km);
      this.finalPushPlayed = true;
      this.lastDistEventAt = now;
      await this._playSequence(
        [this._pickMilestone(km), this._pickVariant('final_push', now)],
        `milestone_${km}km+final_push`
      );
      return;
    }
    if (hDue && fDue) {
      this.halfwayPlayed = true;
      this.finalPushPlayed = true;
      this.lastDistEventAt = now;
      await this._playVariant('final_push', now);
      return;
    }
    if (mDue) {
      this.passedMilestones.add(km);
      this.lastDistEventAt = now;
      await this._playMilestone(km);
      return;
    }
    if (hDue) {
      this.halfwayPlayed = true;
      this.lastDistEventAt = now;
      await this._playVariant('halfway', now);
      return;
    }
    if (fDue) {
      this.finalPushPlayed = true;
      this.lastDistEventAt = now;
      await this._playVariant('final_push', now);
      return;
    }
  }

  // 페이스/케이던스/경사 등 일반 코칭 — 목표/거리 이벤트는 checkDistanceEvents로 분리됨
  async evaluate({ elapsedSec, currentPaceSec, avgPaceSec, distanceKm, cadenceSpm, slope }) {
    if (this.goalReached) return;
    if (elapsedSec != null) this.elapsedSec = elapsedSec;

    // 백업: GPS 콜백에서 이미 처리됐다면 여기선 조건 불충족으로 바로 반환됨
    await this.checkDistanceEvents({ distanceKm });
    if (this.goalReached) return;

    const t = this.elapsedSec;
    const { warmupSec, globalGapSec, checkinSec, sensSec, judgeBasis } = this.cfg;

    if (t < warmupSec) return;                      // ① 시작 침묵(워밍업)
    if (Date.now() < this.guardUntil) return;       // ①-b 재시작 멘트 우선 구간
    if (this.isSpeaking) return;                    // ② 발화 중 금지
    if (t - this.lastSpeakAtSec < globalGapSec) return; // ③ 전역 최소 간격

    // 경사 코칭
    if (slope != null) {
      if (slope >= SLOPE_THRESHOLDS.uphill) {
        if (await this._trySay('uphill_detected')) return;
      } else if (slope <= SLOPE_THRESHOLDS.downhill) {
        if (await this._trySay('downhill_detected')) return;
      }
    }

    // 케이던스 코칭
    if (cadenceSpm > 0 && cadenceSpm < CADENCE_THRESHOLD) {
      if (await this._trySay('cadence_low')) return;
    }

    // ④ 페이스 판단 — 현재 / 평균 / 혼합
    let dev = null;
    if (judgeBasis === 'avg') {
      if (avgPaceSec > 0) dev = avgPaceSec - this.targetPaceSec;
    } else if (judgeBasis === 'current') {
      if (currentPaceSec > 0) dev = currentPaceSec - this.targetPaceSec;
    } else {
      // 혼합: 현재로 반응하되, 평균과 방향이 충돌하면(보정 중) 코칭을 보류한다
      if (currentPaceSec > 0) {
        const dc = currentPaceSec - this.targetPaceSec;
        const da = avgPaceSec > 0 ? avgPaceSec - this.targetPaceSec : dc;
        dev =
          Math.sign(dc) !== Math.sign(da) && Math.abs(dc) > sensSec && Math.abs(da) > sensSec
            ? 0
            : dc;
      }
    }

    if (dev != null) {
      this.recentDev.push(dev);
      if (this.recentDev.length > 3) this.recentDev.shift();
      const sustained =
        this.recentDev.length >= 2 &&
        this.recentDev.every((x) => Math.abs(x) > sensSec && Math.sign(x) === Math.sign(dev));

      if (sustained) {
        this.wasDeviated = true;
        if (await this._trySay(dev < 0 ? 'pace_too_fast' : 'pace_too_slow')) {
          this.recentDev = [];
          return;
        }
      }
      if (this.wasDeviated && Math.abs(dev) <= sensSec) {
        this.wasDeviated = false;
        if (await this._trySay('pace_recovered')) return;
      }
      if (Math.abs(dev) <= sensSec && t - this.lastSpeakAtSec > checkinSec * 0.8) {
        if (await this._trySay('pace_on_target')) return;
      }
    }

    // ⑥ 주기적 체크인 (최하위)
    if (t - this.lastSpeakAtSec > checkinSec) await this._trySay('idle_checkin');
  }

  // 쿨다운을 확인하고 발화 — 발화했으면 true (v10의 firePool과 같은 계약)
  async _trySay(situationId) {
    if (this.isSpeaking) return false;
    const situation = SITUATIONS[situationId];
    if (!situation) return false;
    // 체크인 간격은 설정값이 상황 쿨다운보다 우선한다
    const cooldown =
      situationId === 'idle_checkin' ? this.cfg.checkinSec : situation.cooldown_sec;
    const last = this.lastSpoken[situationId];
    if (last != null && (Date.now() - last) / 1000 < cooldown) return false;
    await this._playVariant(situationId, Date.now());
    return true;
  }

  async sayStart() {
    await this._playSituation('run_start', Date.now());
  }

  async sayPaused() {
    await this._playSituationForced('paused', Date.now());
  }

  // v7: 재시작 멘트 우선 — 재생 직후 잠시 페이스 코칭을 보류해 끼어들지 않게 한다
  async sayResume() {
    this.guardUntil = Date.now() + RESUME_GUARD_MS;
    await this._playSituationForced('resume', Date.now());
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) {
      Speech.stop();
      if (this.sound) this.sound.setStatusAsync({ volume: 0 }).catch(() => {});
    }
  }

  async _playSituation(situationId, now) {
    if (this.isSpeaking) return;
    await this._playVariant(situationId, now);
  }

  // isSpeaking 무시하고 강제 재생 (paused/resume/goal 전용 — 우선순위 발화)
  async _playSituationForced(situationId, now) {
    this.playToken++; // 진행 중이던 _play/_playSequence를 무효화 — 그쪽의 뒤늦은 finally가 지금부터 시작할 재생 상태를 덮어쓰지 못하게 함
    if (this.sound) {
      await this.sound.stopAsync().catch(() => {});
      await this.sound.unloadAsync().catch(() => {});
      this.sound = null;
    }
    Speech.stop();
    this.isSpeaking = false;
    await this._playVariant(situationId, now);
  }

  // situationId에 대한 다음 변형(오디오키/텍스트)을 고르기만 하고 재생하지 않음
  _pickVariant(situationId, now) {
    const situation = SITUATIONS[situationId];
    if (!situation) return null;

    const audioKeys = situation.audioKeys?.[this.persona] || [];
    const texts = situation.variants?.[this.persona] || [];

    const count = Math.max(audioKeys.length, texts.length);
    const idx = this._pickIndex(situationId, count);
    this.lastSpoken[situationId] = now;

    return { audioKey: audioKeys[idx] ?? audioKeys[0], text: texts[idx] ?? texts[0] };
  }

  // v6 셔플백: 한 상황의 모든 변형을 소진하기 전엔 같은 멘트를 반복하지 않는다
  _pickIndex(key, count) {
    if (count <= 1) return 0;
    let bag = this.bags[key];
    if (!bag || bag.length === 0) {
      bag = [...Array(count).keys()];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // 백 경계에서도 직전 멘트와 겹치지 않게
      if (bag[0] === this.lastVariantIndex[key] && bag.length > 1) {
        [bag[0], bag[1]] = [bag[1], bag[0]];
      }
      this.bags[key] = bag;
    }
    const idx = bag.shift();
    this.lastVariantIndex[key] = idx;
    return idx;
  }

  async _playVariant(situationId, now) {
    const picked = this._pickVariant(situationId, now);
    if (!picked) return;
    await this._play(picked.audioKey, picked.text, situationId);
  }

  _pickMilestone(km) {
    return {
      audioKey: MILESTONES.audioKeys?.[this.persona]?.[km],
      text: MILESTONES.ttsText?.[this.persona]?.[km] ?? milestoneFallbackText(this.persona, km),
    };
  }

  async _playMilestone(km) {
    const picked = this._pickMilestone(km);
    await this._play(picked.audioKey, picked.text, `milestone_${km}km`);
  }

  // 병합 멘트도 러너에겐 한 번의 발화 — 클립 수가 아니라 발화 단위로 로그를 남긴다
  _report(situationId, items) {
    this.lastSpeakAtSec = this.elapsedSec; // 전역 발화 간격 기준
    const withClip = items.filter((it) => it && audioMap[it.audioKey]).length;
    const src = this.muted
      ? 'mute'
      : withClip === items.length
        ? 'clip'
        : withClip === 0
          ? 'tts'
          : 'mixed';
    const text = items.map((it) => it?.text).filter(Boolean).join(' ');
    this.onSpeak?.({ sit: situationId, text, src });
    this.onStateChange?.({ speaking: true, text, sit: situationId });
  }

  _finishedSpeaking() {
    this.onStateChange?.({ speaking: false });
  }

  // v9: 병합 멘트 — 새로 합성하지 않고 기존 클립 여러 개를 순서대로 이어 재생
  async _playSequence(items, situationId) {
    if (this.isSpeaking) return;
    const token = ++this.playToken;
    this.isSpeaking = true;
    this._report(situationId, items);
    try {
      for (const item of items) {
        if (!item) continue;
        if (this.playToken !== token) break; // 도중에 강제 발화로 선점됨
        await this._playOne(item.audioKey, item.text, token);
      }
    } finally {
      if (this.playToken === token) {
        this.isSpeaking = false;
        this._finishedSpeaking();
      }
    }
  }

  async _play(audioKey, ttsText, situationId) {
    if (this.isSpeaking) return;
    const token = ++this.playToken;
    this.isSpeaking = true;
    this._report(situationId, [{ audioKey, text: ttsText }]);
    try {
      await this._playOne(audioKey, ttsText, token);
    } finally {
      if (this.playToken === token) {
        this.isSpeaking = false;
        this._finishedSpeaking();
      }
    }
  }

  // isSpeaking 가드 없이 클립 하나 재생 (단일 재생·시퀀스 재생 공용)
  async _playOne(audioKey, ttsText, token) {
    // 음소거 — 로그·말풍선은 남기되 소리는 내지 않는다 (말풍선이 깜빡이지 않게 잠깐 유지)
    if (this.muted) {
      await new Promise((r) => setTimeout(r, 1200));
      return;
    }
    try {
      const source = audioKey ? audioMap[audioKey] : null;
      if (source) {
        await this._playSound(source, token);
      } else if (ttsText) {
        await this._speakTTS(ttsText);
      }
    } catch {
      if (ttsText) await this._speakTTS(ttsText);
    }
  }

  async _playSound(source, token) {
    if (this.sound) {
      await this.sound.unloadAsync().catch(() => {});
      this.sound = null;
    }
    const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: true });
    if (token !== undefined && this.playToken !== token) {
      // 로딩되는 사이 강제 발화로 선점됨 — this.sound는 건드리지 않고 이 인스턴스만 정리
      await sound.unloadAsync().catch(() => {});
      return;
    }
    this.sound = sound;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish || status.error || !status.isLoaded) finish();
      });
      setTimeout(finish, PLAYBACK_TIMEOUT_MS);
    });
    await sound.unloadAsync().catch(() => {});
    if (this.playToken === token) this.sound = null;
  }

  async _speakTTS(text) {
    await new Promise((resolve) => {
      Speech.speak(text, {
        language: 'ko-KR',
        rate: 0.9,
        onDone: resolve,
        onError: resolve,
      });
    });
  }

  async destroy() {
    Speech.stop();
    if (this.sound) {
      await this.sound.unloadAsync();
      this.sound = null;
    }
  }
}
