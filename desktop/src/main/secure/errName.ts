/** Log-safe error label: only the class name, never the message (it can carry key material or paths). */
export function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err
}
