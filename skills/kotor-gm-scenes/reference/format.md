# Scene plan format (version 1)

A scene plan is one JSON file. The GM imports it in KotOR.js GM mode (Scenes → Scene plan). The importer:

1. loads the area;
2. places the props, then the actors;
3. gives the actors their orders;
4. moves the players to their start.

The beats wait in the GM panel, and the GM runs them one at a time.

```jsonc
{
  "format": "kotorjs-gm-scene",
  "version": 1,
  "title": "Massacre at the Onderon Temple",
  "summary": "One or two sentences for the GM.",
  "gmNotes": "Anything the GM should know: pacing, what the players should feel, what to improvise.",

  "content": "tsl",                     // the game the GM runs: actors' and props' templates come from it
  "area": { "game": "kotor", "module": "danm13", "reason": "Why this area stands in for the story's place." },
  "settings": { "npcAi": true, "deathRule": "kotor" },   // optional

  "players": {
    "at": { "spot": "waypoint:dan13_wp_pc01", "offset": [0, -2], "formation": "line" },
    "facing": "toward:room:m13aa_01a",
    "frozen": true,                       // watching only: can't move or act, and NPCs leave them alone
    "note": "Shown to the GM: where the players are and why."
  },

  "actors": [ /* see below */ ],
  "props":  [ /* see below */ ],
  "beats":  [ /* see below */ ]
}
```

## Spots and placement

Plans never use coordinates. Everything is placed at a **spot**, which must exist in the chosen area (see `catalog/<game>/areas.md`):

| Spot | Where |
|---|---|
| `"entry"` | the area's start point |
| `"room:<room>"` | the middle of a room's floor, e.g. `"room:m13aa_01a"` |
| `"waypoint:<tag>"` | one of the area's waypoints, e.g. `"waypoint:dan13_wp_pc01"` |
| `"actor:<id>"`, `"prop:<id>"` | something this plan placed (listed earlier in the plan) |
| `"players"` | where the players start |

A **placement** is a spot plus optional extras:

```jsonc
{ "spot": "room:m13aa_01a", "offset": [4, -3], "formation": "ring", "spacing": 2 }
```

- `offset`: metres from the spot along the area's x axis (east) and y axis (north). Use it to spread groups apart and to keep things out of each other.
- `formation`: how several copies (`count`) stand: `"cluster"` (default: bunched up), `"ring"` (around the spot, facing in) or `"line"` (side by side along x).
- `spacing`: metres between copies (default 1.5).

Every point is snapped to the nearest walkable floor, so a slightly-off offset is safe. A point far off the floor (inside a wall, past a room's edge) is moved to whatever floor is nearest, which can be metres away in another room; the checker flags it. A spot that isn't in the area is reported to the GM, and that actor or prop is skipped.

`room:<room>` puts things at the room's spot point, the `@x,y` in `areas.md`. That point is always on the room's floor, but not always in its middle: in a room built around something you can't walk on (a garden, a pit), it is at the edge of the walkway.

## Checking a plan

`scripts/check_plan.py` checks a plan's names and its layout. For the layout, it uses each area's floor map (`catalog/<game>/floors.json`, half-metre cells) and works out where everything lands, as the importer does. Where it lands is then checked against the floor, the rooms, the other actors and props, and the players, and the beats are run over who's visible, on which side and frozen. It prints a text map of the scene.

The floor map is flat: where floors stack (a walkway over a hall), they're merged, so check stacked areas in the game.

`npm run scene:check -- <plan.json>` (in the KotOR.js repository, with the game) imports the plan in the game and runs its beats. It takes screenshots, and reports what really happened: where things stand, fights, deaths, and orders that didn't play out.

**Choosing spots:** the area catalog gives each room's walkable size, width x depth, and floor centre (`@x,y`), plus each waypoint's position. Use them to:
- put groups in rooms big enough for them;
- work out offsets between spots (the distance from one `@x,y` to another);
- choose sightlines, e.g. players in a doorway room next to the big hall, looking in.

## Facing

`"facing"` is either degrees (0 = north, 90 = east) or `"toward:<spot>"`. When it's left out, actors and props face the players.

## Actors

```jsonc
{
  "id": "dark_jedi",                      // unique in the plan; beats and orders use it
  "name": "Dark Jedi",                    // optional; with count > 1 they're numbered
  "template": "g_darkjedi02",             // a creature template from catalog/<content>/creatures.tsv
  "faction": "hostile",                   // "hostile" (fights the players and their allies), "friendly", "neutral"
  "count": 4,
  "at": { "spot": "entry", "formation": "line" },
  "facing": "toward:room:m13aa_01a",
  "hidden": true,                         // placed now, invisible and inert until a beat reveals it
  "bark": "Line spoken when a player clicks them.",
  "stance": "meditate",                   // optional: held while idle (see Stances and gestures)
  "order": { "kind": "attack", "target": "jedi" },   // optional standing order (see Orders)
  "customize": { "hp": 150, "rightHand": "g_w_lghtsbr02", "appearance": "Dark_Jedi_Male_01" },  // optional
  "loot": ["g_i_credits001"]              // optional items from catalog/<content>/items.tsv
}
```

**Factions:**
- *hostile* creatures fight *friendly* ones and the players.
- *friendly* creatures are the players' side.
- *neutral* creatures are bystanders.

To make NPCs fight each other with the players out of it, use hostile against friendly, and freeze the players.

## Props

```jsonc
{
  "id": "rubble",
  "template": "plc_burnjunk",             // a placeable template from catalog/<content>/placeables.tsv
  "appearance": "BurningJunk",            // or just a model: a label from catalog/<content>/models.tsv
  "name": "Smouldering wreckage",         // optional
  "count": 3,
  "at": { "spot": "room:m13aa_01a", "offset": [6, 2], "formation": "cluster", "spacing": 3 },
  "facing": 45,
  "hidden": false,
  "container": true, "loot": ["g_i_medeqpmnt01"],   // a searchable container with these items
  "locked": { "dc": 20 },                 // Security DC
  "skill": { "skill": "computer use", "dc": 15 },   // a skill check before it can be used
  "bark": "Line shown when used.",
  "scale": 1.0
}
```

Use `template` when one fits (it keeps the game's own name and behaviour). Use `appearance` for pure set dressing.

Props block the way like walls: NPCs walk around them, but a room packed with tables leaves no way through. Keep walkways a couple of metres wide, especially where beats send NPCs.

### Seats

The seated stances (`chair`, `chair_drunk`, `chair_pazaak`) don't bring a chair: put a seat prop down and the actor on it, facing the same way.

```jsonc
"props":  [ { "id": "seat1", "template": "plc_chair_mil_01", "at": { "spot": "room:207tel_1", "offset": [10.5, -4.4] }, "facing": 0 } ],
"actors": [ { "id": "gambler", "template": "n_rodian", "at": { "spot": "prop:seat1" }, "facing": 0, "stance": "chair_pazaak" } ]
```

One seat per seated actor: give a group a seat each (props and actors with the same `count`, `formation` and `spacing`, so the copies line up), or a bench per two. Put the table 1.3 m in front of the seat (in the facing direction) for `chair_pazaak`.

| Seat | KotOR (`content: "kotor"`) | KotOR II (`content: "tsl"`) |
|---|---|---|
| Military chair (best for most scenes) | `plc_chair1` (named "Food pile" in the game's data, but it's the chair) | `plc_chair_mil_01` |
| Luxurious chair | `plc_chair2` | `plc_chair2` |
| Bench | `plc_bench`, `plc_bench2` | `plc_bench`, `plc_bench2`, `plc_lbench01` (long), `plc_medbench01` |
| Lounge chair | | `plc_chair03`, `plc_chair04` (low, angled: reads oddly with `chair_pazaak`) |
| Rakata bench | `plc_rbench` | `plc_rbench` |

In KotOR II `plc_chair1` is a food pile, not a chair.

## Orders

| Order | Meaning |
|---|---|
| `{ "kind": "attack", "target": "<actor id>" }` or `"target": "players"` | Fight that group, sharing the members out; when they're dead, back to their own judgement |
| `{ "kind": "follow", "target": "<actor id>" }` | Stay close; fight back if attacked |
| `{ "kind": "move", "to": <placement> }` | Walk there, then guard it |
| `{ "kind": "guard", "radius": 8 }` | Hold where they stand, fight enemies within the radius |
| `{ "kind": "patrol", "points": [<placement>, <placement>, ...] }` | Walk the loop, fight what they meet |
| `{ "kind": "flee" }` | Run from enemies, never fight |
| `{ "kind": "standDown" }` | Don't fight at all, even when attacked |

A hidden actor's order is given when a beat reveals it.

## Beats

Beats are the scene's script: steps the GM runs in order, at their own pace.

```jsonc
{
  "title": "The dark Jedi arrive",
  "narration": "The great doors burst open...",     // sent to every player's chat when the beat runs
  "notes": "For the GM only: wait for the players to settle in first.",
  "actions": [
    { "do": "reveal", "ids": ["dark_jedi"] },
    { "do": "order", "ids": ["dark_jedi"], "order": { "kind": "attack", "target": "jedi" } },
    { "do": "say", "id": "dark_jedi", "text": "Leave none alive." }
  ]
}
```

| Action | Does |
|---|---|
| `{ "do": "reveal", "ids": [...] }` | Show hidden actors or props (and give hidden actors their orders) |
| `{ "do": "hide", "ids": [...] }` | Hide them again |
| `{ "do": "order", "ids": [...], "order": <order> }` | A new order; `"order": null` hands them back to their own judgement |
| `{ "do": "faction", "ids": [...], "faction": "hostile" }` | Change sides (an ally turns) |
| `{ "do": "say", "id": "<id>", "text": "..." }` | The actor speaks (shown over the scene and in chat) |
| `{ "do": "animate", "ids": [...], "stance": "kneel_sad", "gesture": "bow" }` | A new stance (`""` stands them up) and/or a one-off gesture; either is optional |
| `{ "do": "narrate", "text": "..." }` | GM narration in chat |
| `{ "do": "freezePlayers", "on": true }` | Players watch only (`false`: they're free again) |
| `{ "do": "movePlayers", "to": <placement> }` | Move every player's character |
| `{ "do": "check", "check": "awareness", "dc": 15, "secret": false }` | Every player rolls a skill (`computer use`, `demolitions`, `stealth`, `awareness`, `persuade`, `repair`, `security`, `treat injury`) or a save (`fortitude`, `reflex`, `will`) |

## Stances and gestures

A **stance** is held whenever the actor would otherwise just stand: after walking somewhere, after a gesture. Combat interrupts it, and it comes back afterwards. A **gesture** plays once.

Each creature's model has its own set of animations. When an actor's model lacks a stance, it just stands, and the importer notes it. "Both" means both games' human models have it; "KotOR II" means only KotOR II's do; "some models" means a few creatures have it, so check in the game.

**Stances**

| id | Looks like | Models |
|---|---|---|
| `listen` | Listening | both |
| `talk` | Talking | both |
| `talk_forceful` | Talking, forceful | both |
| `talk_pleading` | Pleading | both |
| `talk_sad` | Talking, sad | both |
| `laugh` | Laughing | both |
| `kneel_angry` | Kneeling, angry | KotOR II |
| `kneel_sad` | Kneeling, sad | KotOR II |
| `attention` | At attention | KotOR II |
| `pointing` | Pointing | KotOR II |
| `injured` | Injured | both |
| `tired` | Tired | both |
| `sick` | Sick or poisoned | both |
| `crouched` | Crouched (sneaking) | both |
| `meditate` | Meditating | both |
| `meditate_sit` | Meditating, seated | KotOR II |
| `meditate_stand` | Meditating, standing | KotOR II |
| `sit` | Sitting on the ground | KotOR II |
| `chair` | Sitting in a chair (needs a seat prop) | both |
| `chair_drunk` | Slumped in a chair (needs a seat prop) | both |
| `chair_pazaak` | Playing pazaak at a table (needs a seat prop) | both |
| `computer` | Using a computer | both |
| `datapad` | Reading a datapad | some models |
| `weld` | Welding | some models |
| `treat` | Tending the wounded | both |
| `cards` | Playing cards | some models |
| `dance` | Dancing | both |
| `dance2` | Dancing (other) | both |
| `flirt` | Flirting | both |
| `horror` | Horrified | both |
| `fear` | Cowering | some models |
| `choke` | Choking | both |
| `spasm` | Convulsing | both |
| `paralyzed` | Paralyzed | both |
| `collapsed` | Collapsed | some models |
| `sleep` | Asleep | both |
| `prone` | Lying down | both |
| `prone_talk` | Lying wounded, talking | KotOR II |
| `dead` | Lying dead | both |
| `dead_back` | Lying dead (other) | both |
| `dead_face` | Lying dead, face down | both |
| `shut_down` | Shut down | some models |

**Gestures**

| id | Looks like | Models |
|---|---|---|
| `bow` | Bow | both |
| `salute` | Salute | both |
| `greet` | Wave | both |
| `nod` | Nod | KotOR II |
| `shake` | Shake head | KotOR II |
| `shrug` | Shrug | KotOR II |
| `heart` | Hand on heart | KotOR II |
| `roll_eyes` | Roll eyes | KotOR II |
| `persuade` | Persuade | both |
| `cheer` | Cheer | both |
| `taunt` | Taunt | both |
| `point` | Point | KotOR II |
| `point_up` | Point up | KotOR II |
| `point_down` | Point down | some models |
| `look_left` | Look left | both |
| `look_right` | Look right | both |
| `look_around` | Look around | KotOR II |
| `scratch` | Scratch head | KotOR II |
| `bored` | Bored | KotOR II |
| `pick_up` | Pick up from the ground | both |
| `take_table` | Take from a table | both |
| `console` | Work a console | both |
| `activate` | Use an item | both |
| `inject` | Use a medpac | both |
| `drink` | Drink | some models |
| `lock` | Pick a lock | both |
| `throw` | Throw | both |
| `kneel` | Kneel | both |
| `sit_down` | Sit down | both |
| `stand_up` | Stand up | both |
| `power` | Use a Force power | some models |
| `roll` | Dive roll | KotOR II |

Droids and beasts: `spasm`, `dead` and `shut_down` (droids), and the gestures `cheer`, `taunt`, `look_left` and `look_right`, use their own versions.

## What the importer can't do (yet)

- **Area objects:** the area's own creatures, placeables and doors aren't kept. That's always true of areas borrowed from the other game, where doorways stay open. Place everything the scene needs yourself.
- **Mid-scene changes:** there's no spawning, scene change or camera move during a scene. Place everything up front, hidden if needed, and reveal it in a beat.
- **Players:** they're the GM's connected players. The plan positions them but doesn't create their characters.
