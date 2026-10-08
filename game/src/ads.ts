// ============================================================
//  광고 - Verse8 Ads SDK (@verse8/ads)
//  보상형: 결과 보상 2배 / 부활 / 소환권 받기
//  전면형: 스테이지 결과 후 (광고 제거 구매 시 제외, 초반 스테이지 제외)
//  Verse8 호스트 밖(로컬 개발)에서는 개발 서버에서만 가짜 광고로 흐름 테스트
// ============================================================
import { meta, saveMeta, todayStr, addItem } from './meta';

export const AD_PLACEMENTS = {
  doubleReward: 'reward_double',
  revive: 'reward_revive',
  freeTicket: 'reward_ticket',
  interstitial: 'interstitial_result',
} as const;
export const FREE_TICKET_ADS_PER_DAY = 3;
export const FREE_TICKET_AMOUNT = 5;
const INTERSTITIAL_EVERY = 2;      // N판마다 1회
const INTERSTITIAL_FROM_STAGE = 3; // 1-1~1-3 은 광고 없음 (첫인상/리텐션)

type AdsModule = typeof import('@verse8/ads');
let mod: Promise<AdsModule> | null = null;
function ads(): Promise<AdsModule> {
  if (!mod) {
    mod = import('@verse8/ads').then((m) => {
      m.Verse8Ads.init({ debug: !!import.meta.env?.DEV });
      return m;
    });
  }
  return mod;
}

let unsupported = false;
let gamesSinceInterstitial = 0;

function isDev(): boolean {
  try { return !!import.meta.env?.DEV; } catch { return false; }
}

/** 개발 서버용 가짜 광고 (실제 호스트 없이 흐름 확인) */
function fakeAd(label: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'overlay';
    el.style.zIndex = '95';
    el.innerHTML = `<div class="dialog" style="text-align:center"><h2>📺 광고 (개발용)</h2>
      <div class="fine">${label}</div><div class="spinner"></div>
      <button class="btn small" data-skip>닫기(보상 없음)</button></div>`;
    document.getElementById('app')!.appendChild(el);
    const done = (ok: boolean) => { el.remove(); resolve(ok); };
    const t = setTimeout(() => done(true), 1500);
    (el.querySelector('[data-skip]') as HTMLElement).onclick = () => { clearTimeout(t); done(false); };
  });
}

/** 보상형 광고 사용 가능 여부 (광고 제거 보유 시 시청 없이 즉시 보상) */
export function rewardedAvailable(): boolean {
  return meta.adRemoved || !unsupported || isDev();
}

/** 보상형 광고 시청 → 보상 지급 여부 */
export async function showRewarded(placement: keyof typeof AD_PLACEMENTS): Promise<boolean> {
  if (meta.adRemoved) return true; // 광고 제거 패키지: 시청 없이 보상
  if (!unsupported) {
    try {
      const { Verse8Ads } = await ads();
      const r = await Verse8Ads.showRewarded({ placementId: AD_PLACEMENTS[placement] });
      if (r.status === 'rewarded') return true;
      if (r.status === 'dismissed') return false;
      if (r.error.code === 'unsupported_env') unsupported = true;
      else return false;
    } catch {
      unsupported = true;
    }
  }
  return isDev() ? fakeAd(placement) : false;
}

/** 판 종료 후 전면 광고 (조건 충족 시) */
export async function maybeInterstitial(stageIndex: number | null): Promise<void> {
  if (meta.adRemoved || unsupported) return;
  if (stageIndex !== null && stageIndex < INTERSTITIAL_FROM_STAGE) return;
  gamesSinceInterstitial += 1;
  if (gamesSinceInterstitial < INTERSTITIAL_EVERY) return;
  gamesSinceInterstitial = 0;
  try {
    const { Verse8Ads } = await ads();
    const r = await Verse8Ads.showInterstitial({ placementId: AD_PLACEMENTS.interstitial });
    if (r.status === 'failed' && r.error.code === 'unsupported_env') unsupported = true;
  } catch {
    unsupported = true;
  }
}

// ---------- 일일 광고 소환권 ----------
function adKey(): string { return `adTicket:${todayStr()}`; }
export function freeTicketAdsLeft(): number {
  const used = Number(meta.oneTime[adKey()] || 0);
  return Math.max(0, FREE_TICKET_ADS_PER_DAY - used);
}
export async function watchForTickets(): Promise<boolean> {
  if (freeTicketAdsLeft() <= 0) return false;
  if (!(await showRewarded('freeTicket'))) return false;
  const k = adKey();
  (meta.oneTime as Record<string, unknown>)[k] = Number(meta.oneTime[k] || 0) + 1;
  addItem('summonTicket', FREE_TICKET_AMOUNT);
  saveMeta();
  return true;
}
