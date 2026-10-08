/**
 * Random Defense - Verse8(Agent8) GameServer
 *
 * 기능
 *  - 클라우드 저장: loadProfile / saveProfile  (계정별 메타 진행도)
 *  - VX Shop 결제 지급: $onItemPurchased 훅이 대기 목록에 기록 → claimPurchases 로 수령
 *  - PvP 실시간 1:1: 매칭(pvpQueue/pvpPoll/pvpCancel) → 룸(pvpReady/pvpSnap/pvpAttack/pvpDefeat)
 *    → 결과(트로피/랭킹) 서버 판정. 이탈(onRoomLeave) 시 상대 승리.
 *
 * 각 클라이언트가 자기 필드를 시뮬레이션하고, 서버는 매칭·중계·승패/트로피만 권위적으로 처리한다.
 * (같은 seed 로 양쪽 웨이브 구성이 동일)
 */

const QUEUE_KEY = 'pvpQueue';
const QUEUE_TTL = 15_000;        // 대기열 하트비트 만료(ms) - 클라이언트가 2초마다 poll
const MATCH_TTL = 60_000;        // 매칭 결과 보관(ms)
const TROPHY_WIN = 30;
const TROPHY_LOSS = 20;
const RANKING = 'pvpRanking';
const MAX_META_BYTES = 60_000;

interface QueueEntry { account: string; nick: string; trophies: number; t: number }
interface PvpStats { trophies: number; wins: number; losses: number; streak: number }
interface MatchInfo {
  roomId: string;
  seed: number;
  t: number;
  opponent: { account: string; nick: string; trophies: number };
}
interface PurchaseRecord { purchaseId: string; productId: string; quantity: number }
interface PlayerSlot { nick: string; trophies: number; ready: boolean }

function cleanNick(n: unknown): string {
  const s = typeof n === 'string' ? n.trim() : '';
  return (s || '용사').slice(0, 12);
}

function freshStats(): PvpStats {
  return { trophies: 0, wins: 0, losses: 0, streak: 0 };
}

async function getStats(account: string): Promise<PvpStats> {
  const st = await $global.getUserState(account, ['pvp']);
  return { ...freshStats(), ...(st.pvp || {}) };
}

export class Server {
  // ================= 클라우드 저장 =================
  async loadProfile(): Promise<{ account: string; meta: Record<string, any> | null; pvp: PvpStats }> {
    const st = await $global.getMyState(['meta', 'pvp']);
    const pvp = { ...freshStats(), ...(st.pvp || {}) };
    const meta = st.meta || null;
    // PvP 기록은 서버 값이 권위 (클라이언트 저장본 덮어쓰기)
    if (meta) meta.pvp = pvp;
    return { account: $sender.account, meta, pvp };
  }

  async saveProfile(meta: Record<string, any>): Promise<boolean> {
    if (!meta || typeof meta !== 'object') throw new Error('invalid meta');
    if (JSON.stringify(meta).length > MAX_META_BYTES) throw new Error('meta too large');
    delete meta.pvp; // 서버 권위 필드는 저장하지 않음
    await $global.updateMyState({ meta }, { returnState: false });
    return true;
  }

  // ================= VX Shop 결제 =================
  /** 결제 완료 시 플랫폼이 호출 ($sender 가 아닌 event.account 로 사용자 식별) */
  async $onItemPurchased(event: { account: string; purchaseId: number | string; productId: string; quantity?: number }): Promise<boolean> {
    const account = event.account;
    await $lock(`purchase:${account}`, async () => {
      const st = await $global.getUserState(account, ['pendingPurchases']);
      const list: PurchaseRecord[] = Array.isArray(st.pendingPurchases) ? st.pendingPurchases : [];
      const purchaseId = String(event.purchaseId);
      if (!list.some((p) => p.purchaseId === purchaseId)) {
        list.push({ purchaseId, productId: event.productId, quantity: Math.max(1, event.quantity || 1) });
      }
      await $global.updateUserState(account, { pendingPurchases: list });
    });
    $global.sendMessageToUser('purchase', account, { productId: event.productId });
    return true;
  }

  /** 대기 중인 구매를 가져가고 비운다 (클라이언트가 purchaseId 로 중복 지급 방지) */
  async claimPurchases(): Promise<PurchaseRecord[]> {
    const account = $sender.account;
    return $lock(`purchase:${account}`, async () => {
      const st = await $global.getMyState(['pendingPurchases']);
      const list: PurchaseRecord[] = Array.isArray(st.pendingPurchases) ? st.pendingPurchases : [];
      if (list.length) await $global.updateMyState({ pendingPurchases: [] });
      return list;
    });
  }

  // ================= PvP 매칭 =================
  async pvpQueue(opts: { nick?: string } = {}): Promise<{ status: 'waiting' } | { status: 'matched'; match: MatchInfo }> {
    const me = $sender.account;
    const nick = cleanNick(opts.nick);
    const stats = await getStats(me);
    await $global.updateMyState({ nick, pvpMatch: null });
    return $lock(QUEUE_KEY, async () => {
      const now = Date.now();
      const g = await $global.getGlobalState([QUEUE_KEY]);
      let queue: QueueEntry[] = (g[QUEUE_KEY] || []).filter((q: QueueEntry) => now - q.t < QUEUE_TTL && q.account !== me);
      // 트로피가 가장 가까운 상대 (오래 기다린 사람일수록 허용 폭 확대)
      let best: QueueEntry | null = null;
      let bestScore = Infinity;
      for (const q of queue) {
        const waited = (now - q.t) / 1000;
        const diff = Math.abs(q.trophies - stats.trophies);
        if (diff > 200 + waited * 40) continue;
        if (diff < bestScore) { bestScore = diff; best = q; }
      }
      if (best) {
        const opp = best;
        queue = queue.filter((q) => q.account !== opp.account);
        await $global.updateGlobalState({ [QUEUE_KEY]: queue });
        const roomId = `pvp_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const seed = Math.floor(Math.random() * 2 ** 31);
        const forMe: MatchInfo = { roomId, seed, t: now, opponent: { account: opp.account, nick: opp.nick, trophies: opp.trophies } };
        const forOpp: MatchInfo = { roomId, seed, t: now, opponent: { account: me, nick, trophies: stats.trophies } };
        await $global.updateUserState(opp.account, { pvpMatch: forOpp });
        $global.sendMessageToUser('pvpMatch', opp.account, forOpp);
        return { status: 'matched' as const, match: forMe };
      }
      queue.push({ account: me, nick, trophies: stats.trophies, t: now });
      await $global.updateGlobalState({ [QUEUE_KEY]: queue });
      return { status: 'waiting' as const };
    });
  }

  /** 대기 중 하트비트 + 매칭 확인 (메시지 유실 대비) */
  async pvpPoll(): Promise<{ status: 'waiting' | 'idle' } | { status: 'matched'; match: MatchInfo }> {
    const me = $sender.account;
    const st = await $global.getMyState(['pvpMatch']);
    const m: MatchInfo | null = st.pvpMatch || null;
    if (m && Date.now() - m.t < MATCH_TTL) {
      await $global.updateMyState({ pvpMatch: null });
      return { status: 'matched', match: m };
    }
    return $lock(QUEUE_KEY, async () => {
      const g = await $global.getGlobalState([QUEUE_KEY]);
      const queue: QueueEntry[] = g[QUEUE_KEY] || [];
      const mine = queue.find((q) => q.account === me);
      if (!mine) return { status: 'idle' as const };
      mine.t = Date.now();
      await $global.updateGlobalState({ [QUEUE_KEY]: queue });
      return { status: 'waiting' as const };
    });
  }

  async pvpCancel(): Promise<boolean> {
    const me = $sender.account;
    await $lock(QUEUE_KEY, async () => {
      const g = await $global.getGlobalState([QUEUE_KEY]);
      const queue: QueueEntry[] = (g[QUEUE_KEY] || []).filter((q: QueueEntry) => q.account !== me);
      await $global.updateGlobalState({ [QUEUE_KEY]: queue });
    });
    await $global.updateMyState({ pvpMatch: null });
    return true;
  }

  // ================= PvP 룸 =================
  /** 룸 입장 후 준비 완료. 두 명 모두 준비되면 3.5초 뒤 동시 시작 */
  async pvpReady(opts: { nick?: string; seed?: number } = {}): Promise<Record<string, any>> {
    const me = $sender.account;
    const roomId = $sender.roomId || $room.getId();
    const stats = await getStats(me);
    return $lock(`room:${roomId}`, async () => {
      const room = await $room.getRoomState();
      const players: Record<string, PlayerSlot> = room.players || {};
      players[me] = { nick: cleanNick(opts.nick), trophies: stats.trophies, ready: true };
      const update: Record<string, any> = { players };
      if (room.seed === undefined && typeof opts.seed === 'number') update.seed = opts.seed;
      const readyCount = Object.values(players).filter((p) => p.ready).length;
      if (readyCount >= 2 && (!room.status || room.status === 'waiting')) {
        update.status = 'playing';
        update.startAt = Date.now() + 3500;
        await $room.updateRoomState(update);
        $room.broadcastToRoom('pvpStart', { startAt: update.startAt, seed: update.seed ?? room.seed, players });
      } else {
        if (!room.status) update.status = 'waiting';
        await $room.updateRoomState(update);
      }
      return { ...room, ...update };
    });
  }

  /** 내 필드 상태 요약 중계 (상대 미니맵) */
  async pvpSnap(snap: Record<string, any>): Promise<void> {
    if (!snap || typeof snap !== 'object') return;
    $room.broadcastToRoom('pvpSnap', { account: $sender.account, snap });
  }

  /** 몹 보내기 중계 */
  async pvpAttack(payload: { tier: number; wave: number }): Promise<boolean> {
    const tier = payload?.tier === 1 ? 1 : 0;
    const wave = Math.max(1, Math.min(999, Math.floor(Number(payload?.wave) || 1)));
    const room = await $room.getRoomState(['status']);
    if (room.status !== 'playing') return false;
    $room.broadcastToRoom('pvpAttack', { from: $sender.account, payload: { tier, wave } });
    return true;
  }

  /** 내 필드가 무너짐 → 상대 승리 */
  async pvpDefeat(): Promise<Record<string, any> | null> {
    const roomId = $sender.roomId || $room.getId();
    return this.finishMatch(roomId, $sender.account, 'defeat');
  }

  async onRoomLeave(roomId: string, account: string): Promise<void> {
    const room = await $room.getRoomState(['status']);
    if (room.status === 'playing') {
      await this.finishMatch(roomId, account, 'leave');
    } else if (room.status === 'waiting') {
      await $room.updateRoomState({ status: 'cancelled' });
      $room.broadcastToRoom('pvpCancel', { account });
    }
  }

  /** 승패 확정 (중복 호출 안전) - 트로피/전적/랭킹 갱신 후 결과 브로드캐스트 */
  private async finishMatch(roomId: string, loser: string, reason: 'defeat' | 'leave'): Promise<Record<string, any> | null> {
    return $lock(`room:${roomId}`, async () => {
      const room = await $room.getRoomState();
      if (room.status !== 'playing') return room.result || null;
      const accounts = Object.keys(room.players || {});
      const winner = accounts.find((a) => a !== loser) || null;
      const delta: Record<string, number> = {};
      const trophies: Record<string, number> = {};
      for (const acc of accounts) {
        const s = await getStats(acc);
        const won = acc === winner;
        const d = won ? TROPHY_WIN + Math.min(10, s.streak * 2) : -Math.min(TROPHY_LOSS, s.trophies);
        s.trophies += d;
        if (won) { s.wins += 1; s.streak = Math.max(0, s.streak) + 1; } else { s.losses += 1; s.streak = 0; }
        delta[acc] = d;
        trophies[acc] = s.trophies;
        await $global.updateUserState(acc, { pvp: s });
        const nick = room.players[acc]?.nick || '용사';
        await $global.addCollectionItem(RANKING, { account: acc, nick, trophies: s.trophies, wins: s.wins }, { id: acc })
          .catch(() => $global.updateCollectionItem(RANKING, { __id: acc, account: acc, nick, trophies: s.trophies, wins: s.wins }));
      }
      const result = { winner, loser, reason, delta, trophies };
      await $room.updateRoomState({ status: 'done', result });
      $room.broadcastToRoom('pvpResult', result);
      return result;
    });
  }

  // ================= 랭킹 =================
  async pvpLeaderboard(): Promise<{ top: Array<{ account: string; nick: string; trophies: number; wins: number }>; me: PvpStats }> {
    const items = await $global.getCollectionItems(RANKING, {
      orderBy: [{ field: 'trophies', direction: 'desc' }],
      limit: 50,
    });
    const top = items.map((i: any) => ({ account: i.account, nick: i.nick, trophies: i.trophies, wins: i.wins || 0 }));
    return { top, me: await getStats($sender.account) };
  }
}
