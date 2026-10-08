// ============================================================
//  PvP 세션 - 실시간 1:1 (Verse8 게임서버) / AI 연습 상대(봇)
//  두 구현이 같은 인터페이스를 가져 UI/게임 흐름은 상대 종류를 신경 쓰지 않는다.
// ============================================================
import { Game, type BoardSnapshot } from './engine';
import { PVP, JOBS } from './config';
import { aiStep } from './ai';
import { meta } from './meta';
import { unitLevels } from './progress';
import { isOnlineEnv } from './platform';
import type { AttackPayload, Job } from './types';

export interface MatchInfo {
  roomId: string;
  seed: number;
  opponent: { account?: string; nick: string; trophies: number };
  bot: boolean;
}

export interface PvpResult {
  won: boolean;
  reason: 'defeat' | 'leave' | 'cancel';
  trophyDelta: number;
  trophies: number;
}

export interface PvpHandlers {
  onStart(startAt: number): void;              // Date.now() 기준 시작 시각
  onSnapshot(s: BoardSnapshot): void;
  onAttack(p: AttackPayload): void;
  onResult(r: PvpResult): void;
}

export interface PvpSession {
  readonly match: MatchInfo;
  ready(h: PvpHandlers): Promise<void>;
  sendSnapshot(s: BoardSnapshot): void;
  sendAttack(p: AttackPayload): void;
  reportDefeat(): void;
  leave(): void;
}

export class MatchTimeout extends Error {
  constructor() { super('match timeout'); }
}

export function onlineAvailable(): boolean {
  return isOnlineEnv();
}

// ---------------------------------------------------------------
//  온라인 매칭 (서버 pvpQueue → pvpMatch 메시지/폴링)
// ---------------------------------------------------------------
export async function findOnlineMatch(onStatus: (sec: number) => void, signal: { cancelled: boolean }): Promise<PvpSession> {
  const net = await import('./net/server');
  const server = await net.getServer();
  type Q = { status: 'waiting' | 'idle' } | { status: 'matched'; match: Omit<MatchInfo, 'bot'> };
  let found: Omit<MatchInfo, 'bot'> | null = null;
  const off = server.onGlobalMessage('pvpMatch', (m: Omit<MatchInfo, 'bot'>) => { found = m; });
  try {
    const first = await net.callGlobal<Q>('pvpQueue', { nick: meta.nick });
    if (first.status === 'matched') found = first.match;
    const t0 = Date.now();
    while (!found) {
      if (signal.cancelled) { await net.callGlobal('pvpCancel'); throw new Error('cancelled'); }
      const sec = (Date.now() - t0) / 1000;
      onStatus(sec);
      if (sec > PVP.matchTimeout) { await net.callGlobal('pvpCancel'); throw new MatchTimeout(); }
      await new Promise((r) => setTimeout(r, 2000));
      if (found) break;
      const p = await net.callGlobal<Q>('pvpPoll');
      if (p.status === 'matched') found = p.match;
      else if (p.status === 'idle') {
        // 대기열 만료 시 재등록
        const again = await net.callGlobal<Q>('pvpQueue', { nick: meta.nick });
        if (again.status === 'matched') found = again.match;
      }
    }
  } finally {
    off();
  }
  return new OnlineSession({ ...(found as Omit<MatchInfo, 'bot'>), bot: false });
}

class OnlineSession implements PvpSession {
  private offs: (() => void)[] = [];
  private started = false;
  private finished = false;
  private me = '';
  constructor(readonly match: MatchInfo) {}

  async ready(h: PvpHandlers): Promise<void> {
    const net = await import('./net/server');
    const server = await net.getServer();
    this.me = server.account;
    const roomId = this.match.roomId;
    await server.joinRoom(roomId);
    const start = (startAt: number) => {
      if (this.started) return;
      this.started = true;
      h.onStart(startAt);
    };
    this.offs.push(
      server.onRoomMessage(roomId, 'pvpStart', (m: { startAt: number }) => start(m.startAt)),
      server.onRoomMessage(roomId, 'pvpSnap', (m: { account: string; snap: BoardSnapshot }) => {
        if (m.account !== this.me) h.onSnapshot(m.snap);
      }),
      server.onRoomMessage(roomId, 'pvpAttack', (m: { from: string; payload: AttackPayload }) => {
        if (m.from !== this.me) h.onAttack(m.payload);
      }),
      server.onRoomMessage(roomId, 'pvpResult', (r: { winner: string; reason: 'defeat' | 'leave'; delta: Record<string, number>; trophies: Record<string, number> }) => {
        if (this.finished) return;
        this.finished = true;
        h.onResult({ won: r.winner === this.me, reason: r.reason, trophyDelta: r.delta[this.me] ?? 0, trophies: r.trophies[this.me] ?? meta.pvp.trophies });
      }),
      server.onRoomMessage(roomId, 'pvpCancel', () => {
        if (this.finished) return;
        this.finished = true;
        h.onResult({ won: false, reason: 'cancel', trophyDelta: 0, trophies: meta.pvp.trophies });
      }),
    );
    const st = await net.callRoom<{ status?: string; startAt?: number }>('pvpReady', { nick: meta.nick, seed: this.match.seed });
    if (st.status === 'playing' && st.startAt) start(st.startAt);
  }

  sendSnapshot(s: BoardSnapshot): void {
    void import('./net/server').then((net) => net.sendRoom('pvpSnap', [s], PVP.reportInterval * 1000));
  }
  sendAttack(p: AttackPayload): void {
    void import('./net/server').then((net) => net.callRoom('pvpAttack', p).catch(() => {}));
  }
  reportDefeat(): void {
    void import('./net/server').then((net) => net.callRoom('pvpDefeat').catch(() => {}));
  }
  leave(): void {
    this.offs.forEach((f) => f());
    this.offs = [];
    void import('./net/server').then(async (net) => (await net.getServer()).leaveRoom());
  }
}

// ---------------------------------------------------------------
//  AI 연습 상대 - 같은 시드의 헤드리스 게임을 페이지 안에서 돌린다
// ---------------------------------------------------------------
const BOT_NAMES = ['고블린왕', '숲의궁수', '철벽수비', '랜덤마스터', '합성장인', '몹폭격기', '새벽용사', '흑마법사'];

export function createBotSession(): PvpSession {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const t = meta.pvp.trophies;
  return new BotSession({
    roomId: `bot_${seed}`,
    seed,
    bot: true,
    opponent: { nick: BOT_NAMES[seed % BOT_NAMES.length], trophies: Math.max(0, t + Math.round((Math.random() - 0.5) * 60)) },
  });
}

class BotSession implements PvpSession {
  private game: Game | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers: PvpHandlers | null = null;
  private done = false;
  constructor(readonly match: MatchInfo) {}

  async ready(h: PvpHandlers): Promise<void> {
    this.handlers = h;
    // 봇 실력: 트로피가 오를수록 강해짐 (0.35 ~ 0.9)
    const skill = Math.min(0.9, 0.35 + meta.pvp.trophies / 2500);
    // 덱: 플레이어 덱과 같은 수, 해금 유닛 중 무작위 (레벨은 플레이어 평균 수준)
    const pool = [...JOBS].sort(() => Math.random() - 0.5);
    const deck = pool.slice(0, Math.max(3, meta.deck.length)) as Job[];
    const lv = unitLevels();
    const vals = Object.values(lv) as number[];
    const avg = Math.max(1, Math.round(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)));
    const game = new Game({ mode: 'pvp', seed: this.match.seed, useResearch: false, track: false, deck, unitLevels: Object.fromEntries(deck.map((j) => [j, avg])) });
    this.game = game;
    game.on('attack', (p) => h.onAttack(p));
    game.on('gameover', () => this.finish(true));
    const startAt = Date.now() + 3000;
    h.onStart(startAt);
    let acc = 0, snapAcc = 0;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      if (now < startAt || this.done) return;
      game.update(dt);
      acc += dt; snapAcc += dt;
      if (acc >= 0.35) { acc = 0; aiStep(game, skill); }
      if (snapAcc >= PVP.reportInterval) { snapAcc = 0; h.onSnapshot(game.snapshot()); }
    }, 50);
  }

  private finish(playerWon: boolean): void {
    if (this.done) return;
    this.done = true;
    if (this.timer) clearInterval(this.timer);
    // AI 대전은 트로피 변동 없음 (보석·시즌 경험치만 일부 지급)
    this.handlers?.onResult({ won: playerWon, reason: 'defeat', trophyDelta: 0, trophies: meta.pvp.trophies });
  }

  sendSnapshot(): void { /* 봇은 상대 화면을 보지 않음 */ }
  sendAttack(p: AttackPayload): void { this.game?.receiveAttack(p); }
  reportDefeat(): void { this.finish(false); }
  leave(): void {
    this.done = true;
    if (this.timer) clearInterval(this.timer);
  }
}
