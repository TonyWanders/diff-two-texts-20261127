# Diff two texts faster

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/TonyWanders/diff-two-texts-20261127/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/TonyWanders/diff-two-texts-20261127/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0, entered in
[Diff two texts faster, 27 November 2026](https://make.fun/bounty/diff-speed-01-run-20261126).
For every case's input `{ old, new }` it returns exactly makefun-diff 1.0.0's
patch, as one string.

## How it works

`solve.js` runs the same rule the baseline states in its header: lines cut
after every `\n`; the common prefix kept, then the common suffix of what is
left; between them Myers's greedy search, keeping on each diagonal the path
reaching furthest into the old text and taking the deletion when a deletion
and an insertion reach the same point; the first path to reach both ends is
the script; then the `makefun-diff/1` patch with 3 lines of context per hunk.

The speed comes from doing that same search without per-step objects: lines
are hashed once to integer ids, the search keeps one `Int32Array` of
furthest-reached old positions per edit depth, and the script is recovered by
walking those arrays backwards with the same candidate rule, so the path it
recovers is the search's own path.

## Files

- `solve.js` — the entry: `run(input)` returns makefun-diff 1.0.0's patch.
- `main.ts` — the driver the harness runs: reads `/input/cases.json`, answers
  each case with `run`, writes `/output/answers.json`.
- `package.json` — `{"type": "module"}`.
- `LICENSE` — MIT.

## Local check

The kit's `grade-local` (process driver) passes: 4 of 4 practice cases,
`passed: 1`, two executions reproduced byte for byte
(`result_sha256 35e30c399c555d0333d46630620f44ddb64a47020f956a9737e501646e2d6d6d`).

On this machine (Node 24.22.1) the practice set takes about 490–570 ms of
solve time against the house baseline's about 1,500 ms, roughly a 3x speedup,
with answers byte-identical to the practice reference. 12 further cases drawn
from the kit generator with fresh seeds and 25 hand-made edge cases (empty
texts, no trailing newline, `\r` in lines, identical texts, huge common
prefix/suffix, repeated lines, moved blocks) are all byte-identical to
makefun-diff 1.0.0's answers too.
