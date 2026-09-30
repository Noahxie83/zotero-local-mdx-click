/* SPDX-License-Identifier: GPL-3.0-or-later */
import { element } from './render.js';

export const ANNOTATION_COLORS = [
  ['黄色', '#ffd400'], ['红色', '#ff6666'], ['绿色', '#5fb236'], ['蓝色', '#2ea8e5'],
  ['紫色', '#a28ae5'], ['洋红', '#e56eee'], ['橙色', '#f19837'], ['灰色', '#aaaaaa'],
];

// Intercept only the reader's text-selection popup callback, never its
// annotation storage, highlight tool or other popup callbacks.
export function replaceSelectionMenu(view, { enabled, onPopup, onError }) {
  const original = view._onSetSelectionPopup;
  if (typeof original !== 'function' || typeof view._onAddAnnotation !== 'function') return null;
  let popup = view._selectionPopup || null, disposed = false, previousEnabled = enabled();
  function callback(value) {
    popup = value || null;
    if (!disposed && enabled() && popup?.annotation) {
      original.call(view, null);
      try { onPopup(popup); }
      catch (e) { original.call(view, popup); onError?.(e); }
      return;
    }
    return original.call(view, value);
  }
  view._onSetSelectionPopup = callback;
  if (enabled() && popup?.annotation) callback(popup);
  return {
    get popup() { return popup; },
    refresh() {
      const currentEnabled = enabled();
      if (currentEnabled === previousEnabled) return;
      previousEnabled = currentEnabled;
      if (currentEnabled && popup?.annotation) callback(popup);
      else original.call(view, currentEnabled ? null : popup);
    },
    dispose() {
      disposed = true;
      // Another extension may have wrapped our callback after attachment.
      // Leave its wrapper intact; ours becomes a transparent pass-through.
      if (view._onSetSelectionPopup === callback) view._onSetSelectionPopup = original;
      if (popup?.annotation) original.call(view, popup);
      popup = null;
    },
  };
}

export function renderSelectionTools(doc, target, { color, setColor, add, readOnly = false, onStatus }) {
  target.hidden = false;
  const palette = element(doc, 'div'); palette.className = 'annotation-colors';
  const buttons = [];
  let selectedColor = ANNOTATION_COLORS.some(([, value]) => value === color) ? color : ANNOTATION_COLORS[0][1];
  const update = () => buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === selectedColor)));
  for (const [label, value] of ANNOTATION_COLORS) {
    const button = element(doc, 'button'); button.type = 'button'; button.className = 'annotation-color';
    button.title = label; button.setAttribute('aria-label', label); button.dataset.color = value;
    button.style.setProperty('--annotation-color', value); button.disabled = readOnly;
    button.addEventListener('click', () => { selectedColor = value; setColor(value); update(); });
    buttons.push(button); palette.append(button);
  }
  update();
  const actions = element(doc, 'div'); actions.className = 'annotation-actions';
  let saved = false;
  for (const [type, label] of [['highlight', '高亮选区'], ['underline', '添加下划线']]) {
    const button = element(doc, 'button', label); button.type = 'button'; button.disabled = readOnly;
    button.addEventListener('click', async () => {
      if (saved) return;
      saved = true; for (const action of actions.children) action.disabled = true;
      try { await add(type, selectedColor); onStatus(type === 'highlight' ? '已保存高亮批注' : '已保存下划线批注'); }
      catch (e) { saved = false; for (const action of actions.children) action.disabled = readOnly; onStatus('批注保存失败：' + e.message); }
    });
    actions.append(button);
  }
  // Clicking our toolbar should not collapse the PDF selection before the
  // annotation action receives its captured position/text.
  target.addEventListener('pointerdown', event => event.preventDefault());
  target.append(palette, actions);
  if (readOnly) target.append(element(doc, 'small', '此文献只读，不能保存批注'));
}
