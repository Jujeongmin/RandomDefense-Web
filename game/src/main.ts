// ============================================================
//  진입점 - 부팅 / 화면 전환(로비↔게임) / 판 흐름(스테이지·무한·PvP) / 메인 루프
// ============================================================
import './style.css';
import { Game } from './engine';
import { Renderer } from './render';
import { UI, type ResultView } from './ui';
import { Menu, type Launch } from './menu';
import { preloadAll, warmTints } from './assets';
import { audio } from './audio';
import { getPlatform } from './platform';
import { meta, saveMeta, reloadMeta, useItem } from './meta';
import { crystalReward, starsFor, STAGE_BY_ID, STAGES, PVP } from './config';
import { completeStage, stageOptions, endlessOptions, stageUnlocked, unitLevels } from './progress';
import { syncPurchases, addSeasonXp } from './shop';
import { showRewarded, rewardedAvailable, maybeInterstitial } from './ads';
import { createBotSession, type PvpSession } from './pvp';
import { $, toast } from './dom';
import type { GameOverData } from './types';

preloadAll();
warmTints();
audio.installUnlock();

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const gameFrame = document.getElementById('game-frame') as HTMLElement;

let game: Game | null = null;
let renderer: Renderer | null = null;
let ui: UI | null = null;
let session: PvpSession | null = null;
let current: Launch | null = null;
let snapAcc = 0;

const menu = new Menu(launch);

// ---------------------------------------------------------------
//  판 시작
// ---------------------------------------------------------------
function launch(l: Launch): void {
  current = l;
  let booster = false;
  if (l.kind !== 'pvp' && l.goldBooster) booster = useItem('goldBooster');
  if (l.kind === 'stage') game = new Game(stageOptions(l.stageId, booster));
  else if (l.kind === 'endless') game = new Game(endlessOptions(booster));
  else {
    game = new Game({ mode: 'pvp', seed: l.session.match.seed, useResearch: false, deck: [...meta.deck], unitLevels: unitLevels() });
    game.paused = true; // 카운트다운 후 동시에 시작
  }
  renderer = new Renderer(canvas, game);
  ui = new UI(game, {
    kind: l.kind,
    stageId: l.kind === 'stage' ? l.stageId : undefined,
    onExit: () => void exitGame(),
  });
  const g = game;
  const u = ui;
  g.on('gameover', (d) => onGameOver(g, d));
  menu.hide();
  u.hideResult();
  gameFrame.classList.remove('hidden');

  if (l.kind === 'pvp') {
    startPvp(g, u, l.session);
    audio.switchBgm('pvp');
  } else {
    audio.switchBgm('battle');
    if (l.kind === 'stage' && l.stageId === '1-1' && meta.tutorial === 0) startTutorial(g, u);
  }
}

// ---------------------------------------------------------------
//  PvP
// ---------------------------------------------------------------
function startPvp(g: Game, u: UI, s: PvpSession): void {
  session = s;
  snapAcc = 0;
  u.setOpponentInfo(s.match.opponent.nick, s.match.opponent.trophies, s.match.bot);
  g.on('attack', (p) => s.sendAttack(p));
  let resultShown = false;
  // 판정 대기 안전장치: 내가 무너졌는데 서버 결과가 안 오면 패배 처리
  let fallback: ReturnType<typeof setTimeout> | null = null;
  g.on('gameover', (d) => {
    if (d.pvp?.won === false && !resultShown) {
      s.reportDefeat();
      fallback = setTimeout(() => {
        if (!resultShown) { resultShown = true; showPvpResult(g, u, s, { won: false, trophyDelta: 0, trophies: meta.pvp.trophies, reason: 'defeat' }); }
      }, 6000);
    }
  });
  void s.ready({
    onStart: (startAt) => u.countdown(startAt, () => { g.paused = false; }),
    onSnapshot: (snap) => u.setOpponent(snap),
    onAttack: (p) => g.receiveAttack(p),
    onResult: (r) => {
      if (resultShown) return;
      resultShown = true;
      if (fallback) clearTimeout(fallback);
      if (!g.over) g.pvpEnd(r.won, r.won ? (r.reason === 'leave' ? '상대가 대전을 떠났습니다' : '상대 필드가 무너졌습니다!') : '내 필드가 무너졌습니다');
      showPvpResult(g, u, s, r);
    },
  }).catch((e) => {
    console.warn('[pvp] ready failed', e);
    toast('대전 서버 연결에 실패했어요');
    void exitGame(true);
  });
}

function showPvpResult(g: Game, u: UI, s: PvpSession, r: { won: boolean; trophyDelta: number; trophies: number; reason: string }): void {
  const bot = s.match.bot;
  const crystals = Math.round((r.won ? PVP.rewardWin : PVP.rewardLoss) * (bot ? 0.5 : 1));
  const xp = Math.round((r.won ? PVP.seasonXpWin : PVP.seasonXpLoss) * (bot ? 0.5 : 1));
  meta.crystals += crystals;
  addSeasonXp(xp);
  if (!bot) {
    meta.pvp.trophies = r.trophies;
    if (r.won) { meta.pvp.wins += 1; meta.pvp.streak += 1; } else { meta.pvp.losses += 1; meta.pvp.streak = 0; }
  }
  saveMeta();
  audio.gameEnd(r.won);
  const rewards = [`💎 +${crystals}`, `시즌 XP +${xp}`];
  if (!bot) rewards.unshift(`🏆 ${r.trophyDelta >= 0 ? '+' : ''}${r.trophyDelta}`);
  u.showResult({
    win: r.won,
    title: r.won ? '🏆 승리!' : '패배',
    sub: `${s.match.opponent.nick}${bot ? ' 🤖' : ''} 상대 · Wave ${g.wave} · 보낸 공격 ${g.sentCount}회${r.reason === 'leave' && r.won ? ' · 상대 이탈' : ''}`,
    rewards,
    buttons: [
      ...(rewardedAvailable() ? [{ label: `📺 광고 보고 💎 +${crystals} 더 받기`, cls: 'blue', id: 'btn-double', action: () => void doubleReward(crystals) }] : []),
      bot
        ? { label: '🤖 다시 연습전', cls: 'red', action: () => { void exitGame(true).then(() => launch({ kind: 'pvp', session: createBotSession() })); } }
        : { label: '⚔ 다시 대전', cls: 'red', action: () => { void exitGame(true).then(() => menu.openPvpPanel()); } },
      { label: '로비로', cls: '', action: () => void exitGame(true) },
    ],
  });
}

// ---------------------------------------------------------------
//  일반 모드 결과
// ---------------------------------------------------------------
function onGameOver(g: Game, d: GameOverData): void {
  if (d.pvp || !ui || !current || current.kind === 'pvp') return;
  const u = ui;
  audio.gameEnd(d.cleared);
  // 실패 시 부활 제안 (보상형 광고, 판당 1회)
  if (!d.cleared && g.canRevive() && rewardedAvailable()) {
    u.showResult({
      win: false,
      title: '위기!',
      sub: d.reason,
      rewards: [],
      extraHtml: '<div class="fine">광고를 보고 필드의 몹을 모두 정리한 뒤 이어서 싸울 수 있어요 (1회)</div>',
      buttons: [
        { label: '📺 부활하고 계속하기', cls: 'green', action: async () => {
          if (await showRewarded('revive') && g.revive()) { u.hideResult(); audio.merge(); }
          else toast('광고를 끝까지 보면 부활할 수 있어요');
        } },
        { label: '포기하기', cls: '', action: () => finishSolo(u, d) },
      ],
    });
    return;
  }
  finishSolo(u, d);
}

function finishSolo(u: UI, d: GameOverData): void {
  const l = current!;
  if (l.kind === 'stage') {
    const st = STAGE_BY_ID[l.stageId];
    const stars = d.cleared ? starsFor(d.peakMobs) : 0;
    const res = completeStage(l.stageId, d.cleared, stars);
    let crystals = res.crystals;
    if (!d.cleared) { crystals = Math.floor(d.wave / 2); meta.crystals += crystals; }
    if (d.cleared) {
      addSeasonXp(30);
      if (l.stageId === '1-1' && meta.tutorial < 2) meta.tutorial = 2;
    }
    saveMeta();
    const next = STAGES[st.index + 1];
    const canNext = d.cleared && next && stageUnlocked(next.id);
    const view: ResultView = {
      win: d.cleared,
      title: d.cleared ? '스테이지 클리어!' : '실패...',
      sub: d.cleared
        ? `${l.stageId} · 최대 필드 몹 ${d.peakMobs}마리${res.firstClear ? ' · 첫 클리어!' : res.newBest ? ' · 별 기록 갱신!' : ''}`
        : `${d.reason} · Wave ${d.wave}/${st.waves}`,
      stars: d.cleared ? stars : undefined,
      rewards: crystals ? [`💎 +${crystals}`] : [],
      unlocked: res.unlocked,
      extraHtml: d.cleared ? '' : '<div class="fine">TIP: 🧙 유닛 레벨업 · 🔬 연구 · 상성(%) 높은 유닛 배치 · 합성 타이밍을 노려보세요</div>',
      buttons: [],
    };
    if (crystals > 0 && rewardedAvailable()) view.buttons.push({ label: `📺 광고 보고 💎 +${crystals} 더 받기`, cls: 'blue', id: 'btn-double', action: () => void doubleReward(crystals) });
    if (canNext) view.buttons.push({ label: `▶ 다음 스테이지 ${next.id}`, cls: 'red', action: () => void exitGame(true, st.index).then(() => menu.openStage(next.id)) });
    view.buttons.push({ label: '🔄 다시 하기', cls: canNext ? '' : 'red', action: () => void exitGame(true, st.index).then(() => menu.openStage(l.stageId)) });
    view.buttons.push({ label: '로비로', cls: '', action: () => void exitGame(true, st.index) });
    u.showResult(view);
  } else {
    const reward = crystalReward(d.wave);
    meta.crystals += reward;
    saveMeta();
    u.showResult({
      win: d.cleared,
      title: d.cleared ? '🎉 50웨이브 클리어!' : '게임 오버',
      sub: `${d.reason} · 최고 기록 ${meta.bestWave}웨이브`,
      rewards: [`Wave ${d.wave}`, `💎 +${reward}`],
      buttons: [
        ...(reward > 0 && rewardedAvailable() ? [{ label: `📺 광고 보고 💎 +${reward} 더 받기`, cls: 'blue', id: 'btn-double', action: () => void doubleReward(reward) }] : []),
        { label: '🔄 다시 하기', cls: 'red', action: () => void exitGame(true).then(() => launch({ kind: 'endless', goldBooster: false })) },
        { label: '로비로', cls: '', action: () => void exitGame(true) },
      ],
    });
  }
}

async function doubleReward(amount: number): Promise<void> {
  const btn = document.getElementById('btn-double') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  if (await showRewarded('doubleReward')) {
    meta.crystals += amount;
    saveMeta();
    audio.coin();
    toast(`보상 2배! 💎 +${amount}`);
    if (btn) btn.textContent = '✓ 2배 보상 받음';
  } else if (btn) {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------
//  튜토리얼 (1-1 첫 플레이): 소환 → 합성 → 강화 → 상성/배치
// ---------------------------------------------------------------
function startTutorial(g: Game, u: UI): void {
  let step = 0;
  const show = () => {
    if (g !== game) return;
    if (step === 0) u.coach('👆 <b>소환</b> 버튼을 눌러 영웅을 불러오세요! (🪙20)', 'btn-summon');
    else if (step === 1) u.coach('좋아요! 영웅은 몹을 자동으로 공격해요.<br>골드가 모이면 계속 <b>소환</b>하세요', 'btn-summon');
    else if (step === 2) u.coach('🔨 같은 유닛·등급 <b>3개</b>가 모였어요!<br><b>영웅</b> 버튼에서 상위 등급으로 <b>합성</b>하세요', 'btn-sell-panel');
    else if (step === 3) u.coach('💪 <b>강화</b>하면 그 유닛 전체가 강해져요', 'unit-stacks');
    else if (step === 4) {
      u.coach('카드의 <b>%</b>는 이번 몹과의 상성이에요.<br>전장을 <b>드래그</b>해 구역을 바꿀 수 있어요. 행운을 빌어요!');
      meta.tutorial = 1;
      saveMeta();
      setTimeout(() => { if (g === game) u.coach(null); }, 6000);
    }
  };
  const advance = (to: number) => { if (step < to) { step = to; show(); } };
  g.on('roster', () => {
    if (step === 0 && g.units.length >= 1) advance(1);
    if (step <= 1 && g.mergeable().length) advance(2);
  });
  g.on('merge', () => { if (step === 2) advance(3); });
  const levelWatch = setInterval(() => {
    if (g !== game || g.over) { clearInterval(levelWatch); return; }
    if (step === 3 && Object.values(g.levels).some((lv) => lv > 1)) { advance(4); clearInterval(levelWatch); }
    // 합성이 오래 안 나오면 강화 단계로 넘어감
    if (step === 1 && g.time > 45) advance(3);
  }, 500);
  show();
}

// ---------------------------------------------------------------
//  나가기
// ---------------------------------------------------------------
async function exitGame(skipConfirm = false, stageIndex: number | null = null): Promise<void> {
  if (!skipConfirm && game && !game.over) {
    const { confirmModal } = await import('./dom');
    const pvp = current?.kind === 'pvp';
    if (!(await confirmModal('나가기', pvp ? '지금 나가면 <b>패배</b> 처리됩니다.' : '진행 중인 판을 포기하고 로비로 갈까요?', '나가기'))) return;
    if (pvp) session?.reportDefeat();
  }
  session?.leave();
  session = null;
  ui?.coach(null);
  gameFrame.classList.add('hidden');
  $('gameover-panel').classList.add('hidden');
  $('sell-panel').classList.add('hidden');
  const wasSolo = current && current.kind !== 'pvp';
  game = null;
  renderer = null;
  ui = null;
  current = null;
  saveMeta();
  menu.show();
  if (wasSolo) await maybeInterstitial(stageIndex);
}

// ---------------------------------------------------------------
//  메인 루프 - PvP 는 백그라운드 탭에서도 시뮬레이션이 멈추지 않게 타이머 보조
// ---------------------------------------------------------------
let last = performance.now();
let lastFrame = performance.now();
function step(now: number): void {
  let dt = (now - last) / 1000;
  last = now;
  if (!game || !renderer || !ui) return;
  const pvp = game.isPvp;
  if (dt > (pvp ? 1.0 : 0.1)) dt = pvp ? 1.0 : 0.1; // 일반: 큰 점프 방지 / PvP: 실시간 유지
  // 큰 dt 는 잘게 나눠 시뮬레이션 (충돌/이동 정확도)
  while (dt > 0) {
    const d = Math.min(dt, 0.05);
    game.update(d);
    dt -= d;
  }
  if (pvp && session && !game.paused && !game.over) {
    snapAcc += (now - lastFrame) / 1000;
    if (snapAcc >= PVP.reportInterval) { snapAcc = 0; session.sendSnapshot(game.snapshot()); }
  }
  lastFrame = now;
  ui.renderTickets();
}
function loop(now: number): void {
  step(now);
  if (game && renderer && ui) {
    renderer.draw();
    ui.update();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(() => {
  // rAF 가 멈춘 경우(백그라운드)에만 PvP 진행
  const now = performance.now();
  if (game?.isPvp && now - last > 400) step(now);
}, 250);

// ---------------------------------------------------------------
//  부팅
// ---------------------------------------------------------------
async function boot(): Promise<void> {
  $('main-menu').classList.remove('hidden');
  $('main-menu').innerHTML = '<div style="margin:auto;text-align:center"><div class="game-title">랜덤 디펜스</div><div class="spinner"></div></div>';
  try {
    await getPlatform().init();
    reloadMeta();
  } catch (e) {
    console.warn('[boot] platform init failed', e);
  }
  const granted = await syncPurchases().catch(() => [] as string[]);
  menu.show();
  if (granted.length) toast('결제한 상품이 지급되었어요 🎁');
}
void boot();

// 디버그용 전역 노출
declare global {
  interface Window {
    __game: Game | null;
    __meta: typeof meta;
    __launch: (l: Launch) => void;
    __forceDraw: () => void;
    __uiUpdate: () => void;
  }
}
window.__launch = launch;
window.__meta = meta;
window.__forceDraw = () => renderer?.draw();
window.__uiUpdate = () => ui?.update();
Object.defineProperty(window, '__game', { get: () => game });
