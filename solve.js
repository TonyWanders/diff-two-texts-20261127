// diff-two-texts: a faster drop-in for makefun-diff 1.0.0.
//
// Same answer as makefun-diff 1.0.0's diffPatch on every input, computed by the
// same rule the baseline's index.js states in its header: lines cut after every
// "\n"; common prefix kept, then common suffix of what is left; between them
// Myers's greedy search keeping, on each diagonal, the path reaching furthest
// into the old text, taking the deletion when a deletion and an insertion reach
// the same point, never moving past either text's end, pruning no edge diagonal,
// following every run of equal lines as far as it goes; the first path to reach
// both ends is the script; then the makefun-diff/1 patch with 3 lines of
// context and hunks merged across at most 6 kept lines.
//
// Speed comes from doing that same search without per-step objects and without
// re-walking the texts: the search keeps one Int32Array per edit depth holding,
// per diagonal, the old lines consumed after the snake plus one (0 where no
// path reaches the diagonal, so a fresh array needs no fill), and the script is
// recovered by walking those arrays backwards with the same candidate rule, so
// the path it recovers is the search's own path. Line comparisons are plain
// string equality on the tokenised lines; the search's snakes take only a few
// ten-thousand steps per case, so no line hashing is needed.

/** Kept / deleted / inserted run kinds. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const lines = new Array(parts.length);
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines[i] = parts[i] + '\n';
  if (parts[last] !== '') lines[last] = parts[last];
  else lines.length = last;
  return lines;
}

/** A 32-bit hash of a line, used only to reject unequal lines fast; equality is always confirmed on the strings. */
function hashLine(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

function hashLines(lines) {
  const out = new Int32Array(lines.length);
  for (let i = 0; i < lines.length; i++) out[i] = hashLine(lines[i]);
  return out;
}

/**
 * The edit script of a[oa..oa+n) into b[ob..ob+m), as merged runs
 * [{kind, count}] in order, by the header's rule. ha/hb are the lines' hashes.
 */
function editRuns(a, oa, ha, b, ob, hb, n, m) {
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ kind: INSERT, count: m }];
  if (m === 0) return [{ kind: DELETE, count: n }];

  // Forward search: Ws[d] is an Int32Array of length 2d+1 holding, at index j
  // (diagonal k = j - d), the old lines consumed after the snake plus one, or
  // 0 where no path reaches that diagonal. y = x - k.
  const maxD = n + m;
  const Ws = new Array(maxD + 1);
  const w0 = new Int32Array(1);
  let x = 0;
  let y = 0;
  while (x < n && y < m && a[oa + x] === b[ob + y]) { x++; y++; }
  w0[0] = x + 1;
  Ws[0] = w0;
  let D = 0;
  let kEnd = 0;
  if (x < n || y < m) {
    let done = false;
    for (let d = 1; d <= maxD && !done; d++) {
      const vp = Ws[d - 1];
      const v = new Int32Array(2 * d + 1);
      const last = 2 * d - 2;
      // Diagonal j's insertion candidate vp[j] is diagonal j+2's deletion
      // candidate, so it is carried forward and each entry is read once.
      let xDownW = 0;
      let xRightW = vp[0];
      for (let j = 0; j <= 2 * d; j += 2) {
        const k = j - d;
        const canRemove = xDownW !== 0 && xDownW - 1 < n;
        const canAdd = xRightW !== 0 && xRightW - 2 - k < m;
        if (canRemove || canAdd) {
          // The candidate further into the old text, the deletion on a tie:
          // deletion's post-step old position is xDownW - 1, insertion's xRightW - 2.
          let xs;
          if (canRemove && (!canAdd || xDownW >= xRightW - 1)) xs = xDownW;
          else xs = xRightW - 1;
          let ys = xs - k;
          while (xs < n && ys < m && ha[oa + xs] === hb[ob + ys] && a[oa + xs] === b[ob + ys]) { xs++; ys++; }
          v[j] = xs + 1;
          if (xs >= n && ys >= m) { D = d; kEnd = k; done = true; break; }
        }
        xDownW = xRightW;
        xRightW = j + 2 <= last ? vp[j + 2] : 0;
      }
      Ws[d] = v;
    }
    if (!done) throw new Error('diff-two-texts: the search ended without reaching both ends');
  }

  // Backtrack the search's own path: at each depth the step it took is the
  // same candidate the forward search chose, and the snake it followed runs
  // from that step's landing point to the depth's recorded point.
  const rev = [];
  let k = kEnd;
  x = Ws[D][k + D] - 1;
  const push = (kind, count) => {
    const l = rev[rev.length - 1];
    if (l !== undefined && l.kind === kind) l.count += count;
    else rev.push({ kind, count });
  };
  for (let d = D; d >= 1; d--) {
    const vp = Ws[d - 1];
    const j = k + d;
    const xDownW = j >= 2 ? vp[j - 2] : 0;
    const xRightW = j <= 2 * d - 2 ? vp[j] : 0;
    const canRemove = xDownW !== 0 && xDownW - 1 < n;
    const canAdd = xRightW !== 0 && xRightW - 2 - k < m;
    let xs;
    let del;
    if (canRemove && (!canAdd || xDownW >= xRightW - 1)) { del = true; xs = xDownW; }
    else { del = false; xs = xRightW - 1; }
    if (x - xs > 0) push(KEEP, x - xs);
    push(del ? DELETE : INSERT, 1);
    x = del ? xDownW - 1 : xRightW - 1;
    k = del ? k - 1 : k + 1;
  }
  if (x > 0) push(KEEP, x);
  rev.reverse();
  return rev;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/**
 * One run of lines as the patch writes it: the op before every line. Every
 * line but a text's last ends with "\n", so a run not touching that last line
 * joins in one string; a run that does touch it falls back to written() per
 * line, so the "%" line still follows a line with no newline.
 */
function emitRun(out, op, lines, start, count) {
  if (count <= 0) return;
  const end = start + count;
  if (end === lines.length && !lines[end - 1].endsWith('\n')) {
    for (let i = start; i < end; i++) out.push(written(op, lines[i]));
    return;
  }
  out.push(op + lines.slice(start, end).join(op));
}

/** makefun-diff 1.0.0's answer for one case's input: its patch, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff-two-texts: the input is { old, new }, two strings');
  }
  const aLines = tokenize(input.old);
  const bLines = tokenize(input.new);
  const n = aLines.length;
  const m = bLines.length;
  const aHash = hashLines(aLines);
  const bHash = hashLines(bLines);

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aLines[prefix] === bLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aLines[n - 1 - suffix] === bLines[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const mid = editRuns(aLines, prefix, aHash, bLines, prefix, bHash, n - prefix - suffix, m - prefix - suffix);
  for (let i = 0; i < mid.length; i++) runs.push(mid[i]);
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (run.kind === KEEP) {
      o += run.count;
      p += run.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (run.kind === DELETE) {
      c.dels += run.count;
      o += run.count;
      deleted += run.count;
    } else {
      c.ins += run.count;
      p += run.count;
      inserted += run.count;
    }
  }

  // The hunks: change runs at most 2 * 3 kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * 3) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      emitRun(out, '=', aLines, at, c.o - at);
      emitRun(out, '-', aLines, c.o, c.dels);
      emitRun(out, '+', bLines, c.p, c.ins);
      at = c.o + c.dels;
    }
    emitRun(out, '=', aLines, at, oldEnd - at);
  }
  return out.join('');
}
