import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, ScrollView, StatusBar,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { loadHistory, exportHistory, clearHistory } from '../data/runLog';
import { DEFAULTS, OPTIONS, GOAL_RANGE, PACE_RANGE, paceLabel } from '../data/settings';
import { C } from '../theme';

const PERSONAS = [
  { id: 'coach', label: '코치형', emoji: '🧘' },
  { id: 'friend', label: '친구형', emoji: '🤝' },
];

export default function SetupScreen({ navigation }) {
  const [persona, setPersona] = useState(DEFAULTS.persona);
  const [targetDistanceKm, setTargetDistanceKm] = useState(DEFAULTS.targetDistanceKm);
  const [targetPaceSec, setTargetPaceSec] = useState(DEFAULTS.targetPaceSec);
  const [cfg, setCfg] = useState({
    judgeBasis: DEFAULTS.judgeBasis,
    sensSec: DEFAULTS.sensSec,
    globalGapSec: DEFAULTS.globalGapSec,
    checkinSec: DEFAULTS.checkinSec,
    warmupSec: DEFAULTS.warmupSec,
    pauseSec: DEFAULTS.pauseSec,
    resumeSec: DEFAULTS.resumeSec,
  });
  const [history, setHistory] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);

  // 요약 화면에서 돌아올 때마다 최신 기록을 다시 읽는다
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadHistory().then((h) => {
        if (alive) setHistory(h);
      });
      setConfirmClear(false);
      return () => {
        alive = false;
      };
    }, [])
  );

  const bumpGoal = (d) => {
    const next = Math.round((targetDistanceKm + d) * 2) / 2;
    setTargetDistanceKm(Math.max(GOAL_RANGE.min, Math.min(GOAL_RANGE.max, next)));
  };
  const bumpPace = (d) => {
    setTargetPaceSec(Math.max(PACE_RANGE.min, Math.min(PACE_RANGE.max, targetPaceSec + d)));
  };

  const handleExportHistory = async () => { await exportHistory(); };

  const handleClearHistory = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    await clearHistory();
    setHistory([]);
    setConfirmClear(false);
  };

  const historySummary = () => {
    const last = history[history.length - 1];
    if (!last) return '';
    const d = new Date(last.date);
    const km = last.result ? last.result.km.toFixed(1) : '0.0';
    return `${history.length}회 저장됨 · 최근 ${d.getMonth() + 1}/${d.getDate()} ${km}km`;
  };

  const handleStart = () => {
    navigation.navigate('Running', {
      persona,
      targetPaceSec,
      targetDistanceKm,
      settings: { ...cfg, persona, targetPaceSec, targetDistanceKm },
    });
  };

  const Seg = ({ label, hint, field }) => (
    <>
      <Text style={styles.lbl}>
        {label} {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </Text>
      <View style={styles.segRow}>
        {OPTIONS[field].map((o) => {
          const sel = cfg[field] === o.v;
          return (
            <TouchableOpacity
              key={String(o.v)}
              style={[styles.segBtn, sel && styles.segBtnSel]}
              onPress={() => setCfg((c) => ({ ...c, [field]: o.v }))}
            >
              <Text style={[styles.segTxt, sel && styles.segTxtSel]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.night} />
      <ScrollView contentContainerStyle={styles.container}>

        <Text style={styles.eyebrow}>러닝메이트</Text>
        <Text style={styles.brand}>자동 트리거 러닝</Text>

        {/* 메이트 성격 */}
        <View style={styles.card}>
          <Text style={styles.lbl}>메이트 성격</Text>
          <View style={styles.personaRow}>
            {PERSONAS.map((p) => {
              const sel = persona === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.personaBtn, sel && styles.personaBtnSel]}
                  onPress={() => setPersona(p.id)}
                >
                  <Text style={styles.personaEmoji}>{p.emoji}</Text>
                  <Text style={[styles.personaLabel, sel && styles.personaLabelSel]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 목표 */}
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLabel}>
              <Text style={styles.lblInline}>목표 거리</Text>
              <Text style={styles.hint}>도달 시 자동 종료</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => bumpGoal(-GOAL_RANGE.step)}>
                <Text style={styles.stepBtnTxt}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepVal}>
                {targetDistanceKm.toFixed(1)}<Text style={styles.stepUnit}>km</Text>
              </Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => bumpGoal(GOAL_RANGE.step)}>
                <Text style={styles.stepBtnTxt}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.row, { marginTop: 14 }]}>
            <View style={styles.rowLabel}>
              <Text style={styles.lblInline}>목표 페이스</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => bumpPace(PACE_RANGE.step)}>
                <Text style={styles.stepBtnTxt}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepVal}>
                {paceLabel(targetPaceSec)}<Text style={styles.stepUnit}>/km</Text>
              </Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => bumpPace(-PACE_RANGE.step)}>
                <Text style={styles.stepBtnTxt}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 코칭 파라미터 */}
        <View style={styles.card}>
          <Seg label="판단 기준" hint="코칭을 현재/평균 페이스 중 무엇으로 판단" field="judgeBasis" />
          <Seg label="민감도" hint="목표 대비 허용 편차(초)" field="sensSec" />
          <Seg label="전역 발화 간격" hint="페이스 코칭 최소 간격" field="globalGapSec" />
          <Seg label="체크인 간격" field="checkinSec" />
          <Seg label="시작 침묵(워밍업)" field="warmupSec" />
          <Seg label="정지 감지" hint="멈춤 인식 시간 (짧을수록 빨리 멈춤)" field="pauseSec" />
          <Seg label="재시작 감지" hint="다시 뛸 때 반응 (둔감할수록 덜 예민)" field="resumeSec" />
        </View>

        <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
          <Text style={styles.startBtnTxt}>러닝 시작</Text>
        </TouchableOpacity>

        {/* 누적 러닝 기록 — 현장 테스트 분석용 */}
        {history.length > 0 && (
          <View style={[styles.card, { marginTop: 14 }]}>
            <Text style={styles.lbl}>러닝 기록</Text>
            <Text style={[styles.hint, { marginBottom: 12 }]}>{historySummary()}</Text>
            <View style={styles.segRow}>
              <TouchableOpacity style={styles.segBtn} onPress={handleExportHistory}>
                <Text style={styles.segTxt}>전체 내보내기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segBtn, confirmClear && styles.segBtnDanger]}
                onPress={handleClearHistory}
              >
                <Text style={[styles.segTxt, confirmClear && styles.segTxtDanger]}>
                  {confirmClear ? '정말 삭제?' : '삭제'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.night },
  container: { padding: 20, paddingBottom: 40, maxWidth: 460, width: '100%', alignSelf: 'center' },

  eyebrow: { fontSize: 11, letterSpacing: 2, color: C.cool, fontWeight: '500', marginTop: 10 },
  brand: { fontSize: 20, fontWeight: '700', color: C.text, marginTop: 2, marginBottom: 12 },

  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 14, marginBottom: 9,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowLabel: { flexShrink: 1 },
  lbl: { fontSize: 13, color: C.muted, marginBottom: 8 },
  lblInline: { fontSize: 13, color: C.muted },
  hint: { fontSize: 11, color: C.cool, lineHeight: 16 },

  personaRow: { flexDirection: 'row', gap: 8 },
  personaBtn: {
    flex: 1, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line,
    borderRadius: 11, paddingVertical: 11, alignItems: 'center',
  },
  personaBtnSel: { borderColor: C.warm, backgroundColor: C.warmSoft },
  personaEmoji: { fontSize: 16, marginBottom: 2 },
  personaLabel: { fontSize: 13, fontWeight: '500', color: C.muted },
  personaLabelSel: { color: C.warm },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 31, height: 31, borderRadius: 9, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
  },
  stepBtnTxt: { fontSize: 16, color: C.text, lineHeight: 18 },
  stepVal: { fontSize: 18, fontWeight: '700', color: C.text, minWidth: 74, textAlign: 'center' },
  stepUnit: { fontSize: 10, color: C.muted, fontWeight: '400' },

  segRow: { flexDirection: 'row', gap: 5, marginBottom: 10 },
  segBtn: {
    flex: 1, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line,
    borderRadius: 9, paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
  },
  segBtnSel: { borderColor: C.warm, backgroundColor: C.warmSoft },
  segTxt: { fontSize: 11.5, color: C.muted, fontWeight: '500', textAlign: 'center' },
  segTxtSel: { color: C.warm },
  segBtnDanger: { borderColor: C.bad, backgroundColor: '#2A1614' },
  segTxtDanger: { color: C.bad },

  startBtn: {
    backgroundColor: C.warm, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 6,
  },
  startBtnTxt: { fontSize: 15, fontWeight: '700', color: '#1A0E08' },
});
