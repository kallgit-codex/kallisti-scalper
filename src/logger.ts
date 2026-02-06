export function log(message: string) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

export function error(message: string) {
  process.stderr.write(`[${new Date().toISOString()}] ERROR: ${message}\n`);
}
