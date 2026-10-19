import { spawnSync } from "node:child_process";
for (const profile of ["runtime", "compatibility", "jobs"]) {
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run"], {
    stdio: "inherit", env: { ...process.env, KOVA_WORKERS_TEST_PROFILE: profile }, timeout: 120000,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
