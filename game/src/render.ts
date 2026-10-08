// ============================================================
//  캔버스 렌더러
// ============================================================
import { MAP, Game } from './engine';
import { unitSprite, mobSprite, tileSprite } from './assets';
import { GRADES, UNIT_BY_ID } from './config';
import type { Job, Mob } from './types';

const JOB_TINT: Record<Job, string> = {
  archer: '#3fae4a', wizard: '#8e5bd8', warrior: '#c9a13b', ranger: '#3fa7c9',
  frost: '#7fe0ff', paladin: '#ffd54f', bomber: '#ff7a3d', assassin: '#a35bd8',
};

// 스프라이트 시트: 32x32 프레임, 3열(걷기) x 4행(하/좌/우/상)
const FRAME = 32;
const WALK_SEQ = [1, 0, 1, 2]; // 걷기 컬럼 순서 (1=정지 기준)
const ATTACK_SEQ = [1, 2, 0, 1]; // 공격 스윙 프레임 순서 (1=정지 기준)
const ATTACK_ANIM_DUR = 0.1;     // engine.ts 의 u.flash 초기값과 동일해야 함

// 타일 맵 설정 (16px 원본 타일 → TILE 크기로 스케일)
const TILE = 45; // 720 / 16
const GRASS_SRC = { sx: 16, sy: 80 }; // grass.png 의 채움 잔디 타일
const DIRT_SRC = { sx: 0, sy: 0 };    // dirt.png 의 채움 흙 타일
const PATH_INSET = 70;                // 경로 중심선 여백 (PATH.corners 와 동일)
const BAND_HALF = 30;                 // 흙길 밴드 반폭

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private game: Game;
  private t = 0; // 애니메이션 시계(초)
  private bg: HTMLCanvasElement | null = null; // 타일 배경 캐시 (매 프레임 2백여 장 drawImage 방지)

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.ctx = canvas.getContext('2d')!;
    this.game = game;
    canvas.width = MAP.size;
    canvas.height = MAP.size;
  }

  draw(): void {
    const ctx = this.ctx;
    this.t = performance.now() / 1000;
    ctx.imageSmoothingEnabled = false; // 픽셀 아트 선명하게
    ctx.clearRect(0, 0, MAP.size, MAP.size);
    ctx.save();
    const sh = this.game.shake;
    if (sh > 0.2) ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    this.drawBackground();
    this.drawZones();
    this.drawUnitAuras();
    this.drawMobs();
    this.drawUnits();
    this.drawEffects();
    this.drawDrag(); // 드래그 화살표는 최상단
    ctx.restore();
    this.drawBossBar();
  }

  // 타일 배경은 오프스크린에 한 번만 그려 재사용 (타일 로드 완료 후 캐시)
  private drawBackground(): void {
    if (this.bg) { this.ctx.drawImage(this.bg, 0, 0); return; }
    const ready = tileSprite('grass').ready && tileSprite('dirt').ready;
    if (!ready) { this.drawTiles(this.ctx); return; }
    const c = document.createElement('canvas');
    c.width = MAP.size; c.height = MAP.size;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    this.drawTiles(cx);
    this.decorate(cx);
    this.bg = c;
    this.ctx.drawImage(c, 0, 0);
  }

  // 배경 장식: 흙길 가장자리 그림자 + 필드 비네트
  private decorate(cx: CanvasRenderingContext2D): void {
    const o1 = PATH_INSET - BAND_HALF, i1 = PATH_INSET + BAND_HALF;
    const S = MAP.size;
    cx.save();
    cx.strokeStyle = 'rgba(60,40,20,0.35)';
    cx.lineWidth = 3;
    cx.strokeRect(o1, o1, S - o1 * 2, S - o1 * 2);
    cx.strokeRect(i1, i1, S - i1 * 2, S - i1 * 2);
    const g = cx.createRadialGradient(S / 2, S / 2, S * 0.25, S / 2, S / 2, S * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, S, S);
    cx.restore();
  }

  // 상단 보스 체력 바 (보스가 살아있을 때)
  private drawBossBar(): void {
    const boss = this.game.mobs.find((m) => m.boss);
    if (!boss) return;
    const ctx = this.ctx;
    const w = MAP.size * 0.62, h = 16, x = (MAP.size - w) / 2, y = 14;
    const ratio = Math.max(0, boss.hp / boss.maxHp);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    this.roundRect(x - 3, y - 3, w + 6, h + 6, 8); ctx.fill();
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#ff3b3b'); g.addColorStop(1, '#ff9f43');
    ctx.fillStyle = g;
    this.roundRect(x, y, w * ratio, h, 6); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`BOSS  ${Math.ceil(ratio * 100)}%   ⏱ ${Math.max(0, this.game.bossTimer).toFixed(0)}s`, MAP.size / 2, y + h / 2 + 1);
    ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (w <= 0) return;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 시트에서 (col,row) 프레임을 (dx,dy) 에 size 크기로 그린다
  private frame(img: CanvasImageSource, col: number, row: number, dx: number, dy: number, size: number): void {
    this.ctx.drawImage(img, col * FRAME, row * FRAME, FRAME, FRAME, dx, dy, size, size);
  }

  private walkCol(phase: number, period: number): number {
    return WALK_SEQ[Math.floor((this.t + phase) / period) % WALK_SEQ.length];
  }

  // flash(공격 발동 후 남은 시간, ATTACK_ANIM_DUR 에서 0으로 감소)를 스윙 프레임으로 변환
  private attackCol(flash: number): number {
    const progress = 1 - Math.max(0, Math.min(1, flash / ATTACK_ANIM_DUR));
    const idx = Math.min(ATTACK_SEQ.length - 1, Math.floor(progress * ATTACK_SEQ.length));
    return ATTACK_SEQ[idx];
  }

  // 잔디 필드 + 흙길 링을 타일로 그린다
  private drawTiles(ctx: CanvasRenderingContext2D): void {
    const grass = tileSprite('grass');
    const dirt = tileSprite('dirt');
    const n = Math.ceil(MAP.size / TILE);
    const o1 = PATH_INSET - BAND_HALF;         // 흙길 바깥 경계
    const i1 = PATH_INSET + BAND_HALF;          // 흙길 안쪽 경계
    const oFar = MAP.size - o1, iFar = MAP.size - i1;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        const cx = gx * TILE + TILE / 2, cy = gy * TILE + TILE / 2;
        const inOuter = cx >= o1 && cx <= oFar && cy >= o1 && cy <= oFar;
        const inInner = cx > i1 && cx < iFar && cy > i1 && cy < iFar;
        const isPath = inOuter && !inInner;    // 사각 링(흙길)
        const spr = isPath ? dirt : grass;
        const src = isPath ? DIRT_SRC : GRASS_SRC;
        if (spr.ready) {
          ctx.drawImage(spr.img, src.sx, src.sy, 16, 16, gx * TILE, gy * TILE, TILE, TILE);
        } else {
          ctx.fillStyle = isPath ? '#d3b183' : '#8bb04a';
          ctx.fillRect(gx * TILE, gy * TILE, TILE, TILE);
        }
      }
    }
  }

  private zonePath(i: number): void {
    const t = this.game.zones[i].tri;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(t[0].x, t[0].y);
    ctx.lineTo(t[1].x, t[1].y);
    ctx.lineTo(t[2].x, t[2].y);
    ctx.closePath();
  }

  private drawZones(): void {
    const ctx = this.ctx;
    const drag = this.game.drag;
    ctx.save();
    this.game.zones.forEach((zone, i) => {
      this.zonePath(i);
      const isFrom = drag?.from === i;
      const isTo = drag?.to === i;
      if (isFrom) {
        // 출발 구역: 밝게 들어올림
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
      } else if (isTo) {
        // 대상 구역: 금색 하이라이트 (교환 가능 표시)
        ctx.fillStyle = 'rgba(255,207,63,0.22)';
      } else if (drag) {
        // 드래그 중 나머지 구역은 살짝 어둡게 → 후보가 도드라짐
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
      } else {
        ctx.fillStyle = zone.job
          ? this.hexA(JOB_TINT[zone.job], 0.10)
          : 'rgba(255,255,255,0.02)';
      }
      ctx.fill();
      if (isFrom || isTo) {
        ctx.setLineDash([10, 6]);
        ctx.lineDashOffset = -this.t * 40; // 개미행렬 점선
        ctx.strokeStyle = isTo ? '#ffcf3f' : 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 4;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(20,20,20,0.18)';
        ctx.lineWidth = 2;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  }

  // 드래그 중: 출발 구역 중심 → 포인터 화살표
  private drawDrag(): void {
    const drag = this.game.drag;
    if (!drag) return;
    const ctx = this.ctx;
    const from = this.game.zones[drag.from];
    const dx = drag.x - from.cx, dy = drag.y - from.cy;
    const len = Math.hypot(dx, dy);
    if (len < 24) return; // 너무 짧으면 생략
    const ux = dx / len, uy = dy / len;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.cx, from.cy);
    ctx.lineTo(drag.x - ux * 16, drag.y - uy * 16);
    ctx.stroke();
    // 화살촉
    ctx.beginPath();
    ctx.moveTo(drag.x, drag.y);
    ctx.lineTo(drag.x - ux * 18 - uy * 9, drag.y - uy * 18 + ux * 9);
    ctx.lineTo(drag.x - ux * 18 + uy * 9, drag.y - uy * 18 - ux * 9);
    ctx.closePath();
    ctx.fill();
    // 교환 아이콘 (대상 구역 위)
    if (drag.to !== null) {
      const to = this.game.zones[drag.to];
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⇄', to.cx, to.cy);
    }
    ctx.restore();
  }

  private hexA(hex: string, a: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  private drawMobs(): void {
    const ctx = this.ctx;
    for (const m of this.game.mobs) {
      const s = m.size;
      // 발밑 그림자
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(m.x, m.y + s * 0.38, s * 0.32, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      this.drawMobAura(m);
      const spr = mobSprite(m.race);
      if (spr.ready) {
        const period = m.kind === 'fast' ? 0.1 : m.kind === 'tank' ? 0.22 : 0.16;
        const col = m.pause > 0 ? 1 : this.walkCol(m.id * 0.07, period); // 코너 정지 시 대기 프레임
        ctx.save();
        if (m.hitFlash > 0) ctx.globalAlpha = 0.65;
        this.frame(spr.img, col, m.dir, m.x - s / 2, m.y - s / 2, s);
        ctx.restore();
        // 상태 색 덧칠 (ctx.filter 는 사파리 미지원이라 source-atop 대신 반투명 원으로 표시)
        if (m.slow > 0 || m.kind === 'sent' || m.kind === 'elite') {
          ctx.fillStyle = m.slow > 0 ? 'rgba(120,200,255,0.28)' : 'rgba(255,70,40,0.22)';
          ctx.beginPath(); ctx.arc(m.x, m.y, s * 0.36, 0, Math.PI * 2); ctx.fill();
        }
        if (m.hitFlash > 0.06) {
          // 피격 순간 흰 번쩍임
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.35;
          this.frame(spr.img, col, m.dir, m.x - s / 2, m.y - s / 2, s);
          ctx.restore();
        }
      } else {
        ctx.fillStyle = m.boss ? '#b23' : '#357';
        ctx.beginPath(); ctx.arc(m.x, m.y, s / 2, 0, Math.PI * 2); ctx.fill();
      }
      const w = Math.max(28, s * 0.8), h = m.boss ? 6 : 4;
      const ratio = Math.max(0, m.hp / m.maxHp);
      const by = m.y - s / 2 - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(m.x - w / 2 - 1, by - 1, w + 2, h + 2);
      ctx.fillStyle = m.boss ? '#ff5252' : m.kind === 'elite' || m.kind === 'sent' ? '#ff8a3d' : ratio > 0.5 ? '#7ee87e' : ratio > 0.25 ? '#ffd54f' : '#ff7b7b';
      ctx.fillRect(m.x - w / 2, by, w * ratio, h);
      if (m.boss || m.kind === 'elite') {
        ctx.fillStyle = m.boss ? '#ffd54f' : '#ff8a3d';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        const label = m.boss ? 'BOSS' : 'ELITE';
        ctx.strokeText(label, m.x, by - 5);
        ctx.fillText(label, m.x, by - 5);
      }
    }
  }

  // 몹 종류별 표식: 탱커=방패 링, 빠름=잔상 선, 보스=붉은 오라
  private drawMobAura(m: Mob): void {
    const ctx = this.ctx;
    if (m.boss) {
      const r = m.size * 0.55 + Math.sin(this.t * 4) * 3;
      const g = ctx.createRadialGradient(m.x, m.y, r * 0.3, m.x, m.y, r);
      g.addColorStop(0, 'rgba(255,60,60,0.0)');
      g.addColorStop(1, 'rgba(255,60,60,0.35)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill();
    } else if (m.kind === 'tank') {
      ctx.strokeStyle = 'rgba(180,200,230,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.x, m.y + 2, m.size * 0.42, 0, Math.PI * 2); ctx.stroke();
    } else if (m.kind === 'fast' && m.pause <= 0) {
      const dx = m.dir === 1 ? 1 : m.dir === 2 ? -1 : 0;
      const dy = m.dir === 0 ? -1 : m.dir === 3 ? 1 : 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        const ox = dy !== 0 ? i * 8 : 0, oy = dx !== 0 ? i * 8 : 0;
        ctx.beginPath();
        ctx.moveTo(m.x + dx * 14 + ox, m.y + dy * 14 + oy);
        ctx.lineTo(m.x + dx * 28 + ox, m.y + dy * 28 + oy);
        ctx.stroke();
      }
    } else if (m.kind === 'elite') {
      ctx.strokeStyle = `rgba(255,138,61,${0.5 + Math.sin(this.t * 6) * 0.25})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.size * 0.5, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // 전설 이상 유닛 발밑 등급 오라 (유닛보다 먼저 그림)
  private drawUnitAuras(): void {
    const ctx = this.ctx;
    for (const u of this.game.units) {
      if (u.gradeIndex < 3) continue;
      const color = GRADES[u.gradeIndex].color;
      const pulse = 0.5 + Math.sin(this.t * 3 + u.id) * 0.2;
      ctx.fillStyle = this.hexA(color, 0.28 * pulse + 0.1);
      ctx.beginPath(); ctx.ellipse(u.x, u.y + 16, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
      if (u.gradeIndex >= 4) {
        ctx.strokeStyle = this.hexA(color, 0.7 * pulse);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(u.x, u.y + 16, 26, 10, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  private drawUnits(): void {
    const ctx = this.ctx;
    for (const u of this.game.units) {
      const spr = unitSprite(u.job, u.grade);
      const s = 45; // 30 → 1.5배
      if (spr.ready) {
        if (u.moveTo) {
          // 구역 교환 등으로 이동 중: 이동 방향 행 + 걷기 사이클 재생
          const col = this.walkCol(u.id * 0.09, 0.14);
          this.frame(spr.img, col, u.dir, u.x - s / 2, u.y - s / 2, s);
        } else {
          // 정지 상태: 정면(row 0). 공격 중일 때만 스윙, 그 외엔 고정 Idle 프레임
          const col = u.flash > 0 ? this.attackCol(u.flash) : 1;
          this.frame(spr.img, col, 0, u.x - s / 2, u.y - s / 2, s);
        }
      } else {
        ctx.fillStyle = JOB_TINT[u.job];
        ctx.fillRect(u.x - s / 2, u.y - s / 2, s, s);
      }
      if (u.flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(u.x - s / 2, u.y - s / 2, s, s);
      }
    }
  }

  private drawEffects(): void {
    const ctx = this.ctx;
    for (const e of this.game.effects) {
      switch (e.type) {
        case 'proj': this.drawProj(e); break;
        case 'pop': {
          const life = e.boss ? 0.8 : 0.45;
          const p = 1 - e.ttl / life;
          const alpha = Math.max(0, 1 - p);
          const r = p * (e.boss ? 70 : 26) + 4;
          ctx.strokeStyle = `rgba(255,240,150,${alpha})`;
          ctx.lineWidth = e.boss ? 5 : 3;
          ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
          // 파편
          const n = e.boss ? 14 : 6;
          ctx.fillStyle = `rgba(255,200,90,${alpha})`;
          for (let i = 0; i < n; i++) {
            const ang = e.seed + (i / n) * Math.PI * 2;
            const d = 6 + p * (e.boss ? 80 : 30);
            ctx.fillRect(e.x + Math.cos(ang) * d - 2, e.y + Math.sin(ang) * d - 2 + p * p * 12, 4, 4);
          }
          break;
        }
        case 'splash': {
          const p = 1 - e.ttl / 0.35;
          const alpha = Math.max(0, 1 - p);
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * (0.5 + p * 0.5));
          g.addColorStop(0, this.hexA(e.color, 0.45 * alpha));
          g.addColorStop(1, this.hexA(e.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = this.hexA(e.color, alpha);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.4 + p * 0.6), 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'slash': {
          const p = 1 - e.ttl / 0.25;
          ctx.save();
          ctx.translate(e.x, e.y);
          ctx.rotate(e.seed);
          ctx.strokeStyle = `rgba(255,240,200,${1 - p})`;
          ctx.lineWidth = 5 * (1 - p) + 1;
          ctx.beginPath(); ctx.arc(0, 0, 22, -0.9 + p * 0.6, 0.9 + p * 0.6); ctx.stroke();
          ctx.restore();
          break;
        }
        case 'merge': {
          const p = 1 - e.ttl / 0.7;
          ctx.strokeStyle = this.hexA(e.color, 1 - p);
          ctx.lineWidth = 4;
          for (let k = 0; k < 2; k++) {
            ctx.beginPath(); ctx.arc(e.x, e.y, 10 + p * (50 + k * 25), 0, Math.PI * 2); ctx.stroke();
          }
          ctx.fillStyle = this.hexA(e.color, (1 - p) * 0.8);
          for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2 + p * 2;
            const d = 40 * (1 - p);
            ctx.beginPath(); ctx.arc(e.x + Math.cos(ang) * d, e.y + Math.sin(ang) * d, 3, 0, Math.PI * 2); ctx.fill();
          }
          break;
        }
        case 'summon': {
          const p = 1 - e.ttl / 0.5;
          // 기둥 빛
          const h = (e.big ? 120 : 70) * (1 - p * 0.5);
          const g = ctx.createLinearGradient(0, e.y - h, 0, e.y + 16);
          g.addColorStop(0, this.hexA(e.color, 0));
          g.addColorStop(1, this.hexA(e.color, 0.55 * (1 - p)));
          ctx.fillStyle = g;
          ctx.fillRect(e.x - (e.big ? 18 : 12), e.y - h, e.big ? 36 : 24, h + 16);
          ctx.strokeStyle = this.hexA(e.color, 1 - p);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(e.x, e.y + 16, 10 + p * 22, 4 + p * 8, 0, 0, Math.PI * 2); ctx.stroke();
          break;
        }
        case 'burst': this.drawBurst(e); break;
        case 'dmg': {
          const p = 1 - e.ttl / 0.7;            // 0→1 진행
          const alpha = Math.max(0, Math.min(1, (e.ttl / 0.7) * 1.6));
          ctx.globalAlpha = alpha;
          const size = e.crit ? 24 + (p < 0.15 ? (0.15 - p) * 60 : 0) : 17;
          ctx.font = `bold ${size}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.75)';
          ctx.fillStyle = e.crit ? '#ff6b3d' : '#ffe066';
          const ty = e.y - p * 28;
          const text = e.crit ? `${this.short(e.value)}!` : this.short(e.value);
          ctx.strokeText(text, e.x, ty);
          ctx.fillText(text, e.x, ty);
          ctx.globalAlpha = 1;
          break;
        }
        case 'gold': {
          const p = 1 - e.ttl / 0.8;
          ctx.globalAlpha = Math.max(0, 1 - p * p);
          ctx.font = 'bold 15px sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.fillStyle = '#ffcf3f';
          const ty = e.y - 14 - p * 22;
          ctx.strokeText(`+${e.value}🪙`, e.x, ty);
          ctx.fillText(`+${e.value}🪙`, e.x, ty);
          ctx.globalAlpha = 1;
          break;
        }
      }
    }
  }

  // 큰 수 축약 (12.3K, 4.5M)
  private short(v: number): string {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    return String(v);
  }

  // 직업별 투사체: 궁수=화살, 마법사=마력구, 전사=검기
  private drawProj(e: Extract<import('./types').Effect, { type: 'proj' }>): void {
    const ctx = this.ctx;
    const p = 1 - e.ttl / e.dur; // 0→1 비행 진행
    const x = e.x1 + (e.x2 - e.x1) * p;
    const y = e.y1 + (e.y2 - e.y1) * p;
    const ang = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
    const color = e.grade === 0 ? JOB_TINT[e.job] : GRADES[e.grade]?.color ?? '#fff';
    const base = UNIT_BY_ID[e.job].base;
    ctx.save();
    if (base === 'archer') {
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.strokeStyle = this.hexA(color, 0.5);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-6, 0); ctx.stroke(); // 궤적
      ctx.strokeStyle = '#f5e6c8';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = '#ddd';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(3, -3); ctx.lineTo(3, 3); ctx.closePath(); ctx.fill();
    } else if (base === 'wizard') {
      const r = (e.job === 'bomber' ? 8 : 5) + e.grade * 0.8;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.35, this.hexA(color, 0.85));
      g.addColorStop(1, 'rgba(142,91,216,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.strokeStyle = this.hexA(color, 0.9);
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(-6, 0, 12, -1.1, 1.1); ctx.stroke();
    }
    ctx.restore();
  }

  private drawBurst(e: Extract<import('./types').Effect, { type: 'burst' }>): void {
    const ctx = this.ctx;
    // 태초 등급 타격 폭발: 확장 링 2겹 + 방사형 파편
    const p = 1 - e.ttl / 0.45;                    // 0→1 진행
    const alpha = Math.max(0, 1 - p);
    const r = 8 + p * 46;
    ctx.save();
    ctx.strokeStyle = `rgba(255,110,40,${alpha})`;
    ctx.lineWidth = 4 * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = `rgba(255,230,120,${alpha})`;
    ctx.lineWidth = 2.5 * (1 - p) + 0.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.55, 0, Math.PI * 2); ctx.stroke();
    if (p < 0.35) {
      ctx.fillStyle = `rgba(255,255,220,${(1 - p / 0.35) * 0.9})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, 10 * (1 - p / 0.35) + 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = `rgba(255,170,60,${alpha})`;
    for (let i = 0; i < 6; i++) {
      const ang = e.seed + (i / 6) * Math.PI * 2;
      const d = 10 + p * 40;
      const size = 3.5 * (1 - p) + 0.5;
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(ang) * d, e.y + Math.sin(ang) * d, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
