/* scripts/testkit.mts — the four lines of test harness this repo needs.
 *
 * Deliberately not a framework. The existing marketCalendar test hand-rolled
 * its own `eq` and that was the right call; this just stops the next four
 * files from each rolling it again. Run a suite directly:
 *
 *   npx tsx scripts/edge.test.mts
 *
 * or all of them with `npm test`. Exit code is non-zero when anything fails,
 * so CI or a pre-deploy check can use it as-is.
 */

let pass = 0;
const failures: string[] = [];

export const eq = (label: string, got: unknown, want: unknown) => {
  if (Object.is(got, want)) pass++;
  else failures.push(`${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
};

/** Floating-point comparison, because 0.1 + 0.2 is not 0.3 and never will be. */
export const near = (label: string, got: number | null, want: number, tol = 1e-6) => {
  if (got != null && Math.abs(got - want) <= tol) pass++;
  else failures.push(`${label}\n    got  ${got}\n    want ${want} (±${tol})`);
};

export const ok = (label: string, got: boolean) => eq(label, got, true);

/** Print the tally and set the exit code. Call once, at the end of a suite. */
export const done = (suite: string) => {
  if (failures.length === 0) {
    console.log(`✓ ${suite}: ${pass} assertions`);
    return;
  }
  console.log(`✗ ${suite}: ${failures.length} failed, ${pass} passed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exitCode = 1;
};
