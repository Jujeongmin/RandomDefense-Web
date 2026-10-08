// ============================================================
//  게임 엔진 - 맵/경로/웨이브/전투/경제 로직
//  (렌더링/DOM 은 여기서 다루지 않음)
// ============================================================
import {
  ECONOMY, WAVE, GRADES, GRADE_BY_KEY, GRADE_INDEX, GRADE_RANGE,
  DMG_MULT, RACES, JOB_KR, FULL_RANGE_FROM_INDEX, RESEARCH_PER,
  MOB_KINDS, SKILLS, SKILL_FROM_INDEX, MERGE_COUNT, PVP, UNIT_BY_ID, STARTER_UNITS,
  UNIT_LEVEL_ATK, perkMult,
  rollGrade, rollJob, makeRng,
} from './config';
import {
  meta, researchLevel, addDailyProgress, setDailyBestWave, unlockAchievement,
} from './meta';
import type {
  Job, Race, GradeKey, Unit, Mob, MobKind, Zone, Effect, LogEntry, Banner, Stack, JobStack,
  WaveState, GameOverData, AchievementDef, DragState, GameOptions, AttackPayload, ResearchKey,
} from './types';

// ---- 맵 기하 (논리 좌표: 720 x 720) ----
export const MAP = { size: 720 } as const;
const P = 70; // 경로 바깥 여백
export const PATH = {
  // 좌상(시작) → 좌하 → 우하 → 우상 : 반시계방향 순환
  corners: [
    { x: P, y: P },                        // 좌상 (스폰)
    { x: P, y: MAP.size - P },             // 좌하
    { x: MAP.size - P, y: MAP.size - P },  // 우하
    { x: MAP.size - P, y: P },             // 우상
  ] as { x: number; y: number }[],
  width: 44,
};
const INNER = 118; // 유닛 배치 사각형 여백
const O = MAP.size / 2;

function makeZones(): Zone[] {
  const a = INNER, b = MAP.size - INNER;
  const A = { x: a, y: a }, B = { x: b, y: a }, C = { x: b, y: b }, D = { x: a, y: b };
  const o = { x: O, y: O };
  const tris = [[A, B, o], [B, C, o], [C, D, o], [D, A, o]]; // 상/우/하/좌
  return tris.map((t, i) => ({
    id: i,
    cx: (t[0].x + t[1].x + t[2].x) / 3,
    cy: (t[0].y + t[1].y + t[2].y) / 3,
    job: null,
    tri: t,
  }));
}

let nextId = 1;

const MAX_EFFECTS = 240; // 이펙트 상한 (성능)

export const DEFAULT_OPTIONS: GameOptions = {
  mode: 'solo',
  seed: 0,
  useResearch: true,
  startGoldMult: 1,
  track: true,
  deck: STARTER_UNITS,
  unitLevels: {},
  waves: 0,
  hpMult: 1,
};

// PvP 상대 화면 미니맵용 상태 요약
export interface BoardSnapshot {
  wave: number;
  mobCount: number;
  unitCount: number;
  topGrade: number;
  gold: number;
  /** 몹 위치 (0~255 로 양자화한 x,y 쌍 평탄화) */
  mobs: number[];
  /** 유닛 (구역 id, 등급 index) 쌍 평탄화 */
  units: number[];
  bossHp: number; // 보스 체력 비율 (없으면 -1)
}

// 이벤트 페이로드 타입
interface EventMap {
  wave: number;
  roster: void;
  achievement: AchievementDef;
  gameover: GameOverData;
  shoot: Job;          // 유닛이 공격 발동
  kill: boolean;       // 몹 처치 (보스면 true)
  bossSpawn: void;     // 보스 등장
  merge: Unit;         // 합성 성공 (결과 유닛)
  attack: AttackPayload;   // PvP: 내가 상대에게 몹을 보냄
  incoming: AttackPayload; // PvP: 상대가 보낸 몹 도착
}
type EventName = keyof EventMap;
type Listener<K extends EventName> = (data: EventMap[K]) => void;

export class Game {
  readonly opts: GameOptions;
  gold = 0;
  wave = 0;
  mobs: Mob[] = [];
  units: Unit[] = [];
  effects: Effect[] = [];
  levels: Record<string, number> = {}; // 직업별 강화 레벨 (job 을 키로 사용)
  zones: Zone[] = [];
  kills = 0;
  summons = 0;
  sells = 0;
  speed = 1;
  paused = false;
  over = false;
  cleared = false;
  currentRace: Race = RACES[0];
  waveState: WaveState = 'rest';
  restTimer = 1.0;
  spawnTimer = 0;
  spawnedCount = 0;
  spawnGoal = 0;
  isBossWave = false;
  bossTimer = 0;
  log: LogEntry[] = [];
  mythicBanner: Banner | null = null;
  drag: DragState | null = null; // 구역 교환 드래그 중 시각 피드백용
  shake = 0;                      // 화면 흔들림 세기 (렌더러가 감쇠 표시)
  time = 0;                       // 게임 경과 시간(배속 반영)
  sentCount = 0;                  // PvP: 보낸 공격 수
  peakMobs = 0;                   // 필드 몹 최대치 (별 판정)
  private pending: { kind: MobKind; hp: number; delay: number }[] = []; // PvP: 도착 대기 몹
  private rng: () => number = Math.random;
  private _listeners: { [K in EventName]?: Listener<K>[] } = {};

  constructor(opts: Partial<GameOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    if (!opts.seed) this.opts.seed = Math.floor(Math.random() * 2 ** 31);
    this.reset();
  }

  get isPvp(): boolean { return this.opts.mode === 'pvp'; }
  /** 이 판의 총 웨이브 수 (PvP 는 무한 → Infinity) */
  get totalWaves(): number { return this.isPvp ? Infinity : this.opts.waves || WAVE.total; }

  /** 연구 레벨 (PvP 등 연구 미적용 모드에서는 0) */
  res(key: ResearchKey): number {
    return this.opts.useResearch ? researchLevel(key) : 0;
  }

  reset(): void {
    this.rng = makeRng(this.opts.seed);
    this.gold = Math.round(
      (ECONOMY.startGold + this.res('startGold') * RESEARCH_PER.startGold) * this.opts.startGoldMult,
    );
    this.wave = 0;
    this.mobs = [];
    this.units = [];
    this.effects = [];
    this.levels = {};
    this.zones = makeZones();
    this.kills = 0;
    this.summons = 0;
    this.sells = 0;
    this.speed = 1;
    this.paused = false;
    this.over = false;
    this.cleared = false;
    this.currentRace = RACES[0];
    this.waveState = 'rest';
    this.restTimer = 1.0;
    this.spawnTimer = 0;
    this.spawnedCount = 0;
    this.spawnGoal = 0;
    this.isBossWave = false;
    this.bossTimer = 0;
    this.log = [];
    this.mythicBanner = null;
    this.drag = null;
    this.shake = 0;
    this.time = 0;
    this.sentCount = 0;
    this.peakMobs = 0;
    this.pending = [];
    this._listeners = {};
  }

  on<K extends EventName>(evt: K, fn: Listener<K>): void {
    ((this._listeners[evt] ??= []) as Listener<K>[]).push(fn);
  }
  emit<K extends EventName>(evt: K, data: EventMap[K]): void {
    (this._listeners[evt] as Listener<K>[] | undefined)?.forEach((f) => f(data));
  }

  // ---------------- 웨이브 ----------------
  startNextWave(): void {
    this.wave += 1;
    if (this.wave > this.totalWaves) { this.win(); return; } // PvP 는 무한 웨이브
    const pool = this.opts.races?.length ? this.opts.races : RACES;
    this.currentRace = pool[Math.floor(this.rng() * pool.length)];
    // 10웨이브마다 + 스테이지 마지막 웨이브는 보스
    this.isBossWave = this.wave % WAVE.bossEvery === 0 || this.wave === this.totalWaves;
    this.spawnedCount = 0;
    this.spawnTimer = 0;
    this.waveState = 'spawning';
    this.spawnGoal = this.isBossWave ? 1 : WAVE.mobsPerWave;
    if (this.isBossWave) this.bossTimer = WAVE.bossTimeLimit;
    if (this.opts.track && !this.isPvp) {
      setDailyBestWave(this.wave);
      if (this.wave > meta.bestWave) meta.bestWave = this.wave;
    }
    this.emit('wave', this.wave);
  }

  baseHp(wave = this.wave): number {
    return WAVE.hpBase * this.opts.hpMult * Math.pow(1 + WAVE.hpGrowthPerWave, Math.max(0, wave - 1));
  }

  waveHp(): number {
    const base = this.baseHp();
    return this.isBossWave ? base * WAVE.bossHpMult : base;
  }

  // 웨이브 안에서 index 번째 몹의 종류 (결정적 → PvP 양쪽 동일)
  private kindFor(index: number): MobKind {
    const n = index + 1;
    if (this.wave >= MOB_KINDS.tank.fromWave && n % MOB_KINDS.tank.every === 0) return 'tank';
    if (this.wave >= MOB_KINDS.fast.fromWave && n % MOB_KINDS.fast.every === 0) return 'fast';
    return 'normal';
  }

  spawnMob(): void {
    const boss = this.isBossWave;
    if (boss) {
      this.addMob('normal', this.waveHp(), true);
      this.shake = Math.max(this.shake, 10);
      this.emit('bossSpawn', undefined);
      return;
    }
    const kind = this.kindFor(this.spawnedCount);
    const k = kind === 'fast' || kind === 'tank' ? MOB_KINDS[kind] : null;
    this.addMob(kind, this.waveHp() * (k ? k.hpMult : 1), false);
  }

  private addMob(kind: MobKind, hp: number, boss: boolean): Mob {
    let size = 44;
    let speedMult = 1;
    if (boss) size = 44 * WAVE.bossSizeMult;
    else if (kind === 'fast' || kind === 'tank') {
      size *= MOB_KINDS[kind].sizeMult;
      speedMult = MOB_KINDS[kind].speedMult;
    } else if (kind === 'elite') {
      size *= 1.5;
      speedMult = 0.85;
    } else if (kind === 'sent') {
      speedMult = 1.1;
    }
    const m: Mob = {
      id: nextId++,
      race: this.currentRace,
      kind,
      x: PATH.corners[0].x,
      y: PATH.corners[0].y,
      seg: 0,
      pause: 0,
      hp, maxHp: hp,
      boss,
      size,
      dead: false,
      hitFlash: 0,
      speedMult,
      slow: 0,
      slowPct: 0,
      dir: 0,
    };
    this.mobs.push(m);
    return m;
  }

  // ---------------- PvP: 몹 보내기 / 받기 ----------------
  attackCost(tier: 0 | 1): number { return PVP.attacks[tier].cost; }

  sendAttack(tier: 0 | 1): boolean {
    if (!this.isPvp || this.over) return false;
    const cost = this.attackCost(tier);
    if (this.gold < cost) return false;
    this.gold -= cost;
    this.sentCount += 1;
    const payload: AttackPayload = { tier, wave: Math.max(1, this.wave) };
    this.pushLog(`⚔ 상대에게 ${PVP.attacks[tier].kr} 전송!`);
    this.emit('attack', payload);
    return true;
  }

  receiveAttack(p: AttackPayload): void {
    if (this.over) return;
    const def = PVP.attacks[p.tier];
    const hp = this.baseHp(p.wave) * def.hpMult;
    const kind: MobKind = p.tier === 1 ? 'elite' : 'sent';
    for (let i = 0; i < def.count; i++) this.pending.push({ kind, hp, delay: i * 0.25 });
    this.pushLog(`⚠ 상대가 ${def.kr}을(를) 보냈습니다!`);
    if (p.tier === 1) this.shake = Math.max(this.shake, 6);
    this.emit('incoming', p);
  }

  private updatePending(dt: number): void {
    if (!this.pending.length) return;
    for (const p of this.pending) p.delay -= dt;
    const ready = this.pending.filter((p) => p.delay <= 0);
    if (!ready.length) return;
    this.pending = this.pending.filter((p) => p.delay > 0);
    for (const p of ready) this.addMob(p.kind, p.hp, false);
  }

  // PvP 상대 미니맵/상태 보고용 요약
  snapshot(): BoardSnapshot {
    const q = (v: number) => Math.max(0, Math.min(255, Math.round((v / MAP.size) * 255)));
    const mobs: number[] = [];
    for (const m of this.mobs.slice(0, 120)) mobs.push(q(m.x), q(m.y));
    const units: number[] = [];
    for (const u of this.units.slice(0, 80)) units.push(u.zoneId, u.gradeIndex);
    const boss = this.mobs.find((m) => m.boss);
    return {
      wave: this.wave,
      mobCount: this.mobs.length,
      unitCount: this.units.length,
      topGrade: this.units.reduce((g, u) => Math.max(g, u.gradeIndex), -1),
      gold: Math.floor(this.gold),
      mobs,
      units,
      bossHp: boss ? boss.hp / boss.maxHp : -1,
    };
  }

  // ---------------- 소환 / 강화 / 판매 ----------------
  summon(): Unit | null {
    if (this.gold < ECONOMY.summonCost || this.over) return null;
    this.gold -= ECONOMY.summonCost;
    this.summons += 1;
    this.progress('summons');

    const rareBonus = this.res('rare') * RESEARCH_PER.rare;
    const gradeKey = rollGrade(rareBonus);
    const job = rollJob(this.opts.deck);
    return this.createUnit(job, gradeKey);
  }

  // 골드 없이 소환 (소환권/신화 확정권, 개발 모드 디버그 버튼).
  // gradeKey 를 주면 해당 등급 확정, 없으면 일반 확률.
  summonFree(gradeKey?: GradeKey): Unit | null {
    if (this.over) return null;
    this.summons += 1;
    this.progress('summons');
    const g = gradeKey ?? rollGrade(this.res('rare') * RESEARCH_PER.rare);
    return this.createUnit(rollJob(this.opts.deck), g);
  }

  // ---------------- 합성 ----------------
  // 같은 직업·등급 3개 → 같은 직업 상위 등급 1개 (태초는 합성 불가)
  canMerge(job: Job, gradeKey: GradeKey): boolean {
    return GRADE_INDEX[gradeKey] < GRADES.length - 1 && this.countOf(job, gradeKey) >= MERGE_COUNT;
  }

  merge(job: Job, gradeKey: GradeKey): Unit | null {
    if (this.over || !this.canMerge(job, gradeKey)) return null;
    let removed = 0;
    let zoneId = 0;
    for (let i = this.units.length - 1; i >= 0 && removed < MERGE_COUNT; i--) {
      const u = this.units[i];
      if (u.job === job && u.grade === gradeKey) {
        zoneId = u.zoneId;
        this.units.splice(i, 1);
        removed += 1;
      }
    }
    const next = GRADES[GRADE_INDEX[gradeKey] + 1];
    const unit = this.createUnit(job, next.key, 'merge');
    const z = this.zones[zoneId];
    this.effects.push({ type: 'merge', x: unit.x, y: unit.y, ttl: 0.7, color: next.color });
    if (z && !this.units.some((u) => u.zoneId === z.id)) z.job = null;
    this.emit('merge', unit);
    return unit;
  }

  /** 합성 가능한 (직업, 등급) 목록 */
  mergeable(): { job: Job; grade: GradeKey }[] {
    const out: { job: Job; grade: GradeKey }[] = [];
    for (const s of this.getStacks()) if (this.canMerge(s.job, s.grade)) out.push({ job: s.job, grade: s.grade });
    return out;
  }

  // 소환 확정 로직 (직업/등급이 정해진 뒤 공통으로 처리)
  private createUnit(job: Job, gradeKey: GradeKey, source: 'summon' | 'merge' = 'summon'): Unit {
    const grade = GRADE_BY_KEY[gradeKey];
    const gIdx = GRADE_INDEX[gradeKey];
    const baseAtk = grade.atk[0] + Math.random() * (grade.atk[1] - grade.atk[0]);

    // 새 직업 구역 배정: 몹 진행(반시계: 좌상→좌하→하단→우측)에 맞춰
    // 상단(0) → 좌측(3) → 하단(2) → 우측(1) 순으로 빈 구역을 채운다
    const ZONE_PRIORITY = [0, 3, 2, 1];
    let zone = this.zones.find((z) => z.job === job)
      || ZONE_PRIORITY.map((i) => this.zones[i]).find((z) => z.job === null)
      || this.zones[0];
    zone.job = job;

    if (!this.levels[job]) this.levels[job] = 1; // 강화는 직업 단위

    const unit: Unit = {
      id: nextId++, job, grade: gradeKey, gradeIndex: gIdx,
      baseAtk: Math.round(baseAtk), zoneId: zone.id,
      x: zone.cx, y: zone.cy, cooldown: 0, flash: 0,
      dir: 0, moveFrom: null, moveTo: null, moveElapsed: 0, moveDur: 0,
    };
    this.units.push(unit);
    this.placeInZone(unit, zone); // 구역 안 랜덤 배치 (겹침 허용)

    const rate = grade.summonRate;
    const verb = source === 'merge' ? '합성' : '소환';
    const text = source === 'merge'
      ? `🔨 ${JOB_KR[job]} ${grade.kr}등급 합성`
      : `${rate}% ${JOB_KR[job]} ${grade.kr}등급 소환`;
    if (gIdx >= GRADE_INDEX['mythic']) {
      this.mythicBanner = { text: `✨ ${JOB_KR[job]} ${grade.kr} 등급 ${verb}! ✨`, ttl: 4 };
      this.shake = Math.max(this.shake, 5);
    } else {
      this.pushLog(text);
    }
    this.addEffect({ type: 'summon', x: unit.x, y: unit.y, ttl: 0.5, color: grade.color, big: gIdx >= GRADE_INDEX['legendary'] });

    if (gradeKey === 'legendary') this.tryAchieve('firstLegendary');
    if (gradeKey === 'mythic') this.tryAchieve('firstMythic');
    if (gradeKey === 'eternal') this.tryAchieve('firstEternal');

    this.emit('roster', undefined);
    return unit;
  }

  private progress(stat: 'summons' | 'sells' | 'kills'): void {
    if (this.opts.track) addDailyProgress(stat, 1);
  }

  pushLog(text: string): void {
    this.log.unshift({ text, ttl: 10 });
    if (this.log.length > 6) this.log.pop();
  }

  tryAchieve(key: string): void {
    if (!this.opts.track) return;
    const a = unlockAchievement(key);
    if (a) this.emit('achievement', a);
  }

  upgradeCost(job: Job): number {
    const level = this.levels[job] || 1;
    return ECONOMY.upgradeStep * level;
  }

  // 직업 강화: 해당 직업의 모든 등급 유닛에 레벨이 적용된다.
  upgrade(job: Job): boolean {
    if (!this.units.some((u) => u.job === job)) return false;
    const cost = this.upgradeCost(job);
    if (this.gold < cost) return false;
    this.gold -= cost;
    this.levels[job] = (this.levels[job] || 1) + 1;
    this.emit('roster', undefined);
    return true;
  }

  sellOne(job: Job, gradeKey: GradeKey): boolean {
    const idx = this.units.findIndex((u) => u.job === job && u.grade === gradeKey);
    if (idx < 0) return false;
    const grade = GRADE_BY_KEY[gradeKey];
    this.gold += grade.sellGold;
    const [removed] = this.units.splice(idx, 1);
    this.sells += 1;
    this.progress('sells');
    // 구역이 비면 직업 해제 (남은 유닛은 각자 위치 유지)
    if (!this.units.some((u) => u.zoneId === removed.zoneId)) {
      const z = this.zones.find((z) => z.id === removed.zoneId);
      if (z) z.job = null;
    }
    this.emit('roster', undefined);
    return true;
  }

  // qty 만큼 판매 (ALL 은 Infinity). 판매한 개수 반환
  sellMany(job: Job, gradeKey: GradeKey, qty: number): number {
    let sold = 0;
    while (sold < qty && this.sellOne(job, gradeKey)) sold += 1;
    return sold;
  }

  countOf(job: Job, gradeKey: GradeKey): number {
    return this.units.reduce((n, u) => n + (u.job === job && u.grade === gradeKey ? 1 : 0), 0);
  }

  swapZones(idA: number, idB: number): void {
    const a = this.zones[idA], b = this.zones[idB];
    if (!a || !b) return;
    const tmp = a.job; a.job = b.job; b.job = tmp;
    for (const u of this.units) {
      if (u.zoneId === idA) u._newZone = idB;
      else if (u.zoneId === idB) u._newZone = idA;
    }
    for (const u of this.units) {
      if (u._newZone !== undefined) { u.zoneId = u._newZone; delete u._newZone; }
    }
    // 교환된 두 구역의 유닛을 새 구역 안의 임의 지점까지 걸어가게 한다
    for (const u of this.units) {
      if (u.zoneId === idA) this.startWalk(u, this.randomPointInZone(a));
      else if (u.zoneId === idB) this.startWalk(u, this.randomPointInZone(b));
    }
    this.emit('roster', undefined);
  }

  // 구역 삼각형 안의 임의 지점 좌표 계산 (유닛끼리 겹쳐도 됨)
  private randomPointInZone(zone: Zone): { x: number; y: number } {
    let r1 = Math.random(), r2 = Math.random();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; } // 삼각형 균등 샘플링
    const [p0, p1, p2] = zone.tri;
    const x = p0.x + r1 * (p1.x - p0.x) + r2 * (p2.x - p0.x);
    const y = p0.y + r1 * (p1.y - p0.y) + r2 * (p2.y - p0.y);
    // 가장자리 여백: 무게중심 쪽으로 살짝 당겨 스프라이트가 밖으로 안 나가게
    return { x: zone.cx + (x - zone.cx) * 0.82, y: zone.cy + (y - zone.cy) * 0.82 };
  }

  // 즉시 배치 (소환 시 최초 등장 - 걷는 모습을 보일 필요 없음)
  private placeInZone(u: Unit, zone: Zone): void {
    const p = this.randomPointInZone(zone);
    u.x = p.x; u.y = p.y;
  }

  // 목표 지점까지 걸어가는 트윈 시작 (구역 교환 시 사용)
  private startWalk(u: Unit, target: { x: number; y: number }, dur = 0.55): void {
    const dx = target.x - u.x, dy = target.y - u.y;
    if (Math.abs(dx) > Math.abs(dy)) u.dir = dx > 0 ? 2 : 1; // 좌/우
    else u.dir = dy > 0 ? 0 : 3;                              // 하/상
    u.moveFrom = { x: u.x, y: u.y };
    u.moveTo = target;
    u.moveElapsed = 0;
    u.moveDur = dur;
  }

  // 매 프레임 걷기 트윈 진행
  private updateUnitMovement(dt: number): void {
    for (const u of this.units) {
      if (!u.moveTo || !u.moveFrom) continue;
      u.moveElapsed += dt;
      const t = Math.min(1, u.moveElapsed / u.moveDur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      u.x = u.moveFrom.x + (u.moveTo.x - u.moveFrom.x) * e;
      u.y = u.moveFrom.y + (u.moveTo.y - u.moveFrom.y) * e;
      if (t >= 1) { u.x = u.moveTo.x; u.y = u.moveTo.y; u.moveFrom = null; u.moveTo = null; }
    }
  }

  // ---------------- 전투 헬퍼 ----------------
  unitLevel(u: Unit): number { return this.levels[u.job] || 1; }

  unitRange(u: { gradeIndex: number; job: Job }): number {
    return u.gradeIndex >= FULL_RANGE_FROM_INDEX ? Infinity : GRADE_RANGE[u.gradeIndex] * UNIT_BY_ID[u.job].rangeMult;
  }

  /** 컬렉션(영구) 레벨 */
  collectionLevel(job: Job): number { return this.opts.unitLevels[job] || 1; }

  unitDamage(u: Unit, mob: { race: Race; boss: boolean; kind?: MobKind }): number {
    const level = this.unitLevel(u);
    let dmg = u.baseAtk * (1 + (level - 1) * ECONOMY.upgradePerLevel);
    dmg *= UNIT_BY_ID[u.job].atkMult * (1 + (this.collectionLevel(u.job) - 1) * UNIT_LEVEL_ATK);
    dmg *= DMG_MULT[u.job][mob.race];
    // 성기사: 보스/정예 특화
    if (u.job === 'paladin' && u.gradeIndex >= SKILL_FROM_INDEX && (mob.boss || mob.kind === 'elite')) {
      const m = u.gradeIndex >= FULL_RANGE_FROM_INDEX ? SKILLS.paladin.bossMultHigh : SKILLS.paladin.bossMult;
      dmg *= 1 + (m - 1) * perkMult(this.collectionLevel(u.job));
    }
    dmg *= 1 + this.res('atk') * RESEARCH_PER.atk;
    if (mob.boss) dmg *= 1 + this.res('boss') * RESEARCH_PER.boss;
    return dmg;
  }

  private addEffect(e: Effect): void {
    if (this.effects.length < MAX_EFFECTS) this.effects.push(e);
  }

  // ---------------- 메인 업데이트 ----------------
  update(dtReal: number): void {
    if (this.over || this.paused) return;
    const dt = dtReal * this.speed;
    this.time += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dtReal * 30);

    for (const l of this.log) l.ttl -= dtReal;
    this.log = this.log.filter((l) => l.ttl > 0);
    if (this.mythicBanner) {
      this.mythicBanner.ttl -= dtReal;
      if (this.mythicBanner.ttl <= 0) this.mythicBanner = null;
    }

    this.updateWaveState(dt);
    this.updatePending(dt);
    this.updateMobs(dt);
    this.updateUnitMovement(dt);
    this.updateCombat(dt);
    this.updateEffects(dt);

    if (this.mobs.length > this.peakMobs) this.peakMobs = this.mobs.length;
    if (this.mobs.length >= WAVE.gameOverMobCount) this.gameOver('몹이 100마리를 넘었습니다');
  }

  updateWaveState(dt: number): void {
    if (this.waveState === 'rest') {
      this.restTimer -= dt;
      if (this.restTimer <= 0) this.startNextWave();
      return;
    }
    if (this.waveState === 'spawning') {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.spawnedCount < this.spawnGoal) {
        this.spawnMob();
        this.spawnedCount += 1;
        this.spawnTimer = WAVE.spawnInterval;
      }
      if (this.spawnedCount >= this.spawnGoal) {
        if (this.isBossWave) {
          this.waveState = 'waiting_boss';
        } else {
          this.waveState = 'rest';
          this.restTimer = WAVE.restBetween;
        }
      }
      return;
    }
    if (this.waveState === 'waiting_boss') {
      this.bossTimer -= dt;
      const bossAlive = this.mobs.some((m) => m.boss);
      if (!bossAlive) {
        if (!this.opts.stageId) this.tryAchieve(`clear${this.wave}`);
        if (this.wave >= this.totalWaves) { this.win(); return; }
        this.waveState = 'rest';
        this.restTimer = WAVE.restBetween;
      } else if (this.bossTimer <= 0) {
        this.gameOver('보스 제한시간 초과');
      }
    }
  }

  updateMobs(dt: number): void {
    const speedPx = 50 * (WAVE.mobSpeed / 1.2);
    for (const m of this.mobs) {
      if (m.hitFlash > 0) m.hitFlash -= dt;
      if (m.slow > 0) m.slow -= dt;
      if (m.pause > 0) { m.pause -= dt; continue; }
      const target = PATH.corners[m.seg];
      const dx = target.x - m.x, dy = target.y - m.y;
      const dist = Math.hypot(dx, dy);
      // 이동 방향으로 스프라이트 방향 결정 (0=하 1=좌 2=우 3=상)
      if (Math.abs(dx) > Math.abs(dy)) m.dir = dx > 0 ? 2 : 1;
      else m.dir = dy > 0 ? 0 : 3;
      const step = speedPx * m.speedMult * (m.slow > 0 ? 1 - m.slowPct : 1) * dt;
      if (dist <= step) {
        m.x = target.x; m.y = target.y;
        m.seg = (m.seg + 1) % PATH.corners.length;
        m.pause = WAVE.cornerPause;
      } else {
        m.x += (dx / dist) * step;
        m.y += (dy / dist) * step;
      }
    }
  }

  // 경로(사각 링) seg 번째 변에서 t(0~1) 위치의 좌표
  private pathPoint(seg: number, t: number): { x: number; y: number } {
    const c = PATH.corners;
    const a = c[seg % c.length], b = c[(seg + 1) % c.length];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  updateCombat(dt: number): void {
    for (const u of this.units) {
      if (u.flash > 0) u.flash -= dt;
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      const range = this.unitRange(u);
      let best: Mob | null = null;
      let bestD = Infinity;
      for (const m of this.mobs) {
        if (m.dead) continue;
        const d = Math.hypot(m.x - u.x, m.y - u.y);
        if (d <= range && d < bestD) { bestD = d; best = m; }
      }
      if (!best) continue;
      const crit = Math.random() < this.critChance(u);
      const dmg = this.unitDamage(u, best) * (crit ? SKILLS.critMult : 1);
      u.cooldown = UNIT_BY_ID[u.job].cooldown;
      u.flash = 0.1;
      this.emit('shoot', u.job);
      // 투사체: 거리에 비례한 비행 시간 (시각 전용)
      const dur = Math.min(0.22, 0.06 + bestD / 2600);
      this.addEffect({
        type: 'proj', x1: u.x, y1: u.y - 8, x2: best.x, y2: best.y,
        job: u.job, grade: u.gradeIndex, ttl: dur, dur,
      });
      this.hit(best, dmg, crit);

      // 직업 스킬 (정예 이상)
      if (u.gradeIndex >= SKILL_FROM_INDEX) this.applySkill(u, best, range);

      // 태초 등급: 몹 이동 경로(사각 링) 전체에 촘촘히 폭발 이펙트 (시각 전용 - 데미지는 단일 대상 그대로)
      if (u.gradeIndex === GRADE_INDEX['eternal'] && this.effects.length < 160) {
        const c = PATH.corners;
        for (let seg = 0; seg < c.length; seg++) {
          const a = c[seg], b = c[(seg + 1) % c.length];
          const count = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 48)); // ~48px 간격
          for (let k = 0; k < count; k++) {
            const t = Math.min(1, Math.max(0, (k + 0.5) / count + (Math.random() - 0.5) * 0.05));
            const p = this.pathPoint(seg, t);
            this.addEffect({ type: 'burst', x: p.x, y: p.y, ttl: 0.4, seed: Math.random() * Math.PI * 2 });
          }
        }
        this.shake = Math.max(this.shake, 2.5);
      }
    }
    if (this.mobs.some((m) => m.dead)) this.mobs = this.mobs.filter((m) => !m.dead);
  }

  // 단일 대상 피해 처리 + 데미지 숫자
  private hit(m: Mob, dmg: number, crit: boolean): void {
    if (m.dead) return;
    m.hp -= dmg;
    m.hitFlash = 0.12;
    // 데미지 숫자 (너무 많으면 생략해 성능/난잡함 방지)
    if (this.effects.length < 90 || crit) {
      this.addEffect({ type: 'dmg', x: m.x + (Math.random() - 0.5) * 14, y: m.y - m.size / 2, ttl: 0.7, value: Math.round(dmg), crit });
    }
    if (m.hp <= 0) this.killMob(m);
  }

  private critChance(u: Unit): number {
    if (u.job === 'ranger' && u.gradeIndex >= SKILL_FROM_INDEX) {
      const c = u.gradeIndex >= FULL_RANGE_FROM_INDEX ? SKILLS.ranger.critChanceHigh : SKILLS.ranger.critChance;
      return Math.min(0.8, c * perkMult(this.collectionLevel(u.job)));
    }
    return SKILLS.critChance;
  }

  // 범위 피해 (대상 제외)
  private splashAround(u: Unit, target: Mob, r: number, ratio: number): void {
    for (const m of this.mobs) {
      if (m === target || m.dead) continue;
      if (Math.hypot(m.x - target.x, m.y - target.y) <= r) this.hit(m, this.unitDamage(u, m) * ratio, false);
    }
  }

  private slowMob(m: Mob, pct: number, dur: number): void {
    if (m.dead) return;
    m.slowPct = m.slow > 0 ? Math.max(m.slowPct, pct) : pct;
    m.slow = Math.max(m.slow, dur);
  }

  private applySkill(u: Unit, target: Mob, range: number): void {
    const high = u.gradeIndex >= FULL_RANGE_FROM_INDEX; // 전설 이상 강화
    const perk = perkMult(this.collectionLevel(u.job));  // 컬렉션 Lv5/10 퍽
    switch (u.job) {
      case 'archer': {
        const n = (high ? SKILLS.archer.extraTargetsHigh : SKILLS.archer.extraTargets) + (perk > 1.5 ? 1 : 0);
        const others = this.mobs
          .filter((m) => m !== target && !m.dead && Math.hypot(m.x - u.x, m.y - u.y) <= range)
          .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))
          .slice(0, n);
        for (const m of others) {
          const dur = 0.12;
          this.addEffect({ type: 'proj', x1: u.x, y1: u.y - 8, x2: m.x, y2: m.y, job: u.job, grade: u.gradeIndex, ttl: dur, dur });
          this.hit(m, this.unitDamage(u, m) * SKILLS.archer.ratio * perk, false);
        }
        break;
      }
      case 'wizard': {
        const r = high ? SKILLS.wizard.radiusHigh : SKILLS.wizard.radius;
        this.addEffect({ type: 'splash', x: target.x, y: target.y, ttl: 0.35, r, color: '#b48cff' });
        this.splashAround(u, target, r, SKILLS.wizard.ratio * perk);
        break;
      }
      case 'bomber': {
        const r = high ? SKILLS.bomber.radiusHigh : SKILLS.bomber.radius;
        this.addEffect({ type: 'splash', x: target.x, y: target.y, ttl: 0.45, r, color: '#ff7a3d' });
        this.splashAround(u, target, r, SKILLS.bomber.ratio * perk);
        this.shake = Math.max(this.shake, 1.5);
        break;
      }
      case 'frost': {
        const r = high ? SKILLS.frost.radiusHigh : SKILLS.frost.radius;
        const pct = Math.min(0.7, (high ? SKILLS.frost.slowPctHigh : SKILLS.frost.slowPct) * (1 + (perk - 1) * 0.5));
        this.addEffect({ type: 'splash', x: target.x, y: target.y, ttl: 0.4, r, color: '#7fe0ff' });
        for (const m of this.mobs) {
          if (Math.hypot(m.x - target.x, m.y - target.y) <= r) this.slowMob(m, pct, SKILLS.frost.dur);
        }
        break;
      }
      case 'warrior': {
        const pct = Math.min(0.7, (high ? SKILLS.warrior.slowPctHigh : SKILLS.warrior.slowPct) * (1 + (perk - 1) * 0.5));
        this.slowMob(target, pct, SKILLS.warrior.dur);
        this.addEffect({ type: 'slash', x: target.x, y: target.y, ttl: 0.25, seed: Math.random() * Math.PI });
        break;
      }
      case 'assassin': {
        const th = (high ? SKILLS.assassin.executeHigh : SKILLS.assassin.execute) * perk;
        if (!target.dead && !target.boss && target.hp / target.maxHp <= th) {
          this.addEffect({ type: 'slash', x: target.x, y: target.y, ttl: 0.3, seed: Math.random() * Math.PI });
          this.hit(target, target.hp + 1, true);
        }
        break;
      }
      default:
        // ranger(치명타)·paladin(보스 피해)은 critChance/unitDamage 에서 처리
        if (u.job === 'paladin' || u.job === 'ranger') {
          this.addEffect({ type: 'slash', x: target.x, y: target.y, ttl: 0.2, seed: Math.random() * Math.PI });
        }
    }
  }

  killMob(m: Mob): void {
    if (m.dead) return;
    m.dead = true; // 배열 제거는 전투 루프 끝에서 일괄 처리
    const goldMult = 1 + this.res('goldGain') * RESEARCH_PER.goldGain;
    const base = m.boss ? ECONOMY.bossGold : m.kind === 'elite' ? ECONOMY.bossGold / 4 : ECONOMY.killGold;
    const gained = Math.round(base * goldMult);
    this.gold += gained;
    this.kills += 1;
    this.progress('kills');
    this.addEffect({ type: 'pop', x: m.x, y: m.y, ttl: m.boss ? 0.8 : 0.45, boss: m.boss, seed: Math.random() * 6.28 });
    if (m.boss || this.effects.length < 140) {
      this.addEffect({ type: 'gold', x: m.x, y: m.y - 10, ttl: 0.8, value: gained });
    }
    if (m.boss) this.shake = Math.max(this.shake, 14);
    this.emit('kill', m.boss);
  }

  updateEffects(dt: number): void {
    for (const e of this.effects) e.ttl -= dt;
    this.effects = this.effects.filter((e) => e.ttl > 0);
  }

  // ---------------- 종료 ----------------
  gameOver(reason: string): void {
    if (this.over) return;
    this.over = true;
    this.cleared = false;
    this.finish(reason);
  }
  win(): void {
    if (this.over) return;
    this.over = true;
    this.cleared = true;
    if (!this.opts.stageId) this.tryAchieve('clear50');
    this.finish(this.opts.stageId ? `스테이지 ${this.opts.stageId} 클리어!` : '50 웨이브 클리어!');
  }
  revived = false;
  /** 부활 (보상형 광고): 일반 몹 정리 + 보스 시간 연장. 판당 1회 */
  canRevive(): boolean {
    return this.over && !this.cleared && !this.isPvp && !this.revived;
  }
  revive(): boolean {
    if (!this.canRevive()) return false;
    this.revived = true;
    this.over = false;
    for (const m of this.mobs) if (!m.boss) this.addEffect({ type: 'pop', x: m.x, y: m.y, ttl: 0.45, boss: false, seed: Math.random() * 6.28 });
    this.mobs = this.mobs.filter((m) => m.boss);
    if (this.waveState === 'waiting_boss') this.bossTimer = Math.max(this.bossTimer, 45);
    this.shake = 12;
    this.pushLog('✨ 부활! 필드가 정리되었습니다');
    return true;
  }

  /** PvP 결과 확정 (상대 패배/이탈 시 승리, 서버 판정 등) */
  pvpEnd(won: boolean, reason: string): void {
    if (this.over) return;
    this.over = true;
    this.cleared = won;
    this.emit('gameover', { wave: this.wave, reason, cleared: won, pvp: { won }, peakMobs: this.peakMobs });
  }
  finish(reason: string): void {
    const d: GameOverData = { wave: this.wave, reason, cleared: this.cleared, peakMobs: this.peakMobs };
    if (this.isPvp) d.pvp = { won: false }; // PvP 에서 내 필드가 무너지면 패배
    this.emit('gameover', d);
  }

  // ---------------- UI 조회 헬퍼 ----------------
  // 직업+등급별 (판매 패널용)
  getStacks(): Stack[] {
    const map = new Map<string, Stack>();
    for (const u of this.units) {
      const key = `${u.job}_${u.grade}`;
      let s = map.get(key);
      if (!s) {
        s = { job: u.job, grade: u.grade, gradeIndex: u.gradeIndex, count: 0,
          level: this.levels[u.job] || 1, key };
        map.set(key, s);
      }
      s.count += 1;
    }
    return [...map.values()].sort((a, b) =>
      b.gradeIndex - a.gradeIndex || a.job.localeCompare(b.job));
  }

  // 직업별 (하단 강화 패널용) - 강화가 직업 단위이므로
  getJobStacks(): JobStack[] {
    const map = new Map<Job, JobStack>();
    for (const u of this.units) {
      let s = map.get(u.job);
      if (!s) {
        s = { job: u.job, count: 0, level: this.levels[u.job] || 1,
          topGrade: u.grade, topGradeIndex: u.gradeIndex };
        map.set(u.job, s);
      }
      s.count += 1;
      if (u.gradeIndex > s.topGradeIndex) { s.topGradeIndex = u.gradeIndex; s.topGrade = u.grade; }
    }
    return [...map.values()].sort((a, b) => a.job.localeCompare(b.job));
  }
}
