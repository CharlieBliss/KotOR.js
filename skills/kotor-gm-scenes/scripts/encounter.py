#!/usr/bin/env python3
"""How hard a scene plan's fights are for its party.

Every combatant gets two numbers, from the catalog (measured with the game's own combat rules):
  offense  its expected damage per round (3 s) against the other side's armour class: each attack it makes
           (both hands, claws), hit chance from its attack bonus, its Force powers while its Force points last,
           its grenades
  health   its vitality, plus what it can heal
A side's strength is its total offense times its total health (Lanchester's square law: numbers count twice).
The ratio R of the enemies' strength to the party's says how the fight goes: the party wins if R < 1, keeping
sqrt(1 - R) of its strength. What it's expected to lose sets the rating:
  trivial < 10%, easy < 25%, medium < 40%, hard < 60%, deadly: 60% or more, or the party loses.

Usage: python3 encounter.py plan.json   (check_plan.py runs it too)
"""
import json
import math
import re
import sys
from pathlib import Path

CATALOG = Path(__file__).resolve().parent.parent / "reference" / "catalog"
ROUNDS = 6                  # a fight lasts about this many rounds: powers and grenades are spread over it
GRENADE_DAMAGE = 15         # a damaging grenade's average, before saves
BANDS = [("trivial", 0.10), ("easy", 0.25), ("medium", 0.40), ("hard", 0.60), ("deadly", 9)]
# Powers that deal damage (spells.2da labels, without FORCE_POWER_); the rest of the hostile ones hold or weaken
DAMAGE_POWERS = re.compile(r"LIGHTNING|STORM|DEATH_FIELD|DRAIN|WAVE|PUSH|WHIRLWIND|SHOCK|THROW|KILL|CHOKE|WOUND|DESTROY_DROID|ION|BREACH|SCREAM|CRUSH|PLAGUE")


def mod(score):
    return (int(score) - 10) // 2


def read_tsv(path):
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    head = lines[0].split("\t")
    return [dict(zip(head, line.split("\t"))) for line in lines[1:] if line.strip()]


class Catalog:
    def __init__(self, game):
        self.creatures = {r["template"].lower(): r for r in read_tsv(CATALOG / game / "creatures.tsv")}
        self.items = {r["template"].lower(): r for r in read_tsv(CATALOG / game / "items.tsv")}
        self.classes = {}
        for r in read_tsv(CATALOG / game / "classes.tsv"):
            ints = lambda col: [int(v) for v in (r.get(col) or "").split(",") if v != ""]
            self.classes[int(r["id"])] = {
                "label": r["label"], "name": r["name"], "hitdie": int(r["hitdie"] or 0), "forcedie": int(r["forcedie"] or 0),
                "bab": ints("bab by level"), "ac": ints("class AC by level"), "featac": ints("feat AC by level"),
                "dueling": ints("dueling by level"), "toughness": ints("toughness HP per level"), "fpbonus": ints("FP bonus by level"),
                "powers": [[p for p in level.split(",") if p] for level in (r.get("dark powers by level") or "").split(";")],
            }

    def class_id(self, name):
        """A class by number, label or name ("Soldier", "jedi guardian", "Combat_Droid")"""
        if isinstance(name, int) or str(name).isdigit():
            return int(name)
        norm = lambda s: re.sub(r"[\s_-]+", "", str(s or "").lower())
        for cid, c in self.classes.items():
            if norm(name) in (norm(c["label"]), norm(c["name"])):
                return cid
        return None

    def by_level(self, cid, column, level):
        rows = (self.classes.get(cid) or {}).get(column) or []
        return rows[max(0, min(len(rows) - 1, level - 1))] if rows else 0


class Fighter:
    """One combatant: what it brings to a fight"""

    def __init__(self, name, level, hp, fp, ac, attacks, powers, grenades, heals, feats, count=1):
        self.name, self.level, self.hp, self.fp, self.ac = name, level, hp, fp, ac
        self.attacks = attacks          # [(attack bonus, average damage)]
        self.powers = powers            # [(label, cost, area)]
        self.grenades, self.heals, self.feats, self.count = grenades, heals, feats, count

    def health(self):
        healing = self.heals * min(self.hp * 0.4, 10 + 2 * self.level)
        return self.hp + healing

    def offense(self, target_ac, targets=4):
        """Expected damage per round against this armour class"""
        hit = lambda bonus: min(0.95, max(0.05, (bonus + 21 - target_ac) / 20))
        weapon = sum(hit(b) * d for b, d in self.attacks) * (1.1 if self.feats else 1.0)
        # Powers, while its Force points last: it uses the best one when that beats its weapon
        best, cost = 0.0, 0
        for label, c, area in self.powers:
            each = (3.0 * min(self.level, 15) * 0.75) if DAMAGE_POWERS.search(label) else 1.5 * self.level
            each *= min(2, targets) if area else 1
            if each > best:
                best, cost = each, c
        power = 0.0
        if best > weapon and self.fp > 0:
            casts = self.fp / max(cost, 1)
            power = min(1.0, casts / ROUNDS) * (best - weapon)
        grenade = min(self.grenades, ROUNDS) / ROUNDS * GRENADE_DAMAGE * min(2, targets) * 0.75
        return weapon + power + grenade

    def line(self):
        att = ", ".join(f"{b:+d} for {d:.0f}" for b, d in self.attacks) or "none"
        extra = []
        if self.powers:
            extra.append(f"{len(self.powers)} hostile powers, {self.fp} FP")
        if self.grenades:
            extra.append(f"{self.grenades} grenades")
        if self.heals:
            extra.append(f"{self.heals} heals")
        return (f"{self.count} x {self.name}: level {self.level}, {self.hp} HP, AC {self.ac}, attacks {att}"
                + (f"; {', '.join(extra)}" if extra else ""))


def player_character(level, cls=None, catalog=None):
    """A player character of a level, with the gear and upgrades a party of that level usually has"""
    hitdie, bab = 8, int(level * 0.8)
    if cls is not None and catalog and cls in catalog.classes:
        hitdie = catalog.classes[cls]["hitdie"] or hitdie
        bab = catalog.by_level(cls, "bab", level)
    hp = level * (hitdie + 2)
    ac = 10 + 2 + min(1 + level // 2, 9) + level // 6
    bonus = bab + 3 + level // 4 + 1
    damage = 9 + level // 2
    attacks = [(bonus, damage)] + ([(bonus - 4, damage * 0.8)] if level >= 4 else [])
    return Fighter("player character", level, hp, 0, ac, attacks, [], 0, 2, 1)


def actor_fighter(actor, catalog):
    """An actor of the plan as it will be in the game: its template, restatted and re-equipped as customize says"""
    row = catalog.creatures.get(str(actor.get("template", "")).lower())
    if not row or not row.get("level"):
        return None, f'no fight data for template "{actor.get("template")}" (regenerate the catalog)'
    custom = actor.get("customize") or {}
    level0 = int(row["level"] or 1)
    cls0 = int(row["class"] or 0)
    s, d, c, w = [int(v) for v in (row.get("abilities") or "10/10/10/10").split("/")]
    hp, fp, ac = int(row["hp"] or 1), int(row["fp"] or 0), int(row["ac"] or 10)
    codes = [code for code in (row.get("attacks") or "").split(";") if code]
    powers = []
    for p in (row.get("powers") or "").split(","):
        m = re.match(r"(.+):(\d+)(a?)$", p)
        if m:
            powers.append((m.group(1), int(m.group(2)), m.group(3) == "a"))
    note = None

    level, cls = level0, cls0
    if "level" in custom or "class" in custom:
        level = int(custom.get("level", level0))
        if "class" in custom:
            cls = catalog.class_id(custom["class"])
            if cls is None:
                note, cls = f'no class "{custom["class"]}"', cls0
        old = {"str": s, "dex": d, "con": c, "wis": w}
        new = dict(old)
        if level < level0:
            for k, v in old.items():
                if v > 10:
                    new[k] = round(max(min(v, 14), 10 + (v - 10) * level / level0))
        else:
            primary = "str" if s >= d else "dex"
            new[primary] += level // 4 - level0 // 4
        info = catalog.classes.get(cls, {})
        hp = max(level, level * (info.get("hitdie", 8) + mod(new["con"]) + catalog.by_level(cls, "toughness", level)))
        fd = info.get("forcedie", 0)
        fp = max(0, level * (fd + mod(new["wis"]))) + catalog.by_level(cls, "fpbonus", level) if fd else 0
        # Dueling (attack and AC) counts with one melee weapon that isn't two-handed
        one_weapon = len(codes) == 1 and codes[0].startswith("m") and "x" not in codes[0].split("+")[0].split("-")[0]
        duel0 = catalog.by_level(cls0, "dueling", level0) if one_weapon else 0
        duel = catalog.by_level(cls, "dueling", level) if one_weapon else 0
        # Its old class and feat AC come off (a template may lack the feats a build would have: only what its AC
        # holds beyond 10, class and Dexterity), the new level's go on
        held = max(0, ac - 10 - catalog.by_level(cls0, "ac", level0) - mod(d))
        old_feats = min(held, catalog.by_level(cls0, "featac", level0) + duel0)
        ac = (ac - catalog.by_level(cls0, "ac", level0) - old_feats - mod(d)
              + catalog.by_level(cls, "ac", level) + catalog.by_level(cls, "featac", level) + duel + mod(new["dex"]))
        bab0, bab = catalog.by_level(cls0, "bab", level0), catalog.by_level(cls, "bab", level)
        if duel != duel0:
            codes = [re.sub(r"([+-]\d+)/", lambda m: f"{int(m.group(1)) + duel - duel0:+d}/", code, count=1) for code in codes]
        # Its powers are its class's for the level (the game builds them)
        if fd:
            levels = info.get("powers") or []
            labels = levels[max(0, min(len(levels) - 1, level - 1))] if levels else []
            powers = [(p.rstrip("*"), 30 if p.endswith("*") else 15, p.endswith("*")) for p in labels]
        s, d, c, w = new["str"], new["dex"], new["con"], new["wis"]
    else:
        bab0 = bab = catalog.by_level(cls0, "bab", level0)
    if custom.get("hp"):
        hp = int(custom["hp"])

    # Gear the plan puts in its hands replaces those attacks
    for hand, flag in (("rightHand", ""), ("leftHand", "h")):
        resref = custom.get(hand)
        if resref is None:
            continue
        codes = [code for code in codes if ("h" in code.split("+")[0].split("-")[0]) != (hand == "leftHand")]
        item = catalog.items.get(str(resref).lower()) if resref else None
        m = re.match(r"(melee|ranged) ([\d.]+)(?: ([+-]\d+))?", (item or {}).get("combat", ""))
        if m:
            kind = "r" if m.group(1) == "ranged" else "m"
            codes.append(f'{kind}{flag}{int(m.group(3) or 0) - (4 if flag else 0):+d}/{m.group(2)}')

    attacks = []
    for code in codes:
        m = re.match(r"([mr])(d?)([hxc]?)([+-]\d+)/([\d.]+)", code)
        if not m:
            continue
        ranged, dex_attack, strkind = m.group(1) == "r", m.group(2) == "d", m.group(3)
        ability = d if (ranged or dex_attack) else s
        bonus = int(m.group(4)) + bab + mod(ability)
        factor = 0 if ranged or strkind == "c" else {"h": 0.5, "x": 1.5}.get(strkind, 1)
        damage = float(m.group(5)) + (math.floor(mod(s) * factor) if mod(s) > 0 else 0)
        attacks.append((bonus, damage))
    if not attacks:
        attacks = [(bab + mod(s), 2.5 + max(0, mod(s)))]

    name = actor.get("name") or row.get("name") or actor.get("template")
    f = Fighter(name, level, hp, fp, ac, attacks, powers, int(row.get("grenades") or 0), int(row.get("heals") or 0),
                int(row.get("feats") or 0), int(actor.get("count", 1)))
    return f, note


def rate(party, enemies):
    """(band, expected loss 0..1, ratio, details) for a party (Fighters) against enemies (Fighters)"""
    def total(side, fn):
        return sum(fn(f) * f.count for f in side)
    party_n = total(party, lambda f: 1)
    enemy_n = total(enemies, lambda f: 1)
    party_ac = total(party, lambda f: f.ac) / max(party_n, 1)
    enemy_ac = total(enemies, lambda f: f.ac * f.health()) / max(total(enemies, lambda f: f.health()), 1)
    o_p = total(party, lambda f: f.offense(enemy_ac, enemy_n))
    h_p = total(party, lambda f: f.health())
    o_e = total(enemies, lambda f: f.offense(party_ac, party_n))
    h_e = total(enemies, lambda f: f.health())
    ratio = (o_e * h_e) / max(o_p * h_p, 1e-9)
    loss = 1.0 if ratio >= 1 else 1 - math.sqrt(1 - ratio)
    band = next(name for name, top in BANDS if loss < top) if ratio < 1 else "deadly"
    detail = (f"enemies {h_e:.0f} HP, {o_e:.0f} damage/round; party {h_p:.0f} HP, {o_p:.0f} damage/round; "
              + (f"the party is expected to lose about {loss * 100:.0f}% of its strength" if ratio < 1 else "the party is expected to lose"))
    return band, loss, ratio, detail


def party_fighters(plan, catalog):
    party = plan.get("party") or {}
    members = party.get("members")
    if members:
        return [player_character(int(m.get("level", party.get("level", 1))), catalog.class_id(m["class"]) if m.get("class") else None, catalog) for m in members]
    size, level = int(party.get("size", 0) or 0), int(party.get("level", 0) or 0)
    if not size or not level:
        return []
    pc = player_character(level)
    pc.count = size
    return [pc]


def fights(plan):
    """
    The fights a plan stages, in order: (label, hostile actors, friendly actors on the players' side, whether
    the players are frozen then: watching, not fighting)
    """
    actors = {a.get("id"): a for a in plan.get("actors") or []}
    faction = {i: a.get("faction") for i, a in actors.items()}
    hidden = {i: bool(a.get("hidden")) for i, a in actors.items()}
    passive = {i: (a.get("order") or {}).get("kind") in ("standDown", "flee") for i, a in actors.items()}

    def fighting(ids, side):
        return [actors[i] for i in ids if faction.get(i) == side and not hidden.get(i) and not passive.get(i)]

    frozen = bool((plan.get("players") or {}).get("frozen"))
    out = []
    start = fighting(actors, "hostile")
    if start:
        out.append(("at the start", start, fighting(actors, "friendly"), frozen))
    for b, beat in enumerate(plan.get("beats") or []):
        joined = []
        for action in beat.get("actions") or []:
            ids = action.get("ids") or []
            what = action.get("do")
            if what == "freezePlayers":
                frozen = bool(action.get("on"))
            elif what == "reveal":
                for i in ids:
                    if hidden.get(i):
                        hidden[i] = False
                        joined.append(i)
            elif what == "hide":
                for i in ids:
                    hidden[i] = True
            elif what == "faction":
                for i in ids:
                    faction[i] = action.get("faction")
                    joined.append(i)
            elif what == "order":
                kind = (action.get("order") or {}).get("kind")
                for i in ids:
                    passive[i] = kind in ("standDown", "flee")
                    if not passive[i]:
                        joined.append(i)
        hostiles = fighting(dict.fromkeys(joined), "hostile")
        if hostiles:
            out.append((f'beat {b + 1} "{beat.get("title", "")}"', hostiles, fighting(actors, "friendly"), frozen))
    return out


def report(plan):
    """(lines to print, notes) for the plan's fights"""
    catalog = Catalog(str(plan.get("content")))
    lines, notes = [], []
    staged = fights(plan)
    if not staged:
        return lines, notes
    party = party_fighters(plan, catalog)
    p = plan.get("party") or {}
    if not party and any(not watching for *_, watching in staged):
        notes.append(("party", 'add "party": { "size": 4, "level": 6 } (the players\' number and level) to rate the fights'))
    if party:
        who = (f"{len(p['members'])} players" if p.get("members") else f"{p.get('size')} players") + f" of level {p.get('level') or '/'.join(str(m.get('level')) for m in p.get('members', []))}"
        lines.append(f"Encounters, for {who}:")
    else:
        lines.append("Encounters:")
    target = str(p.get("difficulty", "")).lower() or None
    order = [name for name, _ in BANDS]
    if target and target not in order:
        notes.append(("party.difficulty", f'difficulty is one of {", ".join(order)}'))
        target = None
    hardest = None
    for label, hostiles, friends, watching in staged:
        enemies, allies = [], []
        for side, group in ((enemies, hostiles), (allies, friends)):
            for a in group:
                f, why = actor_fighter(a, catalog)
                if why:
                    notes.append((f'actor {a.get("id")}', why))
                if f:
                    side.append(f)
        if not enemies:
            continue
        # Frozen players watch: the fight is their allies' (the rating is how badly the allies fare)
        if not watching and not party:
            continue
        side = allies if watching else party + allies
        if not side:
            if watching:
                lines.append(f"  {label}: players watching, and nobody fights the hostiles")
            continue
        band, loss, ratio, detail = rate(side, enemies)
        if watching:
            detail = detail.replace("the party is", "the allies are").replace("party", "allies")
        lines.append(f"  {label}: {band.upper()}{' for the allies (players watching)' if watching else ''} ({detail})")
        for f in enemies:
            lines.append(f"    {f.line()}")
        if allies:
            lines.append(f"    {'fighting them' if watching else 'with the players'}: " + "; ".join(f"{f.count} x {f.name}" for f in allies))
        if not watching and (hardest is None or order.index(band) > order.index(hardest[1])):
            hardest = (label, band)
    if target and hardest and hardest[1] != target:
        harder = order.index(hardest[1]) > order.index(target)
        notes.append(("party.difficulty", f'the plan wants a {target} fight, but {hardest[0]} is {hardest[1]}: '
                      + ("fewer enemies, lower their level (customize.level), or weaker templates" if harder
                         else "more enemies, raise their level (customize.level), or stronger templates")
                      + " (see Encounters in format.md)"))
    if len(lines) == 1:
        lines = []
    return lines, list(dict.fromkeys(notes))


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    plan = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    lines, notes = report(plan)
    for where, message in notes:
        print(f"NOTE  {where}: {message}")
    print("\n".join(lines) or "No fights in this plan.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
