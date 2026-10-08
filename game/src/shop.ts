// ============================================================
//  상점 지급 로직 - 결제 완료 구매를 메타에 반영 (중복 지급 방지)
//  + 월정액 일일 수령 / 시즌 패스 보상 수령
// ============================================================
import {
  PRODUCT_BY_ID, MONTHLY_DAILY_CRYSTALS, SEASON_TIERS, SEASON_XP_PER_TIER,
  type ProductGrant, type SeasonReward,
} from './config';
import { meta, saveMeta, todayStr, addItem, currentSeasonId } from './meta';
import { getPlatform } from './platform';
import type { ItemKey, PurchaseRecord } from './types';

const DAY = 24 * 60 * 60 * 1000;

function applyGrant(g: ProductGrant, qty: number): void {
  if (g.crystals) meta.crystals += g.crystals * qty;
  if (g.items) for (const [k, n] of Object.entries(g.items)) addItem(k as ItemKey, (n || 0) * qty);
  if (g.adRemove) meta.adRemoved = true;
  if (g.monthlyDays) {
    const base = Math.max(Date.now(), meta.monthly.expires);
    meta.monthly.expires = base + g.monthlyDays * DAY * qty;
  }
  if (g.seasonPremium) {
    meta.season.premium = true;
    meta.season.id = currentSeasonId();
  }
}

/** 구매 기록들을 지급. 이미 지급한 purchaseId 는 건너뜀. 지급한 상품 id 목록 반환 */
export function grantPurchases(list: PurchaseRecord[]): string[] {
  const granted: string[] = [];
  for (const p of list) {
    if (meta.grantedPurchases.includes(p.purchaseId)) continue;
    const def = PRODUCT_BY_ID[p.productId];
    if (!def) { console.warn('[shop] 알 수 없는 상품', p.productId); continue; }
    applyGrant(def.grant, Math.max(1, p.quantity || 1));
    if (def.oneTime) meta.oneTime[def.id] = true;
    meta.grantedPurchases.push(p.purchaseId);
    granted.push(def.id);
  }
  // 기록이 무한히 커지지 않게 최근 200건만 유지
  if (meta.grantedPurchases.length > 200) meta.grantedPurchases = meta.grantedPurchases.slice(-200);
  if (granted.length) saveMeta();
  return granted;
}

/** 서버/로컬의 대기 구매를 받아 지급 */
export async function syncPurchases(): Promise<string[]> {
  return grantPurchases(await getPlatform().claimPurchases());
}

/** 결제 → 지급까지. 성공 시 지급된 상품 id 목록 */
export async function purchase(productId: string): Promise<string[]> {
  const def = PRODUCT_BY_ID[productId];
  if (!def || (def.oneTime && meta.oneTime[def.id])) return [];
  const ok = await getPlatform().buy(productId);
  if (!ok) return [];
  // Verse8 은 서버 훅이 기록하기까지 약간 지연될 수 있어 몇 번 재시도
  for (let i = 0; i < 5; i++) {
    const got = await syncPurchases();
    if (got.length) return got;
    await new Promise((r) => setTimeout(r, 800));
  }
  return [];
}

export function productOwned(productId: string): boolean {
  const def = PRODUCT_BY_ID[productId];
  if (!def) return false;
  if (def.id === 'ad_remove') return meta.adRemoved;
  if (def.id === 'season_premium') return meta.season.premium && meta.season.id === currentSeasonId();
  return !!(def.oneTime && meta.oneTime[def.id]);
}

// ---------- 월정액 ----------
export function monthlyActive(): boolean {
  return meta.monthly.expires > Date.now();
}
export function monthlyDaysLeft(): number {
  return Math.max(0, Math.ceil((meta.monthly.expires - Date.now()) / DAY));
}
export function canClaimMonthly(): boolean {
  return monthlyActive() && meta.monthly.lastClaim !== todayStr();
}
export function claimMonthly(): number {
  if (!canClaimMonthly()) return 0;
  meta.monthly.lastClaim = todayStr();
  meta.crystals += MONTHLY_DAILY_CRYSTALS;
  saveMeta();
  return MONTHLY_DAILY_CRYSTALS;
}

// ---------- 시즌 패스 ----------
export function seasonTier(): number {
  return Math.min(SEASON_TIERS.length, Math.floor(meta.season.xp / SEASON_XP_PER_TIER));
}
export function addSeasonXp(xp: number): void {
  if (meta.season.id !== currentSeasonId()) {
    meta.season = { id: currentSeasonId(), xp: 0, premium: false, claimedFree: [], claimedPremium: [] };
  }
  meta.season.xp += xp;
}
function applyReward(r: SeasonReward): void {
  if (r.crystals) meta.crystals += r.crystals;
  if (r.items) for (const [k, n] of Object.entries(r.items)) addItem(k as ItemKey, n || 0);
}
/** tier: 1부터. premium 트랙은 시즌 패스 보유 시만 */
export function claimSeasonReward(tier: number, premium: boolean): boolean {
  if (tier < 1 || tier > seasonTier()) return false;
  const list = premium ? meta.season.claimedPremium : meta.season.claimedFree;
  if (list.includes(tier)) return false;
  if (premium && !meta.season.premium) return false;
  const def = SEASON_TIERS[tier - 1];
  applyReward(premium ? def.premium : def.free);
  list.push(tier);
  saveMeta();
  return true;
}
export function rewardText(r: SeasonReward): string {
  const parts: string[] = [];
  if (r.crystals) parts.push(`💎${r.crystals}`);
  if (r.items) {
    const icons: Record<ItemKey, string> = { summonTicket: '🎟️', mythicTicket: '🌟', goldBooster: '💰' };
    for (const [k, n] of Object.entries(r.items)) if (n) parts.push(`${icons[k as ItemKey]}${n}`);
  }
  return parts.join(' ');
}
