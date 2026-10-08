// ============================================================
//  AI 플레이어 - PvP 연습 상대(봇)가 사용하는 자동 플레이 정책
//  skill(0~1): 높을수록 판단이 빠르고 합성/강화/몹 보내기를 잘 활용
// ============================================================
import { GRADE_INDEX, ECONOMY, PVP } from './config';
import type { Game } from './engine';

export function aiStep(game: Game, skill: number): void {
  if (game.over) return;
  // 실수: 낮은 실력일수록 행동을 자주 건너뜀
  if (Math.random() > 0.35 + skill * 0.6) return;

  // 1) 합성 (낮은 등급부터)
  if (Math.random() < 0.3 + skill * 0.6) {
    const m = game.mergeable().sort((a, b) => GRADE_INDEX[a.grade] - GRADE_INDEX[b.grade])[0];
    if (m && game.merge(m.job, m.grade)) return;
  }
  // 2) 몹 보내기: 여유 골드가 있고 내 필드가 안정적이면 압박
  const safe = game.mobs.length < 35;
  if (game.isPvp && safe && game.units.length >= 12 && Math.random() < 0.15 + skill * 0.35) {
    const elite = PVP.attacks[1].cost;
    if (game.gold >= elite + 120 && Math.random() < skill) { game.sendAttack(1); return; }
    if (game.gold >= PVP.attacks[0].cost + 60) { game.sendAttack(0); return; }
  }
  // 3) 군대 확보 → 강화
  const target = 16 + Math.round(skill * 10);
  if (game.units.length < target) {
    if (game.gold >= ECONOMY.summonCost) game.summon();
    return;
  }
  const jobs = game.getJobStacks().sort((a, b) => b.count - a.count);
  for (const s of jobs) {
    if (game.gold >= game.upgradeCost(s.job)) { game.upgrade(s.job); return; }
  }
  if (game.gold >= ECONOMY.summonCost) game.summon();
}
