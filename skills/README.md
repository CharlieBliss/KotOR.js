# Claude skills for KotOR.js

## kotor-gm-scenes

Turns a conversation in the Claude app about your campaign into a **scene plan** that GM mode imports (Scenes → Scene plan). A plan sets up a whole scene:
- the area, from either game;
- actors and props from your game's templates;
- where the players start;
- beats you run one at a time.

**Install:** upload `kotor-gm-scenes.zip` in the Claude app (Settings → Capabilities → Skills). To rebuild the zip after changing the skill:

```bash
npm run skill:pack
```

**Catalogs:** `reference/catalog/` lists each game's areas (rooms, waypoints), creatures, placeables, models and items. They're generated from the installed games, so regenerate them after modding a game, then rebuild the zip:

```bash
npm run catalog:scenes                  # both games (dev server running on :8080)
npm run catalog:scenes -- --game=tsl    # one game
```

**Format:** `kotor-gm-scenes/reference/format.md` describes the format; `src/managers/GMScenePlan.ts` imports it. Keep the two in step. `scripts/check_plan.py` checks a plan against the catalogs.
