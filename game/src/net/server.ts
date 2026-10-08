// ============================================================
//  Verse8 게임서버 연결 (@agent8/gameserver)
//  - React 훅 없이 GameServer 클래스만 사용 (React 의존성 회피용 딥 임포트)
//  - VITE_AGENT8_VERSE 가 있을 때만 온라인 모드 (Verse8 프로젝트 .env)
// ============================================================
import { GameServer } from '@agent8/gameserver/dist/src/server/GameServer.js';

let server: GameServer | null = null;
let connecting: Promise<GameServer> | null = null;

export async function getServer(): Promise<GameServer> {
  if (server?.connected) return server;
  if (!connecting) {
    connecting = (async () => {
      const s = new GameServer();
      await s.connect();
      server = s;
      return s;
    })().finally(() => { connecting = null; });
  }
  return connecting;
}

/** 전역(GS) 서버 함수 호출 - 응답 대기 */
export async function callGlobal<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  const s = await getServer();
  return (await s.remoteFunction(fn, args, { target: 'gs' })) as T;
}

/** 룸(RS) 서버 함수 호출 - 응답 대기 */
export async function callRoom<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  const s = await getServer();
  return (await s.remoteFunction(fn, args, { target: 'rs' })) as T;
}

/** 룸 함수 고빈도 호출 (응답 없음, 스로틀) */
export function sendRoom(fn: string, args: unknown[], throttleMs: number): void {
  if (!server?.rsConnected) return;
  void server.remoteFunction(fn, args, { target: 'rs', throttle: throttleMs, throttleTrailing: true }).catch(() => {});
}

export function myAccount(): string | null {
  return server?.account ?? null;
}
