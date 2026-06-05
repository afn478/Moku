import { detectAdapter }                              from '$lib/platform-adapters'
import { initPlatformService }                        from '$lib/platform-service'
import { initRequestManager }                         from '$lib/request-manager'
import { appState }                                   from '$lib/state/app.svelte'
import { configureAuth, probeServer }                 from '$lib/core/auth'
import { loadSettings, loadLibrary, loadUpdates }     from '$lib/core/persistence/persist'
import { loadSettingsIntoState, settingsState }       from '$lib/state/settings.svelte'
import { historyState }                               from '$lib/state/history.svelte'
import { readerState }                                from '$lib/state/reader.svelte'
import type { Settings }                              from '$lib/types/settings'

const KEY_URL  = 'moku_server_url'
const KEY_AUTH = 'moku_auth_config'
const DEV_PROXY_URL = '/suwayomi'

interface SavedAuth {
  mode: 'NONE' | 'BASIC_AUTH' | 'UI_LOGIN'
  user?: string
  pass?: string
}

async function resolveServerAdapter() {
  const { SuwayomiAdapter } = await import('$lib/server-adapters/suwayomi')
  return new SuwayomiAdapter()
}

function trimUrl(url: string): string {
  return url.replace(/\/$/, '')
}

function envServerUrl(): string | null {
  const env = import.meta.env.VITE_MOKU_SERVER_URL?.trim()
  return env ? trimUrl(env) : null
}

function resolveServerUrl(
  platform: string,
  rawSettings: Partial<Settings> | null,
  savedUrl: string | null,
): string {
  const envUrl = envServerUrl()
  if (envUrl) return envUrl

  const settingsUrl = rawSettings?.serverUrl?.trim()
  if (settingsUrl) return trimUrl(settingsUrl)

  if (platform === 'web' && import.meta.env.DEV) return DEV_PROXY_URL

  return trimUrl(savedUrl ?? 'http://127.0.0.1:4567')
}

function normalizeAuthMode(
  mode: Settings['serverAuthMode'] | SavedAuth['mode'] | undefined,
): SavedAuth['mode'] {
  return mode === 'BASIC_AUTH' || mode === 'UI_LOGIN' ? mode : 'NONE'
}

async function boot() {
  try {
    const platformAdapter = detectAdapter()
    initPlatformService(platformAdapter)

    await platformAdapter.init()

    const serverAdapter = await resolveServerAdapter()
    initRequestManager(serverAdapter)

    appState.platform = platformAdapter.platform
    appState.version  = await platformAdapter.getVersion()

    const [settingsData, libraryData] = await Promise.all([
      loadSettings(),
      loadLibrary(),
      loadUpdates(),
    ])

    await loadSettingsIntoState(settingsData.settings)
    const rawSettings = settingsData.settings && typeof settingsData.settings === 'object'
      ? settingsData.settings as Partial<Settings>
      : null

    readerState.bookmarks = libraryData.bookmarks
    readerState.markers   = libraryData.markers
    historyState.load(libraryData.sessions, libraryData.dailyReadCounts)

    const savedUrl     = await platformAdapter.getCredential(KEY_URL)
    const savedAuthRaw = await platformAdapter.getCredential(KEY_AUTH)
    const savedAuth: SavedAuth = savedAuthRaw ? JSON.parse(savedAuthRaw) : { mode: 'NONE' }
    const serverUrl    = resolveServerUrl(platformAdapter.platform, rawSettings, savedUrl)
    const authMode     = rawSettings?.serverAuthMode !== undefined
      ? normalizeAuthMode(rawSettings.serverAuthMode)
      : normalizeAuthMode(savedAuth.mode)
    const authUser     = rawSettings?.serverAuthUser ?? savedAuth.user ?? ''
    const authPass     = rawSettings?.serverAuthPass ?? savedAuth.pass ?? ''

    settingsState.settings.serverUrl = serverUrl
    appState.serverUrl = serverUrl
    appState.authMode  = authMode

    configureAuth(serverUrl, authMode, authUser, authPass)

    await serverAdapter.connect({
      baseUrl: serverUrl,
      credentials:
        authMode === 'BASIC_AUTH' && authUser && authPass
          ? { username: authUser, password: authPass }
          : undefined,
    })

    const isTauri         = platformAdapter.platform === 'tauri'
    const autoStartServer = settingsState.settings.autoStartServer ?? false

    if (isTauri && autoStartServer) {
      appState.status = 'booting'
      return
    }

    const probe = await probeServer()

    if (probe === 'auth_required') { appState.status = 'auth'; return }
    if (probe === 'unreachable') {
      appState.error  = `Could not reach server at ${serverUrl}`
      appState.status = 'error'
      return
    }

    appState.authenticated = true
    appState.status        = 'ready'
  } catch (e) {
    appState.error  = String(e)
    appState.status = 'error'
  }
}

boot()
