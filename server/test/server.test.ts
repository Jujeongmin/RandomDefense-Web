/**
 * GameServer 테스트 (gameserver-node test runner)
 * 실행: cd server && npm run build && npm test
 */

describe('클라우드 저장', () => {
  test('saveProfile/loadProfile 왕복, pvp 필드는 서버 값 우선', async (server) => {
    server.connect({ account: 'alice' });
    await server.saveProfile({ crystals: 123, pvp: { trophies: 9999 } });
    const res = await server.loadProfile();
    expect(res.account).toBe('alice');
    expect(res.meta.crystals).toBe(123);
    expect(res.meta.pvp.trophies).toBe(0);
  });
});

describe('VX Shop 지급', () => {
  test('구매 훅 → claim 1회만 반환, 같은 purchaseId 중복 기록 방지', async (server) => {
    await server.$onItemPurchased({ account: 'bob', purchaseId: 7, productId: 'starter_pack', quantity: 1 });
    await server.$onItemPurchased({ account: 'bob', purchaseId: 7, productId: 'starter_pack', quantity: 1 });
    server.connect({ account: 'bob' });
    const first = await server.claimPurchases();
    expect(first.length).toBe(1);
    expect(first[0].productId).toBe('starter_pack');
    expect(first[0].purchaseId).toBe('7');
    const second = await server.claimPurchases();
    expect(second.length).toBe(0);
  });
});

describe('PvP 매칭', () => {
  test('두 명이 큐에 들어오면 같은 룸/시드로 매칭', async (server) => {
    server.connect({ account: 'p1' });
    const a = await server.pvpQueue({ nick: '하나' });
    expect(a.status).toBe('waiting');
    server.connect({ account: 'p2' });
    const b = await server.pvpQueue({ nick: '둘' });
    expect(b.status).toBe('matched');
    expect(b.match.opponent.account).toBe('p1');
    server.connect({ account: 'p1' });
    const polled = await server.pvpPoll();
    expect(polled.status).toBe('matched');
    expect(polled.match.roomId).toBe(b.match.roomId);
    expect(polled.match.seed).toBe(b.match.seed);
    expect(polled.match.opponent.nick).toBe('둘');
  });

  test('취소하면 대기열에서 빠진다', async (server) => {
    server.connect({ account: 'p1' });
    await server.pvpQueue({});
    await server.pvpCancel();
    const polled = await server.pvpPoll();
    expect(polled.status).toBe('idle');
    server.connect({ account: 'p2' });
    const b = await server.pvpQueue({});
    expect(b.status).toBe('waiting');
  });
});

describe('PvP 룸', () => {
  test('둘 다 준비 → playing, 패배 보고 → 승자 트로피 증가', async (server) => {
    await server.simulateJoin('r1', 'p1');
    await server.simulateJoin('r1', 'p2');
    server.connect({ account: 'p1', roomId: 'r1' });
    const s1 = await server.pvpReady({ nick: 'A', seed: 42 });
    expect(s1.status).toBe('waiting');
    server.connect({ account: 'p2', roomId: 'r1' });
    const s2 = await server.pvpReady({ nick: 'B', seed: 42 });
    expect(s2.status).toBe('playing');
    expect(s2.seed).toBe(42);
    const res = await server.pvpDefeat();
    expect(res.winner).toBe('p1');
    expect(res.delta.p1).toBe(30);
    expect(res.trophies.p2).toBe(0);
    // 중복 보고는 같은 결과
    server.connect({ account: 'p1', roomId: 'r1' });
    const again = await server.pvpDefeat();
    expect(again.winner).toBe('p1');
    const lb = await server.pvpLeaderboard();
    expect(lb.me.trophies).toBe(30);
    expect(lb.me.wins).toBe(1);
  });

  test('경기 중 이탈하면 상대 승리', async (server) => {
    await server.simulateJoin('r2', 'p3');
    await server.simulateJoin('r2', 'p4');
    server.connect({ account: 'p3', roomId: 'r2' });
    await server.pvpReady({});
    server.connect({ account: 'p4', roomId: 'r2' });
    await server.pvpReady({});
    await server.simulateLeave('r2', 'p4');
    server.connect({ account: 'p3', roomId: 'r2' });
    const lb = await server.pvpLeaderboard();
    expect(lb.me.wins).toBe(1);
  });
});
