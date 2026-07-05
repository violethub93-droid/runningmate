import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import {
  SITUATIONS,
  MILESTONES,
  PACE_THRESHOLDS,
  CADENCE_THRESHOLD,
  FINAL_PUSH_RATIO,
  HALFWAY_RATIO,
  SLOPE_THRESHOLDS,
  milestoneFallbackText,
} from '../data/mentData';
import audioMap from '../data/audioMap';

// 오디오 세션 인터럽트/언로드로 didJustFinish가 영영 안 올 때를 대비한 최대 대기 시간
const PLAYBACK_TIMEOUT_MS = 15000;

// v8: 거리 이벤트(마일스톤/반환점/막바지)는 GPS 갱신마다 즉시 재검사하되,
// 같은 이벤트가 짧은 시간 내 중복 발화되지 않도록 최소 간격만 둔다 (페이스 코칭용 쿨다운과는 별개)
const DIST_EVENT_GAP_MS = 2500;

// v7: 재시작 멘트 직후 페이스 코칭이 바로 끼어들지 않도록 잠시 보류하는 구간
const RESUME_GUARD_MS = 3500;

export class CoachingEngine {
  constructor({ persona = 'coach', targetPaceSec, targetDistanceKm, onGoalReached }) {
    this.persona = persona;
    this.targetPaceSec = targetPaceSec;
    this.targetDistanceKm = targetDistanceKm;
    this.onGoalReached = onGoalReached;
    this.lastSpoken = {};
    this.lastVariantIndex = {};
    this.passedMilestones = new Set();
    this.halfwayPlayed = false;
    this.finalPushPlayed = false;
    this.goalReached = false;
    this.sound = null;
    this.isSpeaking = false;
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
  async checkDistanceEvents({ distanceKm }) {
    if (this.goalReached) return;
    const now = Date.now();

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
      await this._playSequence([this._pickMilestone(km), this._pickVariant('halfway', now)]);
      return;
    }
    if (mDue && fDue) {
      this.passedMilestones.add(km);
      this.finalPushPlayed = true;
      this.lastDistEventAt = now;
      await this._playSequence([this._pickMilestone(km), this._pickVariant('final_push', now)]);
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
  async evaluate({ currentPaceSec, distanceKm, cadenceSpm, slope }) {
    if (this.goalReached) return;

    // 백업: GPS 콜백에서 이미 처리됐다면 여기선 조건 불충족으로 바로 반환됨
    await this.checkDistanceEvents({ distanceKm });
    if (this.goalReached) return;

    const now = Date.now();
    if (now < this.guardUntil) return; // v7: 재시작 직후엔 페이스 코칭 보류

    // 페이스 없으면 idle_checkin만
    if (!currentPaceSec || currentPaceSec <= 0) {
      if (this._canSpeak('idle_checkin', now)) {
        await this._playSituation('idle_checkin', now);
      }
      return;
    }

    // 경사 코칭
    if (slope !== undefined && slope !== null) {
      if (slope >= SLOPE_THRESHOLDS.uphill && this._canSpeak('uphill_detected', now)) {
        await this._playSituation('uphill_detected', now);
        return;
      }
      if (slope <= SLOPE_THRESHOLDS.downhill && this._canSpeak('downhill_detected', now)) {
        await this._playSituation('downhill_detected', now);
        return;
      }
    }

    // 케이던스 코칭
    if (cadenceSpm && cadenceSpm > 0 && cadenceSpm < CADENCE_THRESHOLD) {
      if (this._canSpeak('cadence_low', now)) {
        await this._playSituation('cadence_low', now);
        return;
      }
    }

    // 페이스 코칭
    const ratio = currentPaceSec / this.targetPaceSec;
    if (ratio < PACE_THRESHOLDS.tooFastRatio) {
      if (this._canSpeak('pace_too_fast', now)) {
        await this._playSituation('pace_too_fast', now);
        return;
      }
    } else if (ratio > PACE_THRESHOLDS.tooSlowRatio) {
      if (this._canSpeak('pace_too_slow', now)) {
        await this._playSituation('pace_too_slow', now);
        return;
      }
    } else {
      if (this._canSpeak('pace_on_target', now)) {
        await this._playSituation('pace_on_target', now);
        return;
      }
    }

    // 주기적 idle_checkin
    if (this._canSpeak('idle_checkin', now)) {
      await this._playSituation('idle_checkin', now);
    }
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

  _canSpeak(situationId, now) {
    if (this.isSpeaking) return false;
    const situation = SITUATIONS[situationId];
    if (!situation) return false;
    const last = this.lastSpoken[situationId] || 0;
    return (now - last) / 1000 >= situation.cooldown_sec;
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

    const lastIdx = this.lastVariantIndex[situationId] ?? -1;
    const count = Math.max(audioKeys.length, texts.length);
    let idx = lastIdx;
    if (count > 1) {
      while (idx === lastIdx) idx = Math.floor(Math.random() * count);
    } else {
      idx = 0;
    }
    this.lastVariantIndex[situationId] = idx;
    this.lastSpoken[situationId] = now;

    return { audioKey: audioKeys[idx] ?? audioKeys[0], text: texts[idx] ?? texts[0] };
  }

  async _playVariant(situationId, now) {
    const picked = this._pickVariant(situationId, now);
    if (!picked) return;
    await this._play(picked.audioKey, picked.text);
  }

  _pickMilestone(km) {
    return {
      audioKey: MILESTONES.audioKeys?.[this.persona]?.[km],
      text: MILESTONES.ttsText?.[this.persona]?.[km] ?? milestoneFallbackText(this.persona, km),
    };
  }

  async _playMilestone(km) {
    const picked = this._pickMilestone(km);
    await this._play(picked.audioKey, picked.text);
  }

  // v9: 병합 멘트 — 새로 합성하지 않고 기존 클립 여러 개를 순서대로 이어 재생
  async _playSequence(items) {
    if (this.isSpeaking) return;
    const token = ++this.playToken;
    this.isSpeaking = true;
    try {
      for (const item of items) {
        if (!item) continue;
        if (this.playToken !== token) break; // 도중에 강제 발화로 선점됨
        await this._playOne(item.audioKey, item.text, token);
      }
    } finally {
      if (this.playToken === token) this.isSpeaking = false;
    }
  }

  async _play(audioKey, ttsText) {
    if (this.isSpeaking) return;
    const token = ++this.playToken;
    this.isSpeaking = true;
    try {
      await this._playOne(audioKey, ttsText, token);
    } finally {
      if (this.playToken === token) this.isSpeaking = false;
    }
  }

  // isSpeaking 가드 없이 클립 하나 재생 (단일 재생·시퀀스 재생 공용)
  async _playOne(audioKey, ttsText, token) {
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
