// ============================================================
//  사운드 - WebAudio 합성 (에셋 파일 없음)
//  효과음 + 절차적 BGM 루프. 엔진과 분리(이벤트로 호출).
// ============================================================
type Wave = OscillatorType;

const MUTE_KEY = 'randomdefense.muted.v1';

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private muted: boolean;
  private lastAttack = 0;
  private lastKill = 0;
  private bgmStep = 0;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
  }

  // 첫 사용자 입력에서 오디오 컨텍스트 해제 (브라우저 자동재생 정책)
  installUnlock(): void {
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  private ensure(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.5;
      this.bgmGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  isMuted(): boolean { return this.muted; }
  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  // ---- 기본 톤 생성 ----
  private tone(freq: number, dur: number, type: Wave, vol: number, dest: AudioNode, when?: number, slideTo?: number): void {
    if (!this.ctx) return;
    const t = when ?? this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  private sfx(freq: number, dur: number, type: Wave, vol: number, slideTo?: number): void {
    if (this.muted || !this.ctx || !this.master) return;
    this.tone(freq, dur, type, vol, this.master, undefined, slideTo);
  }

  // ---- 효과음 ----
  button(): void { this.sfx(520, 0.05, 'square', 0.12); }

  summon(mythic = false): void {
    if (mythic) { this.fanfare(); return; }
    this.sfx(400, 0.12, 'square', 0.18, 760);
  }
  private fanfare(): void {
    if (this.muted || !this.ctx || !this.master) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => this.tone(n, 0.2, 'square', 0.2, this.master!, this.ctx!.currentTime + i * 0.1));
  }

  // 직업별 공격음 (궁수=짧은 고음, 마법사=반짝, 전사=둔탁)
  attack(job?: 'archer' | 'wizard' | 'warrior'): void {
    const now = performance.now();
    if (now - this.lastAttack < 70) return; // 겹침 방지 (최대 ~14/초)
    this.lastAttack = now;
    if (job === 'wizard') this.sfx(900 + Math.random() * 200, 0.06, 'sine', 0.05, 1500);
    else if (job === 'warrior') this.sfx(180 + Math.random() * 40, 0.06, 'square', 0.06, 90);
    else this.sfx(640 + Math.random() * 80, 0.04, 'triangle', 0.06, 420);
  }

  kill(boss: boolean): void {
    if (boss) {
      this.noise(0.6, 0.3);
      this.sfx(200, 0.6, 'sawtooth', 0.28, 45);
      return;
    }
    const now = performance.now();
    if (now - this.lastKill < 45) return;
    this.lastKill = now;
    this.sfx(320, 0.09, 'triangle', 0.12, 130);
  }

  merge(): void {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [392, 523, 659, 1047].forEach((n, i) => this.tone(n, 0.14, 'triangle', 0.18, this.master!, t + i * 0.06));
  }
  fanfareUnlock(): void { this.fanfare(); }
  sendAttack(): void { this.sfx(300, 0.25, 'sawtooth', 0.15, 900); }
  incoming(): void {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [880, 660, 880, 660].forEach((n, i) => this.tone(n, 0.09, 'square', 0.1, this.master!, t + i * 0.1));
  }
  coin(): void { this.sfx(1200, 0.08, 'square', 0.08, 1800); }

  boss(): void { this.noise(0.5, 0.18); this.sfx(90, 0.8, 'sawtooth', 0.26, 50); } // 보스 등장 경고
  gameEnd(cleared: boolean): void {
    if (this.muted || !this.ctx || !this.master) return;
    this.stopBgm();
    if (cleared) {
      [523, 659, 784, 1047, 1319].forEach((n, i) => this.tone(n, 0.3, 'square', 0.22, this.master!, this.ctx!.currentTime + i * 0.13));
    } else {
      [440, 349, 262, 196].forEach((n, i) => this.tone(n, 0.35, 'sawtooth', 0.2, this.master!, this.ctx!.currentTime + i * 0.14));
    }
  }

  // 화이트 노이즈 버스트 (타악/폭발)
  private noise(dur: number, vol: number, dest?: AudioNode, when?: number, hp = 0): void {
    if (!this.ctx || (!dest && (this.muted || !this.master))) return;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = src;
    if (hp > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp;
      src.connect(f);
      node = f;
    }
    node.connect(g); g.connect(dest ?? this.master!);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // ---- BGM (절차적 루프, 트랙별 코드 진행 + 리드 + 베이스 + 드럼) ----
  private track: BgmTrack = 'battle';
  setTrack(t: BgmTrack): void { this.track = t; }

  startBgm(track: BgmTrack = 'battle'): void {
    this.ensure();
    this.track = track;
    if (this.bgmTimer != null) return;
    this.bgmStep = 0;
    // 16분음표 스케줄러: 약간 앞서 예약해 타이밍 흔들림 방지
    const tick = () => {
      if (!this.ctx || !this.bgmGain || this.muted) { this.bgmStep++; return; }
      const song = SONGS[this.track];
      const t = this.ctx.currentTime + 0.05;
      const step = this.bgmStep % 64;            // 4마디 x 16스텝
      const bar = Math.floor(step / 16);
      const s16 = step % 16;
      const chord = song.chords[bar];
      // 베이스: 8분음표 루트/옥타브
      if (s16 % 4 === 0) this.tone(chord[0] / 2, 0.22, 'triangle', 0.1, this.bgmGain, t);
      else if (s16 % 4 === 2 && song.busyBass) this.tone(chord[0], 0.12, 'triangle', 0.06, this.bgmGain, t);
      // 리드 멜로디
      const n = song.lead[step];
      if (n) this.tone(n, song.leadLen, song.leadWave, 0.045, this.bgmGain, t);
      // 아르페지오 패드 (코드 구성음 순환)
      if (song.arp && s16 % 2 === 1) this.tone(chord[(s16 >> 1) % chord.length] * 2, 0.08, 'sine', 0.025, this.bgmGain, t);
      // 드럼: 킥(1,3박) / 스네어(2,4박) / 하이햇
      if (song.drums) {
        if (s16 === 0 || s16 === 8 || (song.busyBass && s16 === 10)) this.tone(110, 0.12, 'sine', 0.16, this.bgmGain, t, 40);
        if (s16 === 4 || s16 === 12) this.noise(0.1, 0.07, this.bgmGain, t, 1200);
        if (s16 % 2 === 0) this.noise(0.03, 0.025, this.bgmGain, t, 6000);
      }
      this.bgmStep++;
    };
    this.bgmTimer = setInterval(tick, 60000 / SONGS[this.track].bpm / 4);
  }
  stopBgm(): void {
    if (this.bgmTimer != null) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
  }
  /** 트랙 전환 (템포가 다르면 스케줄러 재시작) */
  switchBgm(track: BgmTrack): void {
    if (this.track === track && this.bgmTimer != null) return;
    this.stopBgm();
    this.startBgm(track);
  }
}

type BgmTrack = 'menu' | 'battle' | 'boss' | 'pvp';
interface Song {
  bpm: number;
  chords: number[][];   // 마디별 코드 (Hz)
  lead: number[];       // 64스텝 멜로디 (0=쉼표)
  leadWave: OscillatorType;
  leadLen: number;
  arp: boolean;
  drums: boolean;
  busyBass: boolean;
}

// 음이름 → 주파수
const N: Record<string, number> = {
  C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392, A4: 440, B4: 493.9,
  C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784, A5: 880, Bb4: 466.2, Eb5: 622.3,
  A3: 220, F3: 174.6, G3: 196, C3: 130.8, D3: 146.8, E3: 164.8, Bb3: 233.1,
};
// 문자열 멜로디 → 64스텝 배열 ('-' 쉼표)
function mel(s: string): number[] {
  const out = s.trim().split(/\s+/).map((x) => (x === '-' ? 0 : N[x] ?? 0));
  while (out.length < 64) out.push(0);
  return out.slice(0, 64);
}
const SONGS: Record<BgmTrack, Song> = {
  menu: {
    bpm: 92, leadWave: 'triangle', leadLen: 0.3, arp: true, drums: false, busyBass: false,
    chords: [[N.C4, N.E4, N.G4], [N.A3, N.C4, N.E4], [N.F3, N.A3, N.C4], [N.G3, N.B4 / 2, N.D4]],
    lead: mel(`E5 - - - G5 - E5 - D5 - - - C5 - - -  C5 - - - E5 - D5 - C5 - A4 - - - - -
               A4 - - - C5 - A4 - G4 - - - A4 - C5 -  D5 - - - - - B4 - G4 - - - - - - -`),
  },
  battle: {
    bpm: 132, leadWave: 'square', leadLen: 0.12, arp: true, drums: true, busyBass: true,
    chords: [[N.A3, N.C4, N.E4], [N.F3, N.A3, N.C4], [N.C4, N.E4, N.G4], [N.G3, N.B4 / 2, N.D4]],
    lead: mel(`A4 - C5 - E5 - D5 C5 - - A4 - G4 - A4 -  F4 - A4 - C5 - D5 - C5 - A4 - - - - -
               E5 - - E5 D5 - C5 - G4 - - - C5 - D5 -  D5 - - - B4 - G4 - A4 - B4 - D5 - - -`),
  },
  boss: {
    bpm: 150, leadWave: 'sawtooth', leadLen: 0.1, arp: false, drums: true, busyBass: true,
    chords: [[N.D3 * 2, N.F4, N.A4], [N.Bb3, N.D4, N.F4], [N.C4, N.E4, N.G4], [N.A3, N.C4, N.E4]],
    lead: mel(`D5 - D5 - F5 - D5 - A4 - - - D5 - E5 -  F5 - F5 - D5 - Bb4 - F4 - - - Bb4 - D5 -
               E5 - E5 - G5 - E5 - C5 - - - E5 - G5 -  A5 - - - E5 - - - A4 - C5 - E5 - - -`),
  },
  pvp: {
    bpm: 140, leadWave: 'square', leadLen: 0.1, arp: true, drums: true, busyBass: true,
    chords: [[N.E3 * 2, N.G4, N.B4], [N.C4, N.E4, N.G4], [N.D4, N.F4 * 1.059, N.A4], [N.B4 / 2, N.D4, N.F4 * 1.059]],
    lead: mel(`E5 - G5 - B4 - E5 - - - D5 - E5 - G5 -  C5 - E5 - G5 - E5 - C5 - - - E5 - - -
               D5 - F5 - A5 - F5 - D5 - - - A4 - D5 -  B4 - D5 - F5 - - - E5 - D5 - B4 - - -`),
  },
};

export const audio = new AudioManager();
