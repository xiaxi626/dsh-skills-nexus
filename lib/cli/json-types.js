/**
 * The `--json` report contracts, version 1 (P0 §4).
 *
 * These types are the stable half of the machine interface: `doctor --json`
 * already promised `version: 1`, and the write commands now make the same
 * promise — field names and types here are contract, field order and the
 * wording of `error` strings are not (P0 §2.2).
 *
 * Every report carries `version: 1` as a literal type, so a future breaking
 * change has to touch each report object at its construction site rather than
 * being silently forgotten in a type-only refactor. `JsonReport` is the union
 * the emitter accepts, which is what keeps a new command from inventing a shape
 * outside the contract.
 *
 * Deliberately NOT here: `doctor --json`, whose `DoctorReport` already lives
 * next to its checks in `commands/doctor.ts` and is emitted unchanged. The two
 * share the `version` mechanism and the 2-space framing, but they describe
 * different things — `doctor` reports system state, these report what an
 * operation just did (P0 §2.3).
 */
export {};
//# sourceMappingURL=json-types.js.map