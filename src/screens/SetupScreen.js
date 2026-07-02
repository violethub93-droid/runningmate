import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, SafeAreaView, ScrollView, StatusBar,
} from 'react-native';

const PERSONAS = [
  { id: 'coach', label: '코치형', desc: '차분하게 알려줄게요', emoji: '🎯' },
  { id: 'friend', label: '친구형', desc: '같이 달리는 느낌', emoji: '👟' },
];

const PRESET_PACES = [
  { label: '5:00', sec: 300 },
  { label: '5:30', sec: 330 },
  { label: '6:00', sec: 360 },
  { label: '6:30', sec: 390 },
  { label: '7:00', sec: 420 },
  { label: '7:30', sec: 450 },
  { label: '8:00', sec: 480 },
];

const PRESET_DISTANCES = [3, 5, 10];

export default function SetupScreen({ navigation }) {
  const [persona, setPersona] = useState('coach');
  const [targetPaceSec, setTargetPaceSec] = useState(420); // 7:00
  const [targetDistanceKm, setTargetDistanceKm] = useState(5);

  const paceLabel = () => {
    const m = Math.floor(targetPaceSec / 60);
    const s = targetPaceSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleStart = () => {
    navigation.navigate('Running', { persona, targetPaceSec, targetDistanceKm });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <ScrollView contentContainerStyle={styles.container}>

        <Text style={styles.appTitle}>러닝메이트</Text>
        <Text style={styles.appSub}>오늘 같이 달려요</Text>

        {/* 페르소나 선택 */}
        <Text style={styles.sectionLabel}>메이트 유형</Text>
        <View style={styles.personaRow}>
          {PERSONAS.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.personaCard, persona === p.id && styles.personaCardActive]}
              onPress={() => setPersona(p.id)}
            >
              <Text style={styles.personaEmoji}>{p.emoji}</Text>
              <Text style={[styles.personaLabel, persona === p.id && styles.personaLabelActive]}>
                {p.label}
              </Text>
              <Text style={styles.personaDesc}>{p.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 목표 페이스 */}
        <Text style={styles.sectionLabel}>목표 페이스</Text>
        <Text style={styles.currentValue}>{paceLabel()} / km</Text>
        <View style={styles.presetRow}>
          {PRESET_PACES.map((p) => (
            <TouchableOpacity
              key={p.sec}
              style={[styles.presetBtn, targetPaceSec === p.sec && styles.presetBtnActive]}
              onPress={() => setTargetPaceSec(p.sec)}
            >
              <Text style={[styles.presetBtnText, targetPaceSec === p.sec && styles.presetBtnTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 목표 거리 */}
        <Text style={styles.sectionLabel}>목표 거리</Text>
        <View style={styles.presetRow}>
          {PRESET_DISTANCES.map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.distBtn, targetDistanceKm === d && styles.distBtnActive]}
              onPress={() => setTargetDistanceKm(d)}
            >
              <Text style={[styles.distBtnText, targetDistanceKm === d && styles.distBtnTextActive]}>
                {d}km
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.distBtn, targetDistanceKm === 0 && styles.distBtnActive]}
            onPress={() => setTargetDistanceKm(0)}
          >
            <Text style={[styles.distBtnText, targetDistanceKm === 0 && styles.distBtnTextActive]}>
              자유
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
          <Text style={styles.startBtnText}>달리기 시작</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  container: { padding: 24, paddingBottom: 40 },
  appTitle: { fontSize: 32, fontWeight: '800', color: '#fff', marginTop: 20, letterSpacing: -0.5 },
  appSub: { fontSize: 15, color: '#666', marginBottom: 36, marginTop: 4 },

  sectionLabel: { fontSize: 13, color: '#888', fontWeight: '600', marginBottom: 12, letterSpacing: 0.5 },

  personaRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  personaCard: {
    flex: 1, borderRadius: 16, borderWidth: 1.5, borderColor: '#222',
    backgroundColor: '#111', padding: 16, alignItems: 'center',
  },
  personaCardActive: { borderColor: '#4ADE80', backgroundColor: '#0f2010' },
  personaEmoji: { fontSize: 24, marginBottom: 6 },
  personaLabel: { fontSize: 15, fontWeight: '700', color: '#aaa', marginBottom: 4 },
  personaLabelActive: { color: '#4ADE80' },
  personaDesc: { fontSize: 11, color: '#555', textAlign: 'center' },

  currentValue: { fontSize: 40, fontWeight: '800', color: '#fff', marginBottom: 14 },

  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 32 },
  presetBtn: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#222', backgroundColor: '#111',
  },
  presetBtnActive: { borderColor: '#4ADE80', backgroundColor: '#0f2010' },
  presetBtnText: { fontSize: 14, color: '#666', fontWeight: '600' },
  presetBtnTextActive: { color: '#4ADE80' },

  distBtn: {
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#222', backgroundColor: '#111',
  },
  distBtnActive: { borderColor: '#4ADE80', backgroundColor: '#0f2010' },
  distBtnText: { fontSize: 15, color: '#666', fontWeight: '600' },
  distBtnTextActive: { color: '#4ADE80' },

  startBtn: {
    backgroundColor: '#4ADE80', borderRadius: 20, paddingVertical: 18,
    alignItems: 'center', marginTop: 12,
  },
  startBtnText: { fontSize: 18, fontWeight: '800', color: '#0a0a0a', letterSpacing: 0.5 },
});
