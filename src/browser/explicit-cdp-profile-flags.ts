const RESERVED_EXPLICIT_CDP_PROFILE_FLAGS = new Set([
  "--profile-directory",
  "--remote-debugging-address",
  "--remote-debugging-pipe",
  "--remote-debugging-port",
  "--user-data-dir"
]);

export function findUnsafeExplicitCdpProfileFlag(flags: readonly string[]): string | null {
  for (const flag of flags) {
    const normalized = flag.trim().toLowerCase();
    const name = normalized.split(/[=\s]/, 1)[0];
    if (name && RESERVED_EXPLICIT_CDP_PROFILE_FLAGS.has(name)) {
      return name;
    }
  }
  return null;
}
