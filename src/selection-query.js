/* SPDX-License-Identifier: GPL-3.0-or-later */
// Read the PDF reader's selection without changing it. A PDF's printable
// hyphen can be marked ignorable by Zotero, so keep it as a query alternative.
const MAX_TEXT = 256;
const MAX_WORDS = 16;
const LETTER = /[\p{L}\p{M}\p{N}]/u;
const HYPHEN = /^[-\u00ad\u2010\u2011]$/u;

function tidy(value) {
  return value.replace(/[\u200b\ufeff]/g, '').replace(/’/g, "'")
    .replace(/[\u2010\u2011]/g, '-').replace(/\s+/g, ' ').trim()
    .replace(/^[\s"'“”‘’()\[\]{},.;:!?]+|[\s"'“”‘’()\[\]{},.;:!?]+$/gu, '')
    .trim();
}

export function queryFromText(value, source = 'click') {
  if (typeof value !== 'string' || value.length > 4096) return null;
  if (source === 'entry') {
    const text = value.normalize('NFC').trim();
    return text && text.length <= MAX_TEXT ? { text, candidates: [text], source } : null;
  }
  const raw = value.normalize('NFKC').replace(/[\u2010\u2011]/g, '-')
    // Some PDF text layers attach the line-break flag to the glyph before
    // the hyphen. Move that separator after it, preserving the same options.
    .replace(/([\p{L}\p{M}\p{N}])[\t ]*\r?\n[\t ]*-\s*(?=[\p{L}\p{M}\p{N}])/gu, '$1-\n');
  // Three bounded alternatives also cover a phrase that contains both a real
  // compound and a word split by a line break. Never remove ordinary spaces.
  const preserved = tidy(raw.replace(/\u00ad/g, '-')
    .replace(/([\p{L}\p{M}\p{N}])-\s+(?=[\p{L}\p{M}\p{N}])/gu, '$1-'));
  if (!preserved || preserved.length > MAX_TEXT || !/\p{L}/u.test(preserved)
      || preserved.split(/\s+/).length > MAX_WORDS) return null;
  const lineJoined = tidy(raw.replace(/\u00ad\s*/g, '')
    .replace(/([\p{L}\p{M}\p{N}])-\s+(?=[\p{L}\p{M}\p{N}])/gu, '$1'));
  const joined = preserved.replace(/([\p{L}\p{M}\p{N}])-(?=[\p{L}\p{M}\p{N}])/gu, '$1');
  const candidates = [...new Set([preserved, lineJoined, joined].filter(Boolean))];
  return { text: preserved, candidates, source };
}

function fingerprint(value) {
  return String(value || '').normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

function rangeText(range, view) {
  const fallback = typeof range.text === 'string' ? range.text : '';
  const pageIndex = range.position?.pageIndex ?? range.pageIndex;
  const chars = view?._pdfPages?.[pageIndex]?.chars;
  const start = Math.min(range.anchorOffset, range.headOffset);
  const end = Math.max(range.anchorOffset, range.headOffset);
  if (!Array.isArray(chars) || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end > chars.length || end - start > 1024) return fallback;
  let raw = '';
  for (let i = start; i < end; i++) {
    const char = chars[i];
    if (!char || typeof char.c !== 'string') continue;
    const keepHyphen = HYPHEN.test(char.c) && i > start && i + 1 < end
      && LETTER.test(chars[i - 1]?.c || '') && LETTER.test(chars[i + 1]?.c || '');
    if (char.ignorable && !keepHyphen) continue;
    raw += char.c;
    if (char.lineBreakAfter || char.paragraphBreakAfter) raw += '\n';
    else if (char.spaceAfter) raw += ' ';
    if (raw.length > 4096) return fallback;
  }
  // Semantic selection can exclude a different column within the offset span.
  // Use raw glyphs only when they describe the reader's actual selected text.
  return fallback && fingerprint(raw) !== fingerprint(fallback) ? fallback : raw || fallback;
}

function activeRanges(view) {
  const ranges = view?._selectionRanges;
  return Array.isArray(ranges) ? ranges.filter(range => range && !range.collapsed
    && range.anchorOffset !== range.headOffset) : [];
}

export function selectionSignature(win, view) {
  const ranges = activeRanges(view);
  if (ranges.length) return ranges.slice(0, 9).map(range => [
    range.position?.pageIndex ?? range.pageIndex, range.anchorOffset, range.headOffset,
    String(range.text || '').slice(0, 512),
  ].join(':')).join('|');
  const selection = win.getSelection?.();
  return selection && !selection.isCollapsed ? String(selection).slice(0, 4096) : '';
}

export function readSelection(win, view) {
  const ranges = activeRanges(view);
  if (ranges.length) {
    if (ranges.length > 8) return { selected: true, query: null };
    const ordered = ranges.slice().sort((a, b) =>
      (a.position?.pageIndex ?? a.pageIndex) - (b.position?.pageIndex ?? b.pageIndex)
      || Math.min(a.anchorOffset, a.headOffset) - Math.min(b.anchorOffset, b.headOffset));
    return { selected: true, query: queryFromText(ordered.map(range => rangeText(range, view)).join('\n'), 'selection') };
  }
  const selection = win.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return { selected: false, query: null };
  const inPDF = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.page .textLayer');
  if (!inPDF(selection.anchorNode) || !inPDF(selection.focusNode)) return { selected: true, query: null };
  return { selected: true, query: queryFromText(String(selection), 'selection') };
}
