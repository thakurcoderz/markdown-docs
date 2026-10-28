import { getVersion } from "@tauri-apps/api/app"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { toast } from "sonner"

type Options = {
  /** Launch check: stays silent when up to date or offline. */
  quiet: boolean
  /** Runs before restarting into the new version; false postpones the restart (e.g. unsaved changes kept). */
  beforeRestart: () => Promise<boolean>
}

/**
 * Looks for a newer release (latest.json on GitHub Releases, signed in CI). A found update shows a toast
 * that downloads and installs it, then offers a restart.
 */
export async function checkForUpdates({ quiet, beforeRestart }: Options) {
  let update: Update | null
  try {
    update = await check()
  } catch (e) {
    if (!quiet) toast.error("Couldn’t check for updates", { description: String(e) })
    return
  }
  if (!update) {
    if (!quiet) toast.success("You’re up to date", { description: `Markdown Docs ${await getVersion()} is the latest version.` })
    return
  }
  const found = update
  toast.info(`Markdown Docs ${found.version} is available`, {
    id: "update",
    description: `You have ${found.currentVersion}.`,
    duration: Infinity,
    // preventDefault keeps the toast open (sonner closes it after an action) so it can show progress.
    action: { label: "Update", onClick: (e) => (e.preventDefault(), install(found, beforeRestart)) },
  })
}

async function install(update: Update, beforeRestart: () => Promise<boolean>) {
  const id = "update"
  const label = `Downloading ${update.version}…`
  let total = 0, got = 0
  toast.loading(label, { id, description: undefined, action: undefined })
  try {
    // On a .deb install this asks for the admin password (pkexec) to run dpkg.
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0
      else if (e.event === "Progress") {
        got += e.data.chunkLength
        if (total) toast.loading(`${label} ${Math.round((got / total) * 100)}%`, { id })
      } else toast.loading(`Installing ${update.version}…`, { id })
    })
  } catch (e) {
    toast.error("Update failed", { id, description: String(e), duration: 10_000 })
    return
  }
  const restart = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (await beforeRestart()) await relaunch()
    else toast.info(`Updated to ${update.version}`, { id, description: "It’ll be used the next time you open the app.", duration: 10_000 })
  }
  toast.success(`Updated to ${update.version}`, {
    id,
    description: "Restart the app to start using it.",
    duration: Infinity,
    action: { label: "Restart", onClick: restart },
  })
}
