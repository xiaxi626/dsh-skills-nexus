## Summary

Briefly describe what this PR changes and why.

## Type of change

Check the relevant option(s):

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `ci` — CI / build config
- [ ] `refactor` — code refactoring (no behavior change)
- [ ] `test` — test additions / changes
- [ ] `chore` — other maintenance

## Related issue

Closes #<issue number> _(leave empty if none)_

## Quality checklist

Before requesting review, confirm all that apply:

- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(scope):`, `fix(scope):`, `docs:`, `ci:`, …)
- [ ] `npm run typecheck` passes (tsc strict)
- [ ] `npm run lint` passes (ESLint)
- [ ] `npm test` passes (node:test)
- [ ] If `src/` changed: ran `npm run build` and committed the updated `lib/` — CI asserts a fresh build has zero diff via `git diff --exit-code --quiet -- lib/`, and runs that check on `ubuntu-latest` only (to avoid Windows CRLF / `core.autocrlf` false positives)
- [ ] Added / updated tests in `test/` for new logic
- [ ] Updated docs (README / CONTRIBUTING / CHANGELOG) if behavior changed
- [ ] Code changes and pure-doc changes are in **separate commits** (see CONTRIBUTING)

## Breaking changes

List any breaking changes and migration notes. Write "None" if not applicable.

## Notes for the reviewer

Anything the reviewer should pay attention to (edge cases, platform-specific behavior, etc.). Leave empty if nothing special.
