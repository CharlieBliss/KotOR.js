#!/usr/bin/env python3
"""Check a KotOR.js GM scene plan before handing it over.

1. Its shape (as the game's importer reads it), and that everything it names exists in the catalog: the
   area and its rooms and waypoints, creature and placeable templates, models and items.
2. Its layout (layout.py): where everything lands on the area's floor, and whether the blocking and the
   beats work. It ends with a text map of the scene to read.

Usage: python3 check_plan.py plan.json [--map scene.png] [--json positions.json] [--no-map]
  --map    also draw the scene as a picture (for the GM)
  --json   write where everything lands (scripts/gm-scene-check.js compares it with the game)
  --no-map don't print the text map
Exit code 0 when there are no errors (notes are fine).
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import layout  # noqa: E402

CATALOG = Path(__file__).resolve().parent.parent / "reference" / "catalog"
# The words a plan may use, as the game reads them: generated from its sources (src/tests/gmPlanVocab.test.ts)
VOCAB = json.loads((CATALOG / "vocab.json").read_text(encoding="utf-8"))
SKILLS = VOCAB["skills"]
SAVES = VOCAB["saves"]
FACTIONS = VOCAB["factions"]
ORDERS = VOCAB["orders"]
ACTIONS = VOCAB["actions"]
# Stance and gesture ids; a creature's model may not have every one
STANCES = VOCAB["stances"]
# Stances that sit in a chair: they need a seat prop under the actor
SEATED = {"chair", "chair_drunk", "chair_pazaak"}


def is_seat(prop, content):
    """A chair or bench prop (KotOR II's plc_chair1 is a food pile; KotOR's is a chair named "Food pile")"""
    template = str(prop.get("template", "")).lower()
    if content == "tsl" and template == "plc_chair1":
        return False
    if template == "plc_chair1":
        return True
    name = f'{template} {prop.get("appearance", "")}'.lower()
    return any(word in name for word in ("chair", "bench", "stool", "seat", "couch", "sofa"))
GESTURES = VOCAB["gestures"]


def read_tsv(path):
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    head = lines[0].split("\t")
    return [dict(zip(head, line.split("\t"))) for line in lines[1:] if line.strip()]


def read_areas(path):
    """module -> {'rooms': set, 'waypoints': set}"""
    areas = {}
    current = None
    if not path.exists():
        return areas
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^## (\S+)", line)
        if m:
            current = {"rooms": set(), "waypoints": set()}
            areas[m.group(1).lower()] = current
        elif current is not None and line.startswith("rooms"):
            current["rooms"] = {part.strip().split(" ")[0].lower() for part in line.split(":", 1)[1].split(";") if part.strip()}
        elif current is not None and line.startswith("waypoints"):
            current["waypoints"] = {part.strip().split(" ")[0].lower() for part in line.split(":", 1)[1].split(";") if part.strip()}
    return areas


def main():
    args = sys.argv[1:]
    files = [a for a in args if not a.startswith("--") and not (args.index(a) > 0 and args[args.index(a) - 1] in ("--map", "--json"))]
    opt = lambda name: args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else None
    if len(files) != 1:
        print(__doc__)
        return 2
    try:
        plan = json.loads(Path(files[0]).read_text(encoding="utf-8"))
    except Exception as e:
        print(f"ERROR file: not valid JSON: {e}")
        return 1

    errors, warnings = [], []
    err = lambda where, msg: errors.append(f"ERROR {where}: {msg}")
    warn = lambda where, msg: warnings.append(f"NOTE  {where}: {msg}")

    if plan.get("format") != "kotorjs-gm-scene":
        err("format", 'must be "kotorjs-gm-scene"')
    if plan.get("version") != 1:
        err("version", "must be 1")
    content = plan.get("content")
    area = plan.get("area") or {}
    if content not in ("kotor", "tsl"):
        err("content", '"kotor" or "tsl": the game the GM runs')
    if area.get("game") not in ("kotor", "tsl"):
        err("area.game", '"kotor" or "tsl"')

    # Catalogs
    areas = read_areas(CATALOG / str(area.get("game")) / "areas.md")
    module = str(area.get("module", "")).lower()
    area_info = areas.get(module)
    if not module:
        err("area.module", "missing")
    elif areas and not area_info:
        err("area.module", f'no area "{module}" in {area.get("game")}\'s catalog')
    creatures = {r["template"].lower() for r in read_tsv(CATALOG / str(content) / "creatures.tsv")}
    placeables = {r["template"].lower() for r in read_tsv(CATALOG / str(content) / "placeables.tsv")}
    models = {r["appearance"].lower() for r in read_tsv(CATALOG / str(content) / "models.tsv")}
    items = {r["template"].lower() for r in read_tsv(CATALOG / str(content) / "items.tsv")}

    actors = plan.get("actors") or []
    props = plan.get("props") or []
    actor_ids = {a.get("id") for a in actors}
    prop_ids = {p.get("id") for p in props}
    seen = set()

    def check_spot(spot, where):
        spot = str(spot or "")
        kind, _, name = spot.partition(":")
        if spot in ("entry", "players"):
            return
        if kind == "actor":
            if name not in actor_ids:
                err(where, f'no actor "{name}"')
        elif kind == "prop":
            if name not in prop_ids:
                err(where, f'no prop "{name}"')
        elif kind == "room":
            if area_info is not None and name.lower() not in area_info["rooms"]:
                err(where, f'no room "{name}" in {module}')
        elif kind == "waypoint":
            if area_info is not None and name.lower() not in area_info["waypoints"]:
                err(where, f'no waypoint "{name}" in {module}')
        else:
            err(where, f'unknown spot "{spot}"')

    def check_placement(at, where):
        if not isinstance(at, dict) or not at.get("spot"):
            err(where, 'needs { "spot": ... }')
            return
        check_spot(at["spot"], where)
        if at.get("formation") not in (None, "cluster", "ring", "line"):
            err(where, 'formation is "cluster", "ring" or "line"')
        off = at.get("offset")
        if off is not None and not (isinstance(off, list) and len(off) == 2 and all(isinstance(v, (int, float)) for v in off)):
            err(where, "offset is [x, y] in metres")

    def check_facing(facing, where):
        if facing is None or isinstance(facing, (int, float)):
            return
        if isinstance(facing, str) and facing.startswith("toward:"):
            check_spot(facing[len("toward:"):], where)
        else:
            err(where, 'facing is degrees or "toward:<spot>"')

    def check_order(order, where):
        if order is None:
            return
        kind = order.get("kind")
        if kind not in ORDERS:
            err(where, f'unknown order "{kind}"')
        if kind in ("attack", "follow") and order.get("target") != "players" and order.get("target") not in actor_ids:
            err(where, f'no actor "{order.get("target")}" to {kind}')
        if kind == "move":
            check_placement(order.get("to"), where)
        if kind == "patrol":
            points = order.get("points") or []
            if len(points) < 2:
                err(where, "a patrol needs at least 2 points")
            for p in points:
                check_placement(p, where)

    players = plan.get("players") or {}
    check_placement(players.get("at"), "players.at")
    check_facing(players.get("facing"), "players.facing")

    for i, a in enumerate(actors):
        where = f"actors[{i}] {a.get('id', '')}"
        if not a.get("id"):
            err(where, "needs an id")
        if a.get("id") in seen:
            err(where, "duplicate id")
        seen.add(a.get("id"))
        template = str(a.get("template", "")).lower()
        if not template:
            err(where, "needs a creature template")
        elif creatures and template not in creatures:
            err(where, f'no creature template "{template}" in {content}')
        if a.get("faction") not in FACTIONS:
            err(where, 'faction is "hostile", "friendly" or "neutral"')
        if not 1 <= int(a.get("count", 1)) <= 20:
            err(where, "count is 1 to 20")
        check_placement(a.get("at"), where)
        check_facing(a.get("facing"), where)
        check_order(a.get("order"), where)
        if a.get("stance") and a["stance"] not in STANCES:
            warn(where, f'unknown stance "{a["stance"]}"')
        if a.get("stance") in SEATED:
            spot = str((a.get("at") or {}).get("spot", ""))
            seat = next((p for p in props if spot == f'prop:{p.get("id")}'), None)
            if not seat:
                warn(where, f'stance "{a["stance"]}" sits on nothing: place a seat prop and put the actor on it ("at": {{"spot": "prop:<seat id>"}}; see "Seats" in format.md)')
            elif not is_seat(seat, content):
                warn(where, f'stance "{a["stance"]}" sits on prop "{seat.get("id")}", which isn\'t a chair or bench: give the actor a seat of its own (see "Seats" in format.md)')
        for item in a.get("loot", []) + [v for k, v in (a.get("customize") or {}).items() if k in ("rightHand", "leftHand", "armor") and v]:
            if items and str(item).lower() not in items:
                err(where, f'no item "{item}" in {content}')

    for i, p in enumerate(props):
        where = f"props[{i}] {p.get('id', '')}"
        if not p.get("id"):
            err(where, "needs an id")
        if p.get("id") in seen:
            err(where, "duplicate id")
        seen.add(p.get("id"))
        template = str(p.get("template", "")).lower()
        appearance = str(p.get("appearance", "")).lower()
        if not template and not appearance:
            err(where, "needs a placeable template or an appearance")
        if template and placeables and template not in placeables:
            err(where, f'no placeable template "{template}" in {content}')
        if appearance and models and appearance not in models:
            err(where, f'no model "{p.get("appearance")}" in {content}')
        if p.get("skill") and str(p["skill"].get("skill", "")).lower() not in SKILLS:
            err(where, f'unknown skill "{p["skill"].get("skill")}"')
        if not 1 <= int(p.get("count", 1)) <= 20:
            err(where, "count is 1 to 20")
        check_placement(p.get("at"), where)
        check_facing(p.get("facing"), where)
        for item in p.get("loot", []):
            if items and str(item).lower() not in items:
                err(where, f'no item "{item}" in {content}')

    all_ids = actor_ids | prop_ids
    for b, beat in enumerate(plan.get("beats") or []):
        if not beat.get("title"):
            warn(f"beats[{b}]", "give it a title")
        for a, action in enumerate(beat.get("actions") or []):
            where = f"beats[{b}].actions[{a}]"
            what = action.get("do")
            if what not in ACTIONS:
                err(where, f'unknown action "{what}"')
            for id_ in action.get("ids", []) + ([action["id"]] if action.get("id") else []):
                if id_ not in all_ids:
                    err(where, f'no actor or prop "{id_}"')
            if what == "order":
                check_order(action.get("order"), where)
            if what == "movePlayers":
                check_placement(action.get("to"), where)
            if what == "check" and str(action.get("check", "")).lower() not in SKILLS + SAVES:
                err(where, f'unknown check "{action.get("check")}"')
            if what == "animate":
                if "stance" not in action and not action.get("gesture"):
                    err(where, "give a stance or a gesture")
                if action.get("stance") and action["stance"] not in STANCES:
                    warn(where, f'unknown stance "{action["stance"]}"')
                if action.get("gesture") and action["gesture"] not in GESTURES:
                    warn(where, f'unknown gesture "{action["gesture"]}"')
            if what in ("say", "narrate") and not action.get("text"):
                err(where, "needs text")

    # The layout, once the plan reads correctly
    scene = None
    if not errors:
        scene, why = layout.check(plan)
        if why:
            warn("layout", why)
        for level, where, message in (scene.problems if scene else []):
            (err if level == "ERROR" else warn)(where, message)

    for line in errors + warnings:
        print(line)
    if scene and "--no-map" not in args:
        print()
        print(layout.text_map(scene))
        print()
    if scene and opt("--map"):
        if layout.png_map(scene, opt("--map")):
            print(f"Picture of the scene: {opt('--map')}")
    if scene and opt("--json"):
        Path(opt("--json")).write_text(json.dumps(layout.resolved(scene), indent=1), encoding="utf-8")
    n_actors = sum(int(a.get("count", 1)) for a in actors)
    n_props = sum(int(p.get("count", 1)) for p in props)
    print(f"{'OK' if not errors else 'NOT OK'}: {plan.get('title', '(untitled)')} in {area.get('game')}:{module}, "
          f"{n_actors} actors, {n_props} props, {len(plan.get('beats') or [])} beats; {len(errors)} errors, {len(warnings)} notes")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
