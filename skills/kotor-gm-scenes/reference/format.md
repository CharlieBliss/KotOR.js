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

Every point is snapped to the nearest walkable floor, so a slightly-off offset is safe. A spot that isn't in the area is reported to the GM, and that actor or prop is skipped.

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
| `{ "do": "narrate", "text": "..." }` | GM narration in chat |
| `{ "do": "freezePlayers", "on": true }` | Players watch only (`false`: they're free again) |
| `{ "do": "movePlayers", "to": <placement> }` | Move every player's character |
| `{ "do": "check", "check": "awareness", "dc": 15, "secret": false }` | Every player rolls a skill (`computer use`, `demolitions`, `stealth`, `awareness`, `persuade`, `repair`, `security`, `treat injury`) or a save (`fortitude`, `reflex`, `will`) |

## What the importer can't do (yet)

- **Area objects:** the area's own creatures, placeables and doors aren't kept. That's always true of areas borrowed from the other game, where doorways stay open. Place everything the scene needs yourself.
- **Mid-scene changes:** there's no spawning, scene change or camera move during a scene. Place everything up front, hidden if needed, and reveal it in a beat.
- **Players:** they're the GM's connected players. The plan positions them but doesn't create their characters.
