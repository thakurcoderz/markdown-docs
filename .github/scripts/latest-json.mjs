// Writes latest.json, the manifest the in-app updater reads, from the signed update files in a folder.
// Each platform key points at a release asset plus the contents of its .sig file.
// Usage: node latest-json.mjs <dir> <version> <tag> <owner/repo>
import { readdirSync, readFileSync, writeFileSync } from "node:fs"

const [dir, version, tag, repo] = process.argv.slice(2)
const files = readdirSync(dir)

/** The signed asset ending in `suffix`, or null when it (or its signature) is missing. */
function asset(suffix) {
  const name = files.find((f) => f.endsWith(suffix) && files.includes(`${f}.sig`))
  if (!name) return null
  return {
    signature: readFileSync(`${dir}/${name}.sig`, "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
  }
}

// The updater looks up `{os}-{arch}-{bundle}` first, then `{os}-{arch}`.
const mac = asset("_universal.app.tar.gz")
const appimage = asset("_amd64.AppImage")
const deb = asset("_amd64.deb")
const platforms = Object.fromEntries(
  Object.entries({
    "darwin-aarch64-app": mac,
    "darwin-x86_64-app": mac,
    "darwin-aarch64": mac,
    "darwin-x86_64": mac,
    "linux-x86_64-appimage": appimage,
    "linux-x86_64": appimage,
    "linux-x86_64-deb": deb,
  }).filter(([, a]) => a),
)

if (!Object.keys(platforms).length) {
  console.log("No signed update files found; skipping latest.json")
  process.exit(0)
}
const manifest = { version, notes: `See https://github.com/${repo}/releases/tag/${tag}`, pub_date: new Date().toISOString(), platforms }
writeFileSync(`${dir}/latest.json`, JSON.stringify(manifest, null, 2) + "\n")
console.log(Object.keys(platforms).join("\n"))
