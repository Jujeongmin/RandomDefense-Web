// ============================================================
//  로비(메인 화면) - 스테이지 / 유닛·덱 / 연구 / 퀘스트 / 상점 / PvP(시즌패스·랭킹)
// ============================================================
import {
  RESEARCH, researchCost, DAILY_QUESTS, ACHIEVEMENTS, PRODUCTS, ITEM_KR,
  UNITS, UNIT_BY_ID, UNIT_MAX_LEVEL, UNIT_PERK_LEVELS, unitUpgradeCost, SKILL_DESC, SKILL_KR,
  DECK_SIZE, STAGES, STAGE_BY_ID, CHAPTERS, STAGES_PER_CHAPTER, RACE_KR,
  SEASON_TIERS, SEASON_XP_PER_TIER, pvpTier, PVP,
} from './config';
import { meta, saveMeta, researchLevel, currentSeasonId } from './meta';
import { getPlatform } from './platform';
import { audio } from './audio';
import { unitIconUrl } from './assets';
import {
  stageStars, stageUnlocked, nextStageId, chapterStars, chapterUnlocked, CHAPTER_STAR_GOALS,
  chapterStarReward, starRewardClaimed, claimStarReward, featureUnlocked, featureHint,
  unitUnlocked, unitLevel, buyUnit, canUpgradeUnit, upgradeUnit, toggleDeck,
} from './progress';
import {
  purchase, productOwned, monthlyActive, monthlyDaysLeft, canClaimMonthly, claimMonthly,
  seasonTier, claimSeasonReward, rewardText,
} from './shop';
import { freeTicketAdsLeft, watchForTickets, rewardedAvailable, FREE_TICKET_AMOUNT } from './ads';
import { onlineAvailable, findOnlineMatch, createBotSession, MatchTimeout, type PvpSession } from './pvp';
import { $, toast, openOverlay, closeOverlay, bindActions, spriteIcon, confirmModal } from './dom';
import type { Job, ResearchKey } from './types';

export type Launch =
  | { kind: 'stage'; stageId: string; goldBooster: boolean }
  | { kind: 'endless'; goldBooster: boolean }
  | { kind: 'pvp'; session: PvpSession };

const RACE_ICON: Record<string, string> = { troll: '🧌', orc: '👹', undead: '💀' };

export class Menu {
  private onLaunch: (l: Launch) => void;
  private selectedChapter = 1;

  constructor(onLaunch: (l: Launch) => void) {
    this.onLaunch = onLaunch;
  }

  show(): void {
    $('main-menu').classList.remove('hidden');
    this.selectedChapter = STAGE_BY_ID[nextStageId()].chapter;
    this.render();
    audio.switchBgm('menu');
  }
  hide(): void {
    $('main-menu').classList.add('hidden');
  }
  /** 결과 화면 → 스테이지 정보(시작 전) 바로 열기 */
  openStage(id: string): void { this.openStageInfo(id); }
  openPvpPanel(): void { this.openPvp(); }

  refresh(): void {
    if (!$('main-menu').classList.contains('hidden')) this.render();
  }

  // ======================= 로비 =======================
  private render(): void {
    const root = $('main-menu');
    const tier = pvpTier(meta.pvp.trophies);
    const next = STAGE_BY_ID[nextStageId()];
    const ch = CHAPTERS[next.chapter - 1];
    const chCleared = STAGES.filter((s) => s.chapter === next.chapter && stageStars(s.id) > 0).length;
    const allCleared = STAGES.every((s) => stageStars(s.id) > 0);
    const vx = getPlatform().getVX();
    const parade = meta.deck.map((j) => spriteIcon(unitIconUrl(j, Math.min(5, unitLevel(j) >> 1)))).join('');
    const pvpOn = featureUnlocked('pvp');
    const endlessOn = featureUnlocked('endless');
    const notices: string[] = [];
    if (canClaimMonthly()) notices.push(`<div class="notice">📅 월정액 오늘의 보석 <button class="btn small green" data-act="monthly">받기 💎</button></div>`);
    const seasonReady = this.seasonClaimable();
    root.innerHTML = `
      <div class="lobby-top">
        <div class="profile-chip" data-act="profile" style="color:${tier.color}">
          <div class="tier-badge">🏆</div>
          <div><div class="nm" style="color:var(--text)">${esc(meta.nick)}</div><div class="tr">${tier.kr} · ${meta.pvp.trophies}</div></div>
        </div>
        <div class="res-chip" data-act="shop"><span class="crystal">💎 ${meta.crystals.toLocaleString()}</span><span class="plus">+</span></div>
        ${vx !== null ? `<div class="res-chip" data-act="shop"><span class="trophy">VX ${vx.toLocaleString()}</span></div>` : ''}
      </div>
      <div class="lobby-body">
        <h1 class="game-title">랜덤 디펜스</h1>
        <div class="game-sub">소환 · 합성 · 배치로 막아내라!</div>
        <div class="parade">${parade}</div>
        ${notices.join('')}
        <div class="play-card">
          <div class="chap"><span>CHAPTER ${ch.n} · <b>${ch.kr}</b></span><span>${chCleared}/${STAGES_PER_CHAPTER}</span></div>
          <div class="chap-bar"><div style="width:${(chCleared / STAGES_PER_CHAPTER) * 100}%"></div></div>
          <button class="btn red play-btn" data-act="play">▶ ${allCleared ? '스테이지 선택' : `스테이지 ${next.id}`}
            <small>${next.waves}웨이브 · ${next.unlocks ? `클리어 시 ${UNIT_BY_ID[next.unlocks].kr} 해금` : `보상 💎${stageStars(next.id) ? next.replayReward : next.firstReward}`}</small></button>
          <button class="btn small blue" data-act="stages">🗺 스테이지 맵</button>
        </div>
        <div class="mode-row">
          <button class="mode-card pvp ${pvpOn ? '' : 'locked'}" data-act="pvp">
            <div class="ic">⚔️</div><div class="t">PvP 대전</div><div class="d">실시간 1:1 · ${tier.kr}</div>
            ${pvpOn ? '' : `<div class="lock">🔒 ${featureHint('pvp')}</div>`}
            ${seasonReady ? '<span class="dot"></span>' : ''}
          </button>
          <button class="mode-card endless ${endlessOn ? '' : 'locked'}" data-act="endless">
            <div class="ic">♾️</div><div class="t">무한 모드</div><div class="d">최고 ${meta.bestWave || 0}웨이브</div>
            ${endlessOn ? '' : `<div class="lock">🔒 ${featureHint('endless')}</div>`}
          </button>
        </div>
      </div>
      <nav class="lobby-nav">
        <button data-act="shop"><span class="ic">🛒</span>상점${PRODUCTS.some((p) => p.id === 'starter_pack') && !productOwned('starter_pack') ? '<span class="dot"></span>' : ''}</button>
        <button data-act="units"><span class="ic">🧙</span>유닛${UNITS.some((u) => canUpgradeUnit(u.id)) ? '<span class="dot"></span>' : ''}</button>
        <button data-act="research"><span class="ic">🔬</span>연구</button>
        <button data-act="quests"><span class="ic">📜</span>퀘스트${this.questClaimable() ? '<span class="dot"></span>' : ''}</button>
        <button data-act="pvp"><span class="ic">🏆</span>시즌</button>
      </nav>`;
    bindActions(root, {
      profile: () => this.openProfile(),
      shop: () => this.openShop(),
      units: () => this.openUnits(),
      research: () => this.openResearch(),
      quests: () => this.openQuests(),
      stages: () => this.openStages(),
      play: () => (allCleared ? this.openStages() : this.openStageInfo(next.id)),
      pvp: () => (pvpOn ? this.openPvp() : toast(`🔒 ${featureHint('pvp')}`)),
      endless: () => (endlessOn ? this.openEndless() : toast(`🔒 ${featureHint('endless')}`)),
      monthly: () => { const n = claimMonthly(); if (n) { audio.coin(); toast(`월정액 보석 +${n} 💎`); this.render(); } },
    });
    root.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => audio.button(), { capture: true }));
  }

  private questClaimable(): boolean {
    return DAILY_QUESTS.some((q) => (meta.daily.progress[q.key] || 0) >= q.goal && !meta.daily.claimed[q.key]);
  }
  private seasonClaimable(): boolean {
    const t = seasonTier();
    for (let i = 1; i <= t; i++) {
      if (!meta.season.claimedFree.includes(i)) return true;
      if (meta.season.premium && !meta.season.claimedPremium.includes(i)) return true;
    }
    return false;
  }

  // ======================= 프로필 =======================
  private openProfile(): void {
    const p = meta.pvp;
    const tier = pvpTier(p.trophies);
    const stars = STAGES.reduce((n, s) => n + stageStars(s.id), 0);
    const el = openOverlay('panel', `<div class="dialog"><button class="close-x">✕</button>
      <h2>프로필</h2>
      <div class="row"><div class="info"><div class="t">닉네임</div><div class="d">PvP 상대와 랭킹에 표시됩니다</div></div>
        <input id="nick-input" maxlength="12" value="${esc(meta.nick)}" style="width:120px;padding:8px;border-radius:8px;border:none;font-family:inherit;font-size:15px"></div>
      <div class="row"><div class="info"><div class="t" style="color:${tier.color}">🏆 ${tier.kr} · ${p.trophies}</div><div class="d">${p.wins}승 ${p.losses}패 · 연승 ${p.streak}</div></div></div>
      <div class="row"><div class="info"><div class="t">⭐ 캠페인 별 ${stars} / ${STAGES.length * 3}</div><div class="d">무한 모드 최고 ${meta.bestWave}웨이브</div></div></div>
      <button class="btn green close" data-act="save">저장</button></div>`, () => this.render());
    bindActions(el, {
      save: () => {
        const v = ($('nick-input') as HTMLInputElement).value.trim().slice(0, 12);
        if (v) { meta.nick = v; saveMeta(); }
        closeOverlay('panel');
      },
    });
  }

  // ======================= 스테이지 =======================
  private openStages(): void {
    const draw = () => {
      const c = this.selectedChapter;
      const chStars = chapterStars(c);
      const nodes = STAGES.filter((s) => s.chapter === c).map((s) => {
        const st = stageStars(s.id);
        const open = stageUnlocked(s.id);
        const isNext = open && st === 0;
        const unlockIc = s.unlocks && !unitUnlocked(s.unlocks) ? spriteIcon(unitIconUrl(s.unlocks), 'frame-sprite unlock-ic') : '';
        return `<button class="stage-node ${open ? '' : 'locked'} ${isNext ? 'next' : ''} ${s.id.endsWith('-10') ? 'boss' : ''}" data-act="stage" data-id="${s.id}">
          ${s.id}<span class="st">${open ? '★'.repeat(st) + '☆'.repeat(3 - st) : '🔒'}</span>${unlockIc}</button>`;
      }).join('');
      const goals = CHAPTER_STAR_GOALS.map((g, i) => {
        const claimed = starRewardClaimed(c, i);
        const ready = chStars >= g && !claimed;
        return `<button class="btn small ${ready ? 'gold' : ''}" data-act="starGoal" data-i="${i}" ${ready ? '' : 'disabled'}>⭐${g} ${claimed ? '✓' : `💎${chapterStarReward(i)}`}</button>`;
      }).join('');
      const el = openOverlay('panel', `<div class="dialog"><button class="close-x">✕</button>
        <h2>스테이지</h2>
        <div class="tab-row">${CHAPTERS.map((ch) => `<button data-act="chap" data-n="${ch.n}" class="${ch.n === c ? 'active' : ''}">${chapterUnlocked(ch.n) ? '' : '🔒 '}${ch.n}. ${ch.kr}</button>`).join('')}</div>
        <div class="fine" style="margin:-4px 0 10px">${CHAPTERS[c - 1].desc} · 스테이지당 ${CHAPTERS[c - 1].waves}웨이브</div>
        <div class="stage-grid">${nodes}</div>
        <div class="section-title"><span>챕터 별 보상</span><span>⭐ ${chStars}/30</span></div>
        <div class="star-goals">${goals}</div></div>`, () => this.render());
      bindActions(el, {
        chap: (b) => { this.selectedChapter = Number(b.dataset.n); draw(); },
        stage: (b) => {
          const id = b.dataset.id!;
          if (!stageUnlocked(id)) { toast('이전 스테이지를 먼저 클리어하세요'); return; }
          this.openStageInfo(id);
        },
        starGoal: (b) => {
          const n = claimStarReward(c, Number(b.dataset.i));
          if (n) { audio.coin(); toast(`별 보상 💎 +${n}`); draw(); }
        },
      });
    };
    draw();
  }

  private openStageInfo(id: string): void {
    const st = STAGE_BY_ID[id];
    const stars = stageStars(id);
    let booster = false;
    const draw = () => {
      const races = (st.races ?? ['troll', 'orc', 'undead']).map((r) => `${RACE_ICON[r]} ${RACE_KR[r as keyof typeof RACE_KR]}`).join(' · ');
      const deck = meta.deck.map((j) => `<div class="deck-slot filled">${spriteIcon(unitIconUrl(j))}<div>${UNIT_BY_ID[j].kr}</div></div>`).join('')
        + Array.from({ length: DECK_SIZE - meta.deck.length }, () => '<div class="deck-slot">빈 슬롯</div>').join('');
      const el = openOverlay('modal', `<div class="dialog"><button class="close-x">✕</button>
        <h2>스테이지 ${id}</h2>
        <div style="text-align:center;font-size:30px;margin:-6px 0 6px">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
        <div class="row"><div class="ic">🌊</div><div class="info"><div class="t">${st.waves}웨이브 · 마지막 보스</div><div class="d">등장: ${races}</div></div></div>
        <div class="row"><div class="ic">🎁</div><div class="info"><div class="t">${stars ? `반복 보상 💎${st.replayReward}` : `첫 클리어 💎${st.firstReward}`}</div>
          <div class="d">★★★: 필드 몹 40마리 이하 유지 · ★★: 70마리 이하</div></div></div>
        ${st.unlocks && !unitUnlocked(st.unlocks) ? `<div class="row" style="border:2px solid var(--gold)">${spriteIcon(unitIconUrl(st.unlocks), 'frame-sprite', 'width:40px;height:40px')}<div class="info"><div class="t">클리어 시 ${UNIT_BY_ID[st.unlocks].kr} 해금!</div><div class="d">${SKILL_DESC[st.unlocks]}</div></div></div>` : ''}
        <div class="section-title"><span>출전 덱</span><button class="btn small blue" data-act="editDeck">덱 편집</button></div>
        <div class="deck-row">${deck}</div>
        ${meta.items.goldBooster > 0 ? `<label class="row" style="cursor:pointer"><div class="ic">💰</div><div class="info"><div class="t">골드 부스터 사용</div><div class="d">시작 골드 2배 · 보유 ${meta.items.goldBooster}</div></div><input type="checkbox" id="booster-chk" ${booster ? 'checked' : ''} style="width:22px;height:22px"></label>` : ''}
        <button class="btn red close" style="font-size:22px" data-act="go">⚔ 전투 시작</button></div>`);
      const chk = el.querySelector('#booster-chk') as HTMLInputElement | null;
      if (chk) chk.onchange = () => { booster = chk.checked; };
      bindActions(el, {
        editDeck: () => { closeOverlay('modal'); this.openUnits(() => this.openStageInfo(id)); },
        go: () => {
          closeOverlay('modal');
          closeOverlay('panel');
          this.onLaunch({ kind: 'stage', stageId: id, goldBooster: booster });
        },
      });
    };
    draw();
  }

  private openEndless(): void {
    let booster = false;
    const el = openOverlay('modal', `<div class="dialog"><button class="close-x">✕</button>
      <h2>♾️ 무한 모드</h2>
      <div class="row"><div class="ic">🌊</div><div class="info"><div class="t">50웨이브 생존 도전</div><div class="d">최고 기록 ${meta.bestWave}웨이브 · 도달 웨이브만큼 보석 획득</div></div></div>
      <div class="deck-row">${meta.deck.map((j) => `<div class="deck-slot filled">${spriteIcon(unitIconUrl(j))}<div>${UNIT_BY_ID[j].kr}</div></div>`).join('')}</div>
      ${meta.items.goldBooster > 0 ? `<label class="row"><div class="ic">💰</div><div class="info"><div class="t">골드 부스터 사용</div><div class="d">보유 ${meta.items.goldBooster}</div></div><input type="checkbox" id="booster-chk2" style="width:22px;height:22px"></label>` : ''}
      <button class="btn red close" data-act="go">⚔ 시작</button></div>`);
    const chk = el.querySelector('#booster-chk2') as HTMLInputElement | null;
    if (chk) chk.onchange = () => { booster = chk.checked; };
    bindActions(el, { go: () => { closeOverlay('modal'); this.onLaunch({ kind: 'endless', goldBooster: booster }); } });
  }

  // ======================= 유닛 / 덱 =======================
  private openUnits(after?: () => void): void {
    const draw = () => {
      const deck = meta.deck.map((j) => `<div class="deck-slot filled" data-act="toggle" data-job="${j}">${spriteIcon(unitIconUrl(j))}<div>${UNIT_BY_ID[j].kr}</div></div>`).join('')
        + Array.from({ length: DECK_SIZE - meta.deck.length }, () => '<div class="deck-slot">빈 슬롯</div>').join('');
      const cards = UNITS.map((u) => {
        const lv = unitLevel(u.id);
        const unlocked = lv > 0;
        const inDeck = meta.deck.includes(u.id);
        const pips = Array.from({ length: UNIT_MAX_LEVEL }, (_, i) =>
          `<i class="${i < lv ? 'on' : ''} ${UNIT_PERK_LEVELS.includes(i + 1) ? 'perk' : ''}"></i>`).join('');
        let acts: string;
        if (!unlocked) {
          acts = `<button class="btn small gold" data-act="buy" data-job="${u.id}" ${meta.crystals < (u.unlockCrystals || 0) ? 'disabled' : ''}>💎${u.unlockCrystals} 해금</button>`;
        } else {
          const maxed = lv >= UNIT_MAX_LEVEL;
          acts = `<button class="btn small ${inDeck ? 'red' : 'blue'}" data-act="toggle" data-job="${u.id}">${inDeck ? '덱 해제' : '덱 편성'}</button>
            <button class="btn small green" data-act="up" data-job="${u.id}" ${canUpgradeUnit(u.id) ? '' : 'disabled'}>${maxed ? 'MAX' : `💎${unitUpgradeCost(lv)}`}</button>`;
        }
        return `<div class="unit-card ${inDeck ? 'in-deck' : ''} ${unlocked ? '' : 'locked'}">
          <div class="head">${spriteIcon(unitIconUrl(u.id, unlocked ? Math.min(5, lv >> 1) : 0))}
            <div><div class="nm">${u.kr}</div><div class="lv">${unlocked ? `Lv.${lv}` : u.unlockStage ? `🔒 ${u.unlockStage} 클리어` : '🔒'}</div><div class="role">${u.role}</div></div></div>
          <div class="lv-pips">${pips}</div>
          <div class="sk"><b>${SKILL_KR[u.id]}</b> · ${SKILL_DESC[u.id]}</div>
          <div class="acts">${acts}</div></div>`;
      }).join('');
      const el = openOverlay('panel', `<div class="dialog"><button class="close-x">✕</button>
        <h2>유닛 <span class="crystal" style="font-size:16px">💎 ${meta.crystals}</span></h2>
        <div class="fine" style="margin:-6px 0 8px">덱 ${meta.deck.length}/${DECK_SIZE} · 소환 시 덱에서 무작위로 등장 · 4구역에 1종씩 배치</div>
        <div class="deck-row">${deck}</div>
        <div class="fine" style="margin-bottom:8px">레벨당 공격력 +8% · Lv5/Lv10 스킬 강화(퍽)</div>
        <div class="unit-grid">${cards}</div></div>`, () => { this.render(); after?.(); });
      bindActions(el, {
        toggle: (b) => {
          if (!toggleDeck(b.dataset.job as Job)) toast(meta.deck.length >= DECK_SIZE ? '덱이 가득 찼어요 (최대 4)' : '덱에 최소 1종은 있어야 해요');
          else audio.button();
          draw();
        },
        up: (b) => { if (upgradeUnit(b.dataset.job as Job)) { audio.merge(); draw(); } },
        buy: async (b) => {
          const j = b.dataset.job as Job;
          if (await confirmModal('유닛 해금', `${UNIT_BY_ID[j].kr}을(를) 💎${UNIT_BY_ID[j].unlockCrystals}로 해금할까요?`)) {
            if (buyUnit(j)) { audio.fanfareUnlock(); toast(`${UNIT_BY_ID[j].kr} 해금!`); }
          }
          draw();
        },
      });
    };
    draw();
  }

  // ======================= 연구 =======================
  private openResearch(): void {
    if (!featureUnlocked('research')) { toast(`🔒 ${featureHint('research')}`); return; }
    const draw = () => {
      const rows = RESEARCH.map((r) => {
        const lv = researchLevel(r.key);
        const maxed = lv >= r.max;
        const cost = researchCost(lv);
        return `<div class="row"><div class="info"><div class="t">${r.kr} <span class="trophy">Lv.${lv}/${r.max}</span></div>
          <div class="d">${r.desc}</div><div class="lv-pips" style="margin-top:4px">${Array.from({ length: r.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div></div>
          <button class="btn small green" data-act="res" data-key="${r.key}" ${maxed || meta.crystals < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `💎 ${cost}`}</button></div>`;
      }).join('');
      const el = openOverlay('panel', `<div class="dialog"><button class="close-x">✕</button>
        <h2>연구소 <span class="crystal" style="font-size:16px">💎 ${meta.crystals}</span></h2>
        <div class="fine" style="margin:-6px 0 10px">캠페인·무한 모드에 적용 (PvP 는 공정성을 위해 미적용)</div>
        ${rows}</div>`, () => this.render());
      bindActions(el, {
        res: (b) => {
          const key = b.dataset.key as ResearchKey;
          const lv = researchLevel(key);
          const r = RESEARCH.find((x) => x.key === key)!;
          const cost = researchCost(lv);
          if (lv < r.max && meta.crystals >= cost) {
            meta.crystals -= cost;
            meta.research[key] = lv + 1;
            saveMeta();
            audio.merge();
            draw();
          }
        },
      });
    };
    draw();
  }

  // ======================= 퀘스트 =======================
  private openQuests(): void {
    const draw = () => {
      const daily = DAILY_QUESTS.map((q) => {
        const prog = Math.min(q.goal, meta.daily.progress[q.key] || 0);
        const done = prog >= q.goal;
        const claimed = meta.daily.claimed[q.key];
        return `<div class="row"><div class="info"><div class="t">${q.kr}</div>
          <div class="chap-bar" style="margin-top:4px"><div style="width:${(prog / q.goal) * 100}%"></div></div><div class="d">${prog}/${q.goal}</div></div>
          <button class="btn small ${done && !claimed ? 'gold' : ''}" data-act="daily" data-key="${q.key}" ${!done || claimed ? 'disabled' : ''}>${claimed ? '완료' : `💎 ${q.reward}`}</button></div>`;
      }).join('');
      const adLeft = freeTicketAdsLeft();
      const adRow = rewardedAvailable()
        ? `<div class="row"><div class="ic">📺</div><div class="info"><div class="t">광고 보고 소환권 ${FREE_TICKET_AMOUNT}장</div><div class="d">오늘 ${adLeft}회 남음</div></div>
            <button class="btn small blue" data-act="adTicket" ${adLeft ? '' : 'disabled'}>받기</button></div>` : '';
      const ach = ACHIEVEMENTS.map((a) => `<div class="row"><div class="info"><div class="t">${a.kr}</div><div class="d">보상 💎 ${a.reward}</div></div>
        <span class="${meta.achievements[a.key] ? 'trophy' : 'fine'}">${meta.achievements[a.key] ? '달성 ✓' : '미달성'}</span></div>`).join('');
      const el = openOverlay('panel', `<div class="dialog"><button class="close-x">✕</button>
        <h2>퀘스트</h2>
        <div class="section-title">일일 퀘스트 <span class="fine">매일 0시(UTC) 초기화</span></div>${daily}${adRow}
        <div class="section-title">업적</div>${ach}</div>`, () => this.render());
      bindActions(el, {
        daily: (b) => {
          const key = b.dataset.key!;
          const q = DAILY_QUESTS.find((x) => x.key === key)!;
          if ((meta.daily.progress[key] || 0) >= q.goal && !meta.daily.claimed[key]) {
            meta.daily.claimed[key] = true;
            meta.crystals += q.reward;
            saveMeta();
            audio.coin();
            draw();
          }
        },
        adTicket: async () => {
          if (await watchForTickets()) { audio.coin(); toast(`소환권 +${FREE_TICKET_AMOUNT} 🎟️`); }
          draw();
        },
      });
    };
    draw();
  }

  // ======================= 상점 =======================
  openShop(): void {
    const plat = getPlatform();
    const price = (id: string) => plat.priceOf(id) ?? 0;
    const draw = () => {
      const vx = plat.getVX();
      const card = (id: string, hot = false) => {
        const p = PRODUCTS.find((x) => x.id === id)!;
        const owned = productOwned(id);
        let extra = '';
        if (id === 'monthly_pass' && monthlyActive()) extra = ` <span class="badge green">${monthlyDaysLeft()}일 남음</span>`;
        return `<div class="shop-card ${hot ? 'hot' : ''}"><div class="ic">${p.icon}</div>
          <div class="info"><div class="t">${p.kr}${p.badge ? ` <span class="badge">${p.badge}</span>` : ''}${extra}</div><div class="d">${p.desc}</div></div>
          <button class="btn small ${owned ? '' : 'gold'}" data-act="buy" data-id="${id}" ${owned ? 'disabled' : ''}>${owned ? '보유 ✓' : `VX ${price(id)}`}</button></div>`;
      };
      const gems = PRODUCTS.filter((p) => p.category === 'crystal').map((p) => `<div class="gem-card">
        ${p.badge ? `<span class="badge">${p.badge}</span>` : ''}<div class="ic">💎</div><div>${p.kr}</div>
        <button class="btn small gold" data-act="buy" data-id="${p.id}">VX ${price(p.id)}</button></div>`).join('');
      const items = Object.entries(meta.items).map(([k, n]) => `${ITEM_KR[k as keyof typeof ITEM_KR].icon}${n}`).join(' · ');
      const el = openOverlay('panel', `<div class="dialog"><button class="close-x">✕</button>
        <h2>상점</h2>
        <div class="balance"><span class="crystal">💎 ${meta.crystals.toLocaleString()}</span>${vx !== null ? `<span class="vx-badge">VX ${vx.toLocaleString()}</span>` : ''}</div>
        <div class="fine" style="margin:-4px 0 6px">보유: ${items}</div>
        <div class="section-title">추천 패키지</div>
        ${!productOwned('starter_pack') ? card('starter_pack', true) : ''}
        ${card('monthly_pass', true)}
        ${card('ad_remove')}
        <div class="section-title">PvP 시즌 패스</div>${card('season_premium')}
        <div class="section-title">부스터 <span class="fine">일반 모드 전용</span></div>
        ${card('summon_ticket_30')}${card('mythic_ticket')}${card('gold_booster_5')}
        <div class="section-title">보석</div><div class="gem-grid">${gems}</div>
        <div class="fine">${vx !== null ? '* 로컬 개발 환경: 데모 VX 로 결제를 흉내냅니다.' : '* 결제는 Verse8 VX 로 진행되며, 결제 완료 후 자동 지급됩니다.'}</div></div>`, () => this.render());
      bindActions(el, {
        buy: async (b) => {
          const id = b.dataset.id!;
          (b as HTMLButtonElement).disabled = true;
          const got = await purchase(id);
          if (got.length) {
            audio.fanfareUnlock();
            toast(`구매 완료: ${got.map((g) => PRODUCTS.find((p) => p.id === g)?.kr).join(', ')}`);
          } else {
            toast('결제가 완료되지 않았어요');
          }
          draw();
        },
      });
    };
    draw();
  }

  // ======================= PvP =======================
  private openPvp(tab: 'battle' | 'pass' | 'rank' = 'battle'): void {
    const draw = async () => {
      const p = meta.pvp;
      const tier = pvpTier(p.trophies);
      let body = '';
      if (tab === 'battle') {
        const online = onlineAvailable();
        body = `<div style="text-align:center;margin:6px 0 10px">
            <div style="font-size:46px">🏆</div>
            <div style="font-size:22px;color:${tier.color}">${tier.kr}</div>
            <div class="trophy" style="font-size:18px">${p.trophies} 트로피</div>
            <div class="fine">${p.wins}승 ${p.losses}패 · 연승 ${p.streak}</div></div>
          <div class="row"><div class="ic">⚔️</div><div class="info"><div class="t">실시간 1:1 대결</div>
            <div class="d">같은 웨이브를 동시에 막으며 몹을 보내 상대를 무너뜨리세요. 먼저 몹 100마리가 쌓이면 패배!</div></div></div>
          <div class="row"><div class="ic">📏</div><div class="info"><div class="d">연구 미적용(공정) · 유닛 레벨 적용 · 배속 1x 고정<br>승리 🏆+${PVP.trophyWin} 💎${PVP.rewardWin} · 패배 🏆-${PVP.trophyLoss} 💎${PVP.rewardLoss}</div></div></div>
          <button class="btn red close" style="font-size:20px" data-act="match" ${online ? '' : 'disabled'}>⚔ 실시간 매칭</button>
          <button class="btn blue close" data-act="bot">🤖 AI 연습전 (트로피 변동 없음)</button>
          ${online ? '' : '<div class="fine">실시간 매칭은 Verse8 환경(게임서버 연결)에서 활성화됩니다.</div>'}`;
      } else if (tab === 'pass') {
        const t = seasonTier();
        const inTier = meta.season.xp % SEASON_XP_PER_TIER;
        const rows = SEASON_TIERS.map((def, i) => {
          const n = i + 1;
          const reached = n <= t;
          const fDone = meta.season.claimedFree.includes(n);
          const pDone = meta.season.claimedPremium.includes(n);
          const fCls = fDone ? 'done' : reached ? 'ready' : 'lock';
          const pCls = pDone ? 'done' : reached && meta.season.premium ? 'ready' : 'lock';
          return `<div class="pass-row"><div class="n ${reached ? 'on' : ''}">${n}</div>
            <button class="pass-cell ${fCls}" data-act="claim" data-n="${n}" data-p="0">${rewardText(def.free)}</button>
            <button class="pass-cell prem ${pCls}" data-act="claim" data-n="${n}" data-p="1">${meta.season.premium ? '' : '🔒'}${rewardText(def.premium)}</button></div>`;
        }).join('');
        body = `<div class="pass-head"><div class="lvl">${t}</div><div style="flex:1">
            <div class="fine" style="text-align:left">시즌 ${currentSeasonId().slice(1)} · 다음 단계까지 ${SEASON_XP_PER_TIER - inTier} XP</div>
            <div class="pass-bar"><div style="width:${t >= SEASON_TIERS.length ? 100 : (inTier / SEASON_XP_PER_TIER) * 100}%"></div></div></div></div>
          <div class="fine" style="margin-bottom:8px">PvP 승리 +${PVP.seasonXpWin}XP · 패배 +${PVP.seasonXpLoss}XP · 캠페인 클리어 +30XP</div>
          ${meta.season.premium ? '' : `<button class="btn gold close" data-act="buyPass" style="margin:0 0 10px">🏆 프리미엄 패스 구매</button>`}
          <div class="pass-row"><div></div><div class="fine">무료</div><div class="fine trophy">프리미엄</div></div>${rows}`;
      } else {
        body = '<div class="fine">불러오는 중...</div>';
      }
      const el = openOverlay('panel', `<div class="dialog"><button class="close-x">✕</button>
        <h2>PvP 아레나</h2>
        <div class="tab-row">
          <button data-act="tab" data-t="battle" class="${tab === 'battle' ? 'active' : ''}">대전</button>
          <button data-act="tab" data-t="pass" class="${tab === 'pass' ? 'active' : ''}">시즌 패스${this.seasonClaimable() ? ' •' : ''}</button>
          <button data-act="tab" data-t="rank" class="${tab === 'rank' ? 'active' : ''}">랭킹</button></div>
        <div id="pvp-body">${body}</div></div>`, () => this.render());
      bindActions(el, {
        tab: (b) => { tab = b.dataset.t as typeof tab; void draw(); },
        match: () => this.startMatchmaking(),
        bot: () => this.launchPvp(createBotSession()),
        claim: (b) => {
          const ok = claimSeasonReward(Number(b.dataset.n), b.dataset.p === '1');
          if (ok) { audio.coin(); toast('시즌 보상 획득!'); void draw(); }
        },
        buyPass: async () => {
          const got = await purchase('season_premium');
          if (got.length) { audio.fanfareUnlock(); toast('프리미엄 시즌 패스 활성화!'); }
          void draw();
        },
      });
      if (tab === 'rank') await this.drawRanking();
    };
    void draw();
  }

  private async drawRanking(): Promise<void> {
    const body = $('pvp-body');
    if (!onlineAvailable()) {
      body.innerHTML = `<div class="fine">랭킹은 Verse8 환경(게임서버 연결)에서 표시됩니다.</div>
        <div class="rank-row me"><span class="r">-</span><span>${esc(meta.nick)}</span><span class="trophy">🏆 ${meta.pvp.trophies}</span></div>`;
      return;
    }
    try {
      const net = await import('./net/server');
      const res = await net.callGlobal<{ top: { account: string; nick: string; trophies: number }[]; me: { trophies: number } }>('pvpLeaderboard');
      const mine = net.myAccount();
      body.innerHTML = res.top.length
        ? res.top.map((r, i) => `<div class="rank-row ${r.account === mine ? 'me' : ''}"><span class="r">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
            <span>${esc(r.nick)} <span class="fine">${pvpTier(r.trophies).kr}</span></span><span class="trophy">🏆 ${r.trophies}</span></div>`).join('')
        : '<div class="fine">아직 기록이 없습니다. 첫 승리를 차지하세요!</div>';
    } catch {
      body.innerHTML = '<div class="fine">랭킹을 불러오지 못했어요.</div>';
    }
  }

  private startMatchmaking(): void {
    const signal = { cancelled: false };
    const el = openOverlay('modal', `<div class="dialog matching"><h2>상대를 찾는 중...</h2>
      <div class="spinner"></div><div id="mm-time" class="fine">0초</div>
      <div class="fine">🏆 ${meta.pvp.trophies} 근처의 상대를 찾고 있어요</div>
      <button class="btn close" data-act="cancel">취소</button></div>`, () => { signal.cancelled = true; });
    bindActions(el, { cancel: () => closeOverlay('modal') });
    findOnlineMatch((sec) => { const t = document.getElementById('mm-time'); if (t) t.textContent = `${Math.floor(sec)}초`; }, signal)
      .then((session) => { if (!signal.cancelled) this.launchPvp(session); })
      .catch(async (e) => {
        if (signal.cancelled) return;
        closeOverlay('modal');
        if (e instanceof MatchTimeout) {
          if (await confirmModal('상대를 찾지 못했어요', '지금은 대기 중인 상대가 없어요.<br>AI 연습전으로 플레이할까요?', 'AI 연습전', '닫기')) {
            this.launchPvp(createBotSession());
          }
        } else {
          console.warn(e);
          toast('서버 연결에 실패했어요');
        }
      });
  }

  private launchPvp(session: PvpSession): void {
    const m = session.match;
    const myTier = pvpTier(meta.pvp.trophies);
    const opTier = pvpTier(m.opponent.trophies);
    openOverlay('modal', `<div class="dialog matching"><h2>${m.bot ? 'AI 연습전' : '매칭 완료!'}</h2>
      <div class="vs"><div class="p"><div class="nm">${esc(meta.nick)}</div><div style="color:${myTier.color}">🏆 ${meta.pvp.trophies}</div></div>
      <div class="x">VS</div>
      <div class="p"><div class="nm">${esc(m.opponent.nick)}${m.bot ? ' 🤖' : ''}</div><div style="color:${opTier.color}">🏆 ${m.opponent.trophies}</div></div></div>
      <div class="fine">곧 전투가 시작됩니다</div></div>`);
    audio.sendAttack();
    setTimeout(() => {
      closeOverlay('modal');
      closeOverlay('panel');
      this.onLaunch({ kind: 'pvp', session });
    }, 1400);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
