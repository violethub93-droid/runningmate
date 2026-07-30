import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, ScrollView,
} from 'react-native';
import { exportRun } from '../data/runLog';
import { paceLabel, clockLabel } from '../data/settings';
import { C } from '../theme';

export default function SummaryScreen({ route, navigation }) {
  const {
    elapsedSec, distanceKm, avgPaceSec, persona, targetPaceSec, targetDistanceKm, runLog,
  } = route.params;
  const [exportMsg, setExportMsg] = useState(null);

  const handleExport = async () => {
    if (!runLog) return;
    const { ok } = await exportRun(runLog);
    setExportMsg(ok ? '내보냈어요. 파일을 보관해두세요.' : '내보내기를 취소했어요.');
  };

  const goalAchieved = runLog?.result?.goal
    ?? (targetDistanceKm > 0 && distanceKm >= targetDistanceKm * 0.98);
  const pauseCount = runLog?.pauses?.length ?? 0;
  const spokenCount = runLog?.speech?.length ?? 0;
  const paceDiff = avgPaceSec && targetPaceSec ? avgPaceSec - targetPaceSec : 0;

  // 서사형 리포트 — 목표·완주·정지·페이스를 한 단락으로
  const narrative = () => {
    const parts = [];
    parts.push(
      targetDistanceKm > 0
        ? `목표 ${targetDistanceKm.toFixed(1)}km 중 ${distanceKm.toFixed(2)}km를 운동시간 ${clockLabel(elapsedSec)}에 달렸어요.`
        : `${distanceKm.toFixed(2)}km를 운동시간 ${clockLabel(elapsedSec)}에 달렸어요.`
    );
    if (goalAchieved) parts.push('목표 거리를 완주했어요!');
    if (!avgPaceSec) {
      parts.push('페이스 데이터를 충분히 모으지 못했어요.');
    } else if (Math.abs(paceDiff) <= 15) {
      parts.push('목표 페이스를 잘 유지했어요. 훌륭해요.');
    } else if (paceDiff < 0) {
      parts.push(`목표보다 ${Math.abs(paceDiff)}초 빠르게 달렸어요. 초반 오버페이스를 주의해봐요.`);
    } else {
      parts.push(`목표보다 ${paceDiff}초 느렸어요. 다음엔 조금 더 올려봐요.`);
    }
    if (pauseCount > 0) {
      parts.push(`중간에 ${pauseCount}번 멈췄고, 정지 시간은 기록에서 제외했어요.`);
    }
    parts.push('수고했어요.');
    return parts.join(' ');
  };

  const fieldTestItems = [
    '멘트가 너무 자주 / 너무 드물게 나왔나?',
    '목소리 톤이 동행자 같았나, 안내방송 같았나?',
    '상황과 안 맞는 멘트가 있었나?',
    '마일스톤이 km 밟는 즉시 나왔나?',
    '정지·재시작 감지가 상황에 맞았나?',
  ];

  const stats = [
    { v: clockLabel(elapsedSec), l: '운동 시간 (정지 제외)' },
    { v: paceLabel(avgPaceSec), l: '평균 페이스' },
    { v: String(spokenCount), l: '발화 횟수' },
    { v: String(pauseCount), l: '일시정지 (회)' },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.night} />
      <ScrollView contentContainerStyle={styles.container}>

        <Text style={styles.eyebrow}>러닝 리포트</Text>
        <Text style={styles.brand}>{goalAchieved ? '목표 달성!' : '수고했어요'}</Text>

        <View style={styles.hero}>
          <Text style={styles.heroDist}>
            {distanceKm.toFixed(2)}<Text style={styles.heroUnit}> km</Text>
          </Text>
          <Text style={styles.heroSub}>
            {persona === 'coach' ? '코치형' : '친구형'} · 목표 {paceLabel(targetPaceSec)}/km
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.narrative}>{narrative()}</Text>
        </View>

        <View style={styles.statGrid}>
          {stats.map((s) => (
            <View key={s.l} style={styles.stat}>
              <Text style={styles.statVal}>{s.v}</Text>
              <Text style={styles.statLbl}>{s.l}</Text>
            </View>
          ))}
        </View>

        {/* 러닝 로그 — 현장 테스트 분석용 */}
        {runLog && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>러닝 로그 기록됨</Text>
            <Text style={styles.cardSub}>
              발화 {spokenCount}회 · 페이스 샘플 {runLog.samples.length}개 · 정지 {pauseCount}회
            </Text>
            <TouchableOpacity style={styles.btnGhost} onPress={handleExport}>
              <Text style={styles.btnGhostTxt}>이번 러닝 데이터 내보내기 (JSON)</Text>
            </TouchableOpacity>
            {exportMsg && <Text style={styles.exportMsg}>{exportMsg}</Text>}
          </View>
        )}

        {/* 현장 테스트 체크리스트 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>현장 테스트 체크리스트</Text>
          <Text style={styles.cardSub}>달리고 나서 기록해두세요 (음성 메모 추천)</Text>
          {fieldTestItems.map((item, i) => (
            <View key={i} style={styles.checkItem}>
              <Text style={styles.checkBullet}>□</Text>
              <Text style={styles.checkTxt}>{item}</Text>
            </View>
          ))}
          <View style={styles.finalQBox}>
            <Text style={styles.finalQ}>
              핵심 질문: 동행자처럼 느껴졌나요, 트래커 음성안내처럼 느껴졌나요?
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.btnAgain} onPress={() => navigation.replace('Setup')}>
          <Text style={styles.btnAgainTxt}>다시 달리기</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.night },
  container: { padding: 20, paddingBottom: 40, maxWidth: 460, width: '100%', alignSelf: 'center' },

  eyebrow: { fontSize: 11, letterSpacing: 2, color: C.cool, fontWeight: '500', marginTop: 10 },
  brand: { fontSize: 20, fontWeight: '700', color: C.text, marginTop: 2 },

  hero: { alignItems: 'center', marginVertical: 18 },
  heroDist: { fontSize: 50, fontWeight: '800', color: C.text, letterSpacing: -1 },
  heroUnit: { fontSize: 16, color: C.muted, fontWeight: '400' },
  heroSub: { fontSize: 12, color: C.cool, marginTop: 4 },

  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 16, marginBottom: 9,
  },
  cardTitle: { fontSize: 13, color: C.text, fontWeight: '600', marginBottom: 4 },
  cardSub: { fontSize: 11, color: C.cool, marginBottom: 12 },
  narrative: { fontSize: 13, color: '#D4D9E4', lineHeight: 22 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 9 },
  stat: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 11, padding: 12,
  },
  statVal: { fontSize: 18, fontWeight: '700', color: C.text },
  statLbl: { fontSize: 11, color: C.muted, marginTop: 2 },

  btnGhost: {
    backgroundColor: C.night, borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', borderWidth: 1, borderColor: C.line,
  },
  btnGhostTxt: { fontSize: 13, fontWeight: '600', color: C.muted },
  exportMsg: { fontSize: 11, color: C.good, marginTop: 10, textAlign: 'center' },

  checkItem: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  checkBullet: { fontSize: 14, color: C.cool, width: 14 },
  checkTxt: { flex: 1, fontSize: 12.5, color: C.muted, lineHeight: 18 },
  finalQBox: {
    backgroundColor: C.warmSoft, borderRadius: 9, padding: 12, marginTop: 4,
    borderWidth: 1, borderColor: '#4A3528',
  },
  finalQ: { fontSize: 12, color: C.warm, lineHeight: 18, fontWeight: '500' },

  btnAgain: {
    backgroundColor: C.warm, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 4,
  },
  btnAgainTxt: { fontSize: 15, fontWeight: '700', color: '#1A0E08' },
});
