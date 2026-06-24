import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, Vibration, Platform,
} from 'react-native';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { CoachingEngine } from '../engine/CoachingEngine';

const COACHING_INTERVAL_MS = 5000; // 5초마다 코칭 엔진 평가
const GPS_UPDATE_MS = 2000;        // GPS 2초 간격

export default function RunningScreen({ route, navigation }) {
  const { persona, targetPaceSec, targetDistanceKm } = route.params;

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [currentPaceSec, setCurrentPaceSec] = useState(0); // 초/km
  const [cadenceSpm, setCadenceSpm] = useState(0);
  const [lastCoachingText, setLastCoachingText] = useState('');
  const [locationError, setLocationError] = useState(null);

  const engineRef = useRef(null);
  const timerRef = useRef(null);
  const coachingTimerRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  const accelSubscriptionRef = useRef(null);
  const prevLocationRef = useRef(null);
  const stepCountRef = useRef(0);
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

  // GPS 거리 계산 (Haversine)
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

  // 가속도계로 케이던스 추정 (피크 감지)
  const updateCadence = useCallback((accelData) => {
    const mag = Math.sqrt(accelData.x ** 2 + accelData.y ** 2 + accelData.z ** 2);
    const win = accelWindowRef.current;
    win.push({ mag, time: Date.now() });
    if (win.length > 50) win.shift(); // 약 1초 윈도우(50ms 간격)

    // 1초 넘으면 피크 카운트 → spm 추정
    if (win.length >= 50) {
      const avg = win.reduce((s, w) => s + w.mag, 0) / win.length;
      let peaks = 0;
      for (let i = 1; i < win.length - 1; i++) {
        if (win[i].mag > avg * 1.05 && win[i].mag >= win[i - 1].mag && win[i].mag >= win[i + 1].mag) peaks++;
      }
      const spm = peaks * 60; // 1초 윈도우이므로 60 곱
      setCadenceSpm(Math.min(spm, 220)); // 이상치 제한
    }
  }, []);

  const startRun = async () => {
    // 위치 권한
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setLocationError('위치 권한이 필요해요. 설정에서 허용해주세요.');
      return;
    }

    setIsRunning(true);
    setIsPaused(false);
    activateKeepAwakeAsync();

    // 코칭 엔진 생성
    engineRef.current = new CoachingEngine({ persona, targetPaceSec, targetDistanceKm });
    await engineRef.current.sayStart();

    // 타이머
    timerRef.current = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);

    // GPS 구독
    locationSubscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: GPS_UPDATE_MS, distanceInterval: 5 },
      (loc) => {
        const prev = prevLocationRef.current;
        if (prev) {
          const d = haversineKm(prev.coords, loc.coords);
          if (d > 0.003) { // 노이즈 필터: 3m 이상만
            setDistanceKm((km) => {
              const newKm = km + d;
              return newKm;
            });
          }
          // 속도로 페이스 계산 (m/s → 초/km)
          if (loc.coords.speed && loc.coords.speed > 0.5) {
            const paceSec = Math.round(1000 / loc.coords.speed);
            setCurrentPaceSec(Math.min(paceSec, 900)); // 최대 15분/km
          }
        }
        prevLocationRef.current = loc;
      }
    );

    // 가속도계 구독
    Accelerometer.setUpdateInterval(50);
    accelSubscriptionRef.current = Accelerometer.addListener(updateCadence);

    // 코칭 엔진 평가 루프
    coachingTimerRef.current = setInterval(async () => {
      if (engineRef.current) {
        await engineRef.current.evaluate({
          currentPaceSec,
          distanceKm,
          cadenceSpm,
          slope: null, // Phase 2에서 고도 데이터 연결
        });
      }
    }, COACHING_INTERVAL_MS);
  };

  const pauseRun = () => {
    setIsPaused(true);
    clearInterval(timerRef.current);
    clearInterval(coachingTimerRef.current);
    locationSubscriptionRef.current?.remove();
    accelSubscriptionRef.current?.remove();
  };

  const resumeRun = async () => {
    setIsPaused(false);
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    locationSubscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: GPS_UPDATE_MS, distanceInterval: 5 },
      (loc) => {
        const prev = prevLocationRef.current;
        if (prev) {
          const d = haversineKm(prev.coords, loc.coords);
          if (d > 0.003) setDistanceKm((km) => km + d);
          if (loc.coords.speed && loc.coords.speed > 0.5) {
            setCurrentPaceSec(Math.round(1000 / loc.coords.speed));
          }
        }
        prevLocationRef.current = loc;
      }
    );
    accelSubscriptionRef.current = Accelerometer.addListener(updateCadence);
    coachingTimerRef.current = setInterval(async () => {
      if (engineRef.current) {
        await engineRef.current.evaluate({ currentPaceSec, distanceKm, cadenceSpm, slope: null });
      }
    }, COACHING_INTERVAL_MS);
  };

  const finishRun = async () => {
    clearInterval(timerRef.current);
    clearInterval(coachingTimerRef.current);
    locationSubscriptionRef.current?.remove();
    accelSubscriptionRef.current?.remove();
    await engineRef.current?.destroy();
    deactivateKeepAwake();
    Vibration.vibrate(200);

    const avgPaceSec = elapsedSec > 0 && distanceKm > 0
      ? Math.round(elapsedSec / distanceKm)
      : 0;

    navigation.replace('Summary', {
      elapsedSec,
      distanceKm,
      avgPaceSec,
      persona,
      targetPaceSec,
      targetDistanceKm,
    });
  };

  // 코칭 평가 시 distanceKm, currentPaceSec, cadenceSpm 최신값 전달
  useEffect(() => {
    if (coachingTimerRef.current) {
      clearInterval(coachingTimerRef.current);
      coachingTimerRef.current = setInterval(async () => {
        if (engineRef.current && isRunning && !isPaused) {
          await engineRef.current.evaluate({ currentPaceSec, distanceKm, cadenceSpm, slope: null });
        }
      }, COACHING_INTERVAL_MS);
    }
  }, [currentPaceSec, distanceKm, cadenceSpm, isRunning, isPaused]);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
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

        {/* 메인 지표 */}
        <View style={styles.mainMetrics}>
          <View style={styles.metricBig}>
            <Text style={styles.metricBigLabel}>현재 페이스</Text>
            <Text style={[styles.metricBigValue, { color: statusColor }]}>
              {paceLabel(currentPaceSec)}
            </Text>
            <Text style={[styles.metricBigUnit, { color: statusColor }]}>/km  {statusText}</Text>
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

        {/* 마지막 코칭 멘트 표시 영역 */}
        <View style={styles.coachingBox}>
          <Text style={styles.coachingIcon}>💬</Text>
          <Text style={styles.coachingText}>
            {lastCoachingText || (isRunning ? '달리는 중...' : '시작 버튼을 눌러요')}
          </Text>
        </View>

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

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  targetLabel: { fontSize: 14, color: '#666', fontWeight: '600' },
  personaTag: {
    fontSize: 12, color: '#4ADE80', fontWeight: '700',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1, borderColor: '#4ADE80',
  },

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

  coachingBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#111', borderRadius: 16, padding: 16, marginBottom: 24, minHeight: 60,
  },
  coachingIcon: { fontSize: 18, marginTop: 1 },
  coachingText: { flex: 1, fontSize: 15, color: '#bbb', lineHeight: 22 },

  controls: { flexDirection: 'row', gap: 12 },
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
