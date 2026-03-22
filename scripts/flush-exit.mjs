export function normalizeExitCode(code) {
  return Number.isInteger(code) ? code : 0;
}

function flushStream(stream, done) {
  if (!stream || typeof stream.write !== "function") {
    done();
    return;
  }
  stream.write("", () => done());
}

export function flushAndExit(proc = process, code = proc?.exitCode, timeoutMs = 250) {
  const finalCode = normalizeExitCode(code);
  let exited = false;
  const finish = () => {
    if (exited) {
      return;
    }
    exited = true;
    proc.exit(finalCode);
  };
  const fallback = globalThis.setTimeout(finish, Math.max(0, timeoutMs));
  if (typeof fallback?.unref === "function") {
    fallback.unref();
  }
  const flushStderr = () => {
    flushStream(proc?.stderr, finish);
  };
  flushStream(proc?.stdout, flushStderr);
}
