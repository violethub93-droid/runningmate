// 코칭 데이터: situation × persona → { ttsText, audioFile }
// audioFile: assets/audio/ 에 실제 파일이 있을 때만 require() 추가 (audioMap.js)
// 파일 없으면 ttsText로 자동 폴백

export const SITUATIONS = {
  run_start: {
    cooldown_sec: 0,
    variants: {
      coach: [
        '같이 가요. 처음 5분은 몸 푸는 구간이에요. 천천히.',
        '오늘도 나왔네요. 무리하지 말고 편하게 시작해요.',
        '발끝부터 가볍게. 호흡은 코로 들이쉬고 입으로 내쉬어요.',
      ],
      friend: ['자, 가볼까? 처음엔 살살 가자, 같이.'],
    },
    audioKeys: {
      coach: ['run_start_coach_01', 'run_start_coach_02', 'run_start_coach_03'],
      friend: ['run_start_friend_01'],
    },
  },
  pace_too_fast: {
    cooldown_sec: 40,
    variants: {
      coach: [
        '조금 빨라요. 초반엔 힘 아껴둬요.',
        '지금은 천천히 가도 괜찮아요. 숨이 차면 속도를 줄여요.',
        '마음은 알겠지만, 반 박자만 늦춰볼까요?',
      ],
      friend: ['야 너무 빨라~ 좀 아껴, 같이 가자.'],
    },
    audioKeys: {
      coach: ['pace_too_fast_coach_01', 'pace_too_fast_coach_02', 'pace_too_fast_coach_03'],
      friend: ['pace_too_fast_friend_01'],
    },
  },
  pace_too_slow: {
    cooldown_sec: 45,
    variants: {
      coach: [
        '여유 있어 보여요. 호흡 되찾으면 살짝 올려봐요.',
        '괜찮아요, 지칠 땐 천천히. 준비되면 다시 리듬 잡아요.',
      ],
      friend: ['조금만 더 내보자~ 너 더 할 수 있어.'],
    },
    audioKeys: {
      coach: ['pace_too_slow_coach_01', 'pace_too_slow_coach_02'],
      friend: ['pace_too_slow_friend_01'],
    },
  },
  pace_on_target: {
    cooldown_sec: 90,
    variants: {
      coach: [
        '좋아요, 딱 이 리듬 그대로 가요.',
        '안정적이에요. 지금 페이스 기억해두세요.',
        '호흡과 발이 잘 맞아요. 이대로.',
      ],
      friend: ['오 좋아 좋아, 이대로 가자.'],
    },
    audioKeys: {
      coach: ['pace_on_target_coach_01', 'pace_on_target_coach_02', 'pace_on_target_coach_03'],
      friend: ['pace_on_target_friend_01'],
    },
  },
  cadence_low: {
    cooldown_sec: 60,
    variants: {
      coach: ['보폭이 조금 넓어요. 발 회전을 빠르게, 무릎 부담 줄여줘요.'],
      friend: ['보폭 줄이자, 빠르게 빠르게!'],
    },
    audioKeys: {
      coach: ['cadence_low_coach_01'],
      friend: ['cadence_low_coach_01'],
    },
  },
  uphill_detected: {
    cooldown_sec: 30,
    variants: {
      coach: [
        '오르막이에요. 보폭 줄이고 발 회전 빠르게. 페이스 떨어져도 괜찮아요.',
        '언덕 올라가요. 상체 살짝 앞으로, 팔로 리듬 만들어요.',
      ],
      friend: ['언덕이다! 보폭 줄이고 촘촘하게, 같이 올라가자.'],
    },
    audioKeys: {
      coach: ['uphill_coach_01', 'uphill_coach_02'],
      friend: ['uphill_friend_01'],
    },
  },
  downhill_detected: {
    cooldown_sec: 30,
    variants: {
      coach: ['내리막이에요. 보폭 늘리지 말고, 무릎으로 충격 받지 않게.'],
      friend: ['내리막, 가볍게 가자.'],
    },
    audioKeys: {
      coach: ['downhill_coach_01'],
      friend: ['downhill_coach_01'],
    },
  },
  idle_checkin: {
    cooldown_sec: 120,
    variants: {
      coach: [
        '잘하고 있어요. 어깨 힘 빼고, 시선은 앞으로.',
        '물 한 모금 생각나면 천천히. 페이스는 좋아요.',
        '손은 가볍게 쥐고, 호흡은 일정하게.',
      ],
      friend: ['잘 가고 있어, 계속 가자.'],
    },
    audioKeys: {
      coach: ['idle_checkin_coach_01', 'idle_checkin_coach_02', 'idle_checkin_coach_03'],
      friend: ['idle_checkin_coach_01'],
    },
  },
  final_push: {
    cooldown_sec: 30,
    variants: {
      coach: [
        '거의 다 왔어요. 마지막 힘내요.',
        '여기까지 잘 왔어요. 끝까지 같이 가요.',
        '마지막 구간이에요. 호흡 가다듬고 한 발씩.',
      ],
      friend: ['거의 다 왔어! 조금만 더, 할 수 있어!'],
    },
    audioKeys: {
      coach: ['final_push_coach_01', 'final_push_coach_02', 'final_push_coach_03'],
      friend: ['final_push_friend_01'],
    },
  },
  halfway: {
    cooldown_sec: 0,
    variants: {
      coach: [
        '절반 왔어요. 호흡 한 번 고르고 후반 준비해요.',
        '반환점이에요. 지금까지 잘 왔어요, 이대로.',
      ],
      friend: [
        '절반 왔다! 호흡 고르고 후반 가자.',
        '반 왔어, 잘하고 있어!',
      ],
    },
    audioKeys: { coach: [], friend: [] },
  },
  paused: {
    cooldown_sec: 0,
    variants: {
      coach: [
        '지금 타이밍에 잠시 재정비해요.',
        '신발끈 풀렸는지 한번 확인해요.',
        '발목 돌리고, 종아리 한번 풀어줘요.',
      ],
      friend: [
        '잠깐 쉬자, 재정비 한번.',
        '신발끈 한번 확인하고~',
        '발목 종아리 살짝 풀자.',
      ],
    },
    audioKeys: {
      coach: ['paused_coach_01', 'paused_coach_02', 'paused_coach_03'],
      friend: ['paused_friend_01', 'paused_friend_02', 'paused_friend_03'],
    },
  },
  resume: {
    cooldown_sec: 0,
    variants: {
      coach: [
        '다시 가볼까요. 천천히 출발해요.',
        '좋아요, 다시 출발. 페이스 서서히 올려요.',
      ],
      friend: [
        '자, 다시 가자!',
        '좋아 다시 출발하자~',
      ],
    },
    audioKeys: {
      coach: ['resume_coach_01', 'resume_coach_02'],
      friend: ['resume_friend_01', 'resume_friend_02'],
    },
  },
  goal: {
    cooldown_sec: 0,
    variants: {
      coach: ['목표 거리 완주! 오늘도 끝까지 잘 해냈어요.'],
      friend: ['목표 완주! 진짜 잘했어, 고생했어!'],
    },
    audioKeys: {
      coach: ['goal_coach_01'],
      friend: ['goal_friend_01'],
    },
  },
};

export const MILESTONES = {
  ttsText: {
    coach: {
      1: '1킬로미터 통과. 호흡 안정적이에요.',
      2: '2킬로미터 통과. 잘 가고 있어요.',
      3: '3킬로미터 지났어요. 페이스 좋아요.',
      4: '4킬로미터 통과. 잘 가고 있어요.',
      5: '5킬로미터 통과. 페이스 좋아요.',
    },
    friend: {
      1: '1킬로! 잘하고 있어, 계속 가자.',
      2: '2킬로! 같이 가자.',
      3: '3킬로! 잘하고 있어.',
      4: '4킬로! 거의 다 왔어.',
      5: '5킬로! 다 왔어!',
    },
  },
  audioKeys: {
    coach: {
      1: 'milestone_coach_1km',
      2: 'milestone_coach_2km',
      3: 'milestone_coach_3km',
      4: 'milestone_coach_4km',
      5: 'milestone_coach_5km',
    },
    friend: {
      1: 'milestone_friend_1km',
      2: 'milestone_coach_2km',
      3: 'milestone_coach_3km',
      4: 'milestone_coach_4km',
      5: 'milestone_coach_5km',
    },
  },
};

// 페이스 임계값 (초/km)
export const PACE_THRESHOLDS = {
  // 목표 페이스 대비 이 비율 이상 빠르면 too_fast
  tooFastRatio: 0.92,
  // 목표 페이스 대비 이 비율 이상 느리면 too_slow
  tooSlowRatio: 1.12,
  // 페이스 on_target 유지 구간 (목표 ± 8%)
  onTargetRatio: 0.08,
};

// 케이던스 임계값 (spm: steps per minute)
export const CADENCE_THRESHOLD = 160; // 이 이하면 cadence_low 트리거

// final_push 시작 거리 (목표 거리의 이 비율부터)
export const FINAL_PUSH_RATIO = 0.85;

// halfway 트리거 (목표 거리의 이 비율)
export const HALFWAY_RATIO = 0.5;

// 경사 임계값 (%)
export const SLOPE_THRESHOLDS = {
  uphill: 3,    // 경사 3% 이상 = 오르막
  downhill: -3, // 경사 -3% 이하 = 내리막
};
