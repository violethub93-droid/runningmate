import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, StatusBar, ScrollView,
} from 'react-native';

export default function SummaryScreen({ route, navigation }) {
  const { elapsedSec, distanceKm, avgPaceSec, persona, targetPaceSec, targetDistanceKm } = route.params;

  const timeLabel = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}시간 ${m}분 ${s}초`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
  };

  const paceLabel = (sec) => {
    if (!sec || sec <= 0) return '--:--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const paceDiff = avgPaceSec && targetPaceSec ? avgPaceSec - targetPaceSec : 0;
  const paceComment = () => {
    if (!avgPaceSec) return '데이터를 수집하지 못했어요.';
    if (Math.abs(paceDiff) <= 15) return '목표 페이스를 잘 유지했어요. 훌륭해요!';
    if (paceDiff < -15) return `목표보다 ${Math.abs(paceDiff)}초 빠르게 달렸어요. 초반 오버페이스를 주의해봐요.`;
    return `목표보다 ${paceDiff}초 느렸어요. 다음엔 조금 더 올려봐요.`;
  };

  const goalAchieved = targetDistanceKm > 0 && distanceKm >= targetDistanceKm * 0.98;

  const fieldTestItems = [
    '멘트가 너무 자주 / 너무 드물게 나왔나?',
    '목소리 톤이 동행자 같았나, 안내방송 같았나?',
    '상황과 안 맞는 멘트가 있었나?',
    '가장 도움됐던 멘트는?',
    '가장 불필요했던 멘트는?',
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <ScrollView contentContainerStyle={styles.container}>

        {/* 결과 헤더 */}
        <View style={styles.header}>
          <Text style={styles.emoji}>{goalAchieved ? '🎉' : '✅'}</Text>
          <Text style={styles.title}>{goalAchieved ? '목표 달성!' : '잘 달렸어요'}</Text>
          <Text style={styles.sub}>오늘 러닝 요약</Text>
        </View>

        {/* 핵심 지표 */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{distanceKm >= 1 ? distanceKm.toFixed(2) : (distanceKm * 1000).toFixed(0)}</Text>
            <Text style={styles.metricUnit}>{distanceKm >= 1 ? 'km' : 'm'}</Text>
            <Text style={styles.metricLabel}>거리</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{timeLabel(elapsedSec)}</Text>
            <Text style={styles.metricLabel}>시간</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{paceLabel(avgPaceSec)}</Text>
            <Text style={styles.metricUnit}>/km</Text>
            <Text style={styles.metricLabel}>평균 페이스</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{paceLabel(targetPaceSec)}</Text>
            <Text style={styles.metricUnit}>/km</Text>
            <Text style={styles.metricLabel}>목표 페이스</Text>
          </View>
        </View>

        {/* AI 코멘트 */}
        <View style={styles.commentBox}>
          <Text style={styles.commentLabel}>메이트 평가</Text>
          <Text style={styles.commentText}>{paceComment()}</Text>
        </View>

        {/* 현장 테스트 체크리스트 */}
        <View style={styles.fieldTestBox}>
          <Text style={styles.fieldTestTitle}>현장 테스트 체크리스트</Text>
          <Text style={styles.fieldTestSub}>달리고 나서 기록해두세요 (음성 메모 추천)</Text>
          {fieldTestItems.map((item, i) => (
            <View key={i} style={styles.fieldTestItem}>
              <Text style={styles.fieldTestBullet}>□</Text>
              <Text style={styles.fieldTestText}>{item}</Text>
            </View>
          ))}
          <View style={styles.fieldTestFinalBox}>
            <Text style={styles.fieldTestFinalQ}>
              핵심 질문: 동행자처럼 느껴졌나요, 트래커 음성안내처럼 느껴졌나요?
            </Text>
          </View>
        </View>

        {/* 버튼 */}
        <TouchableOpacity
          style={styles.btnAgain}
          onPress={() => navigation.replace('Setup')}
        >
          <Text style={styles.btnAgainText}>다시 달리기</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { padding: 24, paddingBottom: 40 },

  header: { alignItems: 'center', marginTop: 24, marginBottom: 32 },
  emoji: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 4 },
  sub: { fontSize: 14, color: '#555' },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  metricCard: {
    flex: 1, minWidth: '45%', backgroundColor: '#111',
    borderRadius: 16, padding: 20, alignItems: 'center',
    borderWidth: 1, borderColor: '#1a1a1a',
  },
  metricValue: { fontSize: 26, fontWeight: '800', color: '#fff' },
  metricUnit: { fontSize: 13, color: '#555', marginTop: 2 },
  metricLabel: { fontSize: 12, color: '#555', marginTop: 6, fontWeight: '600' },

  commentBox: {
    backgroundColor: '#0f2010', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#1a3a1a', marginBottom: 24,
  },
  commentLabel: { fontSize: 12, color: '#4ADE80', fontWeight: '700', marginBottom: 8, letterSpacing: 0.5 },
  commentText: { fontSize: 15, color: '#bbb', lineHeight: 22 },

  fieldTestBox: {
    backgroundColor: '#111', borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: '#1a1a1a', marginBottom: 24,
  },
  fieldTestTitle: { fontSize: 14, color: '#fff', fontWeight: '700', marginBottom: 4 },
  fieldTestSub: { fontSize: 12, color: '#555', marginBottom: 16 },
  fieldTestItem: { flexDirection: 'row', gap: 10, marginBottom: 12, alignItems: 'flex-start' },
  fieldTestBullet: { fontSize: 16, color: '#555', width: 16 },
  fieldTestText: { flex: 1, fontSize: 14, color: '#888', lineHeight: 20 },
  fieldTestFinalBox: {
    backgroundColor: '#1a1200', borderRadius: 12, padding: 14, marginTop: 8,
    borderWidth: 1, borderColor: '#2a2200',
  },
  fieldTestFinalQ: { fontSize: 13, color: '#D97706', lineHeight: 20, fontWeight: '600' },

  btnAgain: {
    backgroundColor: '#4ADE80', borderRadius: 18,
    paddingVertical: 18, alignItems: 'center',
  },
  btnAgainText: { fontSize: 17, fontWeight: '800', color: '#0a0a0a' },
});
