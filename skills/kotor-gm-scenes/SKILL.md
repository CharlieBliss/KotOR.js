---
name: kotor-gm-scenes
description: Turn a conversation about a Star Wars KotOR tabletop-style campaign (plot lines, scenes, encounters) into scene plan files the GM imports into KotOR.js GM mode. Use whenever the user wants a scene, encounter or set-piece built for their KotOR.js GM sessions, asks to "make this a scene", "set this up in the game", "write the scene file", or discusses a KotOR campaign scene they will run. It picks a fitting area from KotOR or KotOR II (by how it looks, not by canon), casts actors from the game's creature templates, dresses the set with props, places the players, and scripts the scene as beats.
---

# KotOR.js GM scenes

The user runs a game-master mode in KotOR.js, a remake of the KotOR engine. They load an area and fill it with the game's own creatures and props; connected players' characters act in it. This skill turns a story discussion into a **scene plan**: one JSON file the GM imports (Scenes → Scene plan) to set the whole scene up.

## What to read

- **Before writing your first plan, read `reference/format.md`.** It's the file format, and its rules are enforced.
- **`reference/area-guide.md`:** which area suits which kind of setting. It's the shortlist; start there.
- **`reference/catalog/<game>/`** (`kotor` = KotOR, `tsl` = KotOR II) is generated from the installed games. The files are large, so **search them** (grep) rather than reading them whole:
  - `areas.md`: every area, with its rooms (floor size, width x depth, centre) and waypoints.
  - `creatures.tsv`: creature templates, with name, default faction, classes, HP, look and weapon.
  - `placeables.tsv`: placeable templates; `models.tsv`: placeable models.
  - `items.tsv`: items, for loot and gear.
- **`examples/`:** finished plans to copy from.

## Workflow

1. **Know the two games involved.**
   - **`content`:** the game the GM runs. Actors and props must be its templates (templates from the other game get the wrong models).
   - **The area:** it can come from either game. KotOR.js borrows the other game's areas.
   - If you don't know which game the GM runs, ask once. Don't guess.
2. **Talk the scene through first.** Help with the story: stakes, mood, what the players see and can do, how it turns, how it ends. Write the plan once the scene is clear enough, or when asked.
3. **Pick the area for its look, not its canon location.** A Jedi temple on Onderon is best played in Dantooine's Jedi Enclave (KotOR `danm13`), not whatever area carries the Onderon name. Use `area-guide.md`, then grep `areas.md` for the module's block to see its rooms and waypoints. Say why the area fits in `area.reason`.
4. **Block the scene.**
   - **Choose the main room:** usually the biggest one (rooms are listed biggest first).
   - **Place things with offsets:** the room centres (`@x,y`) and waypoint positions are in the area's metres. Use them to put groups apart, set sightlines and keep paths clear.
   - **Use waypoints:** they often mark doorways, posts and NPC spots (e.g. `dan13_wp_pc01` is the player's spot in the Enclave).
   - **Check the room fits:** keep groups inside rooms large enough for them. A 7x24 corridor won't hold a 12-person melee.
5. **Cast it.**
   - **Find templates:** grep `creatures.tsv` for fitting ones by name, look or weapon. Generic templates (e.g. "Dark Jedi", "Jedi", "Sith Trooper") beat named story characters, unless that character is wanted.
   - **Factions:** set the faction the scene needs; it overrides the template's.
   - **Numbers:** keep them sane. 25 or fewer creatures on screen plays well.
6. **Dress the set.** Grep `placeables.tsv` and `models.tsv` for the mood: debris, wreckage, crates, consoles, bodies, fire, banners. Use containers with `loot` for things to find. Use `skill`-gated props for terminals and repairs.
7. **Script it as beats.**
   - **Arrivals:** place them up front with `"hidden": true`, then reveal them in a beat, with orders.
   - **Watching only:** to keep players out of the action, set `"players": { "frozen": true }` and free them in a later beat (`freezePlayers`).
   - **Text:** narration and `say` lines carry the drama. Keep each to one or two sentences.
8. **Write the file and check it.** Save it as `<short-title>.json` and run:
   `python3 scripts/check_plan.py <file>`
   Fix every ERROR. NOTEs are advice. If the catalog lacks something you wanted, choose the nearest thing that exists, and say what you substituted.
9. **Hand it over.** Give the file, then a short summary:
   - the area and why it fits;
   - the cast and the props;
   - where the players start;
   - the beats, in one line each.

   Remind the GM how to import it: Scenes → Scene plan → Open file → Import and set the scene. Then run the beats from that panel.

## Good scenes

- **Arrivals and reveals:** the importer places everything at once, so anything that "arrives" must be placed hidden near its entrance and revealed in a beat.
- **Watching scenes:** frozen players can't be targeted, so NPCs can fight each other around them. Free them in the beat where they can act again.
- **NPC orders:** `attack` shares targets across a group, and attackers turn on the next enemy once theirs is dead. To keep something alive, `standDown` it or give its enemies a different target.
- **Empty areas:** the area's own NPCs, doors and furniture don't come with it (always, for the other game's areas). Doorways are open, and the set is yours to fill.
- **The GM's control:** beats are the GM's controls, not a timeline. Write one beat per moment the GM should choose to trigger: an entrance, a turn, an aftermath.
