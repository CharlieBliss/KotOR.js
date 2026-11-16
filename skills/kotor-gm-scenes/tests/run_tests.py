#!/usr/bin/env python3
"""Tests for check_plan.py's layout check: broken copies of the example plan must each be caught.

Each case starts from examples/onderon-temple-massacre.json (or a small plan), breaks one thing, and
expects a line in the checker's output. The example itself must pass.

Usage: python3 tests/run_tests.py     (exit code 0 when every case passes)
Not shipped in the skill's zip (scripts/pack-skill.js leaves tests/ out).
"""
import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
CHECKER = SKILL / "scripts" / "check_plan.py"
EXAMPLE = json.loads((SKILL / "examples" / "onderon-temple-massacre.json").read_text(encoding="utf-8"))


def actor(plan, id_):
    return next(a for a in plan["actors"] if a["id"] == id_)


def into_a_wall(plan):
    # North of the hall's ring there's no floor for metres
    actor(plan, "master")["at"] = {"spot": "room:m13aa_02a", "offset": [-4, 16]}


def crowded_corridor(plan):
    # m13aa_02d is a 7 x 24 m corridor (159 m² of floor)
    actor(plan, "jedi")["count"] = 15
    actor(plan, "jedi")["at"] = {"spot": "room:m13aa_02d", "formation": "cluster", "spacing": 1.0}


def order_to_hidden(plan):
    plan["beats"][0]["actions"].append({"do": "order", "ids": ["dark_jedi"], "order": {"kind": "guard"}})


def left_frozen(plan):
    for beat in plan["beats"]:
        beat["actions"] = [a for a in beat["actions"] if a.get("do") != "freezePlayers"]


def arrival_on_players(plan):
    actor(plan, "dark_jedi")["at"] = {"spot": "players", "offset": [1, 0], "formation": "line"}


def unreachable_patrol(_):
    # Dreshdae: room m33aa_04a isn't connected to the area's entry
    return {
        "format": "kotorjs-gm-scene", "version": 1, "title": "Patrol test", "content": "kotor",
        "area": {"game": "kotor", "module": "korr_m33aa"},
        "players": {"at": {"spot": "entry"}},
        "actors": [{
            "id": "guard", "template": "n_sithsoldier", "faction": "hostile", "at": {"spot": "entry", "offset": [3, 0]},
            "order": {"kind": "patrol", "points": [{"spot": "entry", "offset": [3, 0]}, {"spot": "room:m33aa_04a"}]},
        }],
        "props": [], "beats": [],
    }


def chair_without_seat(plan):
    actor(plan, "master")["stance"] = "chair"


def chair_on_a_table(plan):
    plan["props"].append({"id": "table", "template": "plc_gentable", "at": {"spot": "room:m13aa_02a"}})
    actor(plan, "master")["stance"] = "chair_pazaak"
    actor(plan, "master")["at"] = {"spot": "prop:table"}


CASES = [
    ("a seated actor without a seat", chair_without_seat, "sits on nothing"),
    ("a seated actor on a table", chair_on_a_table, "isn't a chair or bench"),
    ("the example passes", None, "OK: Massacre at the Onderon Temple"),
    ("an offset into a wall", into_a_wall, "from any floor"),
    ("15 actors in a 7x24 corridor", crowded_corridor, "crowded"),
    ("an order to a hidden actor", order_to_hidden, "which is hidden at this point"),
    ("players left frozen", left_frozen, "still frozen after the last beat"),
    ("an arrival on top of the players", arrival_on_players, "on top of them"),
    ("a patrol point on floor nobody can walk to", unreachable_patrol, "can't walk to room:m33aa_04a"),
]


def main():
    failed = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, breaker, expected in CASES:
            plan = copy.deepcopy(EXAMPLE)
            if breaker:
                plan = breaker(plan) or plan
            path = Path(tmp) / "plan.json"
            path.write_text(json.dumps(plan), encoding="utf-8")
            out = subprocess.run([sys.executable, "-I", str(CHECKER), str(path), "--no-map"], capture_output=True, text=True).stdout
            ok = expected in out
            failed += not ok
            print(f"{'pass' if ok else 'FAIL'}  {name}")
            if not ok:
                print("      expected: " + expected)
                print("      got:\n" + "\n".join("        " + line for line in out.splitlines()))
    print(f"{len(CASES) - failed}/{len(CASES)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
