const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

function resolveCoverageRoot() {
  return path.resolve(process.env.ODB_COVERAGE_ROOT || path.join(process.cwd(), "coverage"));
}

function toResolvedPath(target) {
  if (typeof target === "string") {
    return path.resolve(target);
  }
  if (target instanceof URL) {
    return path.resolve(target.pathname);
  }
  return null;
}

function shouldPreserveCoveragePath(target, coverageRoot = resolveCoverageRoot()) {
  const resolved = toResolvedPath(target);
  if (!resolved) {
    return false;
  }
  const relative = path.relative(coverageRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const [firstSegment] = relative.split(path.sep);
  return Boolean(firstSegment && firstSegment.startsWith(".tmp"));
}

function installCoverageRmGuard() {
  const coverageRoot = resolveCoverageRoot();
  const originalPromiseRm = fsp.rm.bind(fsp);
  const originalSyncRm = fs.rmSync.bind(fs);

  fsp.rm = async (target, options) => {
    if (shouldPreserveCoveragePath(target, coverageRoot)) {
      return;
    }
    return originalPromiseRm(target, options);
  };

  fs.rmSync = (target, options) => {
    if (shouldPreserveCoveragePath(target, coverageRoot)) {
      return;
    }
    return originalSyncRm(target, options);
  };
}

installCoverageRmGuard();

module.exports = {
  installCoverageRmGuard,
  resolveCoverageRoot,
  shouldPreserveCoveragePath
};
