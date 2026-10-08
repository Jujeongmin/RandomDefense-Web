// ============================================================
//  공용 타입 정의
// ============================================================
export type Job = 'archer' | 'wizard' | 'warrior';
export type Race = 'troll' | 'orc' | 'undead';
export type GradeKey = 'common' | 'rare' | 'elite' | 'legendary' | 'mythic' | 'eternal';

export interface Grade {
  key: GradeKey;
  kr: string;
  spriteIndex: number;
  atk: [number, number];
  summonRate: number;
  sellGold: number;
  color: string;
}

export interface ResearchDef {
  key: ResearchKey;
  kr: string;
  max: number;
  desc: string;
  per: number;
}
export type ResearchKey = 'atk' | 'startGold' | 'goldGain' | 'rare' | 'boss';

export interface DailyQuestDef {
  key: string;
  kr: string;
  goal: number;
  stat: QuestStat;
  reward: number;
}
export type QuestStat = 'summons' | 'kills' | 'bestWave' | 'sells';

export interface AchievementDef {
  key: string;
  kr: string;
  reward: number;
}

export interface Unit {
  id: number;
  job: Job;
  grade: GradeKey;
  gradeIndex: number;
  baseAtk: number;
  zoneId: number;
  x: number;
  y: number;
  cooldown: number;
  flash: number;
  dir: number;                                  // 스프라이트 방향 행 (이동 중일 때만 사용)
  moveFrom: { x: number; y: number } | null;     // 걷기 트윈 시작점 (null 이면 정지 상태)
  moveTo: { x: number; y: number } | null;       // 걷기 트윈 목표점
  moveElapsed: number;
  moveDur: number;
  _newZone?: number;
}

export type MobKind = 'normal' | 'fast' | 'tank' | 'sent' | 'elite';

export interface Mob {
  id: number;
  race: Race;
  kind: MobKind;       // fast=빠름/약함, tank=느림/단단함, sent/elite=PvP 상대가 보낸 몹
  x: number;
  y: number;
  seg: number;
  pause: number;
  hp: number;
  maxHp: number;
  boss: boolean;
  size: number;
  dead: boolean;
  hitFlash: number;
  speedMult: number;   // 종류별 이동 속도 배율
  slow: number;        // 전사 둔화 남은 시간(초)
  slowPct: number;     // 둔화 비율 (0~1)
  dir: number; // 스프라이트 방향 행: 0=하 1=좌 2=우 3=상
}

export interface Zone {
  id: number;
  cx: number;
  cy: number;
  job: Job | null;
  tri: { x: number; y: number }[]; // 삼각형 꼭짓점 3개 (랜덤 배치용)
}

// 이펙트는 모두 시각 전용 (데미지 판정은 엔진에서 즉시 처리)
export type Effect =
  | { type: 'proj'; x1: number; y1: number; x2: number; y2: number; job: Job; grade: number; ttl: number; dur: number }
  | { type: 'pop'; x: number; y: number; ttl: number; boss: boolean; seed: number }
  | { type: 'dmg'; x: number; y: number; ttl: number; value: number; crit: boolean }
  | { type: 'gold'; x: number; y: number; ttl: number; value: number }
  | { type: 'splash'; x: number; y: number; ttl: number; r: number }
  | { type: 'slash'; x: number; y: number; ttl: number; seed: number }
  | { type: 'merge'; x: number; y: number; ttl: number; color: string }
  | { type: 'summon'; x: number; y: number; ttl: number; color: string; big: boolean }
  | { type: 'burst'; x: number; y: number; ttl: number; seed: number }; // 태초 등급 타격 연출

export interface LogEntry {
  text: string;
  ttl: number;
}

export interface Banner {
  text: string;
  ttl: number;
}

export interface Stack {
  job: Job;
  grade: GradeKey;
  gradeIndex: number;
  count: number;
  level: number;
  key: string;
}

// 하단 패널용 - 직업 단위 집계 (강화가 직업 단위이므로)
export interface JobStack {
  job: Job;
  count: number;
  level: number;
  topGrade: GradeKey;      // 보유 최고 등급 (대표 스프라이트)
  topGradeIndex: number;
}

export type WaveState = 'spawning' | 'waiting_boss' | 'rest';

// 구역 교환 드래그 상태 (UI 가 갱신, 렌더러가 표시)
export interface DragState {
  from: number;          // 출발 구역 id
  to: number | null;     // 현재 가리키는 구역 id (없으면 null)
  x: number;             // 현재 포인터 논리 좌표
  y: number;
}

export interface GameOverData {
  wave: number;
  reason: string;
  cleared: boolean;
  pvp?: { won: boolean };
}

// 게임 모드/옵션 - solo(일반) 와 pvp(실시간 1:1) 가 같은 엔진을 공유한다
export type GameMode = 'solo' | 'pvp';
export interface GameOptions {
  mode: GameMode;
  /** 웨이브 구성(종족/몹 종류) 시드. PvP 에서는 두 플레이어가 같은 시드를 쓴다 */
  seed: number;
  /** 연구소 효과 적용 여부 (PvP 는 공정성을 위해 false) */
  useResearch: boolean;
  /** 시작 골드 배수 (골드 부스터) */
  startGoldMult: number;
}

// PvP: 상대에게 보내는 공격 묶음
export interface AttackPayload {
  tier: 0 | 1;      // 0=몹 무리, 1=정예 몹
  wave: number;     // 보낸 쪽 웨이브 (체력 기준)
}

// 소모성/영구 아이템 인벤토리 (결제·보상으로 획득)
export type ItemKey = 'summonTicket' | 'mythicTicket' | 'goldBooster';

// meta.ts
export interface MetaData {
  crystals: number;
  research: Record<ResearchKey, number>;
  achievements: Record<string, boolean>;
  daily: {
    date: string;
    progress: Record<string, number>;
    claimed: Record<string, boolean>;
  };
  bestWave: number;
  items: Record<ItemKey, number>;
  /** PvP 시즌 패스 */
  season: { id: string; xp: number; premium: boolean; claimedFree: number[]; claimedPremium: number[] };
  /** 월정액: 만료 시각(ms)과 마지막 일일 수령 날짜 */
  monthly: { expires: number; lastClaim: string };
  /** 결제 처리 완료된 구매 id (중복 지급 방지) */
  grantedPurchases: string[];
  /** 1회 한정 상품 구매 여부 */
  oneTime: Record<string, boolean>;
  pvp: { trophies: number; wins: number; losses: number; streak: number };
}

// ============================================================
//  플랫폼 추상화 (Verse8 SDK 교체 지점)
//  - 지금은 LocalPlatform(localStorage) 구현만 사용
//  - 추후 Verse8Platform 이 같은 인터페이스를 구현해 setPlatform() 으로 교체
// ============================================================
export interface PlatformAdapter {
  /** 저장된 메타 로드 (없으면 null) */
  loadMeta(): Partial<MetaData> | null;
  /** 메타 영구 저장 */
  saveMeta(m: MetaData): void;
  /** 광고제거 패키지 보유 여부 (3배속 해금 조건) */
  isAdRemoved(): boolean;
  /** 광고제거 패키지 소유 등록 (VX 차감 후 호출) */
  purchaseAdRemoval(): Promise<boolean>;
  /** 보유 VX (Verse8 플랫폼 재화) */
  getVX(): number;
  /** VX 차감 (부족하면 false). 실제 결제/충전은 Verse8Platform 에서 */
  spendVX(amount: number): Promise<boolean>;
  /** 계정 식별자 (로컬은 null) */
  accountId(): string | null;
}
