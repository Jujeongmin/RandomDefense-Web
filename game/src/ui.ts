// ============================================================
//  게임 화면 DOM UI - 상단바/소환/강화/합성·판매/소환권/PvP HUD/결과/튜토리얼
// ============================================================
import {
  JOB_KR, RACE_KR, GRADES, DMG_MULT, ECONOMY, WAVE, PVP, SKILL_KR, GRADE_INDEX, MERGE_COUNT,
} from './config';
import { MAP, Game, type BoardSnapshot } from './engine';
import { mobPortraitSrc, unitIconUrl } from './assets';
import { meta, useItem } from './meta';
import { audio } from './audio';
import { $, toast, spriteIcon } from './dom';
import type { Job, Race, GradeKey } from './types';

// 상성 % 색상
function pctColor(pct: number): string {
  if (pct >= 100) return '#7ee87e';
  if (pct >= 80) return '#ffd54f';
  return '#ff7b7b';
}

export interface UIContext {
  kind: 'stage' | 'endless' | 'pvp';
  stageId?: string;
  onExit: () => void;
}

export interface ResultView {
  win: boolean;
  title: string;
  sub: string;
  stars?: number;
  rewards: string[];
  unlocked?: Job;
  extraHtml?: string;
  buttons: { label: string; cls: string; action: () => void; id?: string }[];
}

export class UI {
  private game: Game;
  private ctx: UIContext;
  private speeds: number[];
  private speedIdx = 0;
  private lastRace: Race | null = null;
  private lastMergeKey = '';
  private lastTickets = '';
  private sellOpen: (() => void) | null = null;
  private coachTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(game: Game, ctx: UIContext) {
    this.game = game;
    this.ctx = ctx;
    const pvp = ctx.kind === 'pvp';
    // 3배속은 광고제거 패키지 보유 시 해금 (상점). PvP 는 1배속 고정
    this.speeds = pvp ? [1] : meta.adRemoved ? [1, 2, 3] : [1, 2];
    this.bind();
    game.on('roster', () => { this.renderStacks(); this.sellOpen?.(); });
    game.on('achievement', (a) => toast(`🏅 업적 달성: ${a.kr} (+${a.reward}💎)`));
    game.on('shoot', (job) => audio.attack(job === 'archer' || job === 'ranger' ? 'archer' : job === 'wizard' || job === 'frost' || job === 'bomber' ? 'wizard' : 'warrior'));
    game.on('kill', (boss) => audio.kill(boss));
    game.on('bossSpawn', () => { audio.boss(); if (!pvp) audio.switchBgm('boss'); });
    game.on('wave', () => { if (!pvp && !game.isBossWave) audio.switchBgm('battle'); });
    game.on('merge', () => audio.merge());
    game.on('attack', () => audio.sendAttack());
    game.on('incoming', () => audio.incoming());

    $('pvp-hud').classList.toggle('hidden', !pvp);
    $('attack-row').classList.toggle('hidden', !pvp);
    $('btn-speed').classList.toggle('hidden', pvp);
    $('btn-pause').classList.toggle('hidden', pvp);
    $('btn-speed').textContent = '1x';
    $('btn-pause').textContent = '❚❚';
    $('stage-label').textContent = ctx.kind === 'stage' ? `스테이지 ${ctx.stageId}` : ctx.kind === 'endless' ? '무한 모드' : 'PvP';
    PVP.attacks.forEach((a, i) => { $(`btn-attack-${i}`).querySelector('span')!.textContent = `🪙${a.cost}`; });
    $('sell-panel').classList.add('hidden');
    $('coach').classList.add('hidden');
    $('countdown').classList.add('hidden');
    this.renderStacks();
    this.renderTickets();
  }

  private bind(): void {
    $('btn-summon').onclick = () => {
      const u = this.game.summon();
      if (u) audio.summon(u.gradeIndex >= GRADE_INDEX['mythic']);
      else if (this.game.gold < ECONOMY.summonCost) this.flashGold();
    };
    $('btn-pause').onclick = () => {
      audio.button();
      this.game.paused = !this.game.paused;
      $('btn-pause').textContent = this.game.paused ? '▶' : '❚❚';
    };
    $('btn-speed').onclick = () => {
      audio.button();
      if (this.speeds.length === 2 && this.speedIdx === 1 && !meta.adRemoved) toast('3배속은 광고 제거 패키지로 해금돼요');
      this.speedIdx = (this.speedIdx + 1) % this.speeds.length;
      this.game.speed = this.speeds[this.speedIdx];
      $('btn-speed').textContent = this.game.speed + 'x';
    };
    $('btn-sell-panel').onclick = () => { audio.button(); this.openHeroes(); };
    $('btn-menu').onclick = () => { audio.button(); this.ctx.onExit(); };
    $('btn-mute').onclick = () => {
      const muted = audio.toggleMute();
      $('btn-mute').textContent = muted ? '🔇' : '🔊';
    };
    $('btn-mute').textContent = audio.isMuted() ? '🔇' : '🔊';
    ([0, 1] as const).forEach((tier) => {
      $(`btn-attack-${tier}`).onclick = () => {
        if (!this.game.sendAttack(tier)) this.flashGold();
      };
    });
    this.bindDebug();
    this.setupDrag();
  }

  // 개발 서버에서만 노출되는 테스트용 버튼 (배포 빌드엔 표시 안 됨)
  private bindDebug(): void {
    if (!import.meta.env.DEV) return;
    $('debug-panel').classList.remove('hidden');
    $('debug-mythic').onclick = () => { if (this.game.summonFree('mythic')) audio.summon(true); };
    $('debug-eternal').onclick = () => { if (this.game.summonFree('eternal')) audio.summon(true); };
    $('debug-gold').onclick = () => { this.game.gold += 500; };
  }

  // ---------- 매 프레임 갱신 ----------
  update(): void {
    const g = this.game;
    const total = g.totalWaves;
    $('wave-label').textContent = total === Infinity ? `Wave ${Math.max(1, g.wave)}` : `Wave ${Math.max(1, Math.min(g.wave, total))}/${total}`;
    $('mob-race').textContent = RACE_KR[g.currentRace];
    const portrait = $('mob-portrait');
    if (portrait.dataset.race !== g.currentRace) {
      portrait.dataset.race = g.currentRace;
      portrait.style.backgroundImage = `url(${mobPortraitSrc(g.currentRace)})`;
    }
    if (this.lastRace !== g.currentRace) {
      this.lastRace = g.currentRace;
      this.renderStacks();
    }

    $('gold-amount').textContent = String(Math.floor(g.gold));

    const pct = Math.min(100, (g.mobs.length / WAVE.gameOverMobCount) * 100);
    const fill = $('mob-progress-fill');
    fill.style.width = pct + '%';
    fill.classList.toggle('warn', pct >= 70);
    $('mob-count-label').textContent = `${g.mobs.length} / ${WAVE.gameOverMobCount}`;

    const bt = $('boss-timer');
    if (g.waveState === 'waiting_boss' || (g.isBossWave && g.waveState === 'spawning')) {
      bt.classList.remove('hidden');
      bt.textContent = `⏱ ${g.bossTimer.toFixed(1)}s`;
    } else {
      bt.classList.add('hidden');
    }

    $('summon-log').innerHTML = g.log.map((l) => `<div>${l.text}</div>`).join('');

    const banner = $('mythic-banner');
    if (g.mythicBanner) {
      banner.classList.remove('hidden');
      banner.textContent = g.mythicBanner.text;
    } else {
      banner.classList.add('hidden');
    }

    ($('btn-summon') as HTMLButtonElement).disabled = g.gold < ECONOMY.summonCost || g.over;
    if (g.isPvp) {
      ([0, 1] as const).forEach((t) => { ($(`btn-attack-${t}`) as HTMLButtonElement).disabled = g.gold < g.attackCost(t) || g.over; });
    }
    // 합성 가능 상태가 바뀌면 카드/점 갱신 (매 프레임 DOM 재생성 방지)
    const mk = g.mergeable().map((m) => m.job + m.grade).join(',');
    if (mk !== this.lastMergeKey) {
      this.lastMergeKey = mk;
      $('merge-dot').classList.toggle('hidden', !mk);
      this.renderStacks();
    }
    // 강화 버튼 활성 상태는 골드에 따라 변하므로 가볍게 갱신
    document.querySelectorAll<HTMLButtonElement>('#unit-stacks .up-btn').forEach((b) => {
      const job = b.dataset.job as Job;
      b.disabled = !g.units.some((u) => u.job === job) || g.gold < g.upgradeCost(job);
    });
  }

  private flashGold(): void {
    const el = $('gold-badge');
    el.style.transition = 'transform 0.1s';
    el.style.transform = 'scale(1.3)';
    el.style.color = '#ff5252';
    setTimeout(() => { el.style.transform = ''; el.style.color = ''; }, 150);
  }

  // ---------- 소환권 (일반 모드 전용) ----------
  renderTickets(): void {
    const row = $('ticket-row');
    if (this.ctx.kind === 'pvp') { row.innerHTML = ''; return; }
    const key = `${meta.items.summonTicket}:${meta.items.mythicTicket}`;
    if (key === this.lastTickets) return;
    this.lastTickets = key;
    const chips: string[] = [];
    if (meta.items.summonTicket > 0) chips.push(`<button class="ticket-chip" data-t="summonTicket">🎟️ 무료 소환 ×${meta.items.summonTicket}</button>`);
    if (meta.items.mythicTicket > 0) chips.push(`<button class="ticket-chip mythic" data-t="mythicTicket">🌟 신화 확정 ×${meta.items.mythicTicket}</button>`);
    row.innerHTML = chips.join('');
    row.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => {
      b.onclick = () => {
        if (this.game.over) return;
        const t = b.dataset.t as 'summonTicket' | 'mythicTicket';
        if (!useItem(t)) return;
        const u = this.game.summonFree(t === 'mythicTicket' ? 'mythic' : undefined);
        if (u) audio.summon(u.gradeIndex >= GRADE_INDEX['mythic']);
        this.renderTickets();
      };
    });
  }

  // ---------- 하단 유닛 카드 (덱 순서, 직업 단위 강화) ----------
  renderStacks(): void {
    const el = $('unit-stacks');
    const deck = this.game.opts.deck;
    const merges = new Set(this.game.mergeable().map((m) => m.job));
    el.innerHTML = '';
    for (const job of deck) {
      const units = this.game.units.filter((u) => u.job === job);
      const count = units.length;
      const top = units.reduce((g, u) => Math.max(g, u.gradeIndex), 0);
      const level = this.game.levels[job] || 1;
      const cost = this.game.upgradeCost(job);
      const p = Math.round(DMG_MULT[job][this.game.currentRace] * 100);
      const div = document.createElement('div');
      div.className = `stack${count ? '' : ' empty'}`;
      div.style.borderColor = count ? GRADES[top].color : '';
      div.innerHTML = `
        ${merges.has(job) ? '<div class="merge-tag">합성!</div>' : ''}
        <div class="count">${count}</div>
        <div class="dmg-pct" style="color:${pctColor(p)}">${p}%</div>
        ${spriteIcon(unitIconUrl(job, top))}
        <div class="name">${JOB_KR[job]} Lv.${level}</div>
        <div class="skill">${SKILL_KR[job]}</div>
        <button class="up-btn" data-job="${job}">강화 🪙${cost}</button>`;
      const btn = div.querySelector('.up-btn') as HTMLButtonElement;
      btn.disabled = count === 0 || this.game.gold < cost;
      btn.onclick = () => { if (this.game.upgrade(job)) audio.button(); };
      div.onclick = (e) => { if (e.target !== btn && merges.has(job)) this.openHeroes(job, 'merge'); };
      el.appendChild(div);
    }
  }

  // ---------- 영웅 관리 (합성 / 판매) ----------
  private openHeroes(startJob?: Job, startMode?: 'merge' | 'sell'): void {
    const panel = $('sell-panel');
    const g = this.game;
    const jobs = (): Job[] => {
      const set = new Set<Job>(g.opts.deck);
      for (const u of g.units) set.add(u.job);
      return [...set];
    };
    let job: Job = startJob ?? g.mergeable()[0]?.job ?? jobs()[0];
    let mode: 'merge' | 'sell' = startMode ?? (g.mergeable().length ? 'merge' : 'sell');
    let qty = 1; // 판매 수량 1 | 10 | Infinity(ALL)
    let firstOpen = true;
    const render = () => {
      const mergeJobs = new Set(g.mergeable().map((m) => m.job));
      const cards = GRADES.map((gr, gi) => {
        const cnt = g.countOf(job, gr.key);
        if (mode === 'merge') {
          const can = g.canMerge(job, gr.key);
          const isTop = gi === GRADES.length - 1;
          return `<div class="grade-card${can ? ' ready' : ''}${cnt === 0 ? ' empty' : ''}" data-grade="${gr.key}">
            <div class="gc-name" style="color:${gr.color}">${gr.kr}</div>
            ${spriteIcon(unitIconUrl(job, gi))}
            <div class="gc-count">${cnt}/${MERGE_COUNT}</div>
            <div class="gc-gold" style="color:${isTop ? '#888' : GRADES[gi + 1].color}">${isTop ? '최고' : `→${GRADES[gi + 1].kr}`}</div>
          </div>`;
        }
        const sellQty = qty === Infinity ? cnt : Math.min(qty, cnt);
        return `<div class="grade-card${cnt === 0 ? ' empty' : ''}" data-grade="${gr.key}">
          <div class="gc-name" style="color:${gr.color}">${gr.kr}</div>
          ${spriteIcon(unitIconUrl(job, gi))}
          <div class="gc-count">${cnt}</div>
          <div class="gc-gold">+${sellQty * gr.sellGold}</div>
        </div>`;
      }).join('');
      panel.innerHTML = `
        <div class="dialog sell-dialog${firstOpen ? ' anim' : ''}">
          <button class="close-x">✕</button>
          <div class="sell-head">
            <h2>영웅 관리</h2>
            ${mode === 'sell' ? `<div class="qty-row">
              <button data-qty="1" class="${qty === 1 ? 'active' : ''}">1</button>
              <button data-qty="10" class="${qty === 10 ? 'active' : ''}">10</button>
              <button data-qty="all" class="${qty === Infinity ? 'active' : ''}">ALL</button></div>` : ''}
          </div>
          <div class="mode-tabs">
            <button data-mode="merge" class="merge ${mode === 'merge' ? 'active' : ''}">🔨 합성${mergeJobs.size ? ' •' : ''}</button>
            <button data-mode="sell" class="sell ${mode === 'sell' ? 'active' : ''}">🪙 판매</button>
          </div>
          <div class="sell-hint">${mode === 'merge' ? `같은 유닛·등급 ${MERGE_COUNT}개 → 상위 등급 1개 (카드를 탭)` : '골드가 급할 때 판매해 소환/강화에 투자하세요'}</div>
          <div class="grade-row">${cards}</div>
          <div class="job-tabs">
            ${jobs().map((j) => `<button data-job="${j}" class="${j === job ? 'active' : ''}">${JOB_KR[j]}${mergeJobs.has(j) ? '<span class="dot"></span>' : ''}</button>`).join('')}
          </div>
        </div>`;
      firstOpen = false;
      panel.querySelectorAll<HTMLButtonElement>('[data-qty]').forEach((b) => {
        b.onclick = () => { const v = b.dataset.qty; qty = v === 'all' ? Infinity : Number(v); render(); };
      });
      panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
        b.onclick = () => { mode = b.dataset.mode as 'merge' | 'sell'; render(); };
      });
      panel.querySelectorAll<HTMLButtonElement>('[data-job]').forEach((b) => {
        b.onclick = () => { job = b.dataset.job as Job; render(); };
      });
      panel.querySelectorAll<HTMLElement>('[data-grade]').forEach((b) => {
        b.onclick = () => {
          const gk = b.dataset.grade as GradeKey;
          if (mode === 'merge') {
            if (!g.merge(job, gk)) toast(`같은 등급 ${MERGE_COUNT}개가 필요해요`);
          } else if (g.sellMany(job, gk, qty) > 0) {
            audio.coin();
          }
          render();
        };
      });
      (panel.querySelector('.close-x') as HTMLElement).onclick = close;
    };
    const close = () => { panel.classList.add('hidden'); this.sellOpen = null; };
    this.sellOpen = render;
    render();
    panel.onclick = (e) => { if (e.target === panel) close(); };
    panel.classList.remove('hidden');
  }

  // ---------- PvP: 상대 상태 ----------
  setOpponentInfo(nick: string, trophies: number, bot: boolean): void {
    $('opp-nick').textContent = nick + (bot ? ' 🤖' : '');
    $('opp-trophy').textContent = `🏆${trophies}`;
  }

  setOpponent(s: BoardSnapshot): void {
    const pct = Math.min(100, (s.mobCount / WAVE.gameOverMobCount) * 100);
    $('opp-fill').style.width = pct + '%';
    $('opp-count').textContent = `${s.mobCount} / ${WAVE.gameOverMobCount}`;
    $('opp-sub').textContent = `Wave ${s.wave} · 유닛 ${s.unitCount}${s.bossHp >= 0 ? ` · 보스 ${Math.round(s.bossHp * 100)}%` : ''}`;
    // 미니맵: 흙길 링 + 몹 점 + 유닛 구역 표시
    const c = $<HTMLCanvasElement>('opp-canvas');
    const ctx = c.getContext('2d')!;
    const W = c.width;
    ctx.fillStyle = '#4f7a2e';
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = '#b8935f';
    ctx.lineWidth = 6;
    const inset = (70 / MAP.size) * W;
    ctx.strokeRect(inset, inset, W - inset * 2, W - inset * 2);
    const zoneCenters = [[0.5, 0.3], [0.7, 0.5], [0.5, 0.7], [0.3, 0.5]];
    for (let i = 0; i + 1 < s.units.length; i += 2) {
      const [zx, zy] = zoneCenters[s.units[i]] ?? [0.5, 0.5];
      ctx.fillStyle = GRADES[s.units[i + 1]]?.color ?? '#fff';
      ctx.fillRect(zx * W - 2 + ((i * 7) % 9) - 4, zy * W - 2 + ((i * 3) % 9) - 4, 3, 3);
    }
    ctx.fillStyle = '#ff4a4a';
    for (let i = 0; i + 1 < s.mobs.length; i += 2) {
      ctx.fillRect((s.mobs[i] / 255) * W - 1.5, (s.mobs[i + 1] / 255) * W - 1.5, 3, 3);
    }
  }

  // ---------- 카운트다운 ----------
  countdown(startAt: number, onGo: () => void): void {
    const el = $('countdown');
    el.classList.remove('hidden');
    const tick = () => {
      const left = (startAt - Date.now()) / 1000;
      if (left <= 0) {
        el.innerHTML = 'GO!';
        audio.sendAttack();
        onGo();
        setTimeout(() => el.classList.add('hidden'), 500);
        return;
      }
      el.innerHTML = `${Math.ceil(left)}<small>${this.ctx.kind === 'pvp' ? '몹을 보내 상대를 무너뜨리세요!' : ''}</small>`;
      setTimeout(tick, 100);
    };
    tick();
  }

  // ---------- 튜토리얼 코치 ----------
  coach(text: string | null, targetId?: string): void {
    document.querySelectorAll('.coach-target').forEach((e) => e.classList.remove('coach-target'));
    const el = $('coach');
    if (this.coachTimer) { clearTimeout(this.coachTimer); this.coachTimer = null; }
    if (!text) { el.classList.add('hidden'); return; }
    el.innerHTML = text;
    el.classList.remove('hidden');
    if (targetId) document.getElementById(targetId)?.classList.add('coach-target');
  }

  // ---------- 결과 ----------
  showResult(v: ResultView): void {
    this.coach(null);
    $('sell-panel').classList.add('hidden');
    const panel = $('gameover-panel');
    const stars = v.stars !== undefined
      ? `<div class="stars">${[0, 1, 2].map((i) => `<span class="${i < v.stars! ? '' : 'off'}">⭐</span>`).join('')}</div>` : '';
    const unlock = v.unlocked ? `<div class="unlock">${spriteIcon(unitIconUrl(v.unlocked, 2))}
      <div><div style="font-size:18px">🎉 새 유닛 해금: ${JOB_KR[v.unlocked]}</div><div class="fine" style="text-align:left">로비 → 유닛에서 덱에 편성하세요</div></div></div>` : '';
    panel.innerHTML = `<div class="dialog result">
      <h2 class="${v.win ? 'win' : 'lose'}">${v.title}</h2>
      ${stars}
      <div class="sub">${v.sub}</div>
      <div class="rewards">${v.rewards.map((r) => `<div class="rw">${r}</div>`).join('')}</div>
      ${unlock}${v.extraHtml ?? ''}
      <div class="btns">${v.buttons.map((b, i) => `<button class="btn ${b.cls}" data-i="${i}" ${b.id ? `id="${b.id}"` : ''}>${b.label}</button>`).join('')}</div>
    </div>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) => {
      b.onclick = () => { audio.button(); v.buttons[Number(b.dataset.i)].action(); };
    });
    panel.classList.remove('hidden');
  }

  hideResult(): void {
    $('gameover-panel').classList.add('hidden');
  }

  // ---------- 존 교환 드래그 ----------
  private setupDrag(): void {
    const canvas = $<HTMLCanvasElement>('game-canvas');
    let startZone: number | null = null;
    const toLogical = (e: MouseEvent | TouchEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      const te = e as TouchEvent;
      const pt = (te.touches && te.touches[0]) || (te.changedTouches && te.changedTouches[0]) || (e as MouseEvent);
      const cx = pt.clientX - rect.left;
      const cy = pt.clientY - rect.top;
      const scale = Math.min(rect.width / MAP.size, rect.height / MAP.size);
      const dispW = MAP.size * scale, dispH = MAP.size * scale;
      const offX = (rect.width - dispW) / 2, offY = (rect.height - dispH) / 2;
      return { x: (cx - offX) / scale, y: (cy - offY) / scale };
    };
    const zoneAt = (p: { x: number; y: number }): number | null => {
      const center = MAP.size / 2;
      const dx = p.x - center, dy = p.y - center;
      if (Math.abs(dx) > MAP.size / 2 || Math.abs(dy) > MAP.size / 2) return null;
      if (dy < 0 && Math.abs(dx) < Math.abs(dy)) return 0;
      if (dx > 0 && Math.abs(dy) < Math.abs(dx)) return 1;
      if (dy > 0 && Math.abs(dx) < Math.abs(dy)) return 2;
      if (dx < 0 && Math.abs(dy) < Math.abs(dx)) return 3;
      return null;
    };
    // 캔버스는 게임마다 재사용되므로 이전 핸들러를 덮어쓴다 (on* 프로퍼티)
    const down = (e: MouseEvent | TouchEvent) => {
      const p = toLogical(e);
      startZone = zoneAt(p);
      if (startZone !== null) this.game.drag = { from: startZone, to: null, x: p.x, y: p.y };
    };
    const move = (e: MouseEvent | TouchEvent) => {
      if (startZone === null || !this.game.drag) return;
      const p = toLogical(e);
      const z = zoneAt(p);
      this.game.drag.x = p.x;
      this.game.drag.y = p.y;
      this.game.drag.to = z !== null && z !== startZone ? z : null;
    };
    const up = (e: MouseEvent | TouchEvent) => {
      if (startZone === null) return;
      const endZone = zoneAt(toLogical(e));
      if (endZone !== null && endZone !== startZone) { this.game.swapZones(startZone, endZone); audio.button(); }
      startZone = null;
      this.game.drag = null;
    };
    const cancel = () => { startZone = null; this.game.drag = null; };
    canvas.onmousedown = down;
    canvas.onmousemove = move;
    canvas.onmouseup = up;
    canvas.onmouseleave = cancel;
    canvas.ontouchstart = down;
    canvas.ontouchmove = move;
    canvas.ontouchend = up;
    canvas.ontouchcancel = cancel;
  }
}
