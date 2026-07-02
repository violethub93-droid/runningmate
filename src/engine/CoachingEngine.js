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
} from '../data/mentData';
import audioMap from '../data/audioMap';

// 오디오 세션 인터럽트/언로드로 didJustFinish가 영영 안 올 때를 대비한 최대 대기 시간
const PLAYBACK_TIMEOUT_MS = 15000;

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
    this.goalReached = false;
    this.sound = null;
    this.isSpeaking = false;

    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
  }

  // 메인 코칭 판단 함수 — RunningScreen에서 매 5초 호출
  async evaluate({ currentPaceSec, distanceKm, cadenceSpm, slope }) {
    const now = Date.now();

    // 1. 목표 완주 체크 (마일스톤보다 우선)
    if (
      this.targetDistanceKm > 0 &&
      !this.goalReached &&
      distanceKm >= this.targetDistanceKm
    ) {
      this.goalReached = true;
      await this._playSituation('goal', now);
      this.onGoalReached?.();
      return;
    }

    // 2. 마일스톤 체크
    const km = Math.floor(distanceKm);
    if (km >= 1 && !this.passedMilestones.has(km) && km <= 5) {
      this.passedMilestones.add(km);
      await this._playMilestone(km);
      return;
    }

    // 3. 반환점 체크 (50%)
    if (
      this.targetDistanceKm > 0 &&
      !this.halfwayPlayed &&
      distanceKm >= this.targetDistanceKm * HALFWAY_RATIO
    ) {
      this.halfwayPlayed = true;
      await this._playSituation('halfway', now);
      return;
    }

    // 4. 막바지 체크 (85% ~ 100%)
    if (
      this.targetDistanceKm > 0 &&
      distanceKm >= this.targetDistanceKm * FINAL_PUSH_RATIO &&
      distanceKm < this.targetDistanceKm
    ) {
      if (this._canSpeak('final_push', now)) {
        await this._playSituation('final_push', now);
        return;
      }
    }

    // 페이스 없으면 idle_checkin만
    if (!currentPaceSec || currentPaceSec <= 0) {
      if (this._canSpeak('idle_checkin', now)) {
        await this._playSituation('idle_checkin', now);
      }
      return;
    }

    // 5. 경사 코칭
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

    // 6. 케이던스 코칭
    if (cadenceSpm && cadenceSpm > 0 && cadenceSpm < CADENCE_THRESHOLD) {
      if (this._canSpeak('cadence_low', now)) {
        await this._playSituation('cadence_low', now);
        return;
      }
    }

    // 7. 페이스 코칭
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

    // 8. 주기적 idle_checkin
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

  async sayResume() {
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

  // isSpeaking 무시하고 강제 재생 (paused/resume 전용)
  async _playSituationForced(situationId, now) {
    if (this.sound) {
      await this.sound.stopAsync().catch(() => {});
      await this.sound.unloadAsync().catch(() => {});
      this.sound = null;
    }
    Speech.stop();
    this.isSpeaking = false;
    await this._playVariant(situationId, now);
  }

  async _playVariant(situationId, now) {
    const situation = SITUATIONS[situationId];
    if (!situation) return;

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

    const audioKey = audioKeys[idx] ?? audioKeys[0];
    const text = texts[idx] ?? texts[0];
    await this._play(audioKey, text);
  }

  async _playMilestone(km) {
    const audioKey = MILESTONES.audioKeys?.[this.persona]?.[km];
    const text = MILESTONES.ttsText?.[this.persona]?.[km];
    await this._play(audioKey, text);
  }

  async _play(audioKey, ttsText) {
    if (this.isSpeaking) return;
    this.isSpeaking = true;
    try {
      const source = audioKey ? audioMap[audioKey] : null;
      if (source) {
        await this._playSound(source);
      } else if (ttsText) {
        await this._speakTTS(ttsText);
      }
    } catch {
      if (ttsText) await this._speakTTS(ttsText);
    } finally {
      this.isSpeaking = false;
    }
  }

  async _playSound(source) {
    if (this.sound) {
      await this.sound.unloadAsync();
      this.sound = null;
    }
    const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: true });
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
    this.sound = null;
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
