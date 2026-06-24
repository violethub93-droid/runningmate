import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import {
  SITUATIONS,
  MILESTONES,
  PACE_THRESHOLDS,
  CADENCE_THRESHOLD,
  FINAL_PUSH_RATIO,
  SLOPE_THRESHOLDS,
} from '../data/mentData';
import audioMap from '../data/audioMap';

export class CoachingEngine {
  constructor({ persona = 'coach', targetPaceSec, targetDistanceKm }) {
    this.persona = persona;
    this.targetPaceSec = targetPaceSec; // 초/km (예: 7분/km = 420)
    this.targetDistanceKm = targetDistanceKm;
    this.lastSpoken = {};      // { situationId: timestamp }
    this.lastVariantIndex = {}; // { situationId: lastIndex } for anti-repeat
    this.passedMilestones = new Set();
    this.sound = null;
    this.isSpeaking = false;

    // 오디오 세션 설정 (백그라운드 재생 허용)
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      stayAwakeEnabled: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
    });
  }

  // 메인 코칭 판단 함수 — RunningScreen에서 매초 호출
  async evaluate({ currentPaceSec, distanceKm, cadenceSpm, elevationGain, slope }) {
    const now = Date.now();

    // 1. 마일스톤 체크 (최우선)
    const km = Math.floor(distanceKm);
    if (km >= 1 && !this.passedMilestones.has(km) && km <= 5) {
      this.passedMilestones.add(km);
      await this._playMilestone(km);
      return;
    }

    // 2. final_push (목표 거리 85% 이후)
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

    // 페이스가 없으면 idle_checkin만
    if (!currentPaceSec || currentPaceSec <= 0) {
      if (this._canSpeak('idle_checkin', now)) {
        await this._playSituation('idle_checkin', now);
      }
      return;
    }

    // 3. 경사 코칭
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

    // 4. 케이던스 코칭
    if (cadenceSpm && cadenceSpm > 0 && cadenceSpm < CADENCE_THRESHOLD) {
      if (this._canSpeak('cadence_low', now)) {
        await this._playSituation('cadence_low', now);
        return;
      }
    }

    // 5. 페이스 코칭
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
      // on_target
      if (this._canSpeak('pace_on_target', now)) {
        await this._playSituation('pace_on_target', now);
        return;
      }
    }

    // 6. 주기적 idle_checkin
    if (this._canSpeak('idle_checkin', now)) {
      await this._playSituation('idle_checkin', now);
    }
  }

  // 러닝 시작 멘트
  async sayStart() {
    await this._playSituation('run_start', Date.now());
  }

  _canSpeak(situationId, now) {
    if (this.isSpeaking) return false;
    const situation = SITUATIONS[situationId];
    if (!situation) return false;
    const last = this.lastSpoken[situationId] || 0;
    return (now - last) / 1000 >= situation.cooldown_sec;
  }

  async _playSituation(situationId, now) {
    const situation = SITUATIONS[situationId];
    if (!situation) return;

    const audioKeys = situation.audioKeys?.[this.persona] || [];
    const texts = situation.variants?.[this.persona] || [];

    // anti-repeat: 직전 인덱스와 다른 것 선택
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

    const audioKey = audioKeys[idx] || audioKeys[0];
    const text = texts[idx] || texts[0];

    await this._play(audioKey, text);
  }

  async _playMilestone(km) {
    const audioKey = MILESTONES.audioKeys?.[this.persona]?.[km];
    const text = MILESTONES.ttsText?.[this.persona]?.[km];
    await this._play(audioKey, text);
  }

  // mp3가 audioMap에 있으면 재생, 없으면 TTS
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
    } catch (e) {
      // 재생 실패 시 TTS로 폴백
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
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) resolve();
      });
    });
    await sound.unloadAsync();
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
