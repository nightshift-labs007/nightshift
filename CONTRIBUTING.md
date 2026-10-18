# Contributing to Nightshift

Thanks for helping. Nightshift prices tokenized ETFs after the market closes and lends against them. It's an
**unaudited demo on Base with demo tokens that have no value**, so contributions that make it safer, clearer or
better tested are especially welcome.

## Getting started

```bash
git clone https://github.com/nightshift-labs007/nightshift.git
cd nightshift
npm install
cp .env.example .env.local   # every setting is optional: the site runs without any of them
npm run dev                  # http://localhost:3000
```

Without any keys, prices come from Yahoo Finance (or are clearly labelled as simulated), the Vault works in paper mode,
and features that need a key switch themselves off and say so on `/api/health`.

## Before you open a pull request

Run whichever of these your change touches:

```bash
npx tsc --noEmit                          # type check (must be clean)
node scripts/test-contracts.mjs           # contract tests
node scripts/test-phase2-contracts.mjs    # Vault upgrade, adapters, feeds and CloakRegistry (19 tests)
node scripts/fuzz-guardian.mjs            # Guardian fuzzing on random price paths
node scripts/test-formal.mjs              # Lean proofs (needs the Lean toolchain, see formal/README.md)
```

Profile changes can be tested end to end against a dev server that has an Upstash database connected:
`BASE=http://localhost:3000 node scripts/test-profile.mjs`.

## Guidelines

- **Never commit secrets.** `.env.local` is git-ignored. Private keys, API keys and mnemonics go in environment
  variables only.
- **Keep claims honest.** If a page, post or doc says something is proven, it must match what the Lean proof in
  `formal/` actually states. If something is a demo or not built yet, say so.
- **Contract changes** need tests. If they touch a proven property (see `formal/PROPERTIES.md`), update the proof too
  or flag it in the pull request.
- **Match the surrounding code**: TypeScript, small modules, and comments only where the "why" isn't obvious.
- **Keep pull requests small**, with one change each and a short description of what and why.

## Reporting a security issue

Please don't open a public issue for a vulnerability. Contact the maintainers privately through the GitHub profile,
and give us a chance to fix it first. See `docs/AUDIT_SCOPE.md` for the known trust assumptions.

## License

By contributing, you agree that your contributions are licensed under the Apache License 2.0 (see `LICENSE`).
