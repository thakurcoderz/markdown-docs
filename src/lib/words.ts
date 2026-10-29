const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu
/** Chinese and Japanese don't put spaces between words, so each character counts as one. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu

/** Words in a Markdown doc as a reader sees them: link targets, image paths, HTML tags and markup don't count. */
export function countWords(md: string) {
  const text = md
    .replace(/^---\n[\s\S]*?\n---\n/, "") // front matter
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(\s*[-*+]\s+)\[[ xX]\]/gm, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "link")
  const cjk = text.match(CJK)?.length ?? 0
  return (text.replace(CJK, " ").match(WORD)?.length ?? 0) + cjk
}

/** Minutes to read at about 230 words a minute, at least 1. */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230))
