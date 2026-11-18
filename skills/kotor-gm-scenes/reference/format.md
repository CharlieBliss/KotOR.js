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
  "party": { "size": 4, "level": 6, "difficulty": "hard" },   // who the players are, and how hard the fights should be (see Encounters)

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
  "customize": { "level": 8, "hp": 150, "rightHand": "g_w_lghtsbr02", "appearance": "Dark_Jedi_Male_01" },  // optional (see below)
  "loot": ["g_i_credits001"]              // optional items from catalog/<content>/items.tsv
}
```

**Customize** changes an actor from its template:
- `level` (1 to 50) and `class` restat it: the game rebuilds it at that level, as levelling up would. It gets its class's feats, Force powers (dark side for hostiles), skills, vitality and Force points for the level. It keeps its look, gear and its own special abilities.
  - Going down, its Strength, Dexterity, Constitution and Wisdom shrink with it, but not below 14. Going up, its main ability gains a point per four levels.
  - `class` is a name or number from `catalog/<content>/classes.tsv` (`"Soldier"`, `"Jedi Guardian"`, `"Combat Droid"`, `"Minion"` for beasts). Without it, it keeps its own (its first, for multiclass templates).
- `hp` sets its vitality (after a restat too).
- `rightHand`, `leftHand`, `armor` re-equip it (items from `items.tsv`; its `combat` column gives a weapon's average damage and attack bonus, and armour's AC). `appearance` reskins it: an `appearance.2da` label.

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

**Footprints.** `placeables.tsv` and `models.tsv` give each solid prop's `footprint`: the floor it covers, as `minX,minY,maxX,maxY` in metres around its spot before it's turned (empty: it can be walked through). Use it to place actors beside a prop, not in it:
- **Beside it:** offset the actor from the prop's spot by more than half the footprint's width or depth, plus 0.5 m for the actor. KotOR II's `plc_gentable` is 4 x 2 m (`-2,-1.05,2.01,0.92`), so someone at its long side stands about 1.5 m from its spot, not 0.5 m.
- **Around it** (`"spot": "prop:<id>"`, `"formation": "ring"`): the ring's radius is `spacing` (or larger for many copies), measured from the prop's spot. Make it more than half the footprint's longest side plus 0.5 m.
- **On it:** only a seated actor on a seat (see "Seats" below).

The checker and the game both catch the rest. An actor standing inside a prop is moved to the nearest clear floor (up to 4 m), and the checker says where it lands. Treat that note as a fix to make in the plan.

### Seats

The seated stances (`chair`, `chair_drunk`, `chair_pazaak`) don't bring a chair: put a seat prop down and the actor on it. The game seats it: it sits in the free seat nearest where the plan puts it (within 1.6 m), on the seat's own spot and facing the way the seat does. So the actor's `facing` doesn't matter, and the seat can face any way.

```jsonc
"props":  [ { "id": "seat1", "template": "plc_chair_mil_01", "at": { "spot": "room:207tel_1", "offset": [10.5, -4.4] }, "facing": 90 } ],
"actors": [ { "id": "gambler", "template": "n_rodian", "at": { "spot": "prop:seat1" }, "stance": "chair_pazaak" } ]
```

- **Which way a seat faces.** Each seat model faces its own way: `plc_chair_mil_01` faces 90 degrees to the left of its `facing` (turn it to 0 and its sitter faces west). Work out where sitters look from `seats` in `placeables.tsv` / `models.tsv`: each seat is `x,y,fx,fy` in the model's frame (unturned, north up): where the sitter's hips go and the way it faces; `,e` marks a backless seat it can face either way (the side nearest the actor's `facing`). The checker's map shows each sitter's facing.
- **One seat per seated actor.** A chair seats one, a bench two or three (one per `seats` entry). A group: a seat each (props and actors with the same `count`, `formation` and `spacing`), or `"spot": "prop:<bench>"` with `count` 2.
- **At a table** (`chair_pazaak`): the seat's facing, not the actor's, decides which way it looks: turn the chair so it faces the table, about 1.3 m away.

Chairs and benches are usable: a player who clicks one walks over and sits in it (moving gets them up). The GM can sit an NPC by dragging a seated one onto a seat, or by giving one standing next to a seat a seated stance.

| Seat | KotOR (`content: "kotor"`) | KotOR II (`content: "tsl"`) |
|---|---|---|
| Military chair (best for most scenes) | `plc_chair1` (named "Food pile" in the game's data, but it's the chair) | `plc_chair_mil_01` |
| Luxurious chair | `plc_chair2` | `plc_chair2` |
| Bench | `plc_bench`, `plc_bench2` | `plc_bench`, `plc_bench2`, `plc_lbench01` (long), `plc_medbench01` |
| Lounge chair | | `plc_chair03`, `plc_chair04` (low, angled: reads oddly with `chair_pazaak`) |
| Rakata bench | `plc_rbench` | `plc_rbench` |

In KotOR II `plc_chair1` is a food pile, not a chair.

## Encounters

Fights should suit the party. Say who the players are, and the checker rates every fight the plan stages:

```jsonc
"party": { "size": 4, "level": 6, "difficulty": "medium" }
// or each player: "party": { "members": [ { "level": 6, "class": "Jedi Guardian" }, { "level": 5 } ], "difficulty": "hard" }
```

`difficulty` is the fight you want: `trivial`, `easy`, `medium`, `hard` or `deadly`. The checker notes when the hardest fight misses it.

**How the rating works.** `creatures.tsv` measures each template with the game's own combat rules:
- `level`, `class`, `hp`, `fp`, `ac` and `abilities` (Str/Dex/Con/Wis);
- `attacks`: each attack it makes per round, as `<kind><bonus>/<damage>`:
  - `<kind>`: `m` melee, `r` ranged; `md` is melee on Dexterity.
  - `<bonus>`: the weapon's and feats' attack bonus, on top of its base attack and ability modifier.
  - `<damage>`: the average dice damage, before Strength.
  - Flags: `h` off hand (half Strength), `x` two-handed (one and a half), `c` no Strength.
- `powers`: its hostile Force powers with their cost (`a` = area);
- `grenades`, `heals` (healing powers and items) and `feats` (combat feats).

From these, the checker works out the actor as the plan has it (restatted, re-equipped), and each player character from the party's level. Every combatant gets two numbers:
- **offense:** expected damage per round against the other side's AC, counting its powers while its Force points last, and its grenades;
- **health:** vitality plus healing.

Each side's strength is its total offense times its total health (Lanchester's square law: numbers count twice). From the two strengths it works out how much of its strength the party loses winning, or whether it loses:

| Rating | The party loses | Feels like |
|---|---|---|
| trivial | under 10% | a warm-up |
| easy | under 25% | a few hits taken |
| medium | under 40% | a real fight; medpacs used |
| hard | under 60% | someone goes down; Force points and grenades spent |
| deadly | 60% or more, or the fight | a likely wipe |

A fight is the hostiles fighting at the start, then each beat that reveals or turns hostiles. Each fight is rated alone, as if earlier ones were over. Friendly actors fight on the players' side. While the players are frozen, the fight is rated for their allies alone.

It's an estimate: terrain, cover, focus fire and the players' tactics change fights. Use it to land in the right band, and adjust from the in-game check.

**Making a fight fit**, in this order:
1. **Numbers:** add or remove enemies. Numbers count twice.
2. **Level:** `customize.level` restats an actor. It's the way to use a template whose level is wrong for the party: a level-4 Dark Jedi Apprentice at level 10 for a level-8 party.
3. **Gear:** a better or worse weapon (`rightHand`), or `hp`.
4. **Template:** a different creature.

Some monsters stay strong at any level, because their claws' damage is part of the claw item, not their level. A rancor hits for about 60 a claw whatever its level. Use them as set pieces, or for parties that can take them (`level` around 15+).

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
