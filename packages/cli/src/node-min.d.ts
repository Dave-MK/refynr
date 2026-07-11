/**
 * Minimal ambient declarations for the tiny slice of Node.js this CLI uses.
 * Keeping these local means the package needs no `@types/node` dependency and
 * builds with nothing but the workspace engine — no lockfile churn.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
}

declare module "node:process" {
  interface Stream {
    write(s: string): void;
  }
  interface Process {
    argv: string[];
    exit(code?: number): never;
    stdout: Stream;
    stderr: Stream;
  }
  const process: Process;
  export default process;
}
