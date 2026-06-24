// ─────────────────────────────────────────────────────────────
// 클로바더빙으로 mp3 파일을 만들었을 때 여기에 추가하세요.
// assets/audio/ 폴더에 파일을 넣고, 아래 require() 주석을 해제하면 됩니다.
// 파일이 없는 항목은 자동으로 TTS(음성합성)로 대체됩니다.
//
// 파일명 규칙: {상황}_{페르소나}_{번호}.mp3  →  저장 시 중괄호 제거
//   예) run_start_coach_01.mp3, milestone_coach_1km.mp3
// ─────────────────────────────────────────────────────────────

const audioMap = {
  // ── 시작 (2개 적용) ──────────────────────────────────────
  run_start_coach_01: require('../../assets/audio/run_start_coach_01.mp3'),
  run_start_coach_02: require('../../assets/audio/run_start_coach_02.mp3'),
  // run_start_coach_03: require('../../assets/audio/run_start_coach_03.mp3'),
  // run_start_friend_01: require('../../assets/audio/run_start_friend_01.mp3'),

  // ── 페이스 빠름 (3개 적용) ───────────────────────────────
  pace_too_fast_coach_01: require('../../assets/audio/pace_too_fast_coach_01.mp3'),
  pace_too_fast_coach_02: require('../../assets/audio/pace_too_fast_coach_02.mp3'),
  pace_too_fast_coach_03: require('../../assets/audio/pace_too_fast_coach_03.mp3'),
  // pace_too_fast_friend_01: require('../../assets/audio/pace_too_fast_friend_01.mp3'),

  // ── 페이스 느림 (2개 적용) ───────────────────────────────
  pace_too_slow_coach_01: require('../../assets/audio/pace_too_slow_coach_01.mp3'),
  pace_too_slow_coach_02: require('../../assets/audio/pace_too_slow_coach_02.mp3'),
  // pace_too_slow_friend_01: require('../../assets/audio/pace_too_slow_friend_01.mp3'),

  // ── 페이스 유지 (2개 적용) ───────────────────────────────
  pace_on_target_coach_01: require('../../assets/audio/pace_on_target_coach_01.mp3'),
  pace_on_target_coach_02: require('../../assets/audio/pace_on_target_coach_02.mp3'),
  // pace_on_target_coach_03: require('../../assets/audio/pace_on_target_coach_03.mp3'),
  // pace_on_target_friend_01: require('../../assets/audio/pace_on_target_friend_01.mp3'),

  // ── 케이던스 낮음 (1개 적용) ─────────────────────────────
  cadence_low_coach_01: require('../../assets/audio/cadence_low_coach_01.mp3'),

  // ── 오르막 (1개 적용) ────────────────────────────────────
  uphill_coach_01: require('../../assets/audio/uphill_coach_01.mp3'),
  // uphill_coach_02: require('../../assets/audio/uphill_coach_02.mp3'),
  // uphill_friend_01: require('../../assets/audio/uphill_friend_01.mp3'),

  // ── 내리막 (파일 없음 → TTS 폴백) ────────────────────────
  // downhill_coach_01: require('../../assets/audio/downhill_coach_01.mp3'),

  // ── 체크인 (파일 없음 → TTS 폴백) ────────────────────────
  // idle_checkin_coach_01: require('../../assets/audio/idle_checkin_coach_01.mp3'),
  // idle_checkin_coach_02: require('../../assets/audio/idle_checkin_coach_02.mp3'),
  // idle_checkin_coach_03: require('../../assets/audio/idle_checkin_coach_03.mp3'),

  // ── 막바지 (1개 적용) ────────────────────────────────────
  final_push_coach_01: require('../../assets/audio/final_push_coach_01.mp3'),
  // final_push_coach_02: require('../../assets/audio/final_push_coach_02.mp3'),
  // final_push_coach_03: require('../../assets/audio/final_push_coach_03.mp3'),
  // final_push_friend_01: require('../../assets/audio/final_push_friend_01.mp3'),

  // ── 마일스톤 코치형 (1~5km 적용) ─────────────────────────
  milestone_coach_1km: require('../../assets/audio/milestone_coach_1km.mp3'),
  milestone_coach_2km: require('../../assets/audio/milestone_coach_2km.mp3'),
  milestone_coach_3km: require('../../assets/audio/milestone_coach_3km.mp3'),
  milestone_coach_4km: require('../../assets/audio/milestone_coach_4km.mp3'),
  milestone_coach_5km: require('../../assets/audio/milestone_coach_5km.mp3'),

  // ── 마일스톤 친구형 (파일 없음 → TTS 폴백) ───────────────
  // milestone_friend_1km: require('../../assets/audio/milestone_friend_1km.mp3'),
};

export default audioMap;
