# Workflows in this fork

`ci.yml` runs typecheck, lint and the test suite on every pull request and on
pushes to `main`. It needs no credentials — the tests stub the HTTP layer, so a
green build never depends on access to a real budget. Do not add a YNAB token
to it.

## Why `publish.yml` was removed

Upstream ships a `publish.yml` that fires on a published GitHub release and runs
`npm publish --provenance --access public`. It was deleted here rather than left
in place, for two reasons:

1. **It targets someone else's package namespace.** `package.json` still names
   the package `@maro-org/ynab-mcp`, so a release cut in this fork would try to
   publish to the upstream maintainer's npm package. It would almost certainly
   fail on authentication, but "armed and expected to fail" is a worse state
   than "not armed".
2. **This fork is not consumed from npm.** It is pinned by commit and run from
   source, which is the whole point of forking a project whose published
   artifact lagged its own fixes by five months.

If publishing this fork under a different package name ever becomes desirable,
restore the workflow deliberately and rename the package first.
