---
name: develop-endpoint
description: The team's development workflow for this repository. Use it at the start of EVERY working session here, and whenever someone asks to build, change, fix, test or review an API endpoint, a hard filter (constraint), a power / link / thermal / radiation model, the soft score or a dataset, even if they only say "let's start", "sigo con lo mío", "haz el endpoint de X" or "abre la PR". It creates or resumes the feature branch, keeps logic and data access apart, writes tests first where a hand-worked case exists, and takes the work to a reviewed pull request without touching main.
---

# Develop an endpoint in this repository

Five people work here in parallel, each with their own Claude session, and the deadline is hours
away. The workflow below exists so that nobody breaks `main`, nobody edits the same file as someone
else, and every pull request is small enough to review in minutes. Follow it in order; each step
says why it is there so you can adapt when the situation is unusual.

## 0. Find out what you are building

Ask the person (in Spanish) which role they are (SW-1, SW-2, AERO-1, AERO-2, MECH) and which piece
they are building today, unless they already said so. Then read:

- their section of `docs/endpoints.md` (the specification, the files they own, the done-when);
- `CLAUDE.md` sections "Layer rules", "Conventions that must not drift" and "Known data gaps";
- the reference file closest to the task: `api/app/routers/sites.py` for an endpoint,
  `api/app/logic/constraints/slope.py` for a dataset-based hard filter,
  `api/app/logic/constraints/light.py` for a time-based one, `api/app/logic/scoring.py` for the score.

Do not read the whole repository. The specification names the files that matter.

## 1. Branch before anything else

One functionality, one branch. Work never happens on `main`: it changes only through reviewed pull
requests, so a mistake on a branch costs one person, not five.

```
git fetch origin
git status                      # stop and ask if there are uncommitted changes you did not make
git switch main && git pull --ff-only
git switch -c feat/<role>-<topic>      # e.g. feat/sw1-site-state, feat/aero2-comms-filters
```

Resuming an existing branch instead: `git switch feat/<role>-<topic>`, then `git fetch origin` and
`git rebase origin/main` so the pull request stays mergeable. If the rebase conflicts in a file the
person does not own, stop and tell them rather than resolving it by guesswork.

If the task turns out to be two functionalities (for example an endpoint and an unrelated filter),
finish one, open its pull request, and start a second branch from `main` for the other.

## 2. Agree the contract first

Write the request and response models in `api/app/schemas/<group>.py` before any logic: field names
in snake_case, units in every `Field(description=...)`, times as ISO 8601 UTC strings. If the shape
differs from `docs/endpoints.md`, show the person the difference in a few lines and let them decide.
The frontend will be generated from `/openapi.json`, so a field renamed later breaks someone else.

## 3. Build from the inside out

1. **Logic** in `api/app/logic/`: pure functions over NumPy arrays and plain values. No file access,
   no network, no FastAPI imports. The docstring states the formula, the units and the source.
   When the owner has a hand-worked case, write it as a test first and make it pass.
2. **Data access** in `api/app/db/` only if a new dataset is involved (see the dataset recipe in
   `CLAUDE.md`). It decodes files into arrays; it computes nothing.
3. **Glue** in `api/app/services.py` when data and logic must be combined (additive edits only: this
   file is shared).
4. **Router** in `api/app/routers/<group>.py`, shaped like `routers/sites.py`: validate, call, shape
   the response. Register it in `api/app/main.py` with one added line.
5. **Tests** in `api/tests/test_<group>.py`: a happy path, a validation error (422), an unknown id
   (404) and at least one numerical case with a known answer.

A hard filter follows the same order with fewer steps: one module in `logic/constraints/`, the
`@register("<id>")` decorator, one import line in `logic/constraints/__init__.py`, a test.

### Things that keep it correct

- Use the engine instead of recomputing geometry: `services.model_for_site` / `model_for_point`,
  `services.evaluate_window`, `engine.compute_metrics`, `engine.visibility_ranges`,
  `engine.next_transition`. They are validated against JPL Horizons; new geometry is not.
- A value no dataset provides is `None` with `basis="unavailable"`, never an estimate. Rocks,
  temperature and radiation dose have no dataset yet.
- Thresholds and defaults need a cited source or the owner's explicit decision. If you do not have
  one, make it a required input instead of inventing a default.
- Every response that depends on a horizon says `horizon_kind` (`terrain` or `smooth_sphere`).
- Time-based results give both `fraction` and `ranges`.

### Things that keep it fast

- Vectorise over time: call `evaluate` once with the whole time array, never in a Python loop per
  sample. A 30-day window at 10-minute steps is 4 321 samples and should take milliseconds.
- For several hard filters on one candidate, build one `services.constraint_context` and pass it to
  all of them: the series is computed once.
- Datasets come from `Depends(get_store)`; never open a file inside a request handler.
- Pre-filter area sweeps with `store.grids.sample_many` before running the engine on a point.
- Cap the number of samples a request can ask for and return 422 above the cap.

## 4. Verify before you call it done

```
cd api
uv run pytest -q                                   # everything, not only your file
uv run uvicorn app.main:app --port 8010            # then call your endpoint and open /docs
```

Check the real response against the specification and against a number you can justify. Report to
the person what you ran and what it returned; if a test fails, say so with the output. Stop the
server you started by its own process, never by killing whatever holds a port.

## 5. Documentation, in the same branch

- `docs/endpoints.md`: update the **Status** line of your own section only.
- `docs/references.md`: add every new external source (data, paper, library).
- `data/README.md`: only if you added a dataset.
- **`CLAUDE.md`: touch it only when the endpoint or filter is finished**, and then only to add its
  row to the table "Implemented endpoints and filters". That file is loaded by all five sessions, so
  half-finished notes there mislead everyone, and unrelated edits cause merge conflicts. Any other
  change to `CLAUDE.md` is a team decision and goes in its own pull request.
- Do not edit `docs/STATUS.md` in a feature branch; it records team decisions and is updated on
  `main` by whoever merges.

## 6. Commit

Small commits, English, imperative mood, one topic each (`Add site state endpoint`,
`Add comms hours hard filter`). Stage files by name and read `git status` and `git diff --stat`
before committing: nothing under `data/raw/`, no `.venv`, no secrets, no file you do not own unless
the pull request says why. End the message with the attribution line the session provides.

## 7. Pull request

Ask the person before pushing; pushing publishes their work to the team.

```
git fetch origin && git rebase origin/main
cd api && uv run pytest -q
git push -u origin feat/<role>-<topic>
gh pr create --base main --fill          # or open the URL that git prints after the push
```

Fill the template (`.github/pull_request_template.md`): what it adds, how it was tested with the
output, which shared files it touches, data sources added. Then stop: **a branch is merged into
`main` only after another team member has reviewed and approved the pull request.** Do not merge
your own pull request, do not push to `main`, and do not force-push a branch someone else has
pulled.

## 8. When asked to review someone else's pull request

Check out the branch, run the tests, call the endpoint, and read the diff against this list:

- Layers respected: no file or network access in `logic/`, no formulas in `routers/` or `db/`.
- Contract: snake_case, units in descriptions, UTC times, `horizon_kind` present where relevant.
- Unknown data returned as unknown; no invented thresholds; sources added to `docs/references.md`.
- Tests cover a happy path, a 422, a 404 and a numerical case; the whole suite passes.
- Only the author's own files changed; shared files have additive edits only; `CLAUDE.md` gained at
  most one row.

Report findings to the person in order of severity. Approving or merging is their decision.

## Definition of done

- [ ] Work is on `feat/<role>-<topic>`, rebased on `main`.
- [ ] Schemas, logic, router and tests exist; `uv run pytest -q` passes.
- [ ] The endpoint was called on a running server and the response matches the specification.
- [ ] `docs/endpoints.md` status and `docs/references.md` updated; one row added to `CLAUDE.md`.
- [ ] Pull request open with the template filled; waiting for review.
