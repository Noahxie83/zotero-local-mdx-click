/* SPDX-License-Identifier: GPL-3.0-or-later */

// Popup chrome and the optional text fallback. Original dictionary CSS is
// loaded only inside its own sandboxed iframe by native-render.js.
export const popupCSS = `
  :host { color-scheme: light dark; }
  * { box-sizing: border-box; }
  .card {
    --surface: #fff; --chrome: #f8fafc; --border: #dce3ea;
    --ink: #31343b; --muted: #687383; --blue: #0088d6; --ribbon: #007ab8;
    --definition: #096cab; --uk: #0068b4; --us: #b42d36;
    --example: #37323b; --grammar: #895126; --note: #f0f7fc;
    width: min(540px, calc(100vw - 24px));
    max-height: min(580px, calc(100vh - 24px));
    display: flex; flex-direction: column; overflow: hidden;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--surface); color: var(--ink);
    box-shadow: 0 6px 28px #16273826;
    font: 16px/1.5 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif;
    text-align: left; user-select: text;
  }
  header {
    display: flex; gap: 12px; align-items: center;
    min-height: 37px; padding: 5px 13px 5px 17px;
    background: var(--chrome); border-bottom: 1px solid var(--border);
  }
  header h2 {
    flex: 1; min-width: 0; margin: 0; color: var(--muted);
    font-size: 13px; font-weight: 500; line-height: 1.4;
    overflow-wrap: anywhere;
  }
  button {
    width: 27px; height: 27px; padding: 0; flex: 0 0 auto;
    border: 0; border-radius: 4px; background: transparent;
    color: var(--muted); font: 22px/1 'Segoe UI', sans-serif; cursor: pointer;
  }
  button:hover { background: #8394a41c; color: var(--ink); }
  button:active { background: #8394a430; }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .dictionary-choice {
    display: flex; align-items: center; gap: 9px;
    padding: 8px 17px; border-bottom: 1px solid var(--border);
  }
  .dictionary-label { color: var(--muted); font-size: 12px; flex: 0 0 auto; }
  select {
    flex: 1; min-width: 0; width: 100%; max-width: 100%;
    padding: 4px 7px; border: 1px solid var(--border); border-radius: 4px;
    background: var(--surface); color: var(--ink); font: inherit; font-size: 13px;
  }
  select:hover { border-color: var(--muted); }
  select:disabled { opacity: .6; cursor: default; }
  .body {
    min-height: 70px; padding: 14px 19px 17px; overflow: auto;
    overscroll-behavior: contain; scrollbar-width: thin;
    scrollbar-color: #aebbc9 transparent;
    overflow-wrap: anywhere; text-wrap: pretty;
  }
  .source {
    flex: 0 0 auto; padding: 5px 17px; border-top: 1px solid var(--border);
    background: var(--chrome); color: var(--muted); font-size: 11px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .body section + section { margin-top: 15px; padding-top: 13px; border-top: 1px solid var(--border); }
  .body p { margin: 5px 0; }
  .body h1, .body h2, .body h3, .body h4 { margin: 9px 0 5px; line-height: 1.3; }
  .body h1, .body h2 { font-size: 21px; color: var(--blue); }
  .body h3, .body h4 { font-size: 16px; }
  .body table { border-collapse: collapse; max-width: 100%; }
  .body td, .body th { padding: 3px 5px; }
  .body ul, .body ol { margin: 5px 0; padding-left: 1.4em; }
  .body li + li { margin-top: 5px; }
  .body li::marker { color: var(--definition); font-weight: 500; }
  .body hr { height: 1px; margin: 9px 0; border: 0; background: var(--border); }
  .dict-block { margin: 5px 0; }
  .dict-h-g, .dict-entry, .dict-entry-g, .dict-top-g, .dict-sn-gs,
  .dict-subentry-g, .dict-sn-blk, .dict-sn-blk-nolist { margin: 0; }
  .dict-top-g { margin-bottom: 7px; line-height: 1.65; }
  .dict-h, .dict-hw, .dict-headword, .dict-hwrap h2 {
    color: var(--blue); font-size: 25px; font-weight: 700; line-height: 1.3;
    letter-spacing: .1px;
  }
  .dict-hwrap h2 { margin: 0 0 3px; }
  .dict-h { margin-right: 5px; }
  .dict-hkey { margin-right: 4px; }
  .dict-symbol { color: #ed714b; font-size: .8em; font-variant-emoji: text; }
  .dict-pron-gs { display: inline; }
  .dict-pron-g-blk {
    --pron-color: var(--uk); display: inline-block; margin: 0 5px;
    color: var(--pron-color); white-space: nowrap; vertical-align: baseline;
  }
  .dict-phon-blk { white-space: nowrap; }
  .dict-pron-g-blk:has(.dict-namelabel), .dict-audio-us { --pron-color: var(--us); }
  .dict-pron-g-blk:has(.dict-brelabel), .dict-audio-gb { --pron-color: var(--uk); }
  .dict-phon, .dict-phon-blk, .dict-pron, .dict-ipa {
    color: var(--pron-color, var(--uk)); font-family: 'Segoe UI', 'Lucida Sans Unicode', sans-serif;
    font-size: 17px; font-weight: 500; font-style: normal; letter-spacing: 0;
  }
  .dict-brelabel, .dict-namelabel, .dict-pron-gs br { display: none; }
  .dict-pos-g { display: block; margin: 6px 0 8px; border-bottom: 2px solid var(--blue); line-height: 1.3; }
  .dict-pos {
    display: inline-block; padding: 2px 6px 1px; background: var(--ribbon); color: #fff;
    font-size: 12px; font-weight: 700; line-height: 1.35; text-transform: uppercase; font-style: normal;
  }
  .dict-shcut-blk { display: block; margin: 10px 0 6px; }
  .dict-shcut {
    display: inline; padding: 2px 5px; background: var(--ribbon); color: #fff;
    font-size: 13px; font-weight: 700; line-height: 1.7; text-transform: uppercase;
    box-decoration-break: clone;
  }
  .dict-shcut .dict-chn { color: inherit; }
  .dict-sdsymb, .dict-xsymb { display: none; }
  .dict-sn-blk { margin: 7px 0 9px; }
  .dict-sn-blk > ol { margin: 0; }
  .dict-sn-g, .dict-licontent { display: inline; margin: 0; color: var(--definition); }
  .dict-gram-g, .dict-gram-blk { display: inline; margin: 0; color: var(--grammar); }
  .dict-label-g, .dict-label-g-blk, .dict-gl, .dict-gl-blk { color: var(--grammar); font-size: .93em; }
  .dict-def, .dict-definition { display: inline; color: var(--definition); }
  .dict-chn, .dict-cn, .dict-zh { color: var(--definition); font-style: normal; }
  .dict-cf, .dict-cl { font-weight: 600; }
  .dict-cf-blk { margin-right: .2em; }
  .dict-num, .dict-sn { color: var(--definition); font-weight: 600; margin-right: .3em; }
  .dict-x-gs { display: block; margin: 4px 0 6px; }
  .dict-x-g-blk, .dict-x-g { position: relative; display: block; margin: 4px 0; padding-left: 17px; }
  .dict-x-g-blk::before, .dict-x-g::before {
    content: '⇒'; position: absolute; left: 0; top: 1px; color: var(--blue);
    font: 13px/1.65 'Segoe UI', sans-serif;
  }
  .dict-x, .dict-example {
    color: var(--example); font: italic 16px/1.45 Georgia, 'Times New Roman', 'Microsoft YaHei', serif;
  }
  .dict-x .dict-chn, .dict-example .dict-chn, .dict-example .dict-cn, .dict-example .dict-zh {
    display: block; margin-top: 1px; color: var(--example);
    font: normal 14px/1.55 'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif;
  }
  .dict-x br:has(+ .dict-chn), .dict-example br:has(+ .dict-chn) { display: none; }
  .dict-unbox, .dict-note-g {
    padding: 8px 10px; margin: 9px 0; background: var(--note); border-radius: 4px;
  }
  .dict-unbox h2, .dict-unbox h3 { font-size: 15px; }
  .dict-xr-gs { display: block; margin: 6px 0; font-size: 14px; color: var(--muted); }
  .dict-xrlabel { margin-right: 5px; }
  .dict-xr-gs .dict-xr-g-blk, .dict-xr-gs .dict-xr-g, .dict-xr-gs .dict-xh-blk {
    display: inline; margin: 0; padding: 0;
  }
  .dict-xr-gs .dict-xr-g { white-space: nowrap; }
  .dict-vp-gs {
    display: block; margin: 11px 0 15px; padding: 8px 11px 3px;
    background: var(--note); border-radius: 4px;
  }
  .dict-vp-gs::before {
    content: '词形与发音'; display: block; margin-bottom: 3px;
    color: var(--muted); font-size: 12px; font-weight: 600;
  }
  .dict-form-row {
    display: grid; grid-template-columns: minmax(90px, 30%) minmax(0, 1fr);
    align-items: start; gap: 6px 12px; margin: 0; padding: 7px 0;
    border-top: 1px solid var(--border);
  }
  .dict-vpform {
    display: block; margin: 0; padding-top: 1px; color: var(--muted);
    font-size: 12px; font-style: normal; line-height: 1.45;
  }
  .dict-form-row > .dict-vp-g { display: block; min-width: 0; margin: 0; }
  .dict-form-row > .dict-vp-g:only-child { grid-column: 1 / -1; }
  .dict-vp-g > .dict-vp {
    display: block; margin-bottom: 2px; color: var(--definition);
    font-size: 15px; font-weight: 600; line-height: 1.4;
  }
  .dict-vp-g > .dict-pron-gs, .dict-vp-g > .dict-pron {
    display: flex; flex-wrap: wrap; gap: 2px 10px; font: inherit;
  }
  .dict-vp-g .dict-pron-g-blk { margin: 0; }
  .dict-vp-g .dict-phon, .dict-vp-g .dict-phon-blk { font-size: 14px; line-height: 1.5; }
  .dict-xh, .dict-idm, .dict-pv { color: var(--definition); font-weight: 600; }
  .dict-boxtag, .dict-word-frequency .dict-label {
    display: inline-block; margin: 2px 4px 2px 0; padding: 1px 5px;
    background: var(--note); color: var(--definition); border-radius: 3px; font-size: 11px;
  }
  .dict-dcb { margin: 8px 0; line-height: 1.65; }
  .dict-dcb .dict-pos { margin-right: 8px; }
  .dict-dcn { color: var(--definition); }
  @media (max-width: 420px) {
    .body { padding: 12px 14px 15px; }
    .dict-h, .dict-hw, .dict-headword, .dict-hwrap h2 { font-size: 23px; }
    .dict-pron-g-blk { margin-left: 0; margin-right: 8px; }
    .dict-form-row { grid-template-columns: minmax(85px, 30%) minmax(0, 1fr); column-gap: 8px; }
    .dict-vp-g .dict-pron-g-blk { margin: 0; }
  }
  @media (prefers-color-scheme: dark) {
    .card {
      --surface: #252a31; --chrome: #20252b; --border: #414b57;
      --ink: #e7ebf0; --muted: #aab6c5; --blue: #72c5fa; --ribbon: #106b98;
      --definition: #9bd3f8; --uk: #8fcaff; --us: #ff9da5;
      --example: #e2dce5; --grammar: #e8bc91; --note: #2b3946;
    }
    .body { scrollbar-color: #617184 transparent; }
  }
`;
