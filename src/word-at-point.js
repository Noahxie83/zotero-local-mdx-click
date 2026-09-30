/*
 * Original click-to-word implementation for Zotero's PDF reader.
 * Coordinates are CSS client coordinates in the PDF view's own window.
 * The optional view argument is Zotero's _primaryView or _secondaryView.
 * No selection, annotation, page state, or DOM style is changed.
 */

const WORD = /[\p{L}\p{M}\p{N}]+(?:['’\u2010\u2011-][\p{L}\p{M}\p{N}]+)*/gu;
const TOKEN_CHARACTER = /^[\p{L}\p{M}\p{N}'’\u2010\u2011-]+$/u;

function normalizeWord(value) {
  const word = value.normalize("NFKC")
    .replace(/[\u00ad\u200b]/g, "")
    .replace(/’/g, "'")
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/^['-]+|['-]+$/g, "");
  return word.length <= 128 && /\p{L}/u.test(word) ? word : "";
}

function contains(rect, x, y) {
  return rect && rect.width > 0 && rect.height > 0
    && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function pageAtPoint(doc, x, y) {
  const element = doc.elementFromPoint(x, y);
  const page = element?.closest?.(".page[data-page-number]");
  if (page) return page;
  // Overlay elements can occupy a separate branch of the PDF document.
  for (const candidate of doc.querySelectorAll(".page[data-page-number]")) {
    if (contains(candidate.getBoundingClientRect(), x, y)) return candidate;
  }
  return null;
}

function fromCaret(doc, page, x, y) {
  let node;
  let offset;
  if (typeof doc.caretPositionFromPoint === "function") {
    const caret = doc.caretPositionFromPoint(x, y);
    node = caret?.offsetNode;
    offset = caret?.offset;
  } else if (typeof doc.caretRangeFromPoint === "function") {
    const caret = doc.caretRangeFromPoint(x, y);
    node = caret?.startContainer;
    offset = caret?.startOffset;
  }
  if (node?.nodeType !== 3 || !page.contains(node)
      || !node.parentElement?.closest(".textLayer")) return "";

  // A caret may land beside the glyph, so offset alone is insufficient.
  // The Range rectangle check rejects margins, line gaps, and punctuation.
  for (const match of node.data.matchAll(WORD)) {
    const end = match.index + match[0].length;
    if (offset < match.index || offset > end) continue;
    const range = doc.createRange();
    range.setStart(node, match.index);
    range.setEnd(node, end);
    if (Array.from(range.getClientRects()).some(rect => contains(rect, x, y))) {
      return normalizeWord(match[0]);
    }
  }
  return "";
}

function validCharacter(char) {
  return char && !char.ignorable && typeof char.c === "string"
    && TOKEN_CHARACTER.test(char.c) && Array.isArray(char.rect)
    && char.rect.length >= 4 && char.rect.slice(0, 4).every(Number.isFinite);
}

function box(rect) {
  return {
    left: Math.min(rect[0], rect[2]),
    right: Math.max(rect[0], rect[2]),
    bottom: Math.min(rect[1], rect[3]),
    top: Math.max(rect[1], rect[3]),
  };
}

function adjacent(left, right) {
  if (!validCharacter(left) || !validCharacter(right)) return false;
  if (left.wordBreakAfter || left.spaceAfter || left.lineBreakAfter
      || left.paragraphBreakAfter) return false;
  // Most PDFs provide word-boundary flags. Geometry also protects against
  // joining different columns or lines when a PDF lacks useful spacing.
  const a = box(left.inlineRect || left.rect);
  const b = box(right.inlineRect || right.rect);
  const minHeight = Math.min(a.top - a.bottom, b.top - b.bottom);
  const minWidth = Math.min(a.right - a.left, b.right - b.left);
  const verticalOverlap = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
  const horizontalOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const horizontalGap = Math.max(0, a.left - b.right, b.left - a.right);
  const verticalGap = Math.max(0, a.bottom - b.top, b.bottom - a.top);
  return (verticalOverlap >= minHeight * 0.3 && horizontalGap <= minHeight * 0.5)
    || (horizontalOverlap >= minWidth * 0.3 && verticalGap <= minWidth * 0.5);
}

function fromCharacterGeometry(win, page, view, x, y) {
  const pageIndex = Number(page.dataset.pageNumber) - 1;
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return "";
  const chars = view?._pdfPages?.[pageIndex]?.chars;
  if (!Array.isArray(chars) || !chars.length) return "";

  const contentWindow = win.wrappedJSObject || win;
  const viewer = contentWindow.PDFViewerApplication?.pdfViewer;
  const pageView = viewer?.getPageView?.(pageIndex) || viewer?._pages?.[pageIndex];
  const viewport = pageView?.viewport;
  if (typeof viewport?.convertToPdfPoint !== "function") return "";

  // The canvas wrapper measures the displayed page without its border.
  // Mapping through the viewport covers PDF rotation, zoom, and HiDPI.
  const surface = page.querySelector(".canvasWrapper") || page;
  const rect = surface.getBoundingClientRect();
  if (!contains(rect, x, y) || !viewport.width || !viewport.height) return "";
  const localX = (x - rect.left) * viewport.width / rect.width;
  const localY = (y - rect.top) * viewport.height / rect.height;
  const [pdfX, pdfY] = viewport.convertToPdfPoint(localX, localY);

  let hit = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (!validCharacter(char)) continue;
    const r = box(char.rect);
    if (pdfX < r.left || pdfX > r.right || pdfY < r.bottom || pdfY > r.top) continue;
    const distance = Math.hypot(pdfX - (r.left + r.right) / 2, pdfY - (r.bottom + r.top) / 2);
    if (distance < bestDistance) {
      hit = index;
      bestDistance = distance;
    }
  }
  if (hit < 0) return "";

  let start = hit;
  let end = hit + 1;
  while (start > 0 && hit - start < 128 && adjacent(chars[start - 1], chars[start])) start--;
  while (end < chars.length && end - start < 128 && adjacent(chars[end - 1], chars[end])) end++;
  return normalizeWord(chars.slice(start, end).map(char => char.c).join(""));
}

/**
 * Get a word at a single PDF click, without changing Zotero's selection.
 *
 * @param {Window} win PDF view iframe window (not the outer reader window).
 * @param {number} x MouseEvent.clientX in that same window.
 * @param {number} y MouseEvent.clientY in that same window.
 * @param {object} [view] The corresponding Zotero PDF view, if accessible.
 * @returns {string} A normalized word, or an empty string for a non-word hit.
 */
export function wordAtPoint(win, x, y, view) {
  if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return "";
  try {
    const page = pageAtPoint(win.document, x, y);
    if (!page) return "";
    // Cached character geometry can join a word fragmented across font spans
    // and still works when an annotation overlay blocks the DOM caret API.
    try {
      const geometricWord = fromCharacterGeometry(win, page, view, x, y);
      if (geometricWord) return geometricWord;
    } catch {
      // Internal reader fields can disappear while a tab is being closed.
    }
    return fromCaret(win.document, page, x, y);
  } catch {
    return "";
  }
}
