// ============================================================
//  진행도 - 캠페인 스테이지 / 유닛 해금·레벨 / 덱 / 기능 해금
//  (메타 데이터를 읽고 쓰는 규칙을 한 곳에 모아 UI 와 분리)
// ============================================================
import {
  STAGES, STAGE_BY_ID, UNITS, UNIT_BY_ID, DECK_SIZE, UNIT_MAX_LEVEL, unitUpgradeCost,
  FEATURE_UNLOCK, CHAPTERS, STAGES_PER_CHAPTER,
} from './config';
import { meta, saveMeta } from './meta';
import type { Job, GameOptions } from './types';

// ---------- 스테이지 ----------
export function stageStars(id: string): number {
  return meta.stages[id] || 0;
}
export function stageCleared(id: string): boolean {
  return stageStars(id) > 0;
}
/** 첫 스테이지이거나 이전 스테이지를 클리어했으면 도전 가능 */
export function stageUnlocked(id: string): boolean {
  const st = STAGE_BY_ID[id];
  if (!st) return false;
  if (st.index === 0) return true;
  return stageCleared(STAGES[st.index - 1].id);
}
/** 다음에 도전할 스테이지 (모두 클리어 시 마지막) */
export function nextStageId(): string {
  const s = STAGES.find((x) => !stageCleared(x.id));
  return (s ?? STAGES[STAGES.length - 1]).id;
}
export function chapterStars(chapter: number): number {
  return STAGES.filter((s) => s.chapter === chapter).reduce((n, s) => n + stageStars(s.id), 0);
}
export const CHAPTER_STAR_GOALS = [10, 20, 30];
export function chapterStarReward(goalIdx: number): number {
  return [100, 200, 400][goalIdx];
}
/** 챕터 별 보상 수령 키 */
function starKey(chapter: number, goalIdx: number): string {
  return `stars:${chapter}:${goalIdx}`;
}
export function starRewardClaimed(chapter: number, goalIdx: number): boolean {
  return !!meta.oneTime[starKey(chapter, goalIdx)];
}
export function claimStarReward(chapter: number, goalIdx: number): number {
  if (starRewardClaimed(chapter, goalIdx)) return 0;
  if (chapterStars(chapter) < CHAPTER_STAR_GOALS[goalIdx]) return 0;
  const r = chapterStarReward(goalIdx);
  meta.oneTime[starKey(chapter, goalIdx)] = true;
  meta.crystals += r;
  saveMeta();
  return r;
}

export interface StageResult {
  stars: number;
  firstClear: boolean;
  newBest: boolean;
  crystals: number;
  unlocked?: Job;
}

/** 스테이지 종료 처리 (클리어 시 보상/해금) */
export function completeStage(id: string, cleared: boolean, stars: number): StageResult {
  const st = STAGE_BY_ID[id];
  const prev = stageStars(id);
  if (!st || !cleared) return { stars: 0, firstClear: false, newBest: false, crystals: 0 };
  const firstClear = prev === 0;
  const crystals = firstClear ? st.firstReward : st.replayReward;
  meta.stages[id] = Math.max(prev, stars);
  meta.crystals += crystals;
  let unlocked: Job | undefined;
  if (firstClear && st.unlocks && !meta.units[st.unlocks]) {
    unlocked = st.unlocks;
    unlockUnit(st.unlocks, false);
  }
  saveMeta();
  return { stars, firstClear, newBest: stars > prev, crystals, unlocked };
}

export function chapterName(chapter: number): string {
  return CHAPTERS[chapter - 1]?.kr ?? '';
}
export function chapterUnlocked(chapter: number): boolean {
  if (chapter === 1) return true;
  return stageCleared(`${chapter - 1}-${STAGES_PER_CHAPTER}`);
}

// ---------- 기능 해금 ----------
export type Feature = keyof typeof FEATURE_UNLOCK;
export function featureUnlocked(f: Feature): boolean {
  return stageCleared(FEATURE_UNLOCK[f]);
}
export function featureHint(f: Feature): string {
  return `스테이지 ${FEATURE_UNLOCK[f]} 클리어 시 해금`;
}

// ---------- 유닛 ----------
export function unitUnlocked(job: Job): boolean {
  return !!meta.units[job];
}
export function unitLevel(job: Job): number {
  return meta.units[job] || 0;
}

/** 유닛 해금. 덱에 빈 자리가 있으면 자동 편성 */
export function unlockUnit(job: Job, save = true): void {
  if (meta.units[job]) return;
  meta.units[job] = 1;
  if (meta.deck.length < DECK_SIZE && !meta.deck.includes(job)) meta.deck.push(job);
  if (save) saveMeta();
}

/** 보석으로 조기 해금 */
export function buyUnit(job: Job): boolean {
  const def = UNIT_BY_ID[job];
  if (unitUnlocked(job) || !def.unlockCrystals || meta.crystals < def.unlockCrystals) return false;
  meta.crystals -= def.unlockCrystals;
  unlockUnit(job);
  return true;
}

export function canUpgradeUnit(job: Job): boolean {
  const lv = unitLevel(job);
  return lv > 0 && lv < UNIT_MAX_LEVEL && meta.crystals >= unitUpgradeCost(lv);
}
export function upgradeUnit(job: Job): boolean {
  if (!canUpgradeUnit(job)) return false;
  const lv = unitLevel(job);
  meta.crystals -= unitUpgradeCost(lv);
  meta.units[job] = lv + 1;
  saveMeta();
  return true;
}

/** 덱 토글: 덱에 있으면 빼고(최소 1), 없으면 넣는다(최대 4) */
export function toggleDeck(job: Job): boolean {
  if (!unitUnlocked(job)) return false;
  const i = meta.deck.indexOf(job);
  if (i >= 0) {
    if (meta.deck.length <= 1) return false;
    meta.deck.splice(i, 1);
  } else {
    if (meta.deck.length >= DECK_SIZE) return false;
    meta.deck.push(job);
  }
  saveMeta();
  return true;
}

export function unitLevels(): Partial<Record<Job, number>> {
  const out: Partial<Record<Job, number>> = {};
  for (const u of UNITS) if (meta.units[u.id]) out[u.id] = meta.units[u.id];
  return out;
}

// ---------- 게임 시작 옵션 ----------
export function stageOptions(id: string, goldBooster: boolean): Partial<GameOptions> {
  const st = STAGE_BY_ID[id];
  return {
    mode: 'solo', stageId: id, waves: st.waves, hpMult: st.hpMult, races: st.races,
    deck: [...meta.deck], unitLevels: unitLevels(), startGoldMult: goldBooster ? 2 : 1,
  };
}
export function endlessOptions(goldBooster: boolean): Partial<GameOptions> {
  return { mode: 'solo', deck: [...meta.deck], unitLevels: unitLevels(), startGoldMult: goldBooster ? 2 : 1 };
}
