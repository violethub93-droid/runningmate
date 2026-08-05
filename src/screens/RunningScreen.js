import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, Vibration, ScrollView, Animated, Easing,
} from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { CoachingEngine } from '../engine/CoachingEngine';
import {
  createRunLog, addSample, addSpeech, openPause, closePause,
  finalizeRunLog, saveRun,
} from '../data/runLog';
import {
  DEFAULTS, PAUSE_SPEED_MPS, RESUME_SPEED_MPS, BASIS_LABEL, paceLabel, clockLabel,
} from '../data/settings';
import { BgmPlayer } from '../audio/BgmPlayer';
import { C } from '../theme';

const SAMPLE_EVERY_SEC = 3;        // 러닝 로그 샘플 주기
const COACHING_INTERVAL_MS = 3000; // 코칭 판단 주기
const GPS_UPDATE_MS = 1000;
const PACE_BUF = 5;                // 페이스 중앙값 스무딩 창
const PAUSED_MANTRA_MS = 50000;    // 정지 상태에서 재정비 멘트 반복 간격
const MAX_LOG = 30;

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export default function RunningScreen({ route, navigation }) {
  const { persona, targetPaceSec, targetDistanceKm } = route.params;
  const cfg = { ...DEFAULTS, ...(route.params.settings || {}) };

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState(null); // 'auto' | 'manual'
  const [elapsedSec, setElapsedSec] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentPaceSec, setCurrentPaceSec] = useState(0);
  const [rawPaceSec, setRawPaceSec] = useState(0);
  const [accuracyM, setAccuracyM] = useState(null);
  const [cadenceSpm, setCadenceSpm] = useState(0);
  const [muted, setMuted] = useState(false);
  const [audioStat, setAudioStat] = useState({ clip: 0, tts: 0 });
  const [coachLine, setCoachLine] = useState('GPS를 잡으면 곧 시작할게요.');
  const [speaking, setSpeaking] = useState(false);
  const [speechLog, setSpeechLog] = useState([]);
  const [locationError, setLocationError] = useState(null);

  // 코칭 타이머 내 스테일 클로저 방지용 refs
  const currentPaceRef = useRef(0);
  const distanceKmRef = useRef(0);
  const cadenceSpmRef = useRef(0);
  const elapsedSecRef = useRef(0);
  const avgPaceRef = useRef(0);

  // 자동 일시정지 — 히스테리시스(정지·재시작 임계 분리 + 지속 시간 요구)
  const isPausedRef = useRef(false);
  const lastAbovePauseMsRef = useRef(0);
  const moveStreakStartRef = useRef(0);
  const pausedMantraAtRef = useRef(0);

  const engineRef = useRef(null);
  const timerRef = useRef(null);
  const coachingTimerRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  const accelSubscriptionRef = useRef(null);
  const prevLocationRef = useRef(null);
  const accelWindowRef = useRef([]);
  const paceBufRef = useRef([]);
  const transitionLockRef = useRef(false);

  // 러닝 로그
  const runLogRef = useRef(null);
  const gpsAccuracyRef = useRef(null);
  const pauseStartMsRef = useRef(0);

  // 케이던스 동기화 BGM
  const bgmRef = useRef(null);
  const [bgmOn, setBgmOn] = useState(false);

  // 말풍선 웨이브 애니메이션
  const wave = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!speaking) { wave.stopAnimation(); wave.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wave, { toValue: 1, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(wave, { toValue: 0, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [speaking, wave]);

  const distanceLabel = (km) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(2)}km`);

  const gpsBadge = () => {
    if (isPaused) return { text: pauseReason === 'auto' ? '자동 일시정지' : '일시정지', color: C.blue };
    if (accuracyM == null) return { text: 'GPS 잡는 중…', color: C.bad };
    if (accuracyM <= 12) return { text: 'GPS 양호', color: C.good };
    if (accuracyM <= 25) return { text: 'GPS 보통', color: C.warm };
    return { text: 'GPS 약함', color: C.bad };
  };

  const paceStatus = () => {
    if (isPaused || !currentPaceSec) return { text: '대기중', color: C.muted };
    const dev = currentPaceSec - targetPaceSec;
    if (Math.abs(dev) <= cfg.sensSec) return { text: '유지 ✓', color: C.good };
    return dev < 0 ? { text: '빠름 ↑', color: C.warm } : { text: '느림 ↓', color: C.blue };
  };

  const stateTag = () => {
    if (isPaused) return { tag: '일시정지', left: '' };
    const remain = cfg.warmupSec - elapsedSec;
    if (remain > 0) return { tag: '워밍업', left: `${Math.ceil(remain)}초` };
    return { tag: '발화간격', left: `${cfg.globalGapSec}초↑` };
  };

  const haversineKm = (loc1, loc2) => {
    const R = 6371;
    const dLat = ((loc2.latitude - loc1.latitude) * Math.PI) / 180;
    const dLon = ((loc2.longitude - loc1.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((loc1.latitude * Math.PI) / 180) *
        Math.cos((loc2.latitude * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const updateCadence = useCallback((accelData) => {
    const mag = Math.sqrt(accelData.x ** 2 + accelData.y ** 2 + accelData.z ** 2);
    const win = accelWindowRef.current;
    win.push({ mag, time: Date.now() });
    if (win.length > 50) win.shift();
    if (win.length >= 50) {
      const avg = win.reduce((s, w) => s + w.mag, 0) / win.length;
      let peaks = 0;
      for (let i = 1; i < win.length - 1; i++) {
        if (win[i].mag > avg * 1.05 && win[i].mag >= win[i - 1].mag && win[i].mag >= win[i + 1].mag) peaks++;
      }
      const spm = Math.min(peaks * 60, 220);
      setCadenceSpm(spm);
      cadenceSpmRef.current = spm;
    }
  }, []);

  // 정지 구간 기록 — 자동↔수동 전환으로 구간이 겹쳐도 열린 구간을 먼저 닫는다
  const endPauseLog = () => {
    if (!pauseStartMsRef.current) return;
    closePause(runLogRef.current, { durSec: (Date.now() - pauseStartMsRef.current) / 1000 });
    pauseStartMsRef.current = 0;
  };
  const beginPauseLog = (reason) => {
    endPauseLog();
    pauseStartMsRef.current = Date.now();
    openPause(runLogRef.current, { t: elapsedSecRef.current, reason });
  };

  const startTimer = () => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setElapsedSec((s) => {
        const next = s + 1;
        elapsedSecRef.current = next;
        const km = distanceKmRef.current;
        avgPaceRef.current = km > 0.03 ? Math.round(next / km) : 0;
        if (next % SAMPLE_EVERY_SEC === 0) {
          addSample(runLogRef.current, {
            t: next,
            distanceKm: km,
            paceSec: currentPaceRef.current,
            cadenceSpm: cadenceSpmRef.current,
            accuracyM: gpsAccuracyRef.current,
            paused: false,
          });
        }
        return next;
      });
    }, 1000);
  };

  const stopTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startCoachingLoop = () => {
    if (coachingTimerRef.current) return;
    coachingTimerRef.current = setInterval(async () => {
      if (!engineRef.current) return;
      if (isPausedRef.current) {
        // 정지 상태에서는 주기적으로 재정비 멘트만
        if (!engineRef.current.isSpeaking && Date.now() - pausedMantraAtRef.current > PAUSED_MANTRA_MS) {
          pausedMantraAtRef.current = Date.now();
          await engineRef.current.sayPaused();
        }
        return;
      }
      // 자동 일시정지 판정 — 저속이 설정 시간만큼 지속됐을 때만
      if (
        elapsedSecRef.current > cfg.warmupSec &&
        lastAbovePauseMsRef.current &&
        Date.now() - lastAbovePauseMsRef.current > cfg.pauseSec * 1000
      ) {
        enterPause('auto');
        return;
      }
      await engineRef.current.evaluate({
        elapsedSec: elapsedSecRef.current,
        currentPaceSec: currentPaceRef.current,
        avgPaceSec: avgPaceRef.current,
        distanceKm: distanceKmRef.current,
        cadenceSpm: cadenceSpmRef.current,
        slope: null,
      });
    }, COACHING_INTERVAL_MS);
  };

  const stopCoachingLoop = () => {
    clearInterval(coachingTimerRef.current);
    coachingTimerRef.current = null;
  };

  // GPS 콜백 — 속도는 기기 제공값 대신 위치 델타로 계산(coords.speed가 null인 기기 대응)
  const makeGpsCallback = () => (loc) => {
    const acc = loc.coords.accuracy;
    gpsAccuracyRef.current = acc;
    setAccuracyM(acc);

    // 정확도가 너무 나쁜 표본은 거리·페이스에 반영하지 않는다
    if (acc != null && acc > 30) {
      prevLocationRef.current = loc;
      return;
    }

    const prev = prevLocationRef.current;
    if (prev) {
      const dKm = haversineKm(prev.coords, loc.coords);
      const dt = (loc.timestamp - prev.timestamp) / 1000;
      if (dt > 0.3) {
        const spd = (dKm * 1000) / dt; // m/s
        const now = Date.now();

        if (spd > PAUSE_SPEED_MPS) lastAbovePauseMsRef.current = now;
        if (spd >= RESUME_SPEED_MPS) {
          if (!moveStreakStartRef.current) moveStreakStartRef.current = now;
        } else {
          moveStreakStartRef.current = 0;
        }

        if (isPausedRef.current) {
          // 충분히 지속 이동해야 재시작 (살짝 움직임에 반응하지 않게)
          if (
            pauseReasonRef.current === 'auto' &&
            moveStreakStartRef.current &&
            now - moveStreakStartRef.current >= cfg.resumeSec * 1000
          ) {
            exitPause('auto');
          }
        } else if (spd > PAUSE_SPEED_MPS && spd < 6.5) {
          const newKm = distanceKmRef.current + dKm;
          distanceKmRef.current = newKm;
          setDistanceKm(newKm);

          const raw = 1000 / spd;
          setRawPaceSec(raw);
          const buf = paceBufRef.current;
          buf.push(raw);
          if (buf.length > PACE_BUF) buf.shift();
          const smoothed = median(buf);
          currentPaceRef.current = smoothed;
          setCurrentPaceSec(smoothed);

          // 거리 이벤트는 GPS 갱신마다 즉시 검사 — km 밟는 순간 발화
          engineRef.current?.checkDistanceEvents({
            distanceKm: newKm,
            elapsedSec: elapsedSecRef.current,
          });
        }
      }
    }
    prevLocationRef.current = loc;
  };

  // pauseReason을 GPS 콜백에서 최신값으로 읽기 위한 ref
  const pauseReasonRef = useRef(null);

  const enterPause = (reason) => {
    if (isPausedRef.current) return;
    isPausedRef.current = true;
    pauseReasonRef.current = reason;
    setIsPaused(true);
    setPauseReason(reason);
    moveStreakStartRef.current = 0;
    pausedMantraAtRef.current = Date.now();
    stopTimer();
    beginPauseLog(reason);
    bgmRef.current?.pause(reason);
    if (reason === 'manual') {
      // 수동 정지는 센서까지 내린다 (배터리)
      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = null;
      accelSubscriptionRef.current?.remove();
      accelSubscriptionRef.current = null;
    }
    engineRef.current?.sayPaused();
  };

  const exitPause = async (reason) => {
    if (!isPausedRef.current) return;
    if (transitionLockRef.current) return;
    transitionLockRef.current = true;
    try {
      isPausedRef.current = false;
      pauseReasonRef.current = null;
      setIsPaused(false);
      setPauseReason(null);
      moveStreakStartRef.current = 0;
      lastAbovePauseMsRef.current = Date.now();
      endPauseLog();
      startTimer();
      bgmRef.current?.resume();
      await subscribeSensors();
      await engineRef.current?.sayResume();
    } finally {
      transitionLockRef.current = false;
    }
  };

  const startRun = async () => {
    if (transitionLockRef.current) return;
    transitionLockRef.current = true;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('위치 권한이 필요해요. 설정에서 허용해주세요.');
        return;
      }

      setIsRunning(true);
      setIsPaused(false);
      isPausedRef.current = false;
      lastAbovePauseMsRef.current = Date.now();
      activateKeepAwakeAsync();

      runLogRef.current = createRunLog({ persona, targetPaceSec, targetDistanceKm, settings: cfg });

      engineRef.current = new CoachingEngine({
        persona,
        targetPaceSec,
        targetDistanceKm,
        settings: cfg,
        onGoalReached: () => finishRunRef.current?.(),
        onSpeak: ({ sit, text, src }) => {
          const t = elapsedSecRef.current;
          addSpeech(runLogRef.current, { t, sit, text, src });
          setCoachLine(text);
          setAudioStat((s) =>
            src === 'clip' ? { ...s, clip: s.clip + 1 }
            : src === 'tts' ? { ...s, tts: s.tts + 1 }
            : s
          );
          setSpeechLog((prev) => [{ t, sit, text, src }, ...prev].slice(0, MAX_LOG));
        },
        onStateChange: ({ speaking: sp }) => {
          setSpeaking(sp);
          bgmRef.current?.setDucked(sp); // 멘트가 나가는 동안 배경음을 낮춘다
        },
      });

      // BGM은 발화와 독립적으로 시작 (실패해도 러닝에는 영향 없음)
      if (cfg.bgmBpm) {
        bgmRef.current = new BgmPlayer();
        bgmRef.current.start(cfg.bgmBpm).then((ok) => setBgmOn(ok));
      }

      await engineRef.current.sayStart();

      startTimer();
      // ★ 코칭 루프는 센서·GPS 구독보다 먼저 띄운다.
      // 구독을 await한 뒤에 두면 구독이 늦거나 실패할 때 코칭이 영영 시작되지 않는다.
      startCoachingLoop();

      await subscribeSensors();
    } finally {
      transitionLockRef.current = false;
    }
  };

  // GPS·가속도 구독 — 한쪽이 실패해도 나머지와 코칭 루프는 계속 살아있게 한다
  const subscribeSensors = async () => {
    if (!locationSubscriptionRef.current) {
      try {
        locationSubscriptionRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: GPS_UPDATE_MS, distanceInterval: 3 },
          makeGpsCallback()
        );
      } catch {
        setLocationError('위치 정보를 받지 못했어요. 권한과 GPS를 확인해주세요.');
      }
    }
    if (!accelSubscriptionRef.current) {
      // 케이던스는 있으면 좋은 부가 정보 — 미지원 기기(웹 등)에서 실패해도 러닝은 계속된다
      try {
        Accelerometer.setUpdateInterval(50);
        accelSubscriptionRef.current = Accelerometer.addListener(updateCadence);
      } catch {
        accelSubscriptionRef.current = null;
      }
    }
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      engineRef.current?.setMuted(next);
      return next;
    });
  };

  const finishRun = useCallback(async () => {
    stopTimer();
    stopCoachingLoop();
    locationSubscriptionRef.current?.remove();
    accelSubscriptionRef.current?.remove();
    const goalReached = !!engineRef.current?.goalReached;
    await engineRef.current?.destroy();
    await bgmRef.current?.stop();
    bgmRef.current = null;
    deactivateKeepAwake();
    Vibration.vibrate(200);

    const elapsed = elapsedSecRef.current;
    const dist = distanceKmRef.current;
    const avgPaceSec = elapsed > 0 && dist > 0 ? Math.round(elapsed / dist) : 0;

    endPauseLog();
    const log = finalizeRunLog(runLogRef.current, {
      elapsedSec: elapsed,
      distanceKm: dist,
      avgPaceSec,
      goalReached,
    });
    if (log) await saveRun(log);

    navigation.replace('Summary', {
      elapsedSec: elapsed,
      distanceKm: dist,
      avgPaceSec,
      persona,
      targetPaceSec,
      targetDistanceKm,
      runLog: log,
    });
  }, [navigation, persona, targetPaceSec, targetDistanceKm]);

  const finishRunRef = useRef(finishRun);
  useEffect(() => { finishRunRef.current = finishRun; }, [finishRun]);

  useEffect(() => {
    return () => {
      stopTimer();
      stopCoachingLoop();
      locationSubscriptionRef.current?.remove();
      accelSubscriptionRef.current?.remove();
      engineRef.current?.destroy();
      bgmRef.current?.stop();
      deactivateKeepAwake();
    };
  }, []);

  if (locationError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{locationError}</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>돌아가기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const badge = gpsBadge();
  const status = paceStatus();
  const st = stateTag();
  const progress = targetDistanceKm > 0 ? Math.min((distanceKm / targetDistanceKm) * 100, 100) : 0;
  const waveH = wave.interpolate({ inputRange: [0, 1], outputRange: [4, 13] });

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.night} />
      <View style={styles.container}>

        {/* 상단: GPS 상태 · 음성 토글 */}
        <View style={styles.topBar}>
          <View style={[styles.pill, { borderColor: badge.color }]}>
            <Text style={[styles.pillTxt, { color: badge.color }]}>{badge.text}</Text>
          </View>
          <TouchableOpacity style={styles.pill} onPress={toggleMute}>
            <Text style={styles.pillTxt}>{muted ? '🔇 음성 꺼짐' : '🔊 음성 켜짐'}</Text>
          </TouchableOpacity>
        </View>

        {/* 진행 바 */}
        {targetDistanceKm > 0 && (
          <View style={styles.progBg}>
            <View style={[styles.progFill, { width: `${progress}%` }]} />
          </View>
        )}

        {/* 큰 페이스 */}
        <View style={styles.paceBlock}>
          <Text style={styles.paceLabel}>{BASIS_LABEL[cfg.judgeBasis]}</Text>
          <Text style={[styles.paceBig, { color: isPaused ? C.blue : status.color }]}>
            {isPaused ? "--'--" : paceLabel(currentPaceSec)}
          </Text>
          <Text style={styles.paceUnit}>min / km · {status.text}</Text>
          <Text style={styles.debug}>
            <Text style={styles.debugKey}>원시 </Text>{paceLabel(rawPaceSec)}
            <Text style={styles.debugKey}>  정확도 </Text>{accuracyM == null ? '--' : Math.round(accuracyM)}m
            <Text style={styles.debugKey}>  {st.tag} </Text>{st.left}
            <Text style={styles.debugKey}>  오디오 </Text>
            <Text style={{ color: C.good }}>{audioStat.clip}</Text>/
            <Text style={{ color: C.bad }}>{audioStat.tts}</Text>
            {cfg.bgmBpm ? (
              <>
                <Text style={styles.debugKey}>  BGM </Text>
                <Text style={{ color: bgmOn ? (speaking ? C.blue : C.good) : C.bad }}>
                  {bgmOn ? `${cfg.bgmBpm}${speaking ? ' 낮춤' : ''}` : '실패'}
                </Text>
              </>
            ) : null}
          </Text>
        </View>

        {/* 보조 지표 */}
        <View style={styles.metrics}>
          {[
            { v: clockLabel(elapsedSec), l: '시간' },
            { v: distanceLabel(distanceKm), l: '거리' },
            { v: paceLabel(avgPaceRef.current), l: '평균 페이스' },
            { v: cadenceSpm > 0 ? String(cadenceSpm) : '--', l: 'spm' },
          ].map((m) => (
            <View key={m.l} style={styles.metric}>
              <Text style={styles.metricVal}>{m.v}</Text>
              <Text style={styles.metricLbl}>{m.l}</Text>
            </View>
          ))}
        </View>

        {/* 메이트 말풍선 */}
        <View style={[styles.coach, speaking && styles.coachSpeaking, isPaused && styles.coachPaused]}>
          <View style={[styles.orb, speaking && { borderColor: C.warm }]}>
            <View style={styles.waveRow}>
              {[0, 1, 2, 3].map((i) => (
                <Animated.View
                  key={i}
                  style={[styles.waveBar, { height: speaking ? waveH : 4 }]}
                />
              ))}
            </View>
          </View>
          <View style={styles.coachTextBox}>
            <Text style={styles.coachWho}>
              메이트 · {persona === 'coach' ? '코치' : '친구'}
            </Text>
            <Text style={styles.coachLine} numberOfLines={3}>{coachLine}</Text>
          </View>
        </View>

        {/* 발화 로그 */}
        <View style={styles.logBox}>
          <Text style={styles.logTitle}>발화 로그 (시간 · 상황 · 음원)</Text>
          <ScrollView style={styles.logScroll}>
            {speechLog.length === 0 ? (
              <Text style={styles.logEmpty}>아직 발화가 없어요.</Text>
            ) : (
              speechLog.map((e, i) => (
                <View key={`${e.t}-${i}`} style={styles.logItem}>
                  <Text style={styles.logTime}>{clockLabel(e.t)}</Text>
                  <Text
                    style={[
                      styles.logSrc,
                      { color: e.src === 'clip' ? C.good : e.src === 'mute' ? C.blue : C.bad },
                    ]}
                  >
                    {e.src === 'clip' ? '클로바' : e.src === 'mute' ? '음소거' : e.src === 'mixed' ? '혼합' : 'TTS'}
                  </Text>
                  <Text style={styles.logTxt} numberOfLines={1}>{e.text}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>

        {/* 컨트롤 */}
        <View style={styles.controls}>
          {!isRunning ? (
            <TouchableOpacity style={styles.btnStart} onPress={startRun}>
              <Text style={styles.btnStartTxt}>▶  시작</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.btnPause}
                onPress={() => (isPaused ? exitPause('manual') : enterPause('manual'))}
              >
                <Text style={styles.btnPauseTxt}>{isPaused ? '▶  재개' : '⏸  일시정지'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnFinish} onPress={finishRun}>
                <Text style={styles.btnFinishTxt}>종료</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.night },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 10, maxWidth: 460, width: '100%', alignSelf: 'center' },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  pill: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  pillTxt: { fontSize: 11, fontWeight: '500', color: C.muted },

  progBg: { height: 5, backgroundColor: C.surface2, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progFill: { height: '100%', backgroundColor: C.warm, borderRadius: 3 },

  paceBlock: { alignItems: 'center', marginTop: 4 },
  paceLabel: { fontSize: 12, color: C.muted },
  paceBig: { fontSize: 66, fontWeight: '800', letterSpacing: -2, lineHeight: 72 },
  paceUnit: { fontSize: 12, color: C.muted },
  debug: { fontSize: 10, color: C.text, marginTop: 6 },
  debugKey: { color: C.cool },

  metrics: { flexDirection: 'row', gap: 6, marginTop: 10 },
  metric: {
    flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 11, paddingVertical: 9, alignItems: 'center',
  },
  metricVal: { fontSize: 16, fontWeight: '700', color: C.text },
  metricLbl: { fontSize: 10, color: C.muted, marginTop: 2 },

  coach: {
    marginTop: 9, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62,
  },
  coachSpeaking: { borderColor: C.warm, backgroundColor: '#1A1410' },
  coachPaused: { borderColor: '#25364A', backgroundColor: '#101824' },
  orb: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#1F1610',
    borderWidth: 1, borderColor: C.warmSoft, alignItems: 'center', justifyContent: 'center',
  },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 14 },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: C.warm },
  coachTextBox: { flex: 1 },
  coachWho: { fontSize: 10, color: C.warm, fontWeight: '500', marginBottom: 2 },
  coachLine: { fontSize: 13.5, color: C.text, lineHeight: 19 },

  logBox: {
    marginTop: 9, backgroundColor: '#0E1320', borderWidth: 1, borderColor: C.line,
    borderRadius: 11, padding: 9, flex: 1, minHeight: 70,
  },
  logTitle: { fontSize: 10, color: C.cool, letterSpacing: 0.6, marginBottom: 5 },
  logScroll: { flex: 1 },
  logEmpty: { fontSize: 11, color: C.cool },
  logItem: { flexDirection: 'row', gap: 6, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#161D2C' },
  logTime: { fontSize: 11, color: C.muted, width: 34 },
  logSrc: { fontSize: 10, width: 38 },
  logTxt: { flex: 1, fontSize: 11, color: '#C2C9D6' },

  controls: { flexDirection: 'row', gap: 9, marginTop: 10, paddingBottom: 8 },
  btnStart: { flex: 1, backgroundColor: C.warm, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  btnStartTxt: { fontSize: 16, fontWeight: '700', color: '#1A0E08' },
  btnPause: {
    flex: 2, backgroundColor: C.surface2, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#25364A',
  },
  btnPauseTxt: { fontSize: 15, fontWeight: '600', color: C.blue },
  btnFinish: {
    flex: 1, backgroundColor: C.surface2, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', borderWidth: 1, borderColor: C.warmSoft,
  },
  btnFinishTxt: { fontSize: 15, fontWeight: '600', color: C.warm },

  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 15, color: C.bad, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  backBtn: { backgroundColor: C.surface2, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  backBtnText: { fontSize: 15, color: C.text, fontWeight: '600' },
});
