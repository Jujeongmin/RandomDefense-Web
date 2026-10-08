// ============================================================
//  랜덤 디펜스 - 게임 데이터/밸런스 테이블
//  (게임 기획서 기준. 숫자 하나만 바꿔도 밸런스가 조정되도록 이곳에 집중)
// ============================================================
import type {
  Job, Race, GradeKey, Grade, ResearchDef, DailyQuestDef, AchievementDef, ResearchKey,
} from './types';

// ---------- 직업 ----------
export const JOBS: Job[] = ['archer', 'wizard', 'warrior'];
export const JOB_KR: Record<Job, string> = { archer: '궁수', wizard: '마법사', warrior: '전사' };
export const JOB_SPRITE: Record<Job, string> = { archer: 'Archer', wizard: 'Wizard', warrior: 'Warrior' };

// ---------- 몹 종족 ----------
export const RACES: Race[] = ['troll', 'orc', 'undead'];
export const RACE_KR: Record<Race, string> = { troll: '트롤', orc: '오크', undead: '언데드' };
export const RACE_SPRITE: Record<Race, string> = { troll: 'Mob_Troll', orc: 'Mob_Orc', undead: 'Mob_Undead' };

// ---------- 직업 x 종족 데미지 배율 ----------
export const DMG_MULT: Record<Job, Record<Race, number>> = {
  archer:  { troll: 0.8, orc: 1.0, undead: 0.8 },
  wizard:  { troll: 0.6, orc: 0.8, undead: 1.0 },
  warrior: { troll: 1.0, orc: 0.8, undead: 0.6 },
};

// ---------- 등급 ----------
export const GRADES: Grade[] = [
  { key: 'common',    kr: '일반',   spriteIndex: 0, atk: [10, 15],   summonRate: 50,  sellGold: 10,   color: '#b8b8b8' },
  { key: 'rare',      kr: '고급',   spriteIndex: 1, atk: [20, 30],   summonRate: 33,  sellGold: 25,   color: '#4caf50' },
  { key: 'elite',     kr: '정예',   spriteIndex: 2, atk: [40, 60],   summonRate: 10,  sellGold: 60,   color: '#2196f3' },
  { key: 'legendary', kr: '전설',   spriteIndex: 3, atk: [80, 120],  summonRate: 6.5, sellGold: 150,  color: '#9c27b0' },
  { key: 'mythic',    kr: '신화',   spriteIndex: 4, atk: [160, 240], summonRate: 0.4, sellGold: 400,  color: '#ff9800' },
  { key: 'eternal',   kr: '태초',   spriteIndex: 5, atk: [320, 480], summonRate: 0.1, sellGold: 1000, color: '#f44336' },
];
export const GRADE_BY_KEY: Record<GradeKey, Grade> =
  Object.fromEntries(GRADES.map((g) => [g.key, g])) as Record<GradeKey, Grade>;
export const GRADE_INDEX: Record<GradeKey, number> =
  Object.fromEntries(GRADES.map((g, i) => [g.key, i])) as Record<GradeKey, number>;

// 전설(index 3) 이상은 맵 전체 사거리
export const FULL_RANGE_FROM_INDEX = 3;

// 등급별 사거리(픽셀). 전설 이상은 Infinity 로 처리
// (유닛/몹 크기 확대에 맞춰 상향 - 각 구역이 자기 경로 변을 넉넉히 커버)
export const GRADE_RANGE: number[] = [215, 270, 330, Infinity, Infinity, Infinity];

// ---------- 경제 ----------
export const ECONOMY = {
  startGold: 100,
  summonCost: 20,
  killGold: 2,
  bossGold: 100,
  upgradeBase: 20,
  upgradeStep: 20,
  upgradePerLevel: 0.10,
} as const;

// ---------- 웨이브 ----------
export const WAVE = {
  total: 50,
  mobsPerWave: 40,
  hpBase: 100,
  // 기획서 원안은 +20%(지수)였으나, 그 값으로는 유닛 파워(선형)가 따라잡지 못해
  // 50웨이브 클리어가 수학적으로 불가능. 하드코어(연구 필수) 곡선을 위해 완화.
  // 합성/직업 스킬 추가로 유닛 파워가 오른 만큼 +11% → +11.5% 로 재조정 (tools/simulate.ts).
  hpGrowthPerWave: 0.115,
  mobSpeed: 1.2,
  cornerPause: 0.25,
  restBetween: 5.0,
  spawnInterval: 0.6,
  gameOverMobCount: 100,
  bossEvery: 10,
  bossTimeLimit: 120,
  bossHpMult: 25,
  bossSizeMult: 2,
} as const;

// ---------- 몹 종류 (웨이브 구성 다양화) ----------
// fast: 빠르고 약함 / tank: 느리고 단단함. 등장 시작 웨이브와 간격(n번째 몹마다)
export const MOB_KINDS = {
  fast: { hpMult: 0.6, speedMult: 1.6, sizeMult: 0.85, fromWave: 4, every: 5 },
  tank: { hpMult: 2.6, speedMult: 0.72, sizeMult: 1.25, fromWave: 11, every: 9 },
} as const;

// ---------- 직업 스킬 (정예 등급 이상에서 발동) ----------
export const SKILL_FROM_INDEX = 2; // 정예(index 2) 이상
export const SKILLS = {
  // 궁수: 다중 사격 - 추가 대상 n명에게 비율 피해 (전설 이상 +1명)
  archer: { extraTargets: 1, extraTargetsHigh: 2, ratio: 0.5 },
  // 마법사: 폭발 - 대상 주변 반경 피해
  wizard: { radius: 62, radiusHigh: 86, ratio: 0.35 },
  // 전사: 둔화 - 대상 이동 속도 감소
  warrior: { slowPct: 0.25, slowPctHigh: 0.38, dur: 1.1 },
  // 공통 치명타
  critChance: 0.1,
  critMult: 2,
} as const;
export const SKILL_KR: Record<Job, string> = {
  archer: '다중 사격', wizard: '마력 폭발', warrior: '둔화 강타',
};
export const SKILL_DESC: Record<Job, string> = {
  archer: '정예+: 주변 적 1명(전설+ 2명)에게 50% 추가 피해',
  wizard: '정예+: 대상 주변 범위에 35% 폭발 피해',
  warrior: '정예+: 대상 이동속도 25%(전설+ 38%) 감소',
};

// ---------- 합성 (같은 직업·등급 3개 → 상위 등급 1개) ----------
export const MERGE_COUNT = 3;

// ---------- PvP ----------
export const PVP = {
  // 몹 보내기: [몹 무리, 정예 몹]
  attacks: [
    { kr: '몹 무리', cost: 40, count: 6, hpMult: 0.9 },
    { kr: '정예 몹', cost: 160, count: 1, hpMult: 14 },
  ],
  reportInterval: 0.5,   // 상태 보고 주기(초)
  matchTimeout: 25,      // 매칭 대기 최대(초) → 초과 시 AI 대전 제안
  trophyWin: 30,
  trophyLoss: 20,
  rewardWin: 40,         // 크리스탈
  rewardLoss: 10,
  seasonXpWin: 100,
  seasonXpLoss: 40,
} as const;

// ---------- 시드 RNG (PvP 양쪽이 같은 웨이브를 보도록) ----------
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 소환 확률 도우미 ----------
export function rollGrade(rareBonus = 0): GradeKey {
  const table = GRADES.map((g) => ({ key: g.key, rate: g.summonRate }));
  const bonus = rareBonus;
  if (bonus > 0) {
    table[3].rate += bonus * 0.7;
    table[4].rate += bonus * 0.2;
    table[5].rate += bonus * 0.1;
  }
  const total = table.reduce((s, t) => s + t.rate, 0);
  let r = Math.random() * total;
  for (const t of table) {
    if (r < t.rate) return t.key;
    r -= t.rate;
  }
  return 'common';
}

export function rollJob(): Job {
  return JOBS[Math.floor(Math.random() * JOBS.length)];
}

// ---------- 연구소 ----------
// 하드코어 곡선을 위해 기획서 원안(+2%/레벨 등)보다 강화된 값 사용.
// 연구 성장이 지수 HP 벽을 넘게 해주는 핵심 진행 요소.
export const RESEARCH: ResearchDef[] = [
  { key: 'atk',       kr: '공격력 연구',   max: 20, desc: '레벨 당 공격력 +4%',        per: 0.04 },
  { key: 'startGold', kr: '시작 골드 연구', max: 20, desc: '레벨 당 시작 골드 +10',      per: 10 },
  { key: 'goldGain',  kr: '골드 획득 연구', max: 20, desc: '몬스터 처치 골드 +4%',       per: 0.04 },
  { key: 'rare',      kr: '희귀 소환 연구', max: 10, desc: '전설 이상 등장 확률 소폭 증가', per: 0.5 },
  { key: 'boss',      kr: '보스 피해 연구', max: 20, desc: '보스 대상 공격력 +4%',        per: 0.04 },
];
export function researchCost(level: number): number {
  return 5 + level * 5;
}

// 연구 레벨당 효과 크기 (엔진이 참조하는 단일 소스). RESEARCH.per 와 동기화.
export const RESEARCH_PER: Record<ResearchKey, number> =
  Object.fromEntries(RESEARCH.map((r) => [r.key, r.per])) as Record<ResearchKey, number>;

// ---------- 상점 (VX 로 구매) ----------
export const AD_REMOVE_VX = 300; // 광고제거 패키지 가격(VX)
export interface CrystalPackage { crystals: number; vx: number; bonus?: number }
export const CRYSTAL_PACKAGES: CrystalPackage[] = [
  { crystals: 100,  vx: 10 },
  { crystals: 550,  vx: 50,  bonus: 10 },
  { crystals: 1200, vx: 100, bonus: 20 },
];

// ---------- 게임 종료 시 크리스탈 보상 ----------
export function crystalReward(wave: number): number {
  let c = wave * 2;
  c += Math.floor(wave / 10) * 10;
  return c;
}

// ---------- 퀘스트 ----------
export const DAILY_QUESTS: DailyQuestDef[] = [
  { key: 'summon30',  kr: '유닛 30회 소환',   goal: 30, stat: 'summons',  reward: 20 },
  { key: 'kill200',   kr: '몬스터 200마리 처치', goal: 200, stat: 'kills',  reward: 20 },
  { key: 'wave20',    kr: '20웨이브 도달',    goal: 20, stat: 'bestWave', reward: 30 },
  { key: 'sell20',    kr: '유닛 20회 판매',   goal: 20, stat: 'sells',    reward: 15 },
];

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'firstLegendary', kr: '전설 유닛 최초 획득', reward: 50 },
  { key: 'firstMythic',    kr: '신화 유닛 최초 획득', reward: 100 },
  { key: 'firstEternal',   kr: '태초 유닛 최초 획득', reward: 300 },
  { key: 'clear10',        kr: '10웨이브 클리어',     reward: 30 },
  { key: 'clear20',        kr: '20웨이브 클리어',     reward: 60 },
  { key: 'clear30',        kr: '30웨이브 클리어',     reward: 100 },
  { key: 'clear40',        kr: '40웨이브 클리어',     reward: 200 },
  { key: 'clear50',        kr: '50웨이브 클리어',     reward: 500 },
];
