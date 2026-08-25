/**
 * Structured logging.
 *
 * DECISIONS.md §10: a child's display name never leaves our own UI, and the
 * worker never loads one in the first place. Character names are user free text
 * and are equally not worth putting in a log line that ships to a third-party
 * log sink — ids are enough to debug with, so nothing here logs free text.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

function emit(level: LogLevel, base: Record<string, unknown>, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...base, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  return {
    debug: (m, f) => emit('debug', base, m, f),
    info: (m, f) => emit('info', base, m, f),
    warn: (m, f) => emit('warn', base, m, f),
    error: (m, f) => emit('error', base, m, f),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

/** Used by tests and by any code path that must not write to stdout. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
