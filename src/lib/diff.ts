export type DiffLine = { kind: "same" | "add" | "del"; text: string }

/**
 * Line diff from `a` to `b` (longest common subsequence). Common lines at both ends are trimmed first, so typical
 * edits stay cheap; past ~16M line pairs the middle is shown as fully replaced instead of diffed.
 */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split("\n"), y = b.split("\n")
  let s = 0
  while (s < x.length && s < y.length && x[s] === y[s]) s++
  let e = 0
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++
  const xs = x.slice(s, x.length - e), ys = y.slice(s, y.length - e)
  const same = (t: string): DiffLine => ({ kind: "same", text: t })
  const out: DiffLine[] = x.slice(0, s).map(same)
  const n = xs.length, m = ys.length
  if (n * m > 16_000_000) {
    out.push(...xs.map((text) => ({ kind: "del" as const, text })), ...ys.map((text) => ({ kind: "add" as const, text })))
  } else {
    // lcs[i * (m + 1) + j] = LCS length of xs[i..] and ys[j..]
    const w = m + 1, lcs = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * w + j] = xs[i] === ys[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    let i = 0, j = 0
    while (i < n || j < m) {
      if (i < n && j < m && xs[i] === ys[j]) out.push(same(xs[i++])), j++
      else if (i < n && (j === m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) out.push({ kind: "del", text: xs[i++] })
      else out.push({ kind: "add", text: ys[j++] })
    }
  }
  out.push(...x.slice(x.length - e).map(same))
  return out
}
