import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, Vibration,
} from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { CoachingEngine } from '../engine/CoachingEngine';

const COACHING_INTERVAL_MS = 5000;
const GPS_UPDATE_MS = 2000;
const AUTO_PAUSE_SPEED_MPS = 0.3;   // 이 속도 이하 3연속 → 자동 일시정지
const AUTO_RESUME_SPEED_MPS = 0.5;  // 이 속도 이상 → 자동 재시작
const AUTO_PAUSE_COUNT = 3;          // 연속 저속 감지 횟수

export default function RunningScreen({ route, navigation }) {
  const { persona, targetPaceSec, targetDistanceKm } = route.params;

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isAutoPaused, setIsAutoPaused] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentPaceSec, setCurrentPaceSec] = useState(0);
  const [cadenceSpm, setCadenceSpm] = useState(0);
  const [locationError, setLocationError] = useState(null);

  // 코칭 타이머 내 스테일 클로저 방지용 refs
  const currentPaceRef = useRef(0);
  const distanceKmRef = useRef(0);
  const cadenceSpmRef = useRef(0);
  const elapsedSecRef = useRef(0);

  // 자동 일시정지 상태 ref (GPS 콜백 내에서 최신값 필요)
  const isAutoPausedRef = useRef(false);
  const slowReadingsRef = useRef(0);

  const engineRef = useRef(null);
  const timerRef = useRef(null);
  const coachingTimerRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  const accelSubscriptionRef = useRef(null);
  const prevLocationRef = useRef(null);
  const accelWindowRef = useRef([]);

  const paceLabel = (sec) => {
    if (!sec || sec <= 0) return '--:--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const distanceLabel = (km) => {
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(2)}km`;
  };

  const timeLabel = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const paceStatus = () => {
    if (!currentPaceSec || currentPaceSec <= 0 || !targetPaceSec) return 'neutral';
    const ratio = currentPaceSec / targetPaceSec;
    if (ratio < 0.92) return 'fast';
    if (ratio > 1.12) return 'slow';
    return 'on';
  };

  const targetPaceLabel = () => {
    const m = Math.floor(targetPaceSec / 60);
    const s = targetPaceSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setElapsedSec((s) => {
        elapsedSecRef.current = s + 1;
        return s + 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startCoachingLoop = () => {
    coachingTimerRef.current = setInterval(async () => {
      if (engineRef.current && !isAutoPausedRef.current) {
        await engineRef.current.evaluate({
          currentPaceSec: currentPaceRef.current,
          distanceKm: distanceKmRef.current,
          cadenceSpm: cadenceSpmRef.current,
          slope: null,
        });
      }
    }, COACHING_INTERVAL_MS);
  };

  // GPS 콜백 — auto-pause/resume 포함. isPaused(수동)와 별개로 동작.
  const makeGpsCallback = () => (loc) => {
    const speed = loc.coords.speed ?? 0;

    // 자동 일시정지/재시작 감지
    if (speed < AUTO_PAUSE_SPEED_MPS) {
      slowReadingsRef.current += 1;
      if (slowReadingsRef.current >= AUTO_PAUSE_COUNT && !isAutoPausedRef.current) {
        isAutoPausedRef.current = true;
        setIsAutoPaused(true);
        stopTimer();
        engineRef.current?.sayPaused();
      }
    } else {
      if (isAutoPausedRef.current && speed >= AUTO_RESUME_SPEED_MPS) {
        isAutoPausedRef.current = false;
        setIsAutoPaused(false);
        slowReadingsRef.current = 0;
        startTimer();
        engineRef.current?.sayResume();
      } else if (!isAutoPausedRef.current) {
        slowReadingsRef.current = 0;
      }
    }

    // 자동 일시정지 중엔 거리·페이스 동결
    if (isAutoPausedRef.current) {
      prevLocationRef.current = loc;
      return;
    }

    const prev = prevLocationRef.current;
    if (prev) {
      const d = haversineKm(prev.coords, loc.coords);
      if (d > 0.003) {
        setDistanceKm((km) => {
          const newKm = km + d;
          distanceKmRef.current = newKm;
          return newKm;
        });
      }
      if (speed > 0.5) {
        const paceSec = Math.min(Math.round(1000 / speed), 900);
        setCurrentPaceSec(paceSec);
        currentPaceRef.current = paceSec;
      }
    }
    prevLocationRef.current = loc;
  };

  const startRun = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setLocationError('위치 권한이 필요해요. 설정에서 허용해주세요.');
      return;
    }

    setIsRunning(true);
    setIsPaused(false);
    setIsAutoPaused(false);
    isAutoPausedRef.current = false;
    slowReadingsRef.current = 0;
    activateKeepAwakeAsync();

    engineRef.current = new CoachingEngine({
      persona,
      targetPaceSec,
      targetDistanceKm,
      onGoalReached: () => finishRunRef.current?.(),
    });
    await engineRef.current.sayStart();

    startTimer();

    locationSubscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: GPS_UPDATE_MS, distanceInterval: 5 },
      makeGpsCallback()
    );

    Accelerometer.setUpdateInterval(50);
    accelSubscriptionRef.current = Accelerometer.addListener(updateCadence);

    startCoachingLoop();
  };

  const pauseRun = () => {
    setIsPaused(true);
    // 수동 일시정지 시 자동 일시정지도 해제
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    slowReadingsRef.current = 0;
    stopTimer();
    clearInterval(coachingTimerRef.current);
    locationSubscriptionRef.current?.remove();
    accelSubscriptionRef.current?.remove();
  };

  const resumeRun = async () => {
    setIsPaused(false);
    setIsAutoPaused(false);
    isAutoPausedRef.current = false;
    slowReadingsRef.current = 0;

    startTimer();

    locationSubscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: GPS_UPDATE_MS, distanceInterval: 5 },
      makeGpsCallback()
    );

    accelSubscriptionRef.current = Accelerometer.addListener(updateCadence);
    startCoachingLoop();
  };

  const finishRun = useCallback(async () => {
    stopTimer();
    clearInterval(coachingTimerRef.current);
    locationSubscriptionRef.current?.remove();
    accelSubscriptionRef.current?.remove();
    await engineRef.current?.destroy();
    deactivateKeepAwake();
    Vibration.vibrate(200);

    const elapsed = elapsedSecRef.current;
    const dist = distanceKmRef.current;
    navigation.replace('Summary', {
      elapsedSec: elapsed,
      distanceKm: dist,
      avgPaceSec: elapsed > 0 && dist > 0 ? Math.round(elapsed / dist) : 0,
      persona,
      targetPaceSec,
      targetDistanceKm,
    });
  }, [navigation, persona, targetPaceSec, targetDistanceKm]);

  // 엔진의 onGoalReached 콜백이 항상 최신 finishRun을 참조하도록
  const finishRunRef = useRef(finishRun);
  useEffect(() => {
    finishRunRef.current = finishRun;
  }, [finishRun]);

  useEffect(() => {
    return () => {
      stopTimer();
      clearInterval(coachingTimerRef.current);
      locationSubscriptionRef.current?.remove();
      accelSubscriptionRef.current?.remove();
      engineRef.current?.destroy();
      deactivateKeepAwake();
    };
  }, []);

  const status = paceStatus();
  const statusColor = { fast: '#F59E0B', slow: '#60A5FA', on: '#4ADE80', neutral: '#555' }[status];
  const statusText = { fast: '빠름 ↑', slow: '느림 ↓', on: '유지 ✓', neutral: '대기중' }[status];

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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <View style={styles.container}>

        {/* 상단: 목표 페이스 */}
        <View style={styles.topBar}>
          <Text style={styles.targetLabel}>목표 {targetPaceLabel()}/km</Text>
          <Text style={styles.personaTag}>{persona === 'coach' ? '코치형' : '친구형'}</Text>
        </View>

        {/* 자동 일시정지 배너 */}
        {isAutoPaused && (
          <View style={styles.autoPauseBanner}>
            <Text style={styles.autoPauseText}>🚦 신호 감지 — 자동 일시정지 중</Text>
          </View>
        )}

        {/* 메인 지표 */}
        <View style={styles.mainMetrics}>
          <View style={styles.metricBig}>
            <Text style={styles.metricBigLabel}>현재 페이스</Text>
            <Text style={[styles.metricBigValue, { color: isAutoPaused ? '#555' : statusColor }]}>
              {isAutoPaused ? '--:--' : paceLabel(currentPaceSec)}
            </Text>
            <Text style={[styles.metricBigUnit, { color: isAutoPaused ? '#555' : statusColor }]}>
              /km  {isAutoPaused ? '일시정지' : statusText}
            </Text>
          </View>
        </View>

        {/* 보조 지표 */}
        <View style={styles.secondaryMetrics}>
          <View style={styles.metricSmall}>
            <Text style={styles.metricSmallValue}>{distanceLabel(distanceKm)}</Text>
            <Text style={styles.metricSmallLabel}>거리</Text>
          </View>
          <View style={styles.metricSmallDivider} />
          <View style={styles.metricSmall}>
            <Text style={styles.metricSmallValue}>{timeLabel(elapsedSec)}</Text>
            <Text style={styles.metricSmallLabel}>시간</Text>
          </View>
          <View style={styles.metricSmallDivider} />
          <View style={styles.metricSmall}>
            <Text style={styles.metricSmallValue}>{cadenceSpm > 0 ? cadenceSpm : '--'}</Text>
            <Text style={styles.metricSmallLabel}>spm</Text>
          </View>
        </View>

        {/* 진행 바 */}
        {targetDistanceKm > 0 && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBg}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min((distanceKm / targetDistanceKm) * 100, 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {distanceLabel(distanceKm)} / {targetDistanceKm}km
            </Text>
          </View>
        )}

        {/* 컨트롤 버튼 */}
        <View style={styles.controls}>
          {!isRunning ? (
            <TouchableOpacity style={styles.btnStart} onPress={startRun}>
              <Text style={styles.btnStartText}>▶  시작</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.btnPause}
                onPress={isPaused ? resumeRun : pauseRun}
              >
                <Text style={styles.btnPauseText}>{isPaused ? '▶  재개' : '⏸  일시정지'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnFinish} onPress={finishRun}>
                <Text style={styles.btnFinishText}>종료</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  targetLabel: { fontSize: 14, color: '#666', fontWeight: '600' },
  personaTag: {
    fontSize: 12, color: '#4ADE80', fontWeight: '700',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1, borderColor: '#4ADE80',
  },

  autoPauseBanner: {
    backgroundColor: '#1a1400', borderWidth: 1, borderColor: '#F59E0B',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, marginBottom: 12, alignItems: 'center',
  },
  autoPauseText: { fontSize: 13, color: '#F59E0B', fontWeight: '700' },

  mainMetrics: { alignItems: 'center', marginBottom: 32 },
  metricBig: { alignItems: 'center' },
  metricBigLabel: { fontSize: 13, color: '#555', fontWeight: '600', marginBottom: 8 },
  metricBigValue: { fontSize: 80, fontWeight: '800', letterSpacing: -2, lineHeight: 88 },
  metricBigUnit: { fontSize: 16, fontWeight: '600', marginTop: 4 },

  secondaryMetrics: {
    flexDirection: 'row', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1a1a1a', borderRadius: 20,
    paddingVertical: 16, marginBottom: 24,
  },
  metricSmall: { flex: 1, alignItems: 'center' },
  metricSmallValue: { fontSize: 24, fontWeight: '700', color: '#fff' },
  metricSmallLabel: { fontSize: 11, color: '#555', marginTop: 4, fontWeight: '600' },
  metricSmallDivider: { width: 1, backgroundColor: '#1a1a1a' },

  progressContainer: { marginBottom: 20 },
  progressBg: { height: 6, backgroundColor: '#1a1a1a', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: '#4ADE80', borderRadius: 3 },
  progressText: { fontSize: 12, color: '#444', textAlign: 'right' },

  controls: { flexDirection: 'row', gap: 12, marginTop: 'auto', paddingBottom: 8 },
  btnStart: {
    flex: 1, backgroundColor: '#4ADE80', borderRadius: 18,
    paddingVertical: 20, alignItems: 'center',
  },
  btnStartText: { fontSize: 18, fontWeight: '800', color: '#0a0a0a' },
  btnPause: {
    flex: 2, backgroundColor: '#1a1a1a', borderRadius: 18,
    paddingVertical: 20, alignItems: 'center', borderWidth: 1, borderColor: '#333',
  },
  btnPauseText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  btnFinish: {
    flex: 1, backgroundColor: '#2a0a0a', borderRadius: 18,
    paddingVertical: 20, alignItems: 'center', borderWidth: 1, borderColor: '#F87171',
  },
  btnFinishText: { fontSize: 16, fontWeight: '700', color: '#F87171' },

  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 16, color: '#F87171', textAlign: 'center', marginBottom: 24, lineHeight: 24 },
  backBtn: { backgroundColor: '#222', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  backBtnText: { fontSize: 15, color: '#fff', fontWeight: '600' },
});
