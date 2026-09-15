// src/index.ts
import { stat as stat5 } from "node:fs/promises";
import { isKeyRelease as isKeyRelease2, matchesKey as matchesKey3 } from "@earendil-works/pi-tui";

// src/paths.ts
import { opendirSync, statSync } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
var MAX_COMPLETIONS = 500;
var MAX_LIST_ENTRIES = 1e4;
function parseArg(raw) {
  const s = raw.replace(/^\s+/, "");
  let logical = "";
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else logical += c;
    } else if (quote === '"') {
      if (c === "\\" && (s[i + 1] === '"' || s[i + 1] === "\\")) logical += s[++i];
      else if (c === '"') quote = null;
      else logical += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else {
      logical += c;
    }
  }
  return { logical, flag: s.startsWith("-"), url: /^[\w+.-]+:\/\//.test(logical) };
}
function resolvePath(args, cwd) {
  const { logical, flag, url } = parseArg(args);
  if (logical === "") throw new Error("no path given");
  if (flag) throw new Error(`flags are not supported: ${args.trim()}`);
  if (url) throw new Error(`URLs are not supported: ${args.trim()}`);
  return path.resolve(cwd, logical === "~" ? homedir() : logical.startsWith("~/") ? path.join(homedir(), logical.slice(2)) : logical);
}
function byDirThenName(a, b2) {
  if (a.directory !== b2.directory) return a.directory ? -1 : 1;
  return a.name < b2.name ? -1 : a.name > b2.name ? 1 : 0;
}
function completePath(args, cwd) {
  const { logical, flag, url } = parseArg(args);
  if (flag || url) return null;
  const tilde = logical === "~" || logical.startsWith("~/");
  const sep2 = logical.lastIndexOf("/");
  let dirLogical;
  let base;
  if (tilde && sep2 <= 1) {
    dirLogical = "~";
    base = sep2 === -1 ? "" : logical.slice(2);
  } else if (sep2 === -1) {
    dirLogical = "";
    base = logical;
  } else {
    dirLogical = logical.slice(0, sep2) || "/";
    base = logical.slice(sep2 + 1);
  }
  const dirAbs = dirLogical === "" ? cwd : path.resolve(cwd, dirLogical === "~" ? homedir() : dirLogical.startsWith("~/") ? path.join(homedir(), dirLogical.slice(2)) : dirLogical);
  let dirents = [];
  try {
    const directory = opendirSync(dirAbs);
    try {
      for (let i = 0; i < MAX_LIST_ENTRIES; i++) {
        const entry = directory.readSync();
        if (!entry) break;
        dirents.push(entry);
      }
    } finally {
      directory.closeSync();
    }
  } catch {
    return null;
  }
  const showHidden = base.startsWith(".");
  const head = sep2 === -1 ? tilde ? "~/" : "" : logical.slice(0, sep2 + 1);
  const rows = [];
  for (const d2 of dirents) {
    if (/[\x00-\x1f\x7f-\x9f]/.test(d2.name)) continue;
    if (!d2.name.startsWith(base)) continue;
    if (!showHidden && d2.name.startsWith(".")) continue;
    let directory = d2.isDirectory();
    if (!directory && d2.isSymbolicLink()) {
      try {
        directory = statSync(path.join(dirAbs, d2.name)).isDirectory();
      } catch {
      }
    }
    rows.push({
      name: d2.name,
      directory,
      value: serializeValue(!head && !tilde && d2.name === "~" ? "./~" : head + d2.name, directory),
      label: d2.name + (directory ? "/" : "")
    });
    if (rows.length >= MAX_COMPLETIONS) break;
  }
  if (rows.length === 0) return null;
  rows.sort(byDirThenName);
  return rows.map(({ value, label }) => ({ value, label }));
}
function serializeValue(full, directory) {
  const withSep = directory ? `${full}/` : full;
  if (!/[\s"']/.test(withSep) && !withSep.startsWith("-")) return withSep;
  return `"${withSep.replace(/[\\"]/g, "\\$&")}${directory ? "" : '"'}`;
}
async function listDirectory(dirPath) {
  const rows = [];
  for await (const entry of await opendir(dirPath)) {
    const full = path.join(dirPath, entry.name);
    const directory = entry.isDirectory() || entry.isSymbolicLink() && await stat(full).then((info) => info.isDirectory(), () => false);
    rows.push({ name: entry.name, path: full, directory });
    if (rows.length >= MAX_LIST_ENTRIES) break;
  }
  rows.sort(byDirThenName);
  return rows;
}

// src/documents.ts
import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join as join2, resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath2, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

// node_modules/marked/lib/marked.esm.js
function M() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var T = M();
function N(l3) {
  T = l3;
}
var _ = { exec: () => null };
function E(l3) {
  let e = [];
  return (t) => {
    let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
    return s || (s = l3(n), e[n] = s), s;
  };
}
function d(l3, e = "") {
  let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (s, r) => {
    let i = typeof r == "string" ? r : r.source;
    return i = i.replace(m.caret, "$1"), t = t.replace(s, i), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var Te = ((l3 = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + l3);
  } catch {
    return false;
  }
})();
var m = { codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l3) => new RegExp(`^( {0,3}${l3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: E((l3) => new RegExp(`^ {0,${l3}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: E((l3) => new RegExp(`^ {0,${l3}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`)), fencesBeginRegex: E((l3) => new RegExp(`^ {0,${l3}}(?:\`\`\`|~~~)`)), headingBeginRegex: E((l3) => new RegExp(`^ {0,${l3}}#`)), htmlBeginRegex: E((l3) => new RegExp(`^ {0,${l3}}<(?:[a-z].*>|!--)`, "i")), blockquoteBeginRegex: E((l3) => new RegExp(`^ {0,${l3}}>`)) };
var Oe = /^(?:[ \t]*(?:\n|$))+/;
var we = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var ye = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var B = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Pe = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var j = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var oe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var ae = d(oe).replace(/bull/g, j).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var Se = d(oe).replace(/bull/g, j).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var F = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
var $e = /^[^\n]+/;
var U = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Le = d(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", U).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var _e = d(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, j).getRegex();
var H = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var K = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var ze = d("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", K).replace("tag", H).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var le = d(F).replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex();
var Me = d(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", le).getRegex();
var W = { blockquote: Me, code: we, def: Le, fences: ye, heading: Pe, hr: B, html: ze, lheading: ae, list: _e, newline: Oe, paragraph: le, table: _, text: $e };
var se = d("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex();
var Ee = { ...W, lheading: Se, table: se, paragraph: d(F).replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", se).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex() };
var Ie = { ...W, html: d(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", K).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: _, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: d(F).replace("hr", B).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", ae).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Ae = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ce = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var ue = /^( {2,}|\\)\n(?!\s*$)/;
var Be = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var I = /[\p{P}\p{S}]/u;
var Z = /[\s\p{P}\p{S}]/u;
var X = /[^\s\p{P}\p{S}]/u;
var De = d(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, Z).getRegex();
var pe = /(?!~)[\p{P}\p{S}]/u;
var qe = /(?!~)[\s\p{P}\p{S}]/u;
var ve = /(?:[^\s\p{P}\p{S}]|~)/u;
var He = d(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", Te ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var ce = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Ze = d(ce, "u").replace(/punct/g, I).getRegex();
var Ge = d(ce, "u").replace(/punct/g, pe).getRegex();
var he = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var Ne = d(he, "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var Qe = d(he, "gu").replace(/notPunctSpace/g, ve).replace(/punctSpace/g, qe).replace(/punct/g, pe).getRegex();
var je = d("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var Fe = d(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, I).getRegex();
var Ue = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var Ke = d(Ue, "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var We = d(/\\(punct)/, "gu").replace(/punct/g, I).getRegex();
var Xe = d(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var Je = d(K).replace("(?:-->|$)", "-->").getRegex();
var Ve = d("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", Je).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var v = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/;
var Ye = d(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", v).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var ke = d(/^!?\[(label)\]\[(ref)\]/).replace("label", v).replace("ref", U).getRegex();
var de = d(/^!?\[(ref)\](?:\[\])?/).replace("ref", U).getRegex();
var et = d("reflink|nolink(?!\\()", "g").replace("reflink", ke).replace("nolink", de).getRegex();
var ie = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var J = { _backpedal: _, anyPunctuation: We, autolink: Xe, blockSkip: He, br: ue, code: Ce, del: _, delLDelim: _, delRDelim: _, emStrongLDelim: Ze, emStrongRDelimAst: Ne, emStrongRDelimUnd: je, escape: Ae, link: Ye, nolink: de, punctuation: De, reflink: ke, reflinkSearch: et, tag: Ve, text: Be, url: _ };
var tt = { ...J, link: d(/^!?\[(label)\]\((.*?)\)/).replace("label", v).getRegex(), reflink: d(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", v).getRegex() };
var Q = { ...J, emStrongRDelimAst: Qe, emStrongLDelim: Ge, delLDelim: Fe, delRDelim: Ke, url: d(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", ie).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: d(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", ie).getRegex() };
var nt = { ...Q, br: d(ue).replace("{2,}", "*").getRegex(), text: d(Q.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var D = { normal: W, gfm: Ee, pedantic: Ie };
var A = { normal: J, gfm: Q, breaks: nt, pedantic: tt };
var rt = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var ge = (l3) => rt[l3];
function O(l3, e) {
  if (e) {
    if (m.escapeTest.test(l3)) return l3.replace(m.escapeReplace, ge);
  } else if (m.escapeTestNoEncode.test(l3)) return l3.replace(m.escapeReplaceNoEncode, ge);
  return l3;
}
function V(l3) {
  try {
    l3 = encodeURI(l3).replace(m.percentDecode, "%");
  } catch {
    return null;
  }
  return l3;
}
function Y(l3, e) {
  let t = l3.replace(m.findPipe, (r, i, o) => {
    let u = false, a = i;
    for (; --a >= 0 && o[a] === "\\"; ) u = !u;
    return u ? "|" : " |";
  }), n = t.split(m.splitPipe), s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; s < n.length; s++) n[s] = n[s].trim().replace(m.slashPipe, "|");
  return n;
}
function $(l3, e, t) {
  let n = l3.length;
  if (n === 0) return "";
  let s = 0;
  for (; s < n; ) {
    let r = l3.charAt(n - s - 1);
    if (r === e && !t) s++;
    else if (r !== e && t) s++;
    else break;
  }
  return l3.slice(0, n - s);
}
function ee(l3) {
  let e = l3.split(`
`), t = e.length - 1;
  for (; t >= 0 && m.blankLine.test(e[t]); ) t--;
  return e.length - t <= 2 ? l3 : e.slice(0, t + 1).join(`
`);
}
function fe(l3, e) {
  if (l3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l3.length; n++) if (l3[n] === "\\") n++;
  else if (l3[n] === e[0]) t++;
  else if (l3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function me(l3, e = 0) {
  let t = e, n = "";
  for (let s of l3) if (s === "	") {
    let r = 4 - t % 4;
    n += " ".repeat(r), t += r;
  } else n += s, t++;
  return n;
}
function xe(l3, e, t, n, s) {
  let r = e.href, i = e.title || null, o = l3[1].replace(s.other.outputLinkReplace, "$1");
  n.state.inLink = true;
  let u = { type: l3[0].charAt(0) === "!" ? "image" : "link", raw: t, href: r, title: i, text: o, tokens: n.inlineTokens(o) };
  return n.state.inLink = false, u;
}
function st(l3, e, t) {
  let n = l3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let s = n[1];
  return e.split(`
`).map((r) => {
    let i = r.match(t.other.beginningSpace);
    if (i === null) return r;
    let [o] = i;
    return o.length >= s.length ? r.slice(s.length) : r;
  }).join(`
`);
}
var w = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = this.options.pedantic ? t[0] : ee(t[0]), s = n.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: n, codeBlockStyle: "indented", text: s };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], s = st(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: s };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let s = $(n, "#");
        (this.options.pedantic || !s || this.rules.other.endingSpaceChar.test(s)) && (n = s.trim());
      }
      return { type: "heading", raw: $(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: $(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = $(t[0], `
`).split(`
`), s = "", r = "", i = [];
      for (; n.length > 0; ) {
        let o = false, u = [], a;
        for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) u.push(n[a]), o = true;
        else if (!o) u.push(n[a]);
        else break;
        n = n.slice(a);
        let c = u.join(`
`), p = c.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        s = s ? `${s}
${c}` : c, r = r ? `${r}
${p}` : p;
        let k = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(p, i, true), this.lexer.state.top = k, n.length === 0) break;
        let h = i.at(-1);
        if (h?.type === "code") break;
        if (h?.type === "blockquote") {
          let R = h, f = R.raw + `
` + n.join(`
`), S = this.blockquote(f);
          i[i.length - 1] = S, s = s.substring(0, s.length - R.raw.length) + S.raw, r = r.substring(0, r.length - R.text.length) + S.text;
          break;
        } else if (h?.type === "list") {
          let R = h, f = R.raw + `
` + n.join(`
`), S = this.list(f);
          i[i.length - 1] = S, s = s.substring(0, s.length - h.raw.length) + S.raw, r = r.substring(0, r.length - R.raw.length) + S.raw, n = f.substring(i.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: s, tokens: i, text: r };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), s = n.length > 1, r = { type: "list", raw: "", ordered: s, start: s ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
      let i = this.rules.other.listItemRegex(n), o = false;
      for (; e; ) {
        let a = false, c = "", p = "";
        if (!(t = i.exec(e)) || this.rules.block.hr.test(e)) break;
        c = t[0], e = e.substring(c.length);
        let k = me(t[2].split(`
`, 1)[0], t[1].length), h = e.split(`
`, 1)[0], R = !k.trim(), f = 0;
        if (this.options.pedantic ? (f = 2, p = k.trimStart()) : R ? f = t[1].length + 1 : (f = k.search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, p = k.slice(f), f += t[1].length), R && this.rules.other.blankLine.test(h) && (c += h + `
`, e = e.substring(h.length + 1), a = true), !a) {
          let S = this.rules.other.nextBulletRegex(f), te = this.rules.other.hrRegex(f), ne = this.rules.other.fencesBeginRegex(f), re = this.rules.other.headingBeginRegex(f), be = this.rules.other.htmlBeginRegex(f), Re = this.rules.other.blockquoteBeginRegex(f);
          for (; e; ) {
            let G = e.split(`
`, 1)[0], C;
            if (h = G, this.options.pedantic ? (h = h.replace(this.rules.other.listReplaceNesting, "  "), C = h) : C = h.replace(this.rules.other.tabCharGlobal, "    "), ne.test(h) || re.test(h) || be.test(h) || Re.test(h) || S.test(h) || te.test(h)) break;
            if (C.search(this.rules.other.nonSpaceChar) >= f || !h.trim()) p += `
` + C.slice(f);
            else {
              if (R || k.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || ne.test(k) || re.test(k) || te.test(k)) break;
              p += `
` + h;
            }
            R = !h.trim(), c += G + `
`, e = e.substring(G.length + 1), k = C.slice(f);
          }
        }
        r.loose || (o ? r.loose = true : this.rules.other.doubleBlankLine.test(c) && (o = true)), r.items.push({ type: "list_item", raw: c, task: !!this.options.gfm && this.rules.other.listIsTask.test(p), loose: false, text: p, tokens: [] }), r.raw += c;
      }
      let u = r.items.at(-1);
      if (u) u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
      else return;
      r.raw = r.raw.trimEnd();
      for (let a of r.items) {
        this.lexer.state.top = false, a.tokens = this.lexer.blockTokens(a.text, []);
        let c = a.tokens[0];
        if (a.task && (c?.type === "text" || c?.type === "paragraph")) {
          a.text = a.text.replace(this.rules.other.listReplaceTask, ""), c.raw = c.raw.replace(this.rules.other.listReplaceTask, ""), c.text = c.text.replace(this.rules.other.listReplaceTask, "");
          for (let k = this.lexer.inlineQueue.length - 1; k >= 0; k--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[k].src)) {
            this.lexer.inlineQueue[k].src = this.lexer.inlineQueue[k].src.replace(this.rules.other.listReplaceTask, "");
            break;
          }
          let p = this.rules.other.listTaskCheckbox.exec(a.raw);
          if (p) {
            let k = { type: "checkbox", raw: p[0] + " ", checked: p[0] !== "[ ]" };
            a.checked = k.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = k.raw + a.tokens[0].raw, a.tokens[0].text = k.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(k)) : a.tokens.unshift({ type: "paragraph", raw: k.raw, text: k.raw, tokens: [k] }) : a.tokens.unshift(k);
          }
        } else a.task && (a.task = false);
        if (!r.loose) {
          let p = a.tokens.filter((h) => h.type === "space"), k = p.length > 0 && p.some((h) => this.rules.other.anyLine.test(h.raw));
          r.loose = k;
        }
      }
      if (r.loose) for (let a of r.items) {
        a.loose = true;
        for (let c of a.tokens) c.type === "text" && (c.type = "paragraph");
      }
      return r;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) {
      let n = ee(t[0]);
      return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
    }
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: $(t[0], `
`), href: s, title: r };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = Y(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], i = { type: "table", raw: $(t[0], `
`), header: [], align: [], rows: [] };
    if (n.length === s.length) {
      for (let o of s) this.rules.other.tableAlignRight.test(o) ? i.align.push("right") : this.rules.other.tableAlignCenter.test(o) ? i.align.push("center") : this.rules.other.tableAlignLeft.test(o) ? i.align.push("left") : i.align.push(null);
      for (let o = 0; o < n.length; o++) i.header.push({ text: n[o], tokens: this.lexer.inline(n[o]), header: true, align: i.align[o] });
      for (let o of r) i.rows.push(Y(o, i.header.length).map((u, a) => ({ text: u, tokens: this.lexer.inline(u), header: false, align: i.align[a] })));
      return i;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: $(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
        if (!this.rules.other.endAngleBracket.test(n)) return;
        let i = $(n.slice(0, -1), "\\");
        if ((n.length - i.length) % 2 === 0) return;
      } else {
        let i = fe(t[2], "()");
        if (i === -2) return;
        if (i > -1) {
          let u = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
          t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, u).trim(), t[3] = "";
        }
      }
      let s = t[2], r = "";
      if (this.options.pedantic) {
        let i = this.rules.other.pedanticHrefTitle.exec(s);
        i && (s = i[1], r = i[3]);
      } else r = t[3] ? t[3].slice(1, -1) : "";
      return s = s.trim(), this.rules.other.startAngleBracket.test(s) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? s = s.slice(1) : s = s.slice(1, -1)), xe(t, { href: s && s.replace(this.rules.inline.anyPunctuation, "$1"), title: r && r.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let s = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), r = t[s.toLowerCase()];
      if (!r) {
        let i = n[0].charAt(0);
        return { type: "text", raw: i, text: i };
      }
      return xe(n, r, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let s = this.rules.inline.emStrongLDelim.exec(e);
    if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let i = [...s[0]].length - 1, o, u, a = i, c = 0, p = s[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (p.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = p.exec(t)) !== null; ) {
        if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o) continue;
        if (u = [...o].length, s[3] || s[4]) {
          a += u;
          continue;
        } else if ((s[5] || s[6]) && i % 3 && !((i + u) % 3)) {
          c += u;
          continue;
        }
        if (a -= u, a > 0) continue;
        u = Math.min(u, u + a + c);
        let k = [...s[0]][0].length, h = e.slice(0, i + s.index + k + u);
        if (Math.min(i, u) % 2) {
          let f = h.slice(1, -1);
          return { type: "em", raw: h, text: f, tokens: this.lexer.inlineTokens(f) };
        }
        let R = h.slice(2, -2);
        return { type: "strong", raw: h, text: R, tokens: this.lexer.inlineTokens(R) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return s && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let s = this.rules.inline.delLDelim.exec(e);
    if (!s) return;
    if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let i = [...s[0]].length - 1, o, u, a = i, c = this.rules.inline.delRDelim;
      for (c.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = c.exec(t)) !== null; ) {
        if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o || (u = [...o].length, u !== i)) continue;
        if (s[3] || s[4]) {
          a += u;
          continue;
        }
        if (a -= u, a > 0) continue;
        u = Math.min(u, u + a);
        let p = [...s[0]][0].length, k = e.slice(0, i + s.index + p + u), h = k.slice(i, -i);
        return { type: "del", raw: k, text: h, tokens: this.lexer.inlineTokens(h) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, s;
      return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, s;
      if (t[2] === "@") n = t[0], s = "mailto:" + n;
      else {
        let r;
        do
          r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (r !== t[0]);
        n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: t[0], escaped: n };
    }
  }
};
var x = class l {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || T, this.options.tokenizer = this.options.tokenizer || new w(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, top: true };
    let t = { other: m, block: D.normal, inline: A.normal };
    this.options.pedantic ? (t.block = D.pedantic, t.inline = A.pedantic) : this.options.gfm && (t.block = D.gfm, this.options.breaks ? t.inline = A.breaks : t.inline = A.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: D, inline: A };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, ""));
    let s = 1 / 0;
    for (; e; ) {
      if (e.length < s) s = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      let r;
      if (this.options.extensions?.block?.some((o) => (r = o.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        r.raw.length === 1 && o !== void 0 ? o.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.at(-1).src = o.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.raw, this.inlineQueue.at(-1).src = o.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let i = e;
      if (this.options.extensions?.startBlock) {
        let o = 1 / 0, u = e.slice(1), a;
        this.options.extensions.startBlock.forEach((c) => {
          a = c.call({ lexer: this }, u), typeof a == "number" && a >= 0 && (o = Math.min(o, a));
        }), o < 1 / 0 && o >= 0 && (i = e.substring(0, o + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(i))) {
        let o = t.at(-1);
        n && o?.type === "paragraph" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = e, s = null;
    if (this.tokens.links) {
      let a = Object.keys(this.tokens.links);
      if (a.length > 0) for (; (s = this.tokenizer.rules.inline.reflinkSearch.exec(n)) !== null; ) a.includes(s[0].slice(s[0].lastIndexOf("[") + 1, -1)) && (n = n.slice(0, s.index) + "[" + "a".repeat(s[0].length - 2) + "]" + n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex));
    }
    for (; (s = this.tokenizer.rules.inline.anyPunctuation.exec(n)) !== null; ) n = n.slice(0, s.index) + "++" + n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
    let r;
    for (; (s = this.tokenizer.rules.inline.blockSkip.exec(n)) !== null; ) r = s[2] ? s[2].length : 0, n = n.slice(0, s.index + r) + "[" + "a".repeat(s[0].length - r - 2) + "]" + n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
    n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let i = false, o = "", u = 1 / 0;
    for (; e; ) {
      if (e.length < u) u = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      i || (o = ""), i = false;
      let a;
      if (this.options.extensions?.inline?.some((p) => (a = p.call({ lexer: this }, e, t)) ? (e = e.substring(a.raw.length), t.push(a), true) : false)) continue;
      if (a = this.tokenizer.escape(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.tag(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.link(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(a.raw.length);
        let p = t.at(-1);
        a.type === "text" && p?.type === "text" ? (p.raw += a.raw, p.text += a.text) : t.push(a);
        continue;
      }
      if (a = this.tokenizer.emStrong(e, n, o)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.codespan(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.br(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.del(e, n, o)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (a = this.tokenizer.autolink(e)) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      if (!this.state.inLink && (a = this.tokenizer.url(e))) {
        e = e.substring(a.raw.length), t.push(a);
        continue;
      }
      let c = e;
      if (this.options.extensions?.startInline) {
        let p = 1 / 0, k = e.slice(1), h;
        this.options.extensions.startInline.forEach((R) => {
          h = R.call({ lexer: this }, k), typeof h == "number" && h >= 0 && (p = Math.min(p, h));
        }), p < 1 / 0 && p >= 0 && (c = e.substring(0, p + 1));
      }
      if (a = this.tokenizer.inlineText(c)) {
        e = e.substring(a.raw.length), a.raw.slice(-1) !== "_" && (o = a.raw.slice(-1)), i = true;
        let p = t.at(-1);
        p?.type === "text" ? (p.raw += a.raw, p.text += a.text) : t.push(a);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return t;
  }
  infiniteLoopError(e) {
    let t = "Infinite loop on byte: " + e;
    if (this.options.silent) console.error(t);
    else throw new Error(t);
  }
};
var y = class {
  options;
  parser;
  constructor(e) {
    this.options = e || T;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let s = (t || "").match(m.notSpaceStart)?.[0], r = e.replace(m.endingNewline, "") + `
`;
    return s ? '<pre><code class="language-' + O(s) + '">' + (n ? r : O(r, true)) + `</code></pre>
` : "<pre><code>" + (n ? r : O(r, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, s = "";
    for (let o = 0; o < e.items.length; o++) {
      let u = e.items[o];
      s += this.listitem(u);
    }
    let r = t ? "ol" : "ul", i = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + r + i + `>
` + s + "</" + r + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
    t += this.tablerow({ text: n });
    let s = "";
    for (let r = 0; r < e.rows.length; r++) {
      let i = e.rows[r];
      n = "";
      for (let o = 0; o < i.length; o++) n += this.tablecell(i[o]);
      s += this.tablerow({ text: n });
    }
    return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${O(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, tokens: n }) {
    let s = this.parser.parseInline(n), r = V(e);
    if (r === null) return s;
    e = r;
    let i = '<a href="' + e + '"';
    return t && (i += ' title="' + O(t) + '"'), i += ">" + s + "</a>", i;
  }
  image({ href: e, title: t, text: n, tokens: s }) {
    s && (n = this.parser.parseInline(s, this.parser.textRenderer));
    let r = V(e);
    if (r === null) return O(n);
    e = r;
    let i = `<img src="${e}" alt="${O(n)}"`;
    return t && (i += ` title="${O(t)}"`), i += ">", i;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
  }
};
var L = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var b = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || T, this.options.renderer = this.options.renderer || new y(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new L();
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0; n < e.length; n++) {
      let s = e[n];
      if (this.options.extensions?.renderers?.[s.type]) {
        let i = s, o = this.options.extensions.renderers[i.type].call({ parser: this }, i);
        if (o !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "html", "def", "paragraph", "text"].includes(i.type)) {
          t += o || "";
          continue;
        }
      }
      let r = s;
      switch (r.type) {
        case "space": {
          t += this.renderer.space(r);
          break;
        }
        case "hr": {
          t += this.renderer.hr(r);
          break;
        }
        case "heading": {
          t += this.renderer.heading(r);
          break;
        }
        case "code": {
          t += this.renderer.code(r);
          break;
        }
        case "table": {
          t += this.renderer.table(r);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(r);
          break;
        }
        case "list": {
          t += this.renderer.list(r);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(r);
          break;
        }
        case "html": {
          t += this.renderer.html(r);
          break;
        }
        case "def": {
          t += this.renderer.def(r);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(r);
          break;
        }
        case "text": {
          t += this.renderer.text(r);
          break;
        }
        default: {
          let i = 'Token with "' + r.type + '" type was not found.';
          if (this.options.silent) return console.error(i), "";
          throw new Error(i);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let s = 0; s < e.length; s++) {
      let r = e[s];
      if (this.options.extensions?.renderers?.[r.type]) {
        let o = this.options.extensions.renderers[r.type].call({ parser: this }, r);
        if (o !== false || !["escape", "html", "link", "image", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
          n += o || "";
          continue;
        }
      }
      let i = r;
      switch (i.type) {
        case "escape": {
          n += t.text(i);
          break;
        }
        case "html": {
          n += t.html(i);
          break;
        }
        case "link": {
          n += t.link(i);
          break;
        }
        case "image": {
          n += t.image(i);
          break;
        }
        case "checkbox": {
          n += t.checkbox(i);
          break;
        }
        case "strong": {
          n += t.strong(i);
          break;
        }
        case "em": {
          n += t.em(i);
          break;
        }
        case "codespan": {
          n += t.codespan(i);
          break;
        }
        case "br": {
          n += t.br(i);
          break;
        }
        case "del": {
          n += t.del(i);
          break;
        }
        case "text": {
          n += t.text(i);
          break;
        }
        default: {
          let o = 'Token with "' + i.type + '" type was not found.';
          if (this.options.silent) return console.error(o), "";
          throw new Error(o);
        }
      }
    }
    return n;
  }
};
var P = class {
  options;
  block;
  constructor(e) {
    this.options = e || T;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer(e = this.block) {
    return e ? x.lex : x.lexInline;
  }
  provideParser(e = this.block) {
    return e ? b.parse : b.parseInline;
  }
};
var q = class {
  defaults = M();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = b;
  Renderer = y;
  TextRenderer = L;
  Lexer = x;
  Tokenizer = w;
  Hooks = P;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
      case "table": {
        let r = s;
        for (let i of r.header) n = n.concat(this.walkTokens(i.tokens, t));
        for (let i of r.rows) for (let o of i) n = n.concat(this.walkTokens(o.tokens, t));
        break;
      }
      case "list": {
        let r = s;
        n = n.concat(this.walkTokens(r.items, t));
        break;
      }
      default: {
        let r = s;
        this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((i) => {
          let o = r[i].flat(1 / 0);
          n = n.concat(this.walkTokens(o, t));
        }) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let s = { ...n };
      if (s.async = this.defaults.async || s.async || false, n.extensions && (n.extensions.forEach((r) => {
        if (!r.name) throw new Error("extension name required");
        if ("renderer" in r) {
          let i = t.renderers[r.name];
          i ? t.renderers[r.name] = function(...o) {
            let u = r.renderer.apply(this, o);
            return u === false && (u = i.apply(this, o)), u;
          } : t.renderers[r.name] = r.renderer;
        }
        if ("tokenizer" in r) {
          if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let i = t[r.level];
          i ? i.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
        }
        "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
      }), s.extensions = t), n.renderer) {
        let r = this.defaults.renderer || new y(this.defaults);
        for (let i in n.renderer) {
          if (!(i in r)) throw new Error(`renderer '${i}' does not exist`);
          if (["options", "parser"].includes(i)) continue;
          let o = i, u = n.renderer[o], a = r[o];
          r[o] = (...c) => {
            let p = u.apply(r, c);
            return p === false && (p = a.apply(r, c)), p || "";
          };
        }
        s.renderer = r;
      }
      if (n.tokenizer) {
        let r = this.defaults.tokenizer || new w(this.defaults);
        for (let i in n.tokenizer) {
          if (!(i in r)) throw new Error(`tokenizer '${i}' does not exist`);
          if (["options", "rules", "lexer"].includes(i)) continue;
          let o = i, u = n.tokenizer[o], a = r[o];
          r[o] = (...c) => {
            let p = u.apply(r, c);
            return p === false && (p = a.apply(r, c)), p;
          };
        }
        s.tokenizer = r;
      }
      if (n.hooks) {
        let r = this.defaults.hooks || new P();
        for (let i in n.hooks) {
          if (!(i in r)) throw new Error(`hook '${i}' does not exist`);
          if (["options", "block"].includes(i)) continue;
          let o = i, u = n.hooks[o], a = r[o];
          P.passThroughHooks.has(i) ? r[o] = (c) => {
            if (this.defaults.async && P.passThroughHooksRespectAsync.has(i)) return (async () => {
              let k = await u.call(r, c);
              return a.call(r, k);
            })();
            let p = u.call(r, c);
            return a.call(r, p);
          } : r[o] = (...c) => {
            if (this.defaults.async) return (async () => {
              let k = await u.apply(r, c);
              return k === false && (k = await a.apply(r, c)), k;
            })();
            let p = u.apply(r, c);
            return p === false && (p = a.apply(r, c)), p;
          };
        }
        s.hooks = r;
      }
      if (n.walkTokens) {
        let r = this.defaults.walkTokens, i = n.walkTokens;
        s.walkTokens = function(o) {
          let u = [];
          return u.push(i.call(this, o)), r && (u = u.concat(r.call(this, o))), u;
        };
      }
      this.defaults = { ...this.defaults, ...s };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return x.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return b.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, s) => {
      let r = { ...s }, i = { ...this.defaults, ...r }, o = this.onError(!!i.silent, !!i.async);
      if (this.defaults.async === true && r.async === false) return o(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return o(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return o(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (i.hooks && (i.hooks.options = i, i.hooks.block = e), i.async) return (async () => {
        let u = i.hooks ? await i.hooks.preprocess(n) : n, c = await (i.hooks ? await i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(u, i), p = i.hooks ? await i.hooks.processAllTokens(c) : c;
        i.walkTokens && await Promise.all(this.walkTokens(p, i.walkTokens));
        let h = await (i.hooks ? await i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(p, i);
        return i.hooks ? await i.hooks.postprocess(h) : h;
      })().catch(o);
      try {
        i.hooks && (n = i.hooks.preprocess(n));
        let a = (i.hooks ? i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(n, i);
        i.hooks && (a = i.hooks.processAllTokens(a)), i.walkTokens && this.walkTokens(a, i.walkTokens);
        let p = (i.hooks ? i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(a, i);
        return i.hooks && (p = i.hooks.postprocess(p)), p;
      } catch (u) {
        return o(u);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let s = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(s) : s;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var z = new q();
function g(l3, e) {
  return z.parse(l3, e);
}
g.options = g.setOptions = function(l3) {
  return z.setOptions(l3), g.defaults = z.defaults, N(g.defaults), g;
};
g.getDefaults = M;
g.defaults = T;
g.use = function(...l3) {
  return z.use(...l3), g.defaults = z.defaults, N(g.defaults), g;
};
g.walkTokens = function(l3, e) {
  return z.walkTokens(l3, e);
};
g.parseInline = z.parseInline;
g.Parser = b;
g.parser = b.parse;
g.Renderer = y;
g.TextRenderer = L;
g.Lexer = x;
g.lexer = x.lex;
g.Tokenizer = w;
g.Hooks = P;
g.parse = g;
var Ft = g.options;
var Ut = g.setOptions;
var Kt = g.use;
var Wt = g.walkTokens;
var Xt = g.parseInline;
var Vt = b.parse;
var Yt = x.lex;

// src/image-client.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
var worker;
var active;
var stopping = false;
var nextId = 0;
var idle;
var queue = [];
function settle(error, value) {
  const job = active;
  active = void 0;
  if (job) {
    clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.cancel);
    if (error) job.reject(error);
    else job.resolve(value);
  }
}
function stop(error) {
  stopping = true;
  settle(error);
  worker?.kill("SIGKILL");
  if (!worker) {
    stopping = false;
    pump();
  }
}
function pump() {
  if (active || stopping) return;
  clearTimeout(idle);
  if (!queue.length) {
    if (worker) {
      const current = worker;
      current.unref();
      for (const stream of [current.stdin, current.stdout, current.stderr]) stream.unref?.();
      idle = setTimeout(() => {
        if (worker === current && !active) {
          stopping = true;
          current.kill();
        }
      }, 5e3);
      idle.unref();
    }
    return;
  }
  active = queue.shift();
  if (!worker) {
    const node = process.env.PI_VIEW_NODE || (process.versions.bun ? "node" : process.execPath);
    const current = worker = spawn(node, [fileURLToPath(new URL("./image-worker.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    current.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4096);
    });
    current.stdin.on("error", (error) => {
      if (worker === current) stop(error);
    });
    const lines = createInterface({ input: current.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (worker !== current || stopping) return;
      try {
        const result = JSON.parse(line);
        if (result.id !== active?.id) return;
        if (result.error) settle(new Error(result.error));
        else settle(void 0, { ...result, data: Buffer.from(result.data, "base64") });
        pump();
      } catch (error) {
        stop(error);
      }
    });
    current.on("error", (error) => {
      if (worker === current) settle(new Error(`Image worker could not start: ${error.message}. Install Node.js >=22.19 or set PI_VIEW_NODE.`));
    });
    current.on("close", () => {
      if (worker !== current) return;
      lines.close();
      worker = void 0;
      stopping = false;
      settle(new Error(`Image worker stopped${stderr ? `: ${stderr.trim()}` : ""}`));
      pump();
    });
  }
  worker.ref();
  for (const stream of [worker.stdin, worker.stdout, worker.stderr]) stream.ref?.();
  const job = active;
  if (!job) return;
  job.timer = setTimeout(() => stop(new Error("Image rendering exceeded the 20 second limit")), 2e4);
  worker.stdin.write(job.payload + "\n");
}
function request(operation, data, metadata, signal) {
  signal?.throwIfAborted();
  if (data.length > 32 * 1024 * 1024) throw new Error("Image exceeds the 32 MiB worker limit");
  if (queue.length >= 16) throw new Error("Too many pending image previews");
  const deferred = Promise.withResolvers();
  const id = ++nextId;
  const job = {
    id,
    payload: JSON.stringify({ id, operation, data: data.toString("base64"), ...metadata }),
    resolve: deferred.resolve,
    reject: deferred.reject,
    signal,
    cancel: () => {
      const error = new Error("Image preview aborted");
      if (active === job) stop(error);
      else {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        signal?.removeEventListener("abort", job.cancel);
        deferred.reject(error);
      }
    }
  };
  signal?.addEventListener("abort", job.cancel, { once: true });
  queue.push(job);
  pump();
  return deferred.promise;
}
async function decodeImage(data, label, signal) {
  const result = await request("decode", data, { label }, signal);
  return { data: result.data, width: result.width, height: result.height, label: result.label };
}
async function renderRaster(image, options, signal) {
  return (await request("render", image.data, { image: { width: image.width, height: image.height, label: image.label }, options }, signal)).data;
}
function stopImageWorker() {
  clearTimeout(idle);
  for (const job of queue.splice(0)) {
    job.signal?.removeEventListener("abort", job.cancel);
    job.reject(new Error("Image viewer shut down"));
  }
  if (worker) stop(new Error("Image viewer shut down"));
}

// src/documents.ts
var TEXT_LIMIT = 2 * 1024 * 1024;
var IMAGE_LIMIT = 32 * 1024 * 1024;
var PDF_LIMIT = 128 * 1024 * 1024;
var imageExtensions = { ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true };
function safeText(text) {
  return stripVTControlCharacters(text.replace(/\x1b[P_^][\s\S]*?(?:\x1b\\|$)/g, "")).replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}
async function boundedRead(path3, limit, signal) {
  signal?.throwIfAborted();
  const file = await open(path3, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat6 = await file.stat();
    if (!stat6.isFile()) throw new Error("Only regular files can be previewed");
    if (stat6.size > limit) throw new Error(`File exceeds the ${Math.round(limit / 1024 / 1024)} MiB preview limit`);
    const buffer = Buffer.alloc(Math.min(stat6.size + 1, limit + 1));
    let length = 0;
    while (length < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat6.size || length > limit) throw new Error("File changed while reading; reload the preview");
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}
function markdownBlocks(source) {
  const spans = [];
  const prefix = /^[ \t]*(?:(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+)[ \t]*)*/gm;
  const positions = [];
  let normalized = "";
  for (const match of source.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0];
    const stripped = line.replace(prefix, "");
    const removed = line.length - stripped.length;
    normalized += stripped;
    for (let i = removed; i < line.length; i++) positions.push(match.index + i);
  }
  function visit(tokens2, start, end) {
    let cursor2 = start;
    for (const token of tokens2) {
      const raw = token.raw?.replace(prefix, "");
      if (!raw) continue;
      const at = normalized.indexOf(raw, cursor2);
      if (at < cursor2 || at + raw.length > end) continue;
      const stop2 = at + raw.length;
      cursor2 = stop2;
      if (token.type === "image") {
        spans.push({ start: positions[at], end: positions[stop2 - 1] + 1, target: token.href, alt: token.text });
      } else if (token.type !== "code" && token.type !== "codespan" && token.type !== "html") {
        if ("tokens" in token && Array.isArray(token.tokens)) visit(token.tokens, at, stop2);
        if (token.type === "list") visit(token.items, at, stop2);
        if (token.type === "table") {
          let cellCursor = at;
          for (const cell of [...token.header, ...token.rows.flat()]) {
            const text = cell.text.replace(prefix, "");
            const cellAt = normalized.indexOf(text, cellCursor);
            if (cellAt >= cellCursor && cellAt < stop2) {
              visit(cell.tokens, cellAt, cellAt + text.length);
              cellCursor = cellAt + text.length;
            }
          }
        }
      }
    }
  }
  const tokens = g.lexer(source);
  visit(tokens, 0, normalized.length);
  const definitions = Object.entries(tokens.links).map(([name, link]) => `[${name.replace(/[\]\\]/g, "\\$&")}]: <${link.href.replace(/>/g, "%3E")}>${link.title ? ` ${JSON.stringify(link.title)}` : ""}`).join("\n");
  const blocks = [];
  let cursor = 0;
  for (const span of spans.sort((a, b2) => a.start - b2.start)) {
    if (span.start < cursor) continue;
    if (span.start > cursor) blocks.push({ kind: "text", text: source.slice(cursor, span.start) });
    blocks.push({ kind: "image", target: span.target, alt: safeText(span.alt) });
    cursor = span.end;
  }
  if (cursor < source.length) blocks.push({ kind: "text", text: source.slice(cursor) });
  if (definitions) {
    for (const block of blocks) if (block.kind === "text") block.text += `

${definitions}
`;
  }
  return blocks;
}
async function loadDocument(path3, signal) {
  const extension = extname(path3).toLowerCase();
  if ([".html", ".htm", ".xhtml", ".mhtml", ".mht"].includes(extension)) {
    throw new Error("HTML and webpage preview are intentionally not supported");
  }
  if (imageExtensions[extension]) return { kind: "image", path: path3, image: await loadImage(pathToFileURL(path3).href, dirname(path3), false, signal) };
  if (extension === ".pdf") {
    await checkPdf(path3, signal);
    const info = await run("pdfinfo", [path3], signal);
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
    if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("Could not read PDF page count (encrypted or invalid PDF)");
    return { kind: "pdf", path: path3, pages };
  }
  const bytes = await boundedRead(path3, TEXT_LIMIT, signal);
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("This is not a supported image/PDF or UTF-8 text file");
  }
  if (source.includes("\0")) throw new Error("Binary file preview is not supported");
  source = safeText(source);
  const markdown = [".md", ".markdown", ".mdown", ".mkd"].includes(extension);
  return {
    kind: markdown ? "markdown" : "text",
    path: path3,
    source,
    language: extension.slice(1),
    blocks: markdown ? markdownBlocks(source) : [{ kind: "text", text: source }]
  };
}
async function remoteImage(url, signal) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Unsupported image URL");
  const abort = AbortSignal.any([AbortSignal.timeout(1e4), ...signal ? [signal] : []]);
  const response = await fetch(parsed, { signal: abort, credentials: "omit" });
  if (!response.ok || !response.body) throw new Error(`Image download failed: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMAGE_LIMIT) throw new Error("Remote image exceeds the 32 MiB limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {
    });
  }
  return Buffer.concat(chunks);
}
async function loadImage(target, baseDir, allowRemote, signal) {
  let bytes;
  if (/^https?:\/\//i.test(target)) {
    if (!allowRemote) throw new Error("Remote image not fetched; press R to allow remote images for this preview");
    bytes = await remoteImage(target, signal);
  } else if (/^data:/i.test(target)) {
    const match = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i.exec(target);
    if (!match || target.length > IMAGE_LIMIT * 1.4) throw new Error("Unsupported or oversized embedded image");
    bytes = Buffer.from(match[1], "base64");
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) && !target.startsWith("file:") && !/^[a-z]:[\\/]/i.test(target)) throw new Error("Unsupported image scheme");
    let path3 = target.startsWith("file:") ? fileURLToPath2(target) : target;
    if (!target.startsWith("file:")) {
      try {
        path3 = decodeURIComponent(path3);
      } catch {
      }
    }
    bytes = await boundedRead(resolve2(baseDir, path3), IMAGE_LIMIT, signal);
  }
  return decodeImage(bytes, target.startsWith("data:") ? "embedded image" : target, signal);
}
function run(command, args, signal) {
  const { promise, resolve: resolveResult, reject } = Promise.withResolvers();
  let failure = null;
  let output = "";
  const child = execFile(command, args, {
    signal,
    timeout: 2e4,
    killSignal: "SIGKILL",
    maxBuffer: TEXT_LIMIT,
    encoding: "utf8",
    windowsHide: true
  }, (error, stdout) => {
    failure = error;
    output = stdout;
  });
  child.once("close", () => {
    if (failure?.code === "ENOENT") reject(new Error(`${command} is missing. Install Poppler (brew install poppler / apt install poppler-utils).`));
    else if (failure) reject(new Error(safeText(failure.message)));
    else resolveResult(output);
  });
  return promise;
}
async function checkPdf(path3, signal) {
  signal?.throwIfAborted();
  const file = await open(path3, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat6 = await file.stat();
    if (!stat6.isFile() || stat6.size > PDF_LIMIT) throw new Error("PDF must be a regular file no larger than 128 MiB");
    const signature = Buffer.alloc(5);
    await file.read(signature, 0, 5, 0);
    if (signature.toString() !== "%PDF-") throw new Error("Invalid PDF signature");
  } finally {
    await file.close();
  }
}
async function loadPdfPage(path3, page, signal) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid PDF page number");
  await checkPdf(path3, signal);
  const dir = await mkdtemp(join2(tmpdir(), "pi-view-"));
  try {
    const prefix = join2(dir, "page");
    await run("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "2400", "-png", path3, prefix], signal);
    return decodeImage(await boundedRead(`${prefix}.png`, IMAGE_LIMIT, signal), `${path3} \xB7 page ${page}`, signal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function pdfText(path3, signal) {
  await checkPdf(path3, signal);
  return safeText(await run("pdftotext", ["-layout", path3, "-"], signal));
}
async function mediaDiagnostics() {
  const node = process.env.PI_VIEW_NODE || (process.versions.bun ? "node" : process.execPath);
  return Promise.all(["pdfinfo", "pdftoppm", "pdftotext", node].map(async (command) => {
    try {
      await run(command, command === node ? ["--version"] : ["-v"]);
      return `${command === node ? "Node image worker" : command}: available`;
    } catch (error) {
      return `${command}: ${safeText(error.message)}`;
    }
  }));
}

// src/viewer.ts
import { watch } from "node:fs";
import { stat as stat2 } from "node:fs/promises";
import { basename, dirname as dirname2 } from "node:path";
import { stripVTControlCharacters as stripVTControlCharacters2 } from "node:util";
import { getLanguageFromPath, getMarkdownTheme, highlightCode } from "@earendil-works/pi-coding-agent";
import { Input, Markdown, isKeyRelease, matchesKey, parseKey, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// src/host.ts
import { randomInt } from "node:crypto";
import * as piTui from "@earendil-works/pi-tui";
var {
  Image,
  allocateImageId,
  deleteKittyImage,
  getCapabilities,
  getCellDimensions,
  getImageDimensions
} = piTui;
var SIXEL_IMAGE_PROTOCOL = "\x1BPq";
var KITTY_IMAGE_PROTOCOL = "\x1B_G";
var ITERM2_IMAGE_PROTOCOL = "\x1B]1337;File=";
function ompTerminal() {
  return piTui.TERMINAL;
}
function hostImageProtocol() {
  return ompTerminal()?.imageProtocol;
}
function mapHostImageProtocol(marker) {
  if (marker === KITTY_IMAGE_PROTOCOL) return "kitty";
  if (marker === ITERM2_IMAGE_PROTOCOL) return "iterm2";
  if (marker === SIXEL_IMAGE_PROTOCOL) return "sixel";
  return null;
}
function imagesDisabled(env) {
  const value = env.PI_VIEW_IMAGES?.trim().toLowerCase();
  return value === "off" || value === "0" || value === "false";
}
function detectTerminalName(env) {
  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
  const term = env.TERM?.toLowerCase() ?? "";
  if (env.KITTY_WINDOW_ID || termProgram === "kitty") return "kitty";
  if (env.GHOSTTY_RESOURCES_DIR || termProgram === "ghostty" || term.includes("ghostty")) return "ghostty";
  if (env.WEZTERM_PANE || termProgram === "wezterm") return "wezterm";
  if (env.ITERM_SESSION_ID || termProgram === "iterm.app") return "iterm2";
  if (env.ALACRITTY_WINDOW_ID || termProgram === "alacritty") return "alacritty";
  if (env.VSCODE_PID || termProgram === "vscode") return "vscode";
  if (termProgram === "warpterminal" || env.WARP_SESSION_ID || env.WARP_TERMINAL_SESSION_UUID) return "warp";
  if (env.WT_SESSION) return "windows-terminal";
  if (termProgram === "apple_terminal") return "terminal.app";
  if (env.TERMINAL_EMULATOR === "jetbrains-jediterm") return "jetbrains";
  return env.TERM || "unknown";
}
function detectMultiplexer(env) {
  if (env.TMUX) return "tmux";
  if (env.STY) return "screen";
  if (env.ZELLIJ) return "zellij";
  return "none";
}
function resolveImageProtocol(env, hostProtocolMarker) {
  if (imagesDisabled(env)) {
    return { protocol: null, detail: `images: disabled (PI_VIEW_IMAGES=${env.PI_VIEW_IMAGES})` };
  }
  const marker = hostProtocolMarker === void 0 ? hostImageProtocol() : hostProtocolMarker;
  if (marker === SIXEL_IMAGE_PROTOCOL) {
    return { protocol: "sixel", detail: "protocol: sixel (host-reported)" };
  }
  if (env.PI_FORCE_IMAGE_PROTOCOL?.trim() && marker !== void 0) {
    const mapped = mapHostImageProtocol(marker);
    return {
      protocol: mapped,
      detail: mapped ? `protocol: ${mapped} (host override)` : "protocol: none (host override)"
    };
  }
  const caps = getCapabilities();
  if (caps.images) return { protocol: caps.images, detail: `protocol: ${caps.images}` };
  const mux = detectMultiplexer(env);
  if (mux !== "none") {
    return { protocol: null, detail: `protocol: none (${mux} conservatively disables image protocols)` };
  }
  return { protocol: null, detail: "protocol: none (terminal fallback)" };
}
function hostDiagnostics(env) {
  const onSsh = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
  const cell = getCellDimensions();
  const details = [
    `host: ${ompTerminal() ? "oh-my-pi" : "pi"}`,
    `terminal: ${detectTerminalName(env)}`,
    `multiplexer: ${detectMultiplexer(env)}`,
    `ssh: ${onSsh ? "yes" : "no"}`,
    `cell: ${cell.widthPx}x${cell.heightPx}px`
  ];
  const forced = env.PI_FORCE_IMAGE_PROTOCOL?.trim().toLowerCase();
  if (forced) details.push(`env: PI_FORCE_IMAGE_PROTOCOL=${forced}`);
  return details;
}
function capabilities(env = process.env, hostProtocolMarker) {
  const cell = getCellDimensions();
  const cellWidth = Math.max(1, cell.widthPx);
  const cellHeight = Math.max(1, cell.heightPx);
  const resolved = resolveImageProtocol(env, hostProtocolMarker);
  return {
    protocol: resolved.protocol,
    cellWidth,
    cellHeight,
    details: [...hostDiagnostics(env), resolved.detail]
  };
}
function fitCells(dims, maxWidthCells, maxHeightCells, cell) {
  const scale = Math.min(
    maxWidthCells * cell.widthPx / dims.widthPx,
    maxHeightCells * cell.heightPx / dims.heightPx
  );
  return {
    columns: Math.max(1, Math.min(maxWidthCells, Math.ceil(dims.widthPx * scale / cell.widthPx))),
    rows: Math.max(1, Math.min(maxHeightCells, Math.ceil(dims.heightPx * scale / cell.heightPx)))
  };
}
function sanitizeLabel(label) {
  return label.replace(/[\x00-\x1f\x7f]/gu, " ").replace(/\s+/gu, " ").trim();
}
function writeRaw(tui, data) {
  const terminal = tui?.terminal;
  if (typeof terminal?.write === "function") {
    terminal.write(data);
  } else {
    process.stdout.write(data);
  }
}
function createTerminalImage(png, widthCells, heightCells, label, tui) {
  const maxWidthCells = Math.max(1, Math.floor(widthCells));
  const maxHeightCells = Math.max(1, Math.floor(heightCells));
  const base64 = png.toString("base64");
  const cell = getCellDimensions();
  const dims = getImageDimensions(base64, "image/png") ?? {
    widthPx: maxWidthCells * cell.widthPx,
    heightPx: maxHeightCells * cell.heightPx
  };
  const fit = fitCells(dims, maxWidthCells, maxHeightCells, cell);
  const protocol = resolveImageProtocol(process.env).protocol;
  const imageId = protocol === "kitty" ? typeof allocateImageId === "function" ? allocateImageId() : randomInt(1, 4294967296) : void 0;
  const native = new Image(
    base64,
    "image/png",
    { fallbackColor: (s) => s },
    {
      maxWidthCells,
      maxHeightCells,
      filename: sanitizeLabel(label),
      ...imageId !== void 0 ? { imageId } : {}
    },
    dims
  );
  let disposed = false;
  let nativeLines;
  let ownedLines;
  return {
    get imageId() {
      return imageId;
    },
    get columns() {
      return fit.columns;
    },
    get rows() {
      return fit.rows;
    },
    render(width) {
      if (disposed) return [];
      const lines = native.render(width);
      if (imageId === void 0) return lines;
      if (lines === nativeLines) return ownedLines;
      nativeLines = lines;
      ownedLines = lines.map((line) => line.replace(/\x1b_G([^;]*);/g, (sequence, header) => {
        const fields = header.split(",");
        if (!fields.some((field) => field === "a=T" || field === "a=t" || field === "a=p")) return sequence;
        if (fields.includes(`i=${imageId}`)) return sequence;
        return `\x1B_G${fields.filter((field) => !field.startsWith("i=")).join(",")},i=${imageId};`;
      }));
      return ownedLines;
    },
    invalidate() {
      native.invalidate();
      nativeLines = void 0;
      ownedLines = void 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      native.invalidate();
      nativeLines = void 0;
      ownedLines = void 0;
      if (imageId !== void 0) {
        try {
          const ompDelete = piTui.encodeKittyDeleteImage;
          const remove = typeof deleteKittyImage === "function" ? deleteKittyImage : ompDelete;
          let sequence;
          if (remove) sequence = remove(imageId);
          else {
            sequence = `\x1B_Ga=d,d=I,i=${imageId},q=2\x1B\\`;
            if (process.env.TMUX) sequence = `\x1BPtmux;${sequence.replaceAll("\x1B", "\x1B\x1B")}\x1B\\`;
          }
          writeRaw(tui, sequence);
        } catch {
        }
      }
    }
  };
}
var WHEEL_STEP_LINES = 3;
var MAX_PENDING_BYTES = 64;
var SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
var SGR_MOUSE_PARTIAL = /^\x1b\[<[\d;]*$/;
var X10_MOUSE_PREFIX = "\x1B[M";
var URXVT_MOUSE = /^\x1b\[(\d+);(\d+);(\d+)[Mm]/;
var DECRPM_REPLY = /^\x1b\[\?(\d+);(\d+)\$y/;
var DECRPM_PARTIAL = /^\x1b\[\?[\d;]+\$?$/;
var MOUSE_ENABLE = "\x1B[?1000h\x1B[?1006h";
var MOUSE_QUERY = "\x1B[?1000$p\x1B[?1002$p\x1B[?1003$p\x1B[?1006$p";
var PROBED_MODES = [1e3, 1002, 1003, 1006];
function wheelDelta(button) {
  if ((button & 64) === 0) return null;
  const direction = button & 3;
  if (direction === 0) return -WHEEL_STEP_LINES;
  if (direction === 1) return WHEEL_STEP_LINES;
  return null;
}
function probeTimeoutMs(env) {
  const raw = Number.parseInt(env.PI_VIEW_MOUSE_PROBE_MS ?? "", 10);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(2e3, raw));
  return 200;
}
function parseMouseStream(buffer, state) {
  const events = [];
  let rest = "";
  let pos = 0;
  while (pos < buffer.length) {
    const slice = buffer.slice(pos);
    if (state.probing) {
      const reply = DECRPM_REPLY.exec(slice);
      if (reply) {
        events.push({ kind: "decrpm", mode: Number(reply[1]), value: Number(reply[2]) });
        pos += reply[0].length;
        continue;
      }
      if (slice.length <= MAX_PENDING_BYTES && DECRPM_PARTIAL.test(slice)) {
        return { events, rest, held: slice };
      }
    }
    if (!slice.startsWith("\x1B")) {
      const nextEsc2 = slice.indexOf("\x1B");
      const plain = nextEsc2 === -1 ? slice : slice.slice(0, nextEsc2);
      rest += plain;
      pos += plain.length;
      continue;
    }
    const sgr = SGR_MOUSE.exec(slice);
    if (sgr) {
      const delta = wheelDelta(Number(sgr[1]));
      events.push(delta === null ? { kind: "noise" } : { kind: "wheel", delta });
      pos += sgr[0].length;
      continue;
    }
    if (slice.startsWith(X10_MOUSE_PREFIX) && slice.length >= 6) {
      const delta = wheelDelta(slice.charCodeAt(3) - 32);
      events.push(delta === null ? { kind: "noise" } : { kind: "wheel", delta });
      pos += 6;
      continue;
    }
    const urxvt = URXVT_MOUSE.exec(slice);
    if (urxvt) {
      const delta = wheelDelta(Number(urxvt[1]) - 32);
      events.push(delta === null ? { kind: "noise" } : { kind: "wheel", delta });
      pos += urxvt[0].length;
      continue;
    }
    const holdable = slice.length <= MAX_PENDING_BYTES && (slice === X10_MOUSE_PREFIX || slice.startsWith(X10_MOUSE_PREFIX) && slice.length < 6 || slice.startsWith("\x1B[<") && SGR_MOUSE_PARTIAL.test(slice) || state.probing && DECRPM_PARTIAL.test(slice));
    if (holdable) {
      return { events, rest, held: slice };
    }
    const nextEsc = slice.indexOf("\x1B", 1);
    const chunk = nextEsc === -1 ? slice : slice.slice(0, nextEsc);
    rest += chunk;
    pos += chunk.length;
  }
  return { events, rest, held: "" };
}
function attachMouse(tui, onWheel) {
  if (typeof tui.addInputListener !== "function") return () => {
  };
  const timeout = probeTimeoutMs(process.env);
  const state = { probing: timeout > 0, pendingModes: new Set(PROBED_MODES), held: "" };
  const originalModes = /* @__PURE__ */ new Map();
  const changedModes = [];
  let detached = false;
  let timer;
  const listener = (data) => {
    if (detached) return;
    const { events, rest, held } = parseMouseStream(state.held + data, state);
    state.held = held;
    for (const event of events) {
      if (event.kind === "decrpm" && state.pendingModes.delete(event.mode)) {
        originalModes.set(event.mode, event.value);
        if (!state.pendingModes.size) {
          state.probing = false;
          if ([...originalModes.values()].every((value) => value >= 1 && value <= 4)) {
            const tracking = [1e3, 1002, 1003].some((mode) => [1, 3].includes(originalModes.get(mode)));
            if (!tracking && originalModes.get(1e3) === 2) changedModes.push(1e3);
            if (originalModes.get(1006) === 2) changedModes.push(1006);
            for (const mode of changedModes) writeRaw(tui, `\x1B[?${mode}h`);
          }
        }
      } else if (event.kind === "wheel") {
        onWheel(event.delta);
      }
    }
    if (!state.held && rest === data) return;
    return rest ? { data: rest } : { consume: true };
  };
  const removeListener = tui.addInputListener(listener);
  if (timeout > 0) {
    writeRaw(tui, MOUSE_QUERY);
    timer = setTimeout(() => {
      state.probing = false;
      state.held = "";
    }, timeout);
    timer.unref();
  } else {
    changedModes.push(1e3, 1006);
    writeRaw(tui, MOUSE_ENABLE);
  }
  return () => {
    if (detached) return;
    detached = true;
    clearTimeout(timer);
    state.held = "";
    removeListener();
    try {
      for (const mode of changedModes.reverse()) writeRaw(tui, `\x1B[?${mode}l`);
    } catch {
    }
  };
}

// src/viewer.ts
var HELP = `pi-view \u2014 local previews; nothing is sent to the model

/view <path> or /v <path>    Tab completes files and directories
/view or /v                Quick Open: recent session files and paths
Cmd+P                     Quick Open above any dialog (if forwarded)
/view --diagnostics        Terminal capabilities and PDF dependencies

Esc / Ctrl+C               Close and restore the agent UI
Up/Down, j/k, PgUp/PgDn     Scroll text; arrows pan an image
Home / End                 Start / end of text
/                          Search text (or filter the file picker)
n / N                      Next / previous search match
w                          Toggle line wrapping
l                          Toggle source line numbers
s                          Markdown source / PDF extracted text
Enter or i                 Focus the first visible Markdown image
b                          Return from an image/help/diagnostics
+ / - or mouse wheel       Zoom a focused image or PDF page
0 / 1                      Fit / actual raster size
[ / ] or PgUp/PgDn         Previous / next PDF page
g                          Jump to a PDF page
r                          Reload (source file changes also reload)
R                          Ask to load remote Markdown images
o                          Browse the current file's directory
? / d                      Help / diagnostics

PNG, JPEG, static GIF, WebP and SVG; SVG is rasterized.
Images are bounded to 4096px per side; actual size uses that raster.
PDF requires Poppler. Scans have no searchable text without OCR.
No HTML/webpages, animation, JavaScript or automatic remote fetching.
Quick Open: arrows select, Tab completes, Enter opens; Esc clears then closes.
Ghostty forwarding if needed: keybind = super+p=csi:112;9u
PI_VIEW_IMAGES=off forces text/path fallbacks.
Mouse support depends on the terminal; keyboard controls always work.`;
var PreviewViewer = class {
  constructor(tui, theme, done, path3, initial) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.path = path3;
    this.detachMouse = attachMouse(tui, (delta) => this.wheel(delta));
    this.input.onSubmit = (value) => this.submitInput(value);
    if (initial === "help") this.panel = HELP;
    else if (initial === "diagnostics") void this.showDiagnostics();
    else void this.open(path3);
  }
  document;
  abort = new AbortController();
  closed = false;
  loading = false;
  message = "";
  path;
  watcher;
  reloadTimer;
  detachMouse;
  offset = 0;
  matchRow;
  horizontal = 0;
  width = 80;
  bodyHeight = 20;
  totalRows = 0;
  wrap = true;
  numbers = false;
  source = false;
  page = 1;
  pdfSource;
  pdfTextLoading;
  focusImage;
  zoom = 1;
  actualSize = false;
  panX = 0.5;
  panY = 0.5;
  remoteAllowed = false;
  remotePrompt = false;
  panel;
  layout;
  frames = /* @__PURE__ */ new Map();
  images = /* @__PURE__ */ new Map();
  imageJobs = Promise.resolve();
  requestedImages = /* @__PURE__ */ new Set();
  visibleImages = [];
  input = new Input();
  inputMode;
  query = "";
  filter = "";
  picker;
  _focused = false;
  get focused() {
    return this._focused;
  }
  set focused(value) {
    this._focused = value;
    this.input.focused = value && !!this.inputMode;
    if (!value) {
      this.detachMouse?.();
      this.detachMouse = void 0;
    } else if (!this.closed && !this.detachMouse) this.detachMouse = attachMouse(this.tui, (delta) => this.wheel(delta));
  }
  redraw(clearLayout = false) {
    if (clearLayout) {
      this.layout = void 0;
      this.matchRow = void 0;
    }
    if (!this.closed) this.tui.requestRender();
  }
  invalidate() {
    this.layout = void 0;
    for (const frame of this.frames.values()) frame.component?.invalidate();
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.watcher?.close();
    clearTimeout(this.reloadTimer);
    this.detachMouse?.();
    this.detachMouse = void 0;
    this.clearFrames();
    this.images.clear();
  }
  clearFrames() {
    for (const frame of this.frames.values()) {
      frame.abort.abort();
      frame.component?.dispose();
    }
    this.frames.clear();
  }
  async open(path3, reload = false) {
    clearTimeout(this.reloadTimer);
    this.abort.abort();
    const controller = this.abort = new AbortController();
    if (path3 !== this.path) {
      this.watcher?.close();
      this.watcher = void 0;
    }
    this.clearFrames();
    this.images.clear();
    this.loading = true;
    this.message = "";
    if (!this.watcher) this.watchPath(path3);
    if (!reload) {
      this.document = void 0;
      this.picker = void 0;
      this.panel = void 0;
      this.offset = 0;
      this.horizontal = 0;
      this.source = false;
      this.page = 1;
      this.query = "";
      this.filter = "";
      this.focusImage = void 0;
      this.remoteAllowed = false;
      this.resetZoom();
    }
    this.pdfSource = void 0;
    this.path = path3;
    this.redraw(true);
    try {
      const info = await stat2(path3);
      if (controller.signal.aborted) return;
      if (info.isDirectory()) {
        this.watcher?.close();
        this.watcher = void 0;
        const entries = await listDirectory(path3);
        if (controller.signal.aborted) return;
        this.picker = { directory: path3, entries, selected: 0 };
        if (entries.length >= MAX_LIST_ENTRIES) this.message = `Listing capped at ${MAX_LIST_ENTRIES} entries; open a specific path directly`;
        this.document = void 0;
      } else {
        const document = await loadDocument(path3, controller.signal);
        if (controller.signal.aborted) return;
        this.document = document;
        this.picker = void 0;
        if (document.kind === "pdf") {
          this.page = Math.min(this.page, document.pages);
          if (!capabilities().protocol) this.source = true;
        }
        if (document.kind === "image") this.images.set(path3, { image: document.image });
        if (this.source && document.kind === "pdf") void this.loadPdfText();
      }
    } catch (error) {
      if (!controller.signal.aborted) this.message = safeText(error.message);
    } finally {
      if (!controller.signal.aborted) {
        this.loading = false;
        this.redraw(true);
      }
    }
  }
  watchPath(path3) {
    try {
      this.watcher = watch(dirname2(path3), (_event, name) => {
        if (name && name.toString() !== basename(path3)) return;
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          if (!this.closed) void this.open(path3, true);
        }, 200);
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = void 0;
        this.message = "File watching unavailable; press r to reload";
        this.redraw();
      });
    } catch {
      this.message = "File watching unavailable; press r to reload";
    }
  }
  resetZoom() {
    this.zoom = 1;
    this.actualSize = false;
    this.panX = 0.5;
    this.panY = 0.5;
  }
  async showDiagnostics() {
    const cap = capabilities();
    this.panel = ["pi-view diagnostics", "", ...cap.details, "", "Checking PDF tools\u2026"].join("\n");
    this.offset = 0;
    this.clearFrames();
    this.redraw(true);
    const panel = this.panel;
    const media = await mediaDiagnostics();
    if (!this.closed && this.panel === panel) {
      this.panel = ["pi-view diagnostics", "", ...cap.details, "", ...media, "", "Images: sharp, static first frame; maximum source raster 4096px/side", "HTML/webpages and animation: disabled", "Remote Markdown images: permission required", "Preview content: never added to model context", "", "b: back \xB7 Esc: close"].join("\n");
      this.redraw(true);
    }
  }
  imageMode() {
    return !this.panel && !this.picker && (!!this.focusImage || this.document?.kind === "image" || this.document?.kind === "pdf" && !this.source);
  }
  wheel(delta) {
    if (this.closed || this.inputMode || this.remotePrompt) return;
    if (this.imageMode()) this.zoom = Math.max(0.05, Math.min(32, this.zoom * (delta < 0 ? 1.2 : 1 / 1.2)));
    else if (this.picker) this.picker.selected = Math.max(0, Math.min(this.filteredEntries().length - 1, this.picker.selected + Math.sign(delta) * 3));
    else this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset + Math.sign(delta) * 3));
    this.redraw();
  }
  handleInput(data) {
    if (this.closed || isKeyRelease(data)) return;
    const key = parseKey(data);
    if (key?.length === 1) data = key;
    else if (key && /^shift\+[a-z]$/.test(key)) data = key.slice(-1).toUpperCase();
    else if (key === "shift+=") data = "+";
    else if (key === "shift+/") data = "?";
    else if (key === "space") data = " ";
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.dispose();
      this.done();
      return;
    }
    if (this.remotePrompt) {
      this.remotePrompt = false;
      if (data.toLowerCase() === "y") {
        this.remoteAllowed = true;
        this.images.clear();
        this.clearFrames();
        this.redraw(true);
      } else this.redraw();
      return;
    }
    if (this.inputMode) {
      this.input.handleInput(data);
      this.redraw();
      return;
    }
    if (data === "?") {
      this.panel = HELP;
      this.offset = 0;
      this.clearFrames();
      this.redraw(true);
      return;
    }
    if (data === "d") {
      void this.showDiagnostics();
      return;
    }
    if (data === "b") {
      this.panel = void 0;
      this.focusImage = void 0;
      this.offset = 0;
      this.resetZoom();
      if (!this.document && !this.picker) void this.open(this.path);
      this.redraw(true);
      return;
    }
    if (data === "r") {
      void this.open(this.path, true);
      return;
    }
    if (data === "o") {
      void this.open(this.picker?.directory ?? dirname2(this.path));
      return;
    }
    if (data === "R" && this.document?.kind === "markdown") {
      this.remotePrompt = true;
      this.redraw();
      return;
    }
    if (data === "/") {
      this.startInput(this.picker ? "filter" : "search");
      return;
    }
    if (this.picker && !this.panel) {
      const entries = this.filteredEntries();
      if (matchesKey(data, "enter") && entries[this.picker.selected]) void this.open(entries[this.picker.selected].path);
      else if (matchesKey(data, "backspace") || matchesKey(data, "left")) void this.open(dirname2(this.picker.directory));
      else if (matchesKey(data, "up") || data === "k") this.picker.selected = Math.max(0, this.picker.selected - 1);
      else if (matchesKey(data, "down") || data === "j") this.picker.selected = Math.min(entries.length - 1, this.picker.selected + 1);
      else if (matchesKey(data, "pageUp")) this.picker.selected = Math.max(0, this.picker.selected - this.bodyHeight);
      else if (matchesKey(data, "pageDown")) this.picker.selected = Math.min(entries.length - 1, this.picker.selected + this.bodyHeight);
      this.redraw();
      return;
    }
    if (data === "s" && !this.panel && (this.document?.kind === "markdown" || this.document?.kind === "pdf")) {
      this.source = !this.source;
      this.focusImage = void 0;
      this.offset = 0;
      this.clearFrames();
      if (this.source && this.document.kind === "pdf" && this.pdfSource === void 0) void this.loadPdfText();
      this.redraw(true);
      return;
    }
    if (this.document?.kind === "pdf" && !this.panel) {
      if (data === "g") {
        this.startInput("page");
        return;
      }
      if (data === "[" || data === "]" || this.imageMode() && (matchesKey(data, "pageUp") || matchesKey(data, "pageDown"))) {
        this.page = Math.max(1, Math.min(this.document.pages, this.page + (data === "[" || matchesKey(data, "pageUp") ? -1 : 1)));
        this.resetZoom();
        this.redraw();
        return;
      }
    }
    if (this.imageMode()) {
      if (data === "+" || data === "=") this.zoom = Math.min(32, this.zoom * 1.2);
      else if (data === "-") this.zoom = Math.max(0.05, this.zoom / 1.2);
      else if (data === "0") this.resetZoom();
      else if (data === "1") {
        this.zoom = 1;
        this.actualSize = true;
      } else if (matchesKey(data, "left") || data === "h") this.panX = Math.max(0, this.panX - 0.1);
      else if (matchesKey(data, "right") || data === "l") this.panX = Math.min(1, this.panX + 0.1);
      else if (matchesKey(data, "up") || data === "k") this.panY = Math.max(0, this.panY - 0.1);
      else if (matchesKey(data, "down") || data === "j") this.panY = Math.min(1, this.panY + 0.1);
      this.redraw();
      return;
    }
    if ((matchesKey(data, "enter") || data === "i") && this.visibleImages.length) {
      this.focusImage = this.visibleImages[0];
      this.resetZoom();
      this.redraw();
      return;
    }
    if (data === "w") {
      this.wrap = !this.wrap;
      this.horizontal = 0;
      this.redraw(true);
      return;
    }
    if (data === "l") {
      this.numbers = !this.numbers;
      this.redraw(true);
      return;
    }
    if (data === "n" || data === "N") {
      this.findMatch(data === "N" ? -1 : 1);
      return;
    }
    if (matchesKey(data, "up") || data === "k") this.offset--;
    else if (matchesKey(data, "down") || data === "j") this.offset++;
    else if (matchesKey(data, "pageUp")) this.offset -= this.bodyHeight;
    else if (matchesKey(data, "pageDown") || data === " ") this.offset += this.bodyHeight;
    else if (matchesKey(data, "home")) this.offset = 0;
    else if (matchesKey(data, "end")) this.offset = Math.max(0, this.totalRows - this.bodyHeight);
    else if (matchesKey(data, "left")) this.horizontal = Math.max(0, this.horizontal - 8);
    else if (matchesKey(data, "right")) this.horizontal = Math.min(1e5, this.horizontal + 8);
    this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset));
    this.redraw();
  }
  startInput(mode) {
    this.inputMode = mode;
    this.input.setValue(mode === "filter" ? this.filter : mode === "search" ? this.query : "");
    this.input.handleInput("\x1B[F");
    this.input.focused = this.focused;
    this.redraw();
  }
  submitInput(value) {
    const mode = this.inputMode;
    this.inputMode = void 0;
    this.input.focused = false;
    value = safeText(value).replace(/\n/g, "");
    if (mode === "filter") {
      this.filter = value;
      if (this.picker) this.picker.selected = 0;
    }
    if (mode === "search") {
      this.query = value;
      this.findMatch(1, true);
    }
    if (mode === "page" && this.document?.kind === "pdf") {
      const page = Number(value);
      if (Number.isInteger(page) && page >= 1 && page <= this.document.pages) {
        this.page = page;
        this.resetZoom();
      } else this.message = `Choose a page from 1 to ${this.document.pages}`;
    }
    this.redraw();
  }
  async loadPdfText() {
    const controller = this.abort;
    if (this.pdfTextLoading === controller) return;
    this.pdfTextLoading = controller;
    this.message = "Extracting PDF text\u2026";
    this.redraw();
    try {
      const source = await pdfText(this.path, controller.signal);
      if (controller.signal.aborted) return;
      this.pdfSource = source || "No text layer found. Scanned PDFs require OCR (not included).";
      this.message = "";
      this.redraw(true);
    } catch (error) {
      if (!controller.signal.aborted) {
        this.message = safeText(error.message);
        this.redraw();
      }
    } finally {
      if (this.pdfTextLoading === controller) this.pdfTextLoading = void 0;
    }
  }
  filteredEntries() {
    return this.picker?.entries.filter((entry) => entry.name.toLowerCase().includes(this.filter.toLowerCase())) ?? [];
  }
  textLines(text, width, code = false) {
    const language = this.document && getLanguageFromPath(this.document.path);
    const lines = code && text.length <= 1e5 ? highlightCode(text, language) : text.split("\n");
    const digits = String(lines.length).length;
    return lines.flatMap((line, index) => {
      const prefix = this.numbers ? this.theme.fg("dim", `${String(index + 1).padStart(digits)} \u2502 `) : "";
      const indent = this.numbers ? digits + 3 : 0;
      const contentWidth = Math.max(1, width - indent);
      const expanded = line.replace(/\t/g, "    ");
      const wrapped = this.wrap ? wrapTextWithAnsi(expanded, contentWidth) : [expanded];
      return wrapped.map((part, partIndex) => (partIndex === 0 ? prefix : " ".repeat(indent)) + part);
    });
  }
  getLayout(width) {
    const key = `${width}|${this.bodyHeight}|${this.source}|${this.wrap}|${this.numbers}|${this.panel ?? ""}|${this.pdfSource ?? ""}`;
    if (this.layout?.key === key) return this.layout.blocks;
    let blocks = [];
    if (this.panel) blocks = [{ kind: "text", lines: this.textLines(this.panel, width) }];
    else if (this.document?.kind === "markdown" && !this.source) {
      const theme = getMarkdownTheme();
      const highlight = theme.highlightCode;
      theme.highlightCode = (code, lang) => code.length <= 1e5 && highlight ? highlight(code, lang) : code.split("\n");
      const renderWidth = this.wrap ? width : Math.min(4096, this.document.source.split("\n").reduce((max, line) => Math.max(max, visibleWidth(line)), width));
      blocks = this.document.blocks.map((block) => block.kind === "image" ? { kind: "image", target: block.target, alt: block.alt, rows: !capabilities().protocol || !this.remoteAllowed && /^https?:\/\//i.test(block.target) ? 1 : Math.max(2, Math.min(12, this.bodyHeight - 1)) } : { kind: "text", lines: new Markdown(block.text, 0, 0, theme).render(renderWidth) });
    } else if (this.document?.kind === "text" || this.document?.kind === "markdown") {
      blocks = [{ kind: "text", lines: this.textLines(this.document.source, width, true) }];
    } else if (this.document?.kind === "pdf" && this.source) {
      blocks = [{ kind: "text", lines: this.textLines(this.pdfSource ?? "Extracting text\u2026", width) }];
    }
    this.layout = { key, blocks };
    return blocks;
  }
  findMatch(direction, includeCurrent = false) {
    if (!this.query) return;
    const rows = [];
    for (const block of this.getLayout(this.width)) {
      if (block.kind === "text") for (const line of block.lines) rows.push(stripVTControlCharacters2(line));
      else rows.push(`[${block.target}]`, ...Array(block.rows - 1).fill(""));
    }
    const from = includeCurrent ? this.offset : this.matchRow ?? this.offset;
    for (let step = includeCurrent ? 0 : 1; step <= rows.length; step++) {
      const index = (from + step * direction + rows.length) % rows.length;
      if (rows[index]?.toLowerCase().includes(this.query.toLowerCase())) {
        this.matchRow = index;
        this.offset = index;
        this.message = "";
        this.redraw();
        return;
      }
    }
    this.message = `No match: ${this.query}`;
    this.redraw();
  }
  getImage(target) {
    let entry = this.images.get(target);
    if (entry?.image) return Promise.resolve(entry.image);
    if (entry?.error) return Promise.reject(new Error(entry.error));
    if (entry?.promise) return entry.promise;
    entry = { abort: new AbortController() };
    this.images.set(target, entry);
    const source = entry;
    const signal = AbortSignal.any([this.abort.signal, entry.abort.signal]);
    const path3 = this.path;
    const page = this.document?.kind === "pdf" ? this.page : void 0;
    const allowRemote = this.remoteAllowed;
    const promise = this.imageJobs.then(() => {
      signal.throwIfAborted();
      return page !== void 0 && target === `pdf:${page}` ? loadPdfPage(path3, page, signal) : loadImage(target, dirname2(path3), allowRemote, signal);
    });
    source.promise = promise.then((image) => {
      source.image = image;
      source.promise = void 0;
      const completed = [...this.images].filter(([, entry2]) => entry2.image);
      for (const [key] of completed.slice(0, Math.max(0, completed.length - 4))) this.images.delete(key);
      return image;
    }, (error) => {
      source.error = safeText(error.message);
      source.promise = void 0;
      throw error;
    });
    this.imageJobs = source.promise.catch(() => {
    });
    return source.promise;
  }
  imageLines(target, width, fullRows, top, rows, focused, used) {
    this.requestedImages.add(target);
    const cap = capabilities();
    const label = safeText(target.startsWith("data:") ? "embedded image" : target).replace(/[\n\t]/g, " ");
    if (!cap.protocol || width < 5) return [truncateToWidth(this.theme.fg("muted", `[${safeText(label)}] \u2014 terminal images unavailable; d: diagnostics`), width), ...Array(rows - 1).fill("")];
    const key = [
      target,
      width,
      fullRows,
      top,
      rows,
      cap.protocol,
      cap.cellWidth,
      cap.cellHeight,
      focused ? `${this.zoom}|${this.actualSize}|${this.panX}|${this.panY}` : "fit"
    ].join("|");
    used.add(key);
    let frame = this.frames.get(key);
    if (!frame) {
      frame = { abort: new AbortController() };
      this.frames.set(key, frame);
      const current = frame;
      const signal = AbortSignal.any([this.abort.signal, frame.abort.signal]);
      void this.getImage(target).then((image) => renderRaster(image, {
        widthPx: Math.max(1, Math.floor((width - 2) * cap.cellWidth)),
        heightPx: Math.max(1, Math.floor(fullRows * cap.cellHeight)),
        zoom: focused ? this.zoom : 1,
        actualSize: focused && this.actualSize,
        panX: focused ? this.panX : 0.5,
        panY: focused ? this.panY : 0.5,
        cropTopPx: Math.floor(top * cap.cellHeight),
        cropHeightPx: Math.max(1, Math.floor(rows * cap.cellHeight))
      }, signal)).then((png) => {
        if (signal.aborted || this.closed) return;
        current.component = createTerminalImage(png, width - 2, rows, label, this.tui);
        this.redraw();
      }).catch((error) => {
        if (!signal.aborted && !this.closed) {
          current.error = safeText(error.message);
          this.redraw();
        }
      });
    }
    if (frame.component) {
      const lines = frame.component.render(width);
      return [...lines.slice(0, rows), ...Array(Math.max(0, rows - lines.length)).fill("")];
    }
    const status = frame.error ? ` \u2014 ${frame.error}` : " \u2014 loading\u2026";
    return [truncateToWidth(this.theme.fg("muted", `[${safeText(label)}]${status}`.replace(/[\n\t]/g, " ")), width), ...Array(rows - 1).fill("")];
  }
  render(width) {
    width = Math.max(1, width);
    if (this.tui.terminal.rows < 6) return [truncateToWidth("pi-view \xB7 enlarge terminal \xB7 Esc: close", width)];
    this.requestedImages.clear();
    this.width = Math.max(1, width);
    this.bodyHeight = Math.max(1, this.tui.terminal.rows - 5);
    const used = /* @__PURE__ */ new Set();
    let body = [];
    this.visibleImages = [];
    const document = this.document;
    let title = this.picker ? this.picker.directory : this.path;
    if (this.panel) title = "pi-view";
    if (this.loading) body = ["Loading\u2026"];
    else if (this.picker && !this.panel) {
      const entries = this.filteredEntries();
      const start = Math.max(0, this.picker.selected - this.bodyHeight + 1);
      body = entries.slice(start, start + this.bodyHeight).map((entry, i) => {
        const line = `${start + i === this.picker.selected ? ">" : " "} ${safeText(entry.name).replace(/[\n\t]/g, " ")}${entry.directory ? "/" : ""}`;
        return truncateToWidth(start + i === this.picker.selected ? this.theme.fg("accent", line) : line, width);
      });
      if (!entries.length) body = [truncateToWidth(this.filter ? "No matching files; / changes filter" : "Empty directory; Backspace goes to parent", width)];
      title += this.filter ? ` \xB7 filter: ${this.filter}` : "";
    } else if (this.imageMode()) {
      const target = this.focusImage ?? (document?.kind === "pdf" ? `pdf:${this.page}` : this.path);
      body = this.imageLines(target, width, this.bodyHeight, 0, this.bodyHeight, true, used);
      title += ` \xB7 ${this.actualSize ? "actual" : "fit"} \xD7${this.zoom.toFixed(2)}`;
      if (document?.kind === "pdf") title += ` \xB7 page ${this.page}/${document.pages}`;
    } else {
      const blocks = this.getLayout(width);
      this.totalRows = blocks.reduce((sum, block) => sum + (block.kind === "text" ? block.lines.length : block.rows), 0);
      this.offset = Math.max(0, Math.min(Math.max(0, this.totalRows - this.bodyHeight), this.offset));
      let cursor = 0;
      for (const block of blocks) {
        const count = block.kind === "text" ? block.lines.length : block.rows;
        const start = Math.max(0, this.offset - cursor);
        const end = Math.min(count, this.offset + this.bodyHeight - cursor);
        if (end > start) {
          if (block.kind === "image") {
            this.visibleImages.push(block.target);
            body.push(...this.imageLines(block.target, width, count, start, end - start, false, used));
          } else {
            body.push(...block.lines.slice(start, end).map((line) => {
              let shown = this.wrap ? truncateToWidth(line, width, "") : sliceByColumn(line, this.horizontal, width);
              if (this.query && stripVTControlCharacters2(line).toLowerCase().includes(this.query.toLowerCase())) shown = this.theme.bg("selectedBg", shown);
              return shown;
            }));
          }
        }
        cursor += count;
        if (cursor >= this.offset + this.bodyHeight) break;
      }
      if (this.totalRows) title += ` \xB7 ${this.offset + 1}/${this.totalRows}${this.source ? " \xB7 source" : ""}`;
      if (this.query && this.matchRow !== void 0) title += ` \xB7 match ${this.matchRow + 1}`;
    }
    for (const [key, frame] of this.frames) if (!used.has(key)) {
      frame.abort.abort();
      frame.component?.dispose();
      this.frames.delete(key);
    }
    for (const [target, source] of this.images) {
      if (source.promise && !this.requestedImages.has(target)) {
        source.abort?.abort();
        this.images.delete(target);
      }
    }
    body.push(...Array(Math.max(0, this.bodyHeight - body.length)).fill(""));
    let status = this.remotePrompt ? "Fetch remote Markdown images? Requests may reveal your IP. y: allow \xB7 any other key: deny" : this.message || (this.imageMode() ? "+/- wheel: zoom \xB7 arrows: pan \xB7 0: fit \xB7 1: actual \xB7 b: back \xB7 ?: help \xB7 Esc: close" : this.picker ? "\u2191\u2193: choose \xB7 Enter: open \xB7 Backspace: parent \xB7 /: filter \xB7 Esc: close" : "\u2191\u2193 wheel: scroll \xB7 /: search \xB7 n/N: matches \xB7 s: source/text \xB7 i: image \xB7 ?: help \xB7 Esc: close");
    if (this.inputMode) status = `${this.inputMode}: ${this.input.render(Math.max(1, width - this.inputMode.length - 2))[0] ?? ""}`;
    return [
      this.theme.fg("accent", truncateToWidth(safeText(title).replace(/[\n\t]/g, " "), width)),
      this.theme.fg("borderMuted", "\u2500".repeat(width)),
      ...body.slice(0, this.bodyHeight),
      this.theme.fg("borderMuted", "\u2500".repeat(width)),
      truncateToWidth(status.replace(/[\n\t]/g, " "), width)
    ];
  }
};

// src/quick-open.ts
import { stat as stat3 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { relative, sep } from "node:path";
import { Input as Input2, matchesKey as matchesKey2, truncateToWidth as truncateToWidth2 } from "@earendil-works/pi-tui";
var QuickOpen = class {
  constructor(tui, theme, cwd, recent, done) {
    this.tui = tui;
    this.theme = theme;
    this.cwd = cwd;
    this.done = done;
    this.input.onSubmit = () => {
      void this.choose();
    };
    void recent.then((paths) => {
      if (this.closed) return;
      this.recent = paths.slice(0, 20);
      this.loading = false;
      if (!this.input.getValue()) this.refresh();
      else this.tui.requestRender();
    }, (error) => {
      if (this.closed) return;
      this.loading = false;
      this.message = safeText(error.message);
      this.refresh();
    });
  }
  input = new Input2();
  recent = [];
  candidates = [];
  selected = 0;
  loading = true;
  message = "";
  closed = false;
  version = 0;
  _focused = false;
  detachMouse;
  get focused() {
    return this._focused;
  }
  set focused(value) {
    this._focused = value;
    this.input.focused = value;
    if (!value) {
      this.detachMouse?.();
      this.detachMouse = void 0;
    } else if (!this.closed && !this.detachMouse) this.detachMouse = attachMouse(this.tui, (delta) => {
      this.selected = Math.max(0, Math.min(this.candidates.length - 1, this.selected + Math.sign(delta)));
      this.tui.requestRender();
    });
  }
  invalidate() {
    this.input.invalidate();
  }
  dispose() {
    this.closed = true;
    this.version++;
    this.detachMouse?.();
    this.detachMouse = void 0;
  }
  displayPath(path3) {
    const local = relative(this.cwd, path3);
    if (local && local !== ".." && !local.startsWith(`..${sep}`) && !local.startsWith(sep)) return local;
    const home = homedir2();
    if (path3.startsWith(`${home}${sep}`)) return `~/${path3.slice(home.length + 1)}`;
    return path3;
  }
  refresh() {
    const value = this.input.getValue();
    this.candidates = value.length === 0 ? this.recent.map((path3) => ({ path: path3, value: this.displayPath(path3), directory: false })) : (completePath(value, this.cwd) ?? []).flatMap((item) => {
      try {
        return [{ path: resolvePath(item.value, this.cwd), value: item.value, directory: item.label.endsWith("/") }];
      } catch {
        return [];
      }
    });
    this.selected = value.length ? -1 : this.candidates.length ? 0 : -1;
    this.version++;
    if (!this.closed) this.tui.requestRender();
  }
  setValue(value) {
    this.input.setValue(safeText(value).replace(/[\n\t]/g, " "));
    this.input.handleInput("\x1B[F");
    this.message = "";
    this.refresh();
  }
  async choose() {
    if (this.closed) return;
    const version = ++this.version;
    const candidate = this.selected >= 0 ? this.candidates[this.selected] : void 0;
    const typed = this.input.getValue();
    if (!candidate && !typed) return;
    try {
      const path3 = candidate?.path ?? resolvePath(typed, this.cwd);
      const info = await stat3(path3);
      if (this.closed || version !== this.version) return;
      if (info.isDirectory()) {
        if (candidate?.directory) this.setValue(candidate.value);
        else {
          const value = `${this.displayPath(path3).replace(/[\\/]$/, "")}/`;
          this.setValue(/[\s"']/.test(value) ? JSON.stringify(value) : value);
        }
        return;
      }
      if (!info.isFile()) throw new Error("Choose a regular file");
      this.dispose();
      this.done(path3);
    } catch (error) {
      if (!this.closed && version === this.version) {
        this.message = safeText(error.message);
        this.tui.requestRender();
      }
    }
  }
  handleInput(data) {
    if (this.closed) return;
    if (matchesKey2(data, "escape")) {
      if (this.input.getValue().length) this.setValue("");
      else {
        this.dispose();
        this.done(void 0);
      }
      return;
    }
    if (matchesKey2(data, "ctrl+c")) {
      this.dispose();
      this.done(void 0);
      return;
    }
    if (matchesKey2(data, "up") || matchesKey2(data, "down")) {
      const length = this.candidates.length;
      if (length) {
        this.selected = matchesKey2(data, "down") ? Math.min(length - 1, this.selected + 1) : this.selected < 0 ? length - 1 : Math.max(0, this.selected - 1);
      }
      this.tui.requestRender();
      return;
    }
    if (matchesKey2(data, "tab")) {
      const candidate = this.candidates[this.selected < 0 ? 0 : this.selected];
      if (candidate) {
        const value = this.input.getValue().length ? candidate.value : /[\s"']/.test(candidate.value) ? JSON.stringify(candidate.value) : candidate.value;
        this.setValue(value);
      }
      return;
    }
    if (matchesKey2(data, "enter")) {
      void this.choose();
      return;
    }
    const before = this.input.getValue();
    this.input.handleInput(data);
    const cleaned = safeText(this.input.getValue()).replace(/[\n\t]/g, " ");
    if (cleaned !== this.input.getValue()) this.input.setValue(cleaned);
    if (this.input.getValue() !== before) {
      this.message = "";
      this.refresh();
    } else this.tui.requestRender();
  }
  render(width) {
    width = Math.max(1, width);
    const inner = Math.max(1, width - 4);
    const visible = Math.max(1, Math.min(5, this.tui.terminal.rows - 8));
    const start = Math.max(0, this.selected - visible + 1);
    const text = this.input.getValue();
    const header = text.length ? "Matching paths" : "Recent files in this session";
    const rows = this.candidates.slice(start, start + visible).map((item, index) => {
      const selected = start + index === this.selected;
      const label = `${selected ? ">" : " "} ${safeText(this.displayPath(item.path)).replace(/[\n\t]/g, " ")}${item.directory ? "/" : ""}`;
      return selected ? this.theme.fg("accent", label) : label;
    });
    if (!rows.length) rows.push(this.loading && !text ? "Loading recent files\u2026" : text ? "No suggestions \u2014 Enter opens the typed path" : "No recent files \u2014 type a path to open");
    while (rows.length < visible) rows.push("");
    const footer = this.message || `\u2191\u2193 select \xB7 Tab complete \xB7 Enter open \xB7 Esc ${text ? "clear" : "close"}`;
    const count = this.candidates.length ? ` \xB7 ${this.selected < 0 ? "\u2013" : this.selected + 1}/${this.candidates.length}` : "";
    const lines = [
      this.theme.fg("borderAccent", `\u256D${"\u2500".repeat(Math.max(0, width - 2))}\u256E`),
      this.theme.bold("Quick Open"),
      this.input.render(inner)[0] ?? "",
      this.theme.fg("muted", `${header}${count}`),
      ...rows,
      this.theme.fg(this.message ? "error" : "dim", footer.replace(/[\n\t]/g, " ")),
      this.theme.fg("borderAccent", `\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256F`)
    ];
    return lines.map((line, index) => index === 0 || index === lines.length - 1 ? truncateToWidth2(line, width, "") : truncateToWidth2(`  ${line}`, width, ""));
  }
};

// src/recents.ts
import { realpath, stat as stat4 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import * as path2 from "node:path";
var MAX_RECENT_FILES = 20;
var MAX_ENTRIES = 2e3;
var MAX_CANDIDATES = 1e3;
var MAX_TEXT_CHARS = 262144;
var MAX_ARG_DEPTH = 2;
var MAX_ARRAY_ITEMS = 64;
var ARG_KEYS = ["path", "file", "filePath", "file_path"];
var VIEW_OPEN_TYPE = "pi-view-open";
var MENTION_RE = /\[[^\]\n]*\]\(([^()\s]+)\)|`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|([^\s'"`()[\]<>|,;]+)/g;
var LINE_SUFFIX_RE = /(?:[:#]L?\d+(?::\d+)?(?:-L?\d+)*)+$/;
var TRAILING_PUNCT_RE = /[.,;:!?)\]}>'"]+$/;
var WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/;
var SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
var EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,11}$/;
function scanTextMentions(text, out) {
  if (text.length > MAX_TEXT_CHARS) text = text.slice(-MAX_TEXT_CHARS);
  for (const m2 of text.matchAll(MENTION_RE)) {
    const raw = m2[1] ?? m2[2] ?? m2[3] ?? m2[4] ?? m2[5];
    if (raw === void 0) continue;
    const s = raw.replace(TRAILING_PUNCT_RE, "").replace(LINE_SUFFIX_RE, "").replace(TRAILING_PUNCT_RE, "").trim();
    if (s === "") continue;
    const bare = m2[5] !== void 0;
    if (bare && (s.startsWith("-") || !/[\\/]/.test(s) && !EXT_RE.test(s))) continue;
    out.push(s);
  }
}
function argMentions(args, depth, out) {
  if (depth > MAX_ARG_DEPTH || typeof args !== "object" || args === null || Array.isArray(args)) return;
  const obj = args;
  for (const key of ARG_KEYS) {
    const v2 = obj[key];
    if (typeof v2 === "string") out.push(v2);
    else if (Array.isArray(v2)) {
      const items = v2.length > MAX_ARRAY_ITEMS ? v2.slice(0, MAX_ARRAY_ITEMS) : v2;
      for (const item of items) {
        if (typeof item === "string") out.push(item);
        else argMentions(item, depth + 1, out);
      }
    } else if (typeof v2 === "object" && v2 !== null) argMentions(v2, depth + 1, out);
  }
}
function pushContentMentions(content, out) {
  if (typeof content === "string") {
    scanTextMentions(content, out);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b2 = block;
    if (b2.type === "toolCall") argMentions(b2.arguments, 0, out);
    else if (typeof b2.text === "string") scanTextMentions(b2.text, out);
  }
}
function entryMentions(entry) {
  if (typeof entry !== "object" || entry === null) return [];
  const e = entry;
  if (e.type === "custom") {
    if (e.customType !== VIEW_OPEN_TYPE) return [];
    const data = e.data;
    const p = typeof data === "object" && data !== null ? data.path : void 0;
    return typeof p === "string" ? [p] : [];
  }
  if (e.type === "compaction" || e.type === "branch_summary") {
    const out2 = [];
    if (typeof e.summary === "string") scanTextMentions(e.summary, out2);
    return out2.reverse();
  }
  if (e.type !== "message") return [];
  const msg = e.message;
  if (typeof msg !== "object" || msg === null) return [];
  const m2 = msg;
  const out = [];
  if (typeof m2.command === "string") scanTextMentions(m2.command, out);
  if (typeof m2.output === "string") scanTextMentions(m2.output, out);
  if (typeof m2.fullOutputPath === "string") out.push(m2.fullOutputPath);
  pushContentMentions(m2.content, out);
  return out.reverse();
}
function toAbsolutePath(raw, cwd) {
  const s = raw.replace(TRAILING_PUNCT_RE, "").replace(LINE_SUFFIX_RE, "").replace(TRAILING_PUNCT_RE, "").trim();
  if (s === "") return null;
  if (WIN_DRIVE_RE.test(s)) return path2.resolve(s);
  const scheme = SCHEME_RE.exec(s);
  if (scheme) {
    const name = scheme[0].slice(0, -1).toLowerCase();
    if (name === "file") {
      try {
        return fileURLToPath3(s);
      } catch {
        return null;
      }
    }
    if (name.length === 1) return path2.resolve(cwd, s);
    return null;
  }
  const expanded = s === "~" ? homedir3() : s.startsWith("~/") ? path2.join(homedir3(), s.slice(2)) : s;
  return path2.resolve(cwd, expanded);
}
async function recentFiles(entries, cwd) {
  const out = [];
  const seenForms = /* @__PURE__ */ new Set();
  const seenReal = /* @__PURE__ */ new Set();
  let budget = MAX_CANDIDATES;
  const start = Math.max(0, entries.length - MAX_ENTRIES);
  for (let i = entries.length - 1; i >= start; i--) {
    for (const raw of entryMentions(entries[i])) {
      const abs = toAbsolutePath(raw, cwd);
      if (abs === null || seenForms.has(abs)) continue;
      seenForms.add(abs);
      if (budget-- <= 0) return out;
      const [st2, rp] = await Promise.all([stat4(abs).catch(() => null), realpath(abs).catch(() => null)]);
      if (st2 === null || rp === null || !st2.isFile()) continue;
      if (seenReal.has(rp)) continue;
      seenReal.add(rp);
      out.push(abs);
      if (out.length >= MAX_RECENT_FILES) return out;
    }
  }
  return out;
}

// src/index.ts
function piView(pi) {
  let cwd = process.cwd();
  let closePreview;
  let closeQuick;
  let detachShortcut;
  let quickPending = false;
  let providerInstalled = false;
  const completions = (args) => args.startsWith("--") ? ["--help", "--diagnostics"].filter((value) => value.startsWith(args)).map((value) => ({ value, label: value })) : completePath(args, cwd);
  async function showPreview(ctx, path3, initial) {
    closePreview?.();
    if (!initial) {
      try {
        if ((await stat5(path3)).isFile()) pi.appendEntry("pi-view-open", { path: path3 });
      } catch {
      }
    }
    let viewer;
    let localClose;
    try {
      await ctx.ui.custom((tui, theme, _keys, done) => {
        let ended = false;
        localClose = () => {
          if (ended) return;
          ended = true;
          viewer?.dispose();
          if (closePreview === localClose) closePreview = void 0;
          done();
        };
        viewer = new PreviewViewer(tui, theme, localClose, path3, initial);
        closePreview = localClose;
        return viewer;
      }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", row: 0, col: 0 } });
    } finally {
      viewer?.dispose();
      if (closePreview === localClose) closePreview = void 0;
    }
  }
  async function showQuick(ctx) {
    if (quickPending || !ctx.hasUI) return;
    quickPending = true;
    let quick;
    let picked;
    try {
      picked = await ctx.ui.custom((tui, theme, _keys, done) => {
        let ended = false;
        const finish = (path3) => {
          if (ended) return;
          ended = true;
          quick?.dispose();
          closeQuick = void 0;
          done(path3);
        };
        closeQuick = () => finish();
        quick = new QuickOpen(tui, theme, ctx.cwd, recentFiles(ctx.sessionManager.getBranch(), ctx.cwd), finish);
        return quick;
      }, { overlay: true, overlayOptions: { width: "80%", maxHeight: "90%", anchor: "top-center", row: 2 } });
    } finally {
      quick?.dispose();
      closeQuick = void 0;
      quickPending = false;
    }
    if (picked) await showPreview(ctx, picked);
  }
  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
    detachShortcut?.();
    if (!ctx.hasUI) return;
    detachShortcut = ctx.ui.onTerminalInput((data) => {
      if (!matchesKey3(data, "super+p")) return;
      if (!isKeyRelease2(data)) void showQuick(ctx).catch((error) => ctx.ui.notify(safeText(error.message), "error"));
      return { consume: true };
    });
    if (!providerInstalled && typeof ctx.ui.addAutocompleteProvider === "function") {
      providerInstalled = true;
      ctx.ui.addAutocompleteProvider((current) => ({
        triggerCharacters: current.triggerCharacters,
        async getSuggestions(lines, row, col, options) {
          const match = /^\/(?:view|v) (.*)$/.exec((lines[row] ?? "").slice(0, col));
          if (match) {
            const items = completions(match[1]);
            return items?.length ? { items, prefix: match[1] } : null;
          }
          return current.getSuggestions(lines, row, col, options);
        },
        applyCompletion: current.applyCompletion.bind(current),
        shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current)
      }));
    }
  });
  pi.on("session_shutdown", () => {
    detachShortcut?.();
    closeQuick?.();
    closePreview?.();
    stopImageWorker();
  });
  pi.registerShortcut("super+p", {
    description: "Quick Open: recent session files and path completion",
    handler: (ctx) => showQuick(ctx).catch((error) => ctx.ui.notify(safeText(error.message), "error"))
  });
  for (const name of ["view", "v"]) {
    pi.registerCommand(name, {
      description: "Preview a file (Tab completes paths); no path opens Quick Open",
      getArgumentCompletions: completions,
      handler: async (args, ctx) => {
        cwd = ctx.cwd;
        if (!ctx.hasUI) {
          ctx.ui.notify("/view needs an interactive terminal session", "warning");
          return;
        }
        try {
          const option = args.trim();
          if (!option) {
            await showQuick(ctx);
            return;
          }
          const initial = option === "--diagnostics" ? "diagnostics" : option === "--help" ? "help" : void 0;
          await showPreview(ctx, initial ? ctx.cwd : resolvePath(args, ctx.cwd), initial);
        } catch (error) {
          ctx.ui.notify(safeText(error.message), "error");
        }
      }
    });
  }
}
export {
  piView as default
};
