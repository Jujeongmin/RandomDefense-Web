// ============================================================
//  헤드리스 밸런스 시뮬레이터
//  자동 플레이어로 게임오버까지 돌려 도달 웨이브를 측정한다.
//  실행: npx tsx tools/simulate.ts
// ============================================================
import { Game } from '../game/src/engine';
import { meta } from '../game/src/meta';
import { WAVE, ECONOMY, RESEARCH_PER, GRADE_INDEX, STAGES, UNITS, starsFor } from '../game/src/config';
import type { ResearchKey, GameOptions, Job } from '../game/src/types';

// 실험용 런타임 오버라이드 (config 는 as const 지만 런타임 객체는 가변)
const W = WAVE as { hpGrowthPerWave: number };
const E = ECONOMY as { upgradePerLevel: number };
// 환경변수로 HP 성장률 실험: SIM_HPG=0.12 npx tsx tools/simulate.ts
if (process.env.SIM_HPG) W.hpGrowthPerWave = Number(process.env.SIM_HPG);
const BASE_HP_GROWTH = W.hpGrowthPerWave;
const BASE_UP = ECONOMY.upgradePerLevel;

// 연구 효과 강도 스케일 적용 (atk/goldGain/startGold/boss 를 배수만큼 강화)
function setResearchScale(scale: number): void {
  RESEARCH_PER.atk = 0.02 * scale;
  RESEARCH_PER.goldGain = 0.02 * scale;
  RESEARCH_PER.startGold = 5 * scale;
  RESEARCH_PER.boss = 0.02 * scale;
  // rare 는 확률이라 별도 유지
}

type Profile = Partial<Record<ResearchKey, number>>;

function setResearch(p: Profile): void {
  meta.research.atk = p.atk ?? 0;
  meta.research.startGold = p.startGold ?? 0;
  meta.research.goldGain = p.goldGain ?? 0;
  meta.research.rare = p.rare ?? 0;
  meta.research.boss = p.boss ?? 0;
}

// ---- 자동 플레이어 정책 ----
// 초반: 유닛 수를 목표치까지 소환. 이후: 살 수 있으면 최고등급 스택 강화, 남는 골드로 소환.
function tryUpgrade(game: Game): boolean {
  // 유닛 수가 많은 직업부터 강화 (강화는 직업 단위)
  const jobs = game.getJobStacks().sort((a, b) => b.count - a.count);
  for (const s of jobs) {
    const cost = game.upgradeCost(s.job);
    if (game.gold >= cost) return game.upgrade(s.job);
  }
  return false;
}

// 합성 가능한 조합이 있으면 합성 (낮은 등급부터)
const MERGE = process.env.SIM_MERGE !== '0';
function tryMerge(game: Game): boolean {
  if (!MERGE) return false;
  const m = game.mergeable().sort((a, b) => GRADE_INDEX[a.grade] - GRADE_INDEX[b.grade])[0];
  return !!(m && game.merge(m.job, m.grade));
}

function autoPlay(game: Game, armyTarget: number): void {
  const SUMMON = 20;
  if (tryMerge(game)) return;
  if (game.units.length < armyTarget) {
    if (game.gold >= SUMMON) game.summon();
    return;
  }
  // 군대 확보됨 → 강화 우선, 실패 시 소환
  if (!tryUpgrade(game)) {
    if (game.gold >= SUMMON) game.summon();
  }
}

function runOnce(profile: Profile, armyTarget = 18, opts: Partial<GameOptions> = {}): number {
  return runGame(profile, armyTarget, opts).wave;
}

function runGame(profile: Profile, armyTarget = 18, opts: Partial<GameOptions> = {}): Game {
  setResearch(profile);
  const game = new Game({ track: false, ...opts });
  game.speed = 1;
  const dt = 1 / 20;
  const actionEvery = 0.2;
  let sinceAction = 0;
  let t = 0;
  const maxT = 90 * 60; // 안전장치(게임시간 90분)
  while (!game.over && t < maxT) {
    game.update(dt);
    t += dt;
    sinceAction += dt;
    if (sinceAction >= actionEvery) {
      sinceAction = 0;
      autoPlay(game, armyTarget);
    }
  }
  return game;
}

// 캠페인 스테이지별 클리어율/별 (연구 진척 × 유닛 레벨 프로필)
// 덱: 해당 스테이지 시점에 해금된 유닛 중 4종 (최근 해금 우선)
function stageSweep(runs = 8, filter?: string): void {
  const profiles: [string, Profile, number][] = [
    ['none', {}, 1],
    ['quarter', { atk: 5, startGold: 5, goldGain: 5, rare: 2, boss: 5 }, 3],
    ['half', { atk: 10, startGold: 10, goldGain: 10, rare: 5, boss: 10 }, 5],
    ['3/4', { atk: 15, startGold: 15, goldGain: 15, rare: 7, boss: 15 }, 7],
  ];
  const order = STAGES.map((s) => s.id);
  console.log(`\n=== 스테이지 클리어율% / 평균별 (각 ${runs}회) ===`);
  console.log('stage  waves hpX   ' + profiles.map(([n]) => n.padStart(11)).join(''));
  for (const st of STAGES) {
    if (filter && !st.id.startsWith(filter)) continue;
    const unlocked: Job[] = UNITS.filter((u) => !u.unlockStage || order.indexOf(u.unlockStage) < order.indexOf(st.id)).map((u) => u.id);
    const deck = unlocked.slice(-4);
    const cells = profiles.map(([, prof, lv]) => {
      const levels = Object.fromEntries(deck.map((j) => [j, lv]));
      let clears = 0, stars = 0;
      for (let i = 0; i < runs; i++) {
        const g = runGame(prof, 18, { stageId: st.id, waves: st.waves, hpMult: st.hpMult, races: st.races, deck, unitLevels: levels });
        if (g.cleared) { clears++; stars += starsFor(g.peakMobs); }
      }
      return `${Math.round((clears / runs) * 100)}%/${clears ? (stars / clears).toFixed(1) : '-'}`.padStart(11);
    });
    console.log(st.id.padEnd(6), String(st.waves).padStart(5), String(st.hpMult).padEnd(5), cells.join(''));
  }
}

function stats(xs: number[]): { avg: number; min: number; max: number; clearRate: number } {
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    avg: Math.round(avg * 10) / 10,
    min: Math.min(...xs),
    max: Math.max(...xs),
    clearRate: Math.round((xs.filter((w) => w >= 50).length / xs.length) * 100),
  };
}

function sweep(runs = 30): void {
  const profiles: [string, Profile][] = [
    ['none  (연구 0)',      {}],
    ['quarter',             { atk: 5, startGold: 5, goldGain: 5, rare: 2, boss: 5 }],
    ['half',                { atk: 10, startGold: 10, goldGain: 10, rare: 5, boss: 10 }],
    ['three-q',             { atk: 15, startGold: 15, goldGain: 15, rare: 7, boss: 15 }],
    ['full  (연구 MAX)',    { atk: 20, startGold: 20, goldGain: 20, rare: 10, boss: 20 }],
  ];
  console.log(`\n=== 밸런스 시뮬 (각 ${runs}회 평균, armyTarget=18) ===`);
  console.log('profile'.padEnd(20), 'avgWave', ' min', ' max', ' clear%');
  for (const [name, prof] of profiles) {
    const waves = Array.from({ length: runs }, () => runOnce(prof));
    const s = stats(waves);
    console.log(
      name.padEnd(20),
      String(s.avg).padStart(6),
      String(s.min).padStart(4),
      String(s.max).padStart(4),
      String(s.clearRate).padStart(6) + '%',
    );
  }
  console.log('');
}

function armySweep(runs = 20): void {
  const full: Profile = { atk: 20, startGold: 20, goldGain: 20, rare: 10, boss: 20 };
  console.log(`\n=== armyTarget 스윕 (full 연구, 각 ${runs}회) ===`);
  console.log('armyTarget'.padEnd(12), 'avgWave', ' min', ' max', ' clear%');
  for (const target of [18, 30, 50, 80, 120, 200]) {
    const waves = Array.from({ length: runs }, () => runOnce(full, target));
    const s = stats(waves);
    console.log(
      String(target).padEnd(12),
      String(s.avg).padStart(6),
      String(s.min).padStart(4),
      String(s.max).padStart(4),
      String(s.clearRate).padStart(6) + '%',
    );
  }
  console.log('');
}

// HP 성장률 / 강화 스케일을 바꿔가며 "50 클리어 가능 지점" 탐색
function tuneSweep(runs = 20): void {
  const full: Profile = { atk: 20, startGold: 20, goldGain: 20, rare: 10, boss: 20 };
  const none: Profile = {};
  console.log(`\n=== HP성장률 × 강화스케일 실험 (각 ${runs}회) ===`);
  console.log('hpGrowth  up/Lv   full_avg full_clear%   none_avg');
  const grows = [0.20, 0.15, 0.12, 0.10];
  const ups = [0.10, 0.20, 0.30];
  for (const g of grows) {
    for (const up of ups) {
      W.hpGrowthPerWave = g;
      E.upgradePerLevel = up;
      const fw = Array.from({ length: runs }, () => runOnce(full, 60));
      const nw = Array.from({ length: runs }, () => runOnce(none, 60));
      const fs = stats(fw), ns = stats(nw);
      console.log(
        String(g).padEnd(9),
        String(up).padEnd(7),
        String(fs.avg).padStart(7),
        (String(fs.clearRate) + '%').padStart(11),
        String(ns.avg).padStart(11),
      );
    }
  }
  W.hpGrowthPerWave = BASE_HP_GROWTH;
  E.upgradePerLevel = BASE_UP;
  console.log('');
}

// HP성장률 × 연구강도 그리드 탐색: 연구 진척별 도달 웨이브 곡선
function search(runs = 25): void {
  const P = {
    none: {} as Profile,
    quarter: { atk: 5, startGold: 5, goldGain: 5, rare: 2, boss: 5 } as Profile,
    half: { atk: 10, startGold: 10, goldGain: 10, rare: 5, boss: 10 } as Profile,
    threeQ: { atk: 15, startGold: 15, goldGain: 15, rare: 7, boss: 15 } as Profile,
    full: { atk: 20, startGold: 20, goldGain: 20, rare: 10, boss: 20 } as Profile,
  };
  console.log(`\n=== HP성장률 × 연구강도 탐색 (각 ${runs}회) ===`);
  console.log('hpG    rScale  none  1/4   half  3/4   full  fullClr%');
  for (const g of [0.10, 0.11]) {
    for (const scale of [1.5, 2, 2.5, 3]) {
      W.hpGrowthPerWave = g;
      setResearchScale(scale);
      const avg = (prof: Profile) => stats(Array.from({ length: runs }, () => runOnce(prof, 60)));
      const n = avg(P.none), q = avg(P.quarter), h = avg(P.half), t = avg(P.threeQ), f = avg(P.full);
      console.log(
        String(g).padEnd(6),
        String(scale).padEnd(7),
        String(n.avg).padStart(4),
        String(q.avg).padStart(5),
        String(h.avg).padStart(5),
        String(t.avg).padStart(5),
        String(f.avg).padStart(5),
        (String(f.clearRate) + '%').padStart(9),
      );
    }
  }
  W.hpGrowthPerWave = BASE_HP_GROWTH;
  E.upgradePerLevel = BASE_UP;
  setResearchScale(1);
  console.log('');
}

const mode = process.argv[2] || 'sweep';
if (mode === 'stages') stageSweep(Number(process.argv[3]) || 8, process.argv[4]);
else if (mode === 'army') armySweep(Number(process.argv[3]) || 20);
else if (mode === 'tune') tuneSweep(Number(process.argv[3]) || 20);
else if (mode === 'search') search(Number(process.argv[3]) || 20);
else sweep(Number(process.argv[2]) || 30);
