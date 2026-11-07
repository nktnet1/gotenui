type ChromeTransport = 'pipe' | 'socket'

/** Prefer loopback WebSocket: headless Chrome sometimes hangs on DevTools pipes in CI. */
export const chromeSmokeTransports = ['socket', 'pipe', 'socket'] as const

/** CI desktops may export a D-Bus address that headless Chrome cannot parse.
 * A browser smoke test has no need to join the desktop session bus.
 */
export function chromeSmokeEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base }
  delete env.DBUS_SESSION_BUS_ADDRESS
  delete env.DBUS_SYSTEM_BUS_ADDRESS
  return env
}

export function chromeSmokeArguments(profile: string, transport: ChromeTransport): string[] {
  return [
    '--headless=new',
    '--no-sandbox',
    '--no-zygote',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-breakpad',
    `--user-data-dir=${profile}`,
    transport === 'pipe' ? '--remote-debugging-pipe' : '--remote-debugging-port=0',
    ...(transport === 'socket' ? ['--remote-debugging-address=127.0.0.1'] : []),
  ]
}
