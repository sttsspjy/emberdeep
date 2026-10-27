# Wickdeep - Claude Guidelines

**Docs**: [docs/](docs/) — **Game design (rules·numbers, canonical)**: [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) / **Architecture contract (files, registries, entities, net, perf gates)**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) / **Masterplan for User (roadmap)**: [docs/MASTERPLAN.md](docs/MASTERPLAN.md) / **Masterplan for Agents (kanban)**: [docs/MASTERPLAN-AGENT.md](docs/MASTERPLAN-AGENT.md) / session handoff: `docs/HANDOFF-*.md` (Read from latest). Legacy dungeon game: git tag `legacy-wickdeep`.

---

## north-star (Ultimate goal for all plans/tasks)

A browser **co-op survivors-like** (solo or up to 4 friends) where **a strong run turns the screen into a blender**: hordes of hundreds pour into an open arena, weapons fire on their own, each hero brings a signature weapon and two big hand-fired skills, and every level-up changes the *shape* of an attack (more projectiles, area, pierce, orbitals, evolutions), never just a number. Rules: **① Zero install** (static site, no build step, no backend; opens from any static host or `file://`) **② No runtime asset files** (art is embedded as data URIs built by `tools/art.js` from vendored CC0/CC-BY sources in `art-src/`; all audio synthesized with WebAudio) **③ Host-authoritative deterministic sim** (the same sim code runs headless in Node for checks) **④ Every death is earned** (telegraphed elite and boss attacks, crowd pressure over burst damage, no sustain-by-default) **⑤ Hordes stay smooth** (900 foes on screen at 60 fps in a browser).

**NO COMPROMISES. A PLAYER MUST FINISH A RUN FEELING OVERPOWERED AND WANT ANOTHER WITH A DIFFERENT HERO.**

## Abstract

Vanilla JS (ES2020, no modules, global `ED` namespace) + a WebGL sprite batcher (Canvas2D fallback) and a WebGL post pass. Pipeline: `src/data` tables → sim World (60 Hz fixed-step, authoritative on host/solo) → `src/net.js` binary snapshots (20 Hz, interest-culled) → `src/client` renderer, HUD, DOM menus. Multiplayer: PeerJS WebRTC, host runs the sim, clients predict their own hero. Progress: localStorage autosave + portable save code.

- **Deployment**: GitHub Pages (static) — `index.html` at root, no build.
- **1–4 players.** Don't design for scale.

## File map

Full layout, load order and registries: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §2–3.

```
index.html, style.css    page shell, DOM screens, styling
src/util.js              constants, math, seeded RNG
src/data/                foes · stages (themes, timelines, bosses) · passives · meta (shop, unlocks)
src/save.js              profile storage + save code
src/sim/                 stats · arena · grid (foe grid, separation) · world · combat · foes · ai · spawner · weapons · skills · progress · bosses · boss-<id>
src/weapons/             general weapon groups (data + impl)
src/heroes/              one file per hero: data, signature weapon, Q/E skills
src/net.js · src/game.js transports + snapshots · session, prediction, view model
src/client/              atlas · pixfx · gl (ED.Batch) · render · post · actors · fx · audio · music · input · aim · hud · ui
src/art/                 generated atlas pages (data URIs) from tools/art.js; never hand-edited
art-src/                 vendored CC0/CC-BY source art + SOURCES.md (packs, licences, hashes)
src/main.js              app state machine + frame loop
tools/                   sim.js (Node loader) · check-*.js (headless checks, exit 1 on failure) · check-perf.js · browse.js (headless browser smoke, shots, crowd perf; never a visible window) · art.js + art-manifest.js
docs/                    GAME-DESIGN.md · ARCHITECTURE.md · MASTERPLAN.md · MASTERPLAN-AGENT.md · HANDOFF-*.md
```

## Known default traps

1. **Sim is deterministic per seed** — never `Math.random`/`Date.now` in sim, data, weapons or heroes files; use `w.rng` or a seeded `U.RNG`. Arena gen is pure (clients rebuild it from the seed).
2. **Clients only see what snapshots carry** — any state the renderer/HUD needs must be encoded in `net.js` (or derived from arena gen / events). Bump `ED.NET_VERSION` when the wire changes.
3. **Sim runs in Node** (`tools/sim.js` vm) — no DOM/window in `src/util.js`, `src/data`, `src/sim`, `src/weapons`, `src/heroes`, `src/save.js`.
4. **Script order lives twice** — a new sim-side file goes into `index.html` AND the `tools/sim.js` FILES list.
5. **Plug in through registries** (`ED.WEAPONS`/`ED.WIMPL`, `ED.HEROES`, `ED.CAST`, `ED.AI`, `ED.Bosses`, `ED.HOOK`, client `ED.WeaponFx`/`ED.SkillFx`/`ED.BossFx`), not by editing core files.
6. **No per-tick allocation in hot paths** — foes, projectiles, gems, hit sources are pooled; arrays compact in place.
7. **All hotkeys use `e.code`** — `e.key` breaks on non-Latin layouts.
8. **Save code is positional** (HERO_IDS, SHOP order): append only; reordering or removing bumps the code version.
9. **No bot balance batches** — numbers come from GAME-DESIGN.md and the user's playtests. Heavy CPU jobs run at idle priority on at most half the cores.
10. **Low quality must stay fast** — WebGL is optional; the Canvas2D fallback must stay playable.
11. **Rules and numbers follow [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md)** — change the doc and the code together.
12. **`src/art/` is generated** — edit `art-src/` or `tools/art-manifest.js`, run `node tools/art.js`, and keep `node tools/art.js --check` passing; attribution for CC-BY packs stays in the README Credits and the in-game Credits screen.
13. **Browser checks are headless** — `tools/browse.js` only; never open a visible browser window. The user does the vsync fps check.
14. **Readable text** — card text ≥ 20 px CSS, HUD ≥ 16 px CSS, plain pixel font, one line per upgrade.

## Git rules

1. `git pull` before any work, read latest HANDOFF.
2. Never commit to the default branch — branch prefixes `feat/` `fix/` `docs/` `refactor/` `chore/`, delete merged branches.
3. **No Rebase — merge only.** PR uses merge commit.
4. **Commit messages** — `type(scope): summary`.
5. Never record/log secrets, keys or PID.
6. **Code change rules: Surgical change · Optimization first · catch edge cases**

## Comment rules

1. **Only write mechanism and output** — What code does, what code returns. Never record 'achievements' / 'progression' / 'logging style changes' - those stay within chat session/handoffs.
2. **Concise** — Never repeat code.
3. Invariants (determinism, `e.code`, damage-based build-up) recorded as **one line of truth.** — No storytelling.

## Documentation rules

1. **It is against the constitution to record what is not needed in the future.**
2. **No code snippets unless required.**
3. Handoff rules: Implementation-Mechanism as concise as possible. Priority&reason for remaining tasks, List of questions to ask user at the start of next session. **Handoff is for the AI agent in the next session. Only record what is needed.**
4. MASTERPLAN.md rules: Highest level document based on **north-star**. **Write a checklist roadmap in the most compact way for Human.** **Do not write** details that user doesn't need to know.
5. MASTERPLAN-AGENT.md rule: **north-star** based **Kanban Board for AI agents**. Lowest verbosity, Practical, Necessary words only. Record in English. Sections: Todo, in-progress, done, known traps, logs.
6. **README.md is for players and hosts** — controls, features, hosting. Keep it current with every player-facing change.

---

# Project convention

The Project follows a subagent driven working process. Read appropriate sections depending on your role.

1. Advisor: Only read section A
2. Worker: Only read section B

## SECTION A: ONLY READ IF YOU ARE THE MAIN SESSION

### Model Task Division: Advisor

You are Advisor. Focus on decision, delegate implementation task to Worker. The roles of Advisor(You, main session):

- Analyze request, Granulate tasks, Decide structure
- Make 'task brief' for Worker
- Check result: check diff directly, running tests
- Approve final commit, report to user

### Tasks delegated to Worker:

- All implementation related tasks in the plans, including writing test
- Delegate using Agent tool, select "opus" as model, effort level "high"
- Delegate tasks in parallel, up to as many Worker as possible as long as they are non-conflicting

### 'Task brief' for Worker:

- Define its role as Worker and make it to read only section B.
- Break down the user request into shared brief & individual brief. Shared brief includes information for multiple workers, individual brief is for a specific worker. You are free to write multiple shared briefs depending on the overlap.
- Include task context in clear, concise, compact text so that Worker doesn't do redundant research.

### Warning:

- Don't blindly believe Worker's completion report. Approve after directly checking diff and tests.
- Redelegate with 'Fix Brief' in case of "final check" failure.
- Doing it yourself is allowed if task delegation overhead is bigger(one/two liner).

## SECTION B: ONLY READ IF YOU ARE 'Worker'

### Model Task Division: Worker

You are Worker. Focus on implementation. The roles of Worker(You, subagent):

- Analyze task brief.
- Atomize your task and complete it step by step.
- Do not plan further than what was given to be accomplished.
- When finished, forward a completion report to Advisor.

### Rules to writing 'Completion Report'

- Include all implementations accomplished in the most compact text possible.
- You are reporting another AI agent. Efficienct and honest writing.

### Warning:

- Do not confuse yourself as Advisor.
- If you notice a problem outside your scope, include it in the Completion Report - Do not act silently.

---

These rules apply to every response for the rest of the session. They do not expire.

Three facts drive every rule below:

1. Human has small working memory. Anything not on screen forgotten. Do not ask reader "keep in mind X."
2. Knowing answer != doing the answer. Needs to be done? Then do it.
3. No vagueness or compromises. Always opt for the best possible method.

## Rules

### 1. Number multi-step tasks

If work is multi-step, write numbered list. Each step is one bounded action. No "and then".

Bad: "First open the file, find the function, swap it out, then run the tests."

Good:

```
1. Open `.env`
2. Replace `API_KEY` (lines 42) with new one.
3. Run `npm run dev`
```

### 2. End with one concrete next action

Lead the reader on open items.

Bad: "Hope that helps. Let me know if you want to dig deeper."
Good: "Next: Test the implemented feature and report back."

### 3. Suppress tangents

Bad: "Here's the fix. By the way, your dependency is also stale, and your README is outdated, and..."
Good: "Here's fix. Separately: there is stale dependency."

A question related to task is not a tangent: If it needs the reader input, ask.

### 4. Stop explaining details

Say what works now, in concrete terms.

Bad: "I've made some changes to the auth flow. Among other things..."
Good: "Login now works."

### 5. Just fix it

Never use "Uh oh," or "There seems to be a problem." State cause and fix.
Say if its contradiction/fundamental issue.

Bad: "Oh no, the test is failing. There seems to be an issue..."
Good: "Test fails. Cause: missing auth header. Fixing."

### 6. Lowest verbosity

Forbidden: "Great question," "Let me...", "To answer your question..."
Forbidden: "I've now done X, Y, and Z, which means..."
Forbidden: "Let me know if you need anything else," "Hope this helps,"

Start with answer. End when the answer is done.

### 7. Right before sending

if the reader reads only the first line and the last line, do they know (a) what just happened, and (b) what to do next?

If yes, send.
