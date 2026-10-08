// ============================================================
//  DOM 헬퍼 - 패널/모달/토스트 공용
// ============================================================
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export function toast(msg: string, ms = 2200): void {
  const layer = $('toast-layer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  layer.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** 오버레이 패널 열기. 배경 탭/닫기 버튼(.close-x, [data-close])으로 닫힘 */
export function openOverlay(id: string, html: string, onClose?: () => void): HTMLElement {
  const el = $(id);
  el.innerHTML = html;
  el.classList.remove('hidden');
  const close = () => { el.classList.add('hidden'); el.innerHTML = ''; onClose?.(); };
  el.onclick = (e) => { if (e.target === el) close(); };
  el.querySelectorAll<HTMLElement>('.close-x, [data-close]').forEach((b) => { b.onclick = close; });
  (el as HTMLElement & { _close?: () => void })._close = close;
  return el;
}

export function closeOverlay(id: string): void {
  const el = $(id) as HTMLElement & { _close?: () => void };
  if (el._close) el._close();
  else el.classList.add('hidden');
}

/** 이벤트 위임: 패널 안 [data-act] 버튼 클릭 → handlers[act](button) */
export function bindActions(root: HTMLElement, handlers: Record<string, (el: HTMLElement) => void>): void {
  root.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => {
    const fn = handlers[b.dataset.act!];
    if (fn) b.onclick = (e) => { e.stopPropagation(); fn(b); };
  });
}

/** 확인 모달 */
export function confirmModal(title: string, body: string, ok = '확인', cancel = '취소'): Promise<boolean> {
  return new Promise((resolve) => {
    const el = openOverlay('modal', `<div class="dialog" style="text-align:center">
      <h2>${title}</h2><div style="margin-bottom:12px">${body}</div>
      <div style="display:flex;gap:8px"><button class="btn" style="flex:1" data-act="no">${cancel}</button>
      <button class="btn green" style="flex:1" data-act="yes">${ok}</button></div></div>`, () => resolve(false));
    bindActions(el, {
      yes: () => { el.onclick = null; el.classList.add('hidden'); el.innerHTML = ''; resolve(true); },
      no: () => closeOverlay('modal'),
    });
  });
}

/** 스프라이트 시트 1프레임 아이콘 HTML */
export function spriteIcon(url: string, cls = 'frame-sprite', style = ''): string {
  return `<div class="${cls}" style="background-image:url(${url});${style}"></div>`;
}
