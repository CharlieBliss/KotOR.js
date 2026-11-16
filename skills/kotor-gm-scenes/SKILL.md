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
  - `areas.md`: every area, with its rooms (floor size, width x depth, and the spot point `room:<room>` puts things at) and waypoints.
  - `floors.json`: each area's walkable floor, which the checker uses. Don't read it yourself.
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
   - **Place things with offsets:** each room's spot point (`@x,y`) and the waypoint positions are in the area's metres. Use them to put groups apart, set sightlines and keep paths clear.
     - A room's spot point is always on its floor, but not always in the room's middle: in a hall around a garden or pit it sits at the edge of the walkway.
     - Check where offsets land with the checker's map; don't trust arithmetic alone.
   - **Use waypoints:** they often mark doorways, posts and NPC spots (e.g. `dan13_wp_pc01` is the player's spot in the Enclave).
   - **Check the room fits:** keep groups inside rooms large enough for them. A 7x24 corridor won't hold a 12-person melee.
5. **Cast it.**
   - **Find templates:** grep `creatures.tsv` for fitting ones by name, look or weapon. Generic templates (e.g. "Dark Jedi", "Jedi", "Sith Trooper") beat named story characters, unless that character is wanted.
   - **Factions:** set the faction the scene needs; it overrides the template's.
   - **Numbers:** keep them sane. 25 or fewer creatures on screen plays well.
   - **Body language:** give actors a `stance` that sells the moment (meditating Jedi, a prisoner kneeling, the wounded lying down, a technician at a console). Change it, or add a gesture, in a beat with `animate`. The ids are in `reference/format.md`; some exist only in KotOR II.
   - **Seated actors need a seat.** `chair`, `chair_drunk` and `chair_pazaak` sit on nothing unless the plan places a chair or bench under them. Give each seated actor its own seat prop and put the actor on it: `"at": { "spot": "prop:<seat id>" }`, with the same `facing` as the seat. Seats are in `reference/format.md` ("Seats"). `sit` and `meditate_sit` are on the floor and need none.
6. **Dress the set.** Grep `placeables.tsv` and `models.tsv` for the mood: debris, wreckage, crates, consoles, bodies, fire, banners, chairs and benches. Use containers with `loot` for things to find. Use `skill`-gated props for terminals and repairs.
   - **Search by model as well as name.** A template's name can be wrong (KotOR II's `plc_chair1` is a food pile); its `model` column says what it really is.
   - **Props are obstacles.** Tables, crates and chairs block the way. Leave walkways a couple of metres wide between them, especially on routes NPCs are ordered along.
   - **Nobody stands inside a prop.** The catalogs give each solid prop's `footprint` (its size on the floor). Place actors around a table or crate at least half its size plus 0.5 m from its spot ("Footprints" in `reference/format.md`). The checker reports anyone inside one and where the game would move them.
7. **Script it as beats.**
   - **Arrivals:** place them up front with `"hidden": true`, then reveal them in a beat, with orders.
   - **Watching only:** to keep players out of the action, set `"players": { "frozen": true }` and free them in a later beat (`freezePlayers`).
   - **Text:** narration and `say` lines carry the drama. Keep each to one or two sentences.
8. **Check the draft.** A plan isn't finished until it has been checked. Names alone aren't enough: offsets worked out by hand land in walls, crowds jam corridors, and arrivals appear on top of the players.
   1. **Save it** as `<short-title>.json`.
   2. **Run the checker:** `python3 scripts/check_plan.py <file>`.
      - It checks the names, then works out where everything lands on the area's floor, the way the game's importer does. It flags:
        - off-floor and far-snapped points;
        - copies landing in the wrong room;
        - overlaps, and crowded rooms or knots;
        - places nobody can walk to;
        - arrivals on top of the players;
        - beats that order, hide or reveal the wrong things.
      - It ends with a **text map** of the scene: `@` players, a letter per actor group (lower case while hidden), digits for props, `*` order destinations.
   3. **Fix every ERROR.** NOTEs are advice: fix the ones that hurt the scene.
   4. **Read the map** against the scene as discussed:
      - Are the groups where the story puts them, with space to fight?
      - Do the players see what they should from their spot?
      - Does each arrival come in from an entrance?

      Re-run the checker after changes. `--map scene.png` also draws a picture you can give the GM.
   5. **Check it in the game, where you can.** If KotOR.js and the game are on this machine (you're working in the KotOR.js repository, with `npm run dev` serving the game), run `npm run scene:check -- <file>`.
      - It imports the plan with the game's own importer, runs every beat, and writes `scene-check/<plan>/report.md` and screenshots: an overview from above with labelled dots, the players' view, each group up close, and the scene after each beat.
      - **Open every screenshot** and judge it as the players will see it: who stands where, facing and stance, whether the cast is visible from the players' spot, and whether each beat plays out (fights start, movers arrive).
      - Fix what the pictures and the report's findings show, then re-run. Fights that break out on their own, or attackers that never close in, mean the blocking needs changing.
   6. **Hand over only after the checks pass,** and say which checks ran: the checker always, the in-game check when it was available.

   If the catalog lacks something you wanted, choose the nearest thing that exists, and say what you substituted.
9. **Hand it over.** Give the file, then a short summary:
   - the area and why it fits;
   - the cast and the props;
   - where the players start;
   - the beats, in one line each.

   Remind the GM how to import it: Scenes → Scene plan → Open file → Import and set the scene. Then run the beats from that panel.

## Good scenes

- **Arrivals and reveals:** the importer places everything at once, so anything that "arrives" must be placed hidden near its entrance and revealed in a beat.
  - Keep hidden hostiles out of sight of other NPCs. Creatures that notice each other can start fighting even while one side is hidden.
  - Not behind a doorway, though: the area's doors aren't kept, and creatures may not path through some empty doorways. The in-game check shows both.
- **Watching scenes:** frozen players can't be targeted, so NPCs can fight each other around them. Free them in the beat where they can act again.
- **NPC orders:** `attack` shares targets across a group, and attackers turn on the next enemy once theirs is dead. To keep something alive, `standDown` it or give its enemies a different target.
- **Empty areas:** the area's own NPCs, doors and furniture don't come with it (always, for the other game's areas). Doorways are open, and the set is yours to fill.
- **The GM's control:** beats are the GM's controls, not a timeline. Write one beat per moment the GM should choose to trigger: an entrance, a turn, an aftermath.
