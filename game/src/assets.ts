// ============================================================
//  스프라이트 로더
//  public/sprites/*.png 를 미리 로드해 캐시한다.
//  해금 유닛(레인저/빙결술사 등)은 기본 3종 시트를 색조 회전한 캔버스로 생성
//  (전용 아트가 준비되면 UNITS 의 hue 를 0 으로 두고 시트만 추가하면 된다)
// ============================================================
import { JOB_SPRITE, GRADES, RACE_SPRITE, UNITS, UNIT_BY_ID } from './config';
import type { Job, Race, GradeKey } from './types';

export interface SpriteEntry {
  img: CanvasImageSource;
  ready: boolean;
  error?: boolean;
  url: string; // DOM 아이콘용 (background-image)
}

const cache = new Map<string, SpriteEntry>();

function loadImage(name: string, dir = 'sprites'): SpriteEntry {
  const key = `${dir}/${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const img = new Image();
  const url = `${dir}/${name}.png`;
  img.src = url;
  const entry: SpriteEntry = { img, ready: false, url };
  img.onload = () => { entry.ready = true; };
  img.onerror = () => { entry.error = true; };
  cache.set(key, entry);
  return entry;
}

// RGB ↔ HSL 색조 회전 (채도 낮은 픽셀 - 피부/회색 - 은 덜 바뀌게)
function hueShift(src: HTMLImageElement, deg: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.naturalWidth; c.height = src.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const shift = deg / 360;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const dlt = max - min;
    if (dlt < 0.08) continue; // 무채색 유지
    const s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min);
    if (s < 0.22) continue;
    let h = max === r ? (g - b) / dlt + (g < b ? 6 : 0) : max === g ? (b - r) / dlt + 2 : (r - g) / dlt + 4;
    h = (h / 6 + shift + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t: number) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    d[i] = f(h + 1 / 3) * 255;
    d[i + 1] = f(h) * 255;
    d[i + 2] = f(h - 1 / 3) * 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

export function unitSprite(job: Job, gradeKey: GradeKey): SpriteEntry {
  const g = GRADES.find((x) => x.key === gradeKey)!;
  const baseName = `${JOB_SPRITE[job]}_${g.spriteIndex}`;
  const base = loadImage(baseName);
  const hue = UNIT_BY_ID[job].hue;
  if (!hue) return base;
  const key = `tint:${job}:${g.spriteIndex}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = { img: base.img, ready: false, url: base.url };
    cache.set(key, entry);
  }
  if (!entry.ready && base.ready) {
    try {
      const canvas = hueShift(base.img as HTMLImageElement, hue);
      entry.img = canvas;
      entry.url = canvas.toDataURL();
      entry.ready = true;
    } catch {
      // file:// 등 캔버스 오염 시 원본 사용
      entry.img = base.img;
      entry.ready = true;
    }
  }
  return entry;
}

/** DOM 아이콘 URL (색조 변형 유닛은 생성 완료 후 dataURL) */
export function unitIconUrl(job: Job, gradeIndex = 0): string {
  return unitSprite(job, GRADES[gradeIndex].key).url;
}

export function mobSprite(race: Race): SpriteEntry {
  return loadImage(`${RACE_SPRITE[race]}_0`);
}

// 맵 타일 (public/tiles/*.png)
export function tileSprite(name: string): SpriteEntry {
  return loadImage(name, 'tiles');
}

export function mobPortraitSrc(race: Race): string {
  return `sprites/${RACE_SPRITE[race]}_0.png`;
}

export function preloadAll(): void {
  for (const u of UNITS) {
    for (const g of GRADES) loadImage(`${JOB_SPRITE[u.id]}_${g.spriteIndex}`);
  }
  for (const race of Object.keys(RACE_SPRITE) as Race[]) loadImage(`${RACE_SPRITE[race]}_0`);
  tileSprite('grass');
  tileSprite('dirt');
}

/** 모든 기본 스프라이트 로드 완료 후 색조 변형 시트 미리 생성 (첫 표시 지연 방지) */
export function warmTints(): void {
  const tick = () => {
    let pending = false;
    for (const u of UNITS) {
      if (!u.hue) continue;
      for (const g of GRADES) if (!unitSprite(u.id, g.key).ready) pending = true;
    }
    if (pending) setTimeout(tick, 200);
  };
  tick();
}
