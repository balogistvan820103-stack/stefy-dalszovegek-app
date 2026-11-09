// Húzással átrendezés (érintés + egér), listában és kétoszlopos rácsban is,
// automatikus görgetéssel a képernyő szélein.

export function makeSortable(container, { itemSelector, handleSelector, onReorder, idAttr = 'id' }) {
  let drag = null;

  const onPointerDown = (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !container.contains(handle)) return;
    if (e.button !== undefined && e.button !== 0) return;
    const item = handle.closest(itemSelector);
    if (!item) return;
    e.preventDefault();
    const rect = item.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder';
    placeholder.style.height = `${rect.height}px`;
    const startOrder = ids();
    const origStyle = item.style.cssText;
    item.after(placeholder);
    item.classList.add('dragging');
    Object.assign(item.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: 1000,
    });
    document.body.classList.add('is-dragging');
    drag = { item, placeholder, origStyle, offsetY: e.clientY - rect.top, offsetX: e.clientX - rect.left, x: e.clientX, y: e.clientY, startOrder, timer: 0, pointerId: e.pointerId };
    try { handle.setPointerCapture(e.pointerId); } catch { /* */ }
    try { navigator.vibrate?.(15); } catch { /* */ }
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    drag.timer = setInterval(tick, 16);
  };

  const ids = () => Array.from(container.querySelectorAll(itemSelector)).map((el) => el.dataset[idAttr]);

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.x = e.clientX;
    drag.y = e.clientY;
    position();
    hitTest();
  };

  const position = () => {
    drag.item.style.top = `${drag.y - drag.offsetY}px`;
    drag.item.style.left = `${drag.x - drag.offsetX}px`;
  };

  const hitTest = () => {
    const el = document.elementFromPoint(drag.x, drag.y);
    const target = el?.closest?.(itemSelector);
    if (!target || target === drag.item || !container.contains(target)) return;
    const all = Array.from(container.children);
    const pIndex = all.indexOf(drag.placeholder);
    const tIndex = all.indexOf(target);
    if (tIndex < pIndex) target.before(drag.placeholder);
    else target.after(drag.placeholder);
  };

  // automatikus görgetés a képernyő tetején / alján
  const tick = () => {
    if (!drag) return;
    const edge = Math.min(110, window.innerHeight * 0.16);
    const topLimit = (document.getElementById('topbar')?.getBoundingClientRect().bottom || 0) + edge;
    const navRect = document.getElementById('bottomnav')?.getBoundingClientRect();
    const bottomLimit = (navRect && navRect.height ? navRect.top : window.innerHeight) - edge;
    let dy = 0;
    if (drag.y < topLimit) dy = -Math.ceil(((topLimit - drag.y) / edge) * 18);
    else if (drag.y > bottomLimit) dy = Math.ceil(((drag.y - bottomLimit) / edge) * 18);
    if (dy) {
      const before = window.scrollY;
      window.scrollBy(0, dy);
      if (window.scrollY !== before) hitTest();
    }
  };

  const onPointerUp = (e) => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
    clearInterval(drag.timer);
    const { item, placeholder, startOrder } = drag;
    placeholder.replaceWith(item);
    item.classList.remove('dragging');
    item.style.cssText = drag.origStyle;
    document.body.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    drag = null;
    const now = ids();
    if (now.join('|') !== startOrder.join('|')) onReorder(now);
  };

  container.addEventListener('pointerdown', onPointerDown);
  return () => {
    container.removeEventListener('pointerdown', onPointerDown);
    if (drag) onPointerUp({ pointerId: drag.pointerId });
  };
}
