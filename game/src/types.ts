// ============================================================
//  공용 타입 정의
// ============================================================
// 유닛 종류 (기본 3종 + 해금 5종). 스프라이트는 base 3종 시트를 색조 변형해 사용
export type Job = 'archer' | 'wizard' | 'warrior' | 'ranger' | 'frost' | 'paladin' | 'assassin' | 'bomber';
export type BaseJob = 'archer' | 'wizard' | 'warrior';
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
  | { type: 'splash'; x: number; y: number; ttl: number; r: number; color: string }
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
  /** 판 도중 필드 몹 최대치 (별 판정) */
  peakMobs: number;
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
  /** 퀘스트/업적/최고기록 반영 여부 (AI 상대의 헤드리스 게임은 false) */
  track: boolean;
  /** 출전 덱 - 소환 시 이 중에서 랜덤 */
  deck: Job[];
  /** 유닛 영구 레벨 (컬렉션 성장) */
  unitLevels: Partial<Record<Job, number>>;
  /** 웨이브 수 (0 = 기본 50, PvP 는 무한) */
  waves: number;
  /** 몹 체력 배수 (스테이지 난이도) */
  hpMult: number;
  /** 등장 종족 제한 (없으면 전체) */
  races?: Race[];
  /** 캠페인 스테이지 id (없으면 무한/PvP) */
  stageId?: string;
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
  oneTime: Record<string, boolean | number>;
  pvp: { trophies: number; wins: number; losses: number; streak: number };
  /** 해금한 유닛과 영구 레벨 (없으면 미해금) */
  units: Partial<Record<Job, number>>;
  /** 출전 덱 (최대 4 = 배치 구역 수) */
  deck: Job[];
  /** 캠페인 스테이지별 별 개수 ("1-3": 2) */
  stages: Record<string, number>;
  /** 튜토리얼 완료 단계 */
  tutorial: number;
  nick: string;
  adRemoved: boolean;
}

// ============================================================
//  플랫폼 추상화 (Verse8 SDK 교체 지점)
//  - LocalPlatform: localStorage + 데모 VX (개발/오프라인)
//  - Verse8Platform: 게임서버(계정 저장) + VX Shop 결제
// ============================================================
/** 결제 완료되어 지급 대기 중인 구매 */
export interface PurchaseRecord {
  purchaseId: string;
  productId: string;
  quantity: number;
}

export interface PlatformAdapter {
  readonly kind: 'local' | 'verse8';
  /** 비동기 초기화 (서버 저장 데이터 로드 등) */
  init(): Promise<void>;
  /** 저장된 메타 로드 (없으면 null) */
  loadMeta(): Partial<MetaData> | null;
  /** 메타 영구 저장 */
  saveMeta(m: MetaData): void;
  /** 보유 VX (로컬 데모만 알 수 있음, Verse8 은 null → 결제창에서 확인) */
  getVX(): number | null;
  /** 상품 가격 (VX Shop 에 등록된 가격, 모르면 null) */
  priceOf(productId: string): number | null;
  /** 결제 시작. 결제창이 닫힐 때 결제 여부를 resolve */
  buy(productId: string): Promise<boolean>;
  /** 결제 완료됐지만 아직 지급하지 않은 구매 목록을 가져오고 비운다 */
  claimPurchases(): Promise<PurchaseRecord[]>;
  /** 계정 식별자 (로컬은 null) */
  accountId(): string | null;
}
