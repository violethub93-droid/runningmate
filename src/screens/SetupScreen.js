import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, ScrollView, StatusBar,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { loadHistory, exportHistory, clearHistory } from '../data/runLog';
import {
  DEFAULTS, OPTIONS, GOAL_RANGE, PACE_RANGE,
  paceLabel, loadSettings, saveSettings, changedSummary,
} from '../data/settings';
import { C } from '../theme';

const PERSONAS = [
  { id: 'coach', label: '코치형', emoji: '🧘' },
  { id: 'friend', label: '친구형', emoji: '🤝' },
];

// 자주 쓰는 목표 거리 — 스테퍼를 열지 않고 한 번에 고르게
const QUICK_KM = [3, 5, 10];

export default function SetupScreen({ navigation }) {
  const [cfg, setCfg] = useState({ ...DEFAULTS });
  const [advanced, setAdvanced] = useState(false);
  const [history, setHistory] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadSettings().then((s) => { if (alive) setCfg(s); });
      loadHistory().then((h) => { if (alive) setHistory(h); });
      setConfirmClear(false);
      return () => { alive = false; };
    }, [])
  );

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const bumpGoal = (d) => {
    const next = Math.round((cfg.targetDistanceKm + d) * 2) / 2;
    set({ targetDistanceKm: Math.max(GOAL_RANGE.min, Math.min(GOAL_RANGE.max, next)) });
  };
  const bumpPace = (d) => {
    set({ targetPaceSec: Math.max(PACE_RANGE.min, Math.min(PACE_RANGE.max, cfg.targetPaceSec + d)) });
  };

  const handleStart = () => {
    saveSettings(cfg);
    navigation.navigate('Running', {
      persona: cfg.persona,
      targetPaceSec: cfg.targetPaceSec,
      targetDistanceKm: cfg.targetDistanceKm,
      settings: cfg,
    });
  };

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

  const Seg = ({ label, hint, field, compact }) => (
    <View style={compact ? styles.segBlockTight : styles.segBlock}>
      <Text style={styles.lbl}>
        {label}
        {hint ? <Text style={styles.hint}>  {hint}</Text> : null}
      </Text>
      <View style={styles.segRow}>
        {OPTIONS[field].map((o) => {
          const sel = cfg[field] === o.v;
          return (
            <TouchableOpacity
              key={String(o.v)}
              style={[styles.segBtn, sel && styles.segBtnSel]}
              onPress={() => set({ [field]: o.v })}
            >
              <Text style={[styles.segTxt, sel && styles.segTxtSel]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const changed = changedSummary(cfg);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.night} />
      <ScrollView contentContainerStyle={styles.container}>

        <Text style={styles.eyebrow}>러닝메이트</Text>
        <Text style={styles.brand}>오늘도 같이 달려요</Text>

        {/* 1. 메이트 성격 */}
        <View style={styles.card}>
          <View style={styles.personaRow}>
            {PERSONAS.map((p) => {
              const sel = cfg.persona === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.personaBtn, sel && styles.personaBtnSel]}
                  onPress={() => set({ persona: p.id })}
                >
                  <Text style={styles.personaEmoji}>{p.emoji}</Text>
                  <Text style={[styles.personaLabel, sel && styles.personaLabelSel]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 2. 목표 — 큰 숫자 + 빠른 선택 */}
        <View style={styles.card}>
          <View style={styles.goalRow}>
            <View style={styles.goalCol}>
              <Text style={styles.goalLbl}>목표 거리</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => bumpGoal(-GOAL_RANGE.step)}>
                  <Text style={styles.stepBtnTxt}>−</Text>
                </TouchableOpacity>
                <Text style={styles.goalVal}>
                  {cfg.targetDistanceKm.toFixed(1)}<Text style={styles.goalUnit}>km</Text>
                </Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => bumpGoal(GOAL_RANGE.step)}>
                  <Text style={styles.stepBtnTxt}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.goalDivider} />

            <View style={styles.goalCol}>
              <Text style={styles.goalLbl}>목표 페이스</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => bumpPace(PACE_RANGE.step)}>
                  <Text style={styles.stepBtnTxt}>−</Text>
                </TouchableOpacity>
                <Text style={styles.goalVal}>
                  {paceLabel(cfg.targetPaceSec)}<Text style={styles.goalUnit}>/km</Text>
                </Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => bumpPace(-PACE_RANGE.step)}>
                  <Text style={styles.stepBtnTxt}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.quickRow}>
            {QUICK_KM.map((km) => {
              const sel = cfg.targetDistanceKm === km;
              return (
                <TouchableOpacity
                  key={km}
                  style={[styles.quickBtn, sel && styles.quickBtnSel]}
                  onPress={() => set({ targetDistanceKm: km })}
                >
                  <Text style={[styles.quickTxt, sel && styles.quickTxtSel]}>{km}km</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 3. BGM — 매 러닝 바꾸는 항목이라 밖에 둔다 */}
        <View style={styles.card}>
          <Seg label="BGM" hint="발걸음 유도 · 멘트 때 자동으로 낮아짐" field="bgmBpm" compact />
        </View>

        <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
          <Text style={styles.startBtnTxt}>러닝 시작</Text>
        </TouchableOpacity>

        {/* 4. 세부 설정 — 평소엔 접어둔다 */}
        <TouchableOpacity
          style={styles.discloseBtn}
          onPress={() => setAdvanced((v) => !v)}
        >
          <Text style={styles.discloseTxt}>
            {advanced ? '▲  세부 설정 접기' : '▼  세부 설정'}
          </Text>
          {!advanced && (
            <Text style={styles.discloseHint} numberOfLines={1}>
              {changed.length ? changed.join(' · ') : '기본값 (현장 테스트로 확정)'}
            </Text>
          )}
        </TouchableOpacity>

        {advanced && (
          <View style={styles.card}>
            <Seg label="판단 기준" hint="현재/평균 페이스 중 무엇으로" field="judgeBasis" />
            <Seg label="민감도" hint="목표 대비 허용 편차(초)" field="sensSec" />
            <Seg label="전역 발화 간격" field="globalGapSec" />
            <Seg label="체크인 간격" field="checkinSec" />
            <Seg label="시작 침묵(워밍업)" field="warmupSec" />
            <Seg label="정지 감지" hint="신호 대기 인식 시간" field="pauseSec" />
            <Seg label="재시작 감지" hint="다시 뛸 때 반응" field="resumeSec" />
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => set({
                judgeBasis: DEFAULTS.judgeBasis, sensSec: DEFAULTS.sensSec,
                globalGapSec: DEFAULTS.globalGapSec, checkinSec: DEFAULTS.checkinSec,
                warmupSec: DEFAULTS.warmupSec, pauseSec: DEFAULTS.pauseSec,
                resumeSec: DEFAULTS.resumeSec,
              })}
            >
              <Text style={styles.resetTxt}>기본값으로 되돌리기</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 5. 러닝 기록 */}
        {history.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.lbl}>러닝 기록</Text>
            <Text style={[styles.hint, { marginBottom: 12 }]}>{historySummary()}</Text>
            <View style={styles.segRow}>
              <TouchableOpacity style={styles.segBtn} onPress={exportHistory}>
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
  brand: { fontSize: 20, fontWeight: '700', color: C.text, marginTop: 2, marginBottom: 14 },

  card: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  lbl: { fontSize: 13, color: C.muted, marginBottom: 8 },
  hint: { fontSize: 11, color: C.cool },

  personaRow: { flexDirection: 'row', gap: 8 },
  personaBtn: {
    flex: 1, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line,
    borderRadius: 11, paddingVertical: 13, alignItems: 'center',
  },
  personaBtnSel: { borderColor: C.warm, backgroundColor: C.warmSoft },
  personaEmoji: { fontSize: 18, marginBottom: 3 },
  personaLabel: { fontSize: 13, fontWeight: '600', color: C.muted },
  personaLabelSel: { color: C.warm },

  goalRow: { flexDirection: 'row', alignItems: 'center' },
  goalCol: { flex: 1, alignItems: 'center' },
  goalDivider: { width: 1, height: 46, backgroundColor: C.line, marginHorizontal: 6 },
  goalLbl: { fontSize: 11, color: C.cool, marginBottom: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
  },
  stepBtnTxt: { fontSize: 16, color: C.text, lineHeight: 18 },
  goalVal: { fontSize: 19, fontWeight: '700', color: C.text, minWidth: 72, textAlign: 'center' },
  goalUnit: { fontSize: 10, color: C.muted, fontWeight: '400' },

  quickRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  quickBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center',
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line,
  },
  quickBtnSel: { borderColor: C.warm, backgroundColor: C.warmSoft },
  quickTxt: { fontSize: 12, color: C.muted, fontWeight: '500' },
  quickTxtSel: { color: C.warm },

  segBlock: { marginBottom: 12 },
  segBlockTight: { marginBottom: 0 },
  segRow: { flexDirection: 'row', gap: 5 },
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
    backgroundColor: C.warm, borderRadius: 14, paddingVertical: 17,
    alignItems: 'center', marginTop: 2, marginBottom: 10,
  },
  startBtnTxt: { fontSize: 16, fontWeight: '700', color: '#1A0E08' },

  discloseBtn: { paddingVertical: 10, paddingHorizontal: 4, marginBottom: 4 },
  discloseTxt: { fontSize: 12.5, color: C.cool, fontWeight: '600' },
  discloseHint: { fontSize: 11, color: C.line === C.cool ? C.muted : '#5A6377', marginTop: 3 },

  resetBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 2 },
  resetTxt: { fontSize: 12, color: C.cool, fontWeight: '500' },
});
