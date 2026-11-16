"""Layout check for a KotOR.js GM scene plan: where everything lands, and whether the scene plays.

Works out each actor's and prop's position the way the game's importer does (GMScenePlan.placementPoints):
the spot, plus the offset, spread in its formation, then snapped to walkable floor. It uses the area's floor
grid from catalog/<game>/floors.json. Then it checks the blocking:
- what lands off the floor or far from where it was meant to;
- what lands in the wrong room;
- what stands on top of something else;
- crowded rooms;
- places nobody can walk to;
- arrivals on top of the players;
- actors facing a wall.
It runs the beats over a simple model of the scene to catch orders to hidden actors, double reveals and the
like. Finally it draws a text map of the scene.

Used by check_plan.py; standard library only.
"""
import base64
import json
import functools
import math
import re
import struct
import zlib
from collections import deque
from pathlib import Path

CATALOG = Path(__file__).resolve().parent.parent / "reference" / "catalog"

SNAP_RADIUS = 3.0        # metres: no floor this close is an error
SNAP_SEARCH = 30.0       # metres: how far to look for the floor the game will put it on anyway
SNAP_FAR = 1.5           # metres: moved further than this to reach floor is worth a note
CREATURE_GAP = 0.8       # metres between two creatures
PROP_GAP = 1.0           # metres between a creature and a prop
CROWD_M2 = 4.0           # m² of floor per creature before a room counts as crowded
PACKED_RADIUS = 2.5      # metres: creatures this close count as one knot
PACKED_COUNT = 6         # ... and this many others in it is too tight to move or fight
ARRIVAL_NEAR = 4.0       # metres: an arrival this close to the players lands on top of them
PLAYERS_SHOWN = 4        # how many players the map and checks assume


# --------------------------------------------------------------------------------------------------
# The area: its floor grid and its spots
# --------------------------------------------------------------------------------------------------

class Floor:
    """An area's walkable floor: a grid of cells, each 0 (no floor) or its room's number"""

    def __init__(self, data):
        self.x0, self.y0 = data["origin"]
        self.cell = data["cell"]
        self.w, self.h = data["width"], data["height"]
        self.rooms = data["rooms"]
        self.cells = zlib.decompress(base64.b64decode(data["cells"]))

    def index(self, x, y):
        i, j = int(math.floor((x - self.x0) / self.cell)), int(math.floor((y - self.y0) / self.cell))
        return (i, j) if 0 <= i < self.w and 0 <= j < self.h else None

    def room_at(self, i, j):
        n = self.cells[j * self.w + i] if 0 <= i < self.w and 0 <= j < self.h else 0
        return self.rooms[n - 1] if n else None

    def centre(self, i, j):
        return self.x0 + (i + 0.5) * self.cell, self.y0 + (j + 0.5) * self.cell

    def is_floor(self, x, y):
        ij = self.index(x, y)
        return bool(ij and self.cells[ij[1] * self.w + ij[0]])

    def interior(self, i, j):
        """The cell and its eight neighbours are all floor (half a metre from any edge)"""
        return all(0 <= i + di < self.w and 0 <= j + dj < self.h and self.cells[(j + dj) * self.w + i + di]
                   for di in (-1, 0, 1) for dj in (-1, 0, 1))

    def snap(self, x, y):
        """(x, y, distance moved, room) on the floor where the game puts a point: the point itself when it's on
        the floor, else the nearest floor a little in from the edge (the engine steps 0.5 m inside it).
        None when there's no floor within SNAP_SEARCH."""
        ij = self.index(x, y)
        if ij and self.cells[ij[1] * self.w + ij[0]]:
            return x, y, 0.0, self.room_at(*ij)
        ci = int(math.floor((x - self.x0) / self.cell))
        cj = int(math.floor((y - self.y0) / self.cell))
        best = best_inner = None
        for ring in range(1, int(math.ceil(SNAP_SEARCH / self.cell)) + 1):
            for j in range(cj - ring, cj + ring + 1):
                for i in range(ci - ring, ci + ring + 1):
                    if max(abs(i - ci), abs(j - cj)) != ring:
                        continue
                    if not (0 <= i < self.w and 0 <= j < self.h) or not self.cells[j * self.w + i]:
                        continue
                    cx, cy = self.centre(i, j)
                    d = math.hypot(cx - x, cy - y)
                    if best is None or d < best[2]:
                        best = (cx, cy, d, self.room_at(i, j))
                    if self.interior(i, j) and (best_inner is None or d < best_inner[2]):
                        best_inner = (cx, cy, d, self.room_at(i, j))
            # Stop once the rings are further out than anything found (plus the step in from the edge)
            if best and ring * self.cell > best[2] + 1.0:
                break
        if best_inner and best_inner[2] <= best[2] + 0.75:
            return best_inner
        return best

    def regions(self):
        """A region number for every floor cell: cells in one region can walk to each other"""
        region = [0] * (self.w * self.h)
        n = 0
        for start in range(self.w * self.h):
            if not self.cells[start] or region[start]:
                continue
            n += 1
            region[start] = n
            queue = deque([start])
            while queue:
                k = queue.popleft()
                i, j = k % self.w, k // self.w
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    a, b = i + di, j + dj
                    if 0 <= a < self.w and 0 <= b < self.h:
                        m = b * self.w + a
                        if self.cells[m] and not region[m]:
                            region[m] = n
                            queue.append(m)
        return region

    def region_of(self, regions, x, y):
        ij = self.index(x, y)
        return regions[ij[1] * self.w + ij[0]] if ij else 0


def read_area(game, module):
    """The module's spots from areas.md: entry, rooms (name -> (x, y, m²)) and waypoints (tag -> (x, y))"""
    path = CATALOG / game / "areas.md"
    if not path.exists():
        return None
    block = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^## (\S+)", line)
        if m:
            if block is not None:
                break
            if m.group(1).lower() == module:
                block = {"entry": None, "rooms": {}, "waypoints": {}}
            continue
        if block is None:
            continue
        if line.startswith("entry "):
            x, y = (float(v) for v in line[6:].split(","))
            block["entry"] = (x, y)
        elif line.startswith("rooms"):
            for part in line.split(":", 1)[1].split(";"):
                m = re.match(r"\s*(\S+) (\d+)m²(?: \d+x\d+)?(?: @(-?[\d.]+),(-?[\d.]+))?", part)
                if m and m.group(3):
                    block["rooms"][m.group(1).lower()] = (float(m.group(3)), float(m.group(4)), int(m.group(2)))
        elif line.startswith("waypoints"):
            for part in line.split(":", 1)[1].split(";"):
                m = re.match(r'\s*(\S+)(?: ".*?")? @(-?[\d.]+),(-?[\d.]+)', part)
                if m:
                    block["waypoints"].setdefault(m.group(1).lower(), (float(m.group(2)), float(m.group(3))))
    return block


def read_floor(game, module):
    path = CATALOG / game / "floors.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))["areas"].get(module)
    return Floor(data) if data else None


# --------------------------------------------------------------------------------------------------
# Where things land (as GMScenePlan.placementPoints does it)
# --------------------------------------------------------------------------------------------------

# Props: actors don't stand inside them (as GMScenePlan.clearOfProps)
ACTOR_CLEARANCE = 0.45      # room an actor needs beside a prop
MAX_CLEARING_MOVE = 4.0     # farthest the game moves an actor to get it out of a prop
SEATED_STANCES = {"chair", "chair_drunk", "chair_pazaak"}
SEAT_WORDS = ("chair", "bench", "stool", "seat", "couch", "sofa")


def read_footprints(game):
    """Model footprints from the catalog: {template or appearance (lower case): (x0, y0, x1, y1)}"""
    out = {}
    for name, key in (("placeables.tsv", "template"), ("models.tsv", "appearance")):
        path = CATALOG / game / name
        if not path.exists():
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        if not lines:
            continue
        head = lines[0].split("\t")
        if "footprint" not in head:
            continue
        k, f = head.index(key), head.index("footprint")
        for line in lines[1:]:
            cells = line.split("\t")
            if len(cells) > max(k, f) and cells[f]:
                try:
                    out[cells[k].lower()] = tuple(float(v) for v in cells[f].split(","))
                except ValueError:
                    pass
    return out


HIP_OFFSET = 0.46   # a sitter's hips sit this far behind its origin (GMSeats.HIP_OFFSET)
SEAT_REACH = 1.6    # a seated actor sits in the free seat nearest where the plan put it, this far at most


@functools.lru_cache(maxsize=4)
def read_seats(game):
    """
    Seats from the catalog: {template or appearance (lower case): [(x, y, fx, fy, either)]}, in the model's frame:
    where a sitter's hips go, the way it faces, and whether a backless seat can face the other way too
    """
    out = {}
    for name, key in (("placeables.tsv", "template"), ("models.tsv", "appearance")):
        path = CATALOG / game / name
        if not path.exists():
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        if not lines or "seats" not in lines[0].split("\t"):
            continue
        head = lines[0].split("\t")
        k, s = head.index(key), head.index("seats")
        for line in lines[1:]:
            cells = line.split("\t")
            if len(cells) <= max(k, s) or not cells[s]:
                continue
            seats = []
            for part in cells[s].split(";"):
                v = part.split(",")
                try:
                    seats.append((float(v[0]), float(v[1]), float(v[2]), float(v[3]), len(v) > 4 and v[4] == "e"))
                except (ValueError, IndexError):
                    pass
            if seats:
                out[cells[k].lower()] = seats
    return out


def seats_of(prop, seats):
    return seats.get(str(prop.get("template", "")).lower()) or seats.get(str(prop.get("appearance", "")).lower()) or []


def is_seat(prop, content):
    """A chair or bench (KotOR II's plc_chair1 is a food pile; KotOR's is a chair the game calls "Food pile")"""
    template = str(prop.get("template", "")).lower()
    if template == "plc_chair1":
        return content != "tsl"
    known = read_seats(content) if content in ("kotor", "tsl") else {}
    if known:
        return bool(seats_of(prop, known))
    name = f'{template} {prop.get("appearance", "")}'.lower()
    return any(word in name for word in SEAT_WORDS)


class Layout:
    def __init__(self, plan, area, floor):
        self.plan = plan
        self.area = area
        self.floor = floor
        self.placed = {}        # id -> [Point]
        self.footprints = []    # (prop id, x0, y0, x1, y1): where props can't be stood in, on the floor plan
        self.player_start = None
        self.problems = []      # (level, where, message)
        self.destinations = []  # (where, actor id, Point): move and patrol destinations

    def problem(self, level, where, message):
        self.problems.append((level, where, message))

    def resolve_spot(self, spot):
        spot = str(spot or "")
        kind, _, name = spot.partition(":")
        if spot == "entry":
            return self.area["entry"]
        if spot == "players":
            return (self.player_start.x, self.player_start.y) if self.player_start else self.area["entry"]
        if kind == "room":
            r = self.area["rooms"].get(name.lower())
            return (r[0], r[1]) if r else None
        if kind == "waypoint":
            return self.area["waypoints"].get(name.lower())
        if kind in ("actor", "prop"):
            got = self.placed.get(name)
            return (got[0].x, got[0].y) if got else None
        return None

    def points(self, at, count, where, label):
        """count snapped points for a placement, or [] (reported) when its spot can't be found"""
        base = self.resolve_spot(at.get("spot"))
        if base is None:
            spot = str(at.get("spot"))
            if spot.startswith(("actor:", "prop:")):
                self.problem("ERROR", where, f'"{spot}" is placed later in the plan (or not at all): place it first')
            else:
                self.problem("ERROR", where, f'spot "{spot}" has no position in the catalog')
            return []
        bx, by = base
        off = at.get("offset") or [0, 0]
        bx += float(off[0] or 0)
        by += float(off[1] or 0)
        spacing = at.get("spacing") if isinstance(at.get("spacing"), (int, float)) and at.get("spacing") > 0 else 1.5
        formation = at.get("formation")
        out = []
        for i in range(count):
            x, y = bx, by
            if count > 1:
                if formation == "line":
                    x += (i - (count - 1) / 2) * spacing
                elif formation == "ring":
                    radius = max(spacing, (spacing * count) / (2 * math.pi))
                    angle = (i / count) * math.pi * 2
                    x += math.cos(angle) * radius
                    y += math.sin(angle) * radius
                else:
                    angle = i * 2.4
                    radius = spacing * 0.6 * math.sqrt(i)
                    x += math.cos(angle) * radius
                    y += math.sin(angle) * radius
            snapped = self.floor.snap(x, y) if self.floor else (x, y, 0.0, None)
            name = f"{label} {i + 1}" if count > 1 else label
            if snapped is None:
                self.problem("ERROR", where, f"{name} is at {x:.1f},{y:.1f}, with no floor within {SNAP_SEARCH:g} m. "
                                             f"Move it onto the floor")
                out.append(Point(x, y, None, float("inf"), name))
                continue
            sx, sy, moved, room = snapped
            if moved > SNAP_RADIUS:
                self.problem("ERROR", where, f"{name} is at {x:.1f},{y:.1f}, {moved:.1f} m from any floor: the game "
                                             f"moves it to {sx:.1f},{sy:.1f}{f' in {room}' if room else ''}. Move it onto the floor")
            elif moved > SNAP_FAR:
                self.problem("NOTE", where, f"{name} is {moved:.1f} m off the floor at {x:.1f},{y:.1f} "
                                            f"(inside a wall or past the room's edge); it lands at {sx:.1f},{sy:.1f}")
            out.append(Point(sx, sy, room, moved, name))
        spot = str(at.get("spot") or "")
        if spot.startswith("room:"):
            want = spot[5:].lower()
            strays = [p.name for p in out if p.room and p.room != want]
            if strays:
                self.problem("NOTE", where, f"{', '.join(strays[:4])}{'...' if len(strays) > 4 else ''} "
                                            f"{'lands' if len(strays) == 1 else 'land'} outside "
                                            f"{want}, in {out[[p.name for p in out].index(strays[0])].room}")
        return out

    def facing_vector(self, x, y, facing):
        """The unit vector something at x, y faces (as GMScenePlan.facingFrom), or None"""
        if isinstance(facing, (int, float)):
            a = math.radians(facing)
            return math.sin(a), math.cos(a)
        target = None
        if isinstance(facing, str) and facing.startswith("toward:"):
            target = self.resolve_spot(facing[7:])
        if target is None:
            target = self.resolve_spot("players")
        if target is None:
            return None
        dx, dy = target[0] - x, target[1] - y
        d = math.hypot(dx, dy)
        return (dx / d, dy / d) if d >= 0.1 else None

    def facing_angle(self, x, y, facing):
        """The engine's facing in radians (as GMScenePlan.facingFrom)"""
        if isinstance(facing, (int, float)):
            return -math.radians(facing)  # degrees clockwise from north; the engine turns the other way
        target = None
        if isinstance(facing, str) and facing.startswith("toward:"):
            target = self.resolve_spot(facing[7:])
        if target is None:
            target = self.resolve_spot("players")
        if target is None or math.hypot(target[0] - x, target[1] - y) < 0.1:
            return 0.0
        return math.atan2(-(target[0] - x), target[1] - y)

    def add_footprints(self, prop, pts, known):
        """Where a prop's copies can't be stood in: its footprint turned to its facing, around each copy"""
        fp = known.get(str(prop.get("template", "")).lower()) or known.get(str(prop.get("appearance", "")).lower())
        if not fp:
            return
        scale = float(prop.get("scale") or 1.0)
        x0, y0, x1, y1 = (v * scale for v in fp)
        for pt in pts:
            a = self.facing_angle(pt.x, pt.y, prop.get("facing"))
            c, s = math.cos(a), math.sin(a)
            xs, ys = [], []
            for cx, cy in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
                xs.append(pt.x + cx * c - cy * s)
                ys.append(pt.y + cx * s + cy * c)
            self.footprints.append((prop["id"], min(xs), min(ys), max(xs), max(ys)))

    def footprint_at(self, x, y, exempt=None):
        k = ACTOR_CLEARANCE
        for f in self.footprints:
            if f[0] != exempt and f[1] - k < x < f[3] + k and f[2] - k < y < f[4] + k:
                return f
        return None

    def clear_of_props(self, pt, exempt):
        """Where the game moves a point standing in a prop: the nearest floor just clear of it, or None"""
        c = ACTOR_CLEARANCE + 0.05
        candidates = []
        for f in self.footprints:
            if f[0] != exempt and f[1] - ACTOR_CLEARANCE < pt.x < f[3] + ACTOR_CLEARANCE and f[2] - ACTOR_CLEARANCE < pt.y < f[4] + ACTOR_CLEARANCE:
                candidates += [(f[1] - c, pt.y), (f[3] + c, pt.y), (pt.x, f[2] - c), (pt.x, f[4] + c)]
        r = 0.5
        while r <= MAX_CLEARING_MOVE:
            for i in range(12):
                a = i / 12 * math.pi * 2
                candidates.append((pt.x + math.cos(a) * r, pt.y + math.sin(a) * r))
            r += 0.5
        best, best_d = None, float("inf")
        for x, y in candidates:
            d = math.hypot(x - pt.x, y - pt.y)
            if d >= best_d or d > MAX_CLEARING_MOVE:
                continue
            snapped = self.floor.snap(x, y) if self.floor else (x, y, 0.0, None)
            if snapped is None or math.hypot(snapped[0] - x, snapped[1] - y) > 0.3 or self.footprint_at(snapped[0], snapped[1], exempt):
                continue
            best, best_d = snapped, d
        return best

    def add_seats(self, prop, pts, known):
        """Where sitters go on a seat prop's copies: (prop id, copy, seat, x, y, facing vector, either)"""
        for ci, pt in enumerate(pts):
            a = self.facing_angle(pt.x, pt.y, prop.get("facing"))
            c, s = math.cos(a), math.sin(a)
            for si, (x, y, fx, fy, either) in enumerate(seats_of(prop, known)):
                cx, cy = x * c - y * s, x * s + y * c
                dx, dy = fx * c - fy * s, fx * s + fy * c
                self.seat_spots.append({"prop": prop["id"], "copy": ci, "seat": si, "cx": pt.x + cx, "cy": pt.y + cy,
                                        "dir": (dx, dy), "either": either, "room": pt.room})

    def sit(self, pt, want, taken):
        """The free seat nearest a point within reach (GMSeats.nearestFree): its spot, facing and key; None if none"""
        best, best_d = None, SEAT_REACH
        for spot in self.seat_spots:
            key = (spot["prop"], spot["copy"], spot["seat"])
            if key in taken:
                continue
            dx, dy = spot["dir"]
            if spot["either"] and want and want[0] * dx + want[1] * dy < 0:
                dx, dy = -dx, -dy
            x, y = spot["cx"] + dx * HIP_OFFSET, spot["cy"] + dy * HIP_OFFSET
            d = math.hypot(x - pt.x, y - pt.y)
            if d < best_d:
                best, best_d = (x, y, (dx, dy), key, spot["room"]), d
        return best

    def place_all(self):
        plan = self.plan
        content = str(plan.get("content", ""))
        known = read_footprints(content)
        seat_models = read_seats(content)
        self.seat_spots = []
        taken = set()
        players = plan.get("players") or {}
        start = self.points({**(players.get("at") or {}), "formation": None}, 1, "players.at", "the players' start")
        self.player_start = start[0] if start else None
        self.players = self.points(players.get("at") or {}, PLAYERS_SHOWN, "players.at", "player") if start else []
        props = {p["id"]: p for p in plan.get("props") or [] if p.get("id")}
        for p in plan.get("props") or []:
            count = max(1, min(20, int(p.get("count", 1))))
            pts = self.points(p.get("at") or {}, count, f"props {p['id']}", p.get("name") or p["id"])
            self.placed[p["id"]] = pts
            self.add_footprints(p, pts, known)
            self.add_seats(p, pts, seat_models)
        for a in plan.get("actors") or []:
            count = max(1, min(20, int(a.get("count", 1))))
            where = f"actors {a['id']}"
            pts = self.points(a.get("at") or {}, count, where, a.get("name") or a["id"])
            # A seated actor put on a seat prop belongs in it; anyone else standing in a prop is moved clear
            spot = str((a.get("at") or {}).get("spot", ""))
            seat = spot[5:] if spot.startswith("prop:") and a.get("stance") in SEATED_STANCES and spot[5:] in props and is_seat(props[spot[5:]], content) else None
            seated = a.get("stance") in SEATED_STANCES
            for pt in pts:
                # A sitter takes the free seat nearest it, on the seat's own spot and facing (as the game does)
                if seated:
                    got = self.sit(pt, self.facing_vector(pt.x, pt.y, a.get("facing")), taken)
                    if got:
                        pt.x, pt.y, pt.room = got[0], got[1], got[4] or pt.room
                        pt.seat_facing = got[2]
                        taken.add(got[3])
                        continue
                    self.problem("NOTE", where, f'{pt.name} sits with no free seat within {SEAT_REACH:g} m: give it a chair or bench of '
                                                f'its own ("at": {{"spot": "prop:<seat>"}}; see "Seats" in format.md)')
                inside = self.footprint_at(pt.x, pt.y, seat)
                if not inside:
                    continue
                clear = self.clear_of_props(pt, seat)
                if clear:
                    moved = math.hypot(clear[0] - pt.x, clear[1] - pt.y)
                    self.problem("NOTE", where, f'{pt.name} stands inside prop "{inside[0]}" at {pt.x:.1f},{pt.y:.1f}: the game moves it '
                                                f'{moved:.1f} m to {clear[0]:.1f},{clear[1]:.1f}. Place it beside the prop instead')
                    pt.x, pt.y, pt.room = clear[0], clear[1], clear[3] or pt.room
                else:
                    self.problem("ERROR", where, f'{pt.name} stands inside prop "{inside[0]}" with no clear floor within '
                                                 f'{MAX_CLEARING_MOVE:g} m. Move it beside the prop')
            self.placed[a["id"]] = pts
            for pt in pts:
                pt.facing = getattr(pt, "seat_facing", None) or self.facing_vector(pt.x, pt.y, a.get("facing"))


class Point:
    def __init__(self, x, y, room, moved, name):
        self.x, self.y, self.room, self.moved, self.name = x, y, room, moved, name
        self.facing = None

    def dist(self, other):
        return math.hypot(self.x - other.x, self.y - other.y)


# --------------------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------------------

def check_blocking(L):
    plan = L.plan
    actors = plan.get("actors") or []
    props = plan.get("props") or []
    creatures = [(a, p) for a in actors for p in L.placed.get(a["id"], []) if p.room is not None or p.moved == 0]

    # On top of each other (things that are hidden at the same time can't collide with what's shown, but they
    # will once revealed, so check everything)
    reported = set()
    for i, (a, p) in enumerate(creatures):
        # Sitters in seats are meant to be in their chair or bench, and side by side on a bench
        seated = getattr(p, "seat_facing", None) is not None
        for b, q in creatures[i + 1:]:
            if p.dist(q) < CREATURE_GAP and not (seated and getattr(q, "seat_facing", None) is not None):
                key = (a["id"], b["id"])
                if key not in reported:
                    reported.add(key)
                    who = f"{p.name} and {q.name}" if a is not b else f"{a['id']}'s copies"
                    L.problem("NOTE", f"actors {a['id']}", f"{who} stand {p.dist(q):.1f} m apart (they overlap): "
                                                         f"spread them with spacing or offsets")
        for prop in props:
            for q in L.placed.get(prop["id"], []):
                if p.dist(q) < PROP_GAP and not seated and (a["id"], prop["id"]) not in reported:
                    reported.add((a["id"], prop["id"]))
                    L.problem("NOTE", f"actors {a['id']}", f"{p.name} stands {p.dist(q):.1f} m from {q.name} (inside it)")

    # Packed knots: too many creatures in one spot, whatever the room's size
    for a, p in creatures:
        near = [q for _, q in creatures if q is not p and p.dist(q) < PACKED_RADIUS]
        if len(near) >= PACKED_COUNT:
            L.problem("NOTE", f"actors {a['id']}", f"{len(near) + 1} creatures within {PACKED_RADIUS:g} m around {p.name}: "
                                                 f"crowded, too packed to move or fight (spread them out, or use fewer)")
            break

    # Crowded rooms
    per_room = {}
    for a, p in creatures:
        if p.room:
            per_room.setdefault(p.room, 0)
            per_room[p.room] += 1
    for room, n in per_room.items():
        size = L.area["rooms"].get(room, (0, 0, 0))[2]
        if size and n * CROWD_M2 > size:
            L.problem("NOTE", f"room {room}", f"{n} creatures in {size} m² of floor: crowded (fights will jam)")

    # Facing a wall: only for a facing given in degrees (one toward something looks at it on purpose)
    for a in actors:
        if not isinstance(a.get("facing"), (int, float)):
            continue
        for p in L.placed.get(a["id"], []):
            if p.facing and L.floor and not L.floor.is_floor(p.x + p.facing[0] * 1.5, p.y + p.facing[1] * 1.5):
                L.problem("NOTE", f"actors {a['id']}", f"{p.name} faces a wall or the floor's edge")
                break

    # Reachability: everyone must be able to walk to where they're sent, and the players to everyone
    if not L.floor or not L.player_start:
        return
    regions = L.floor.regions()
    home = L.floor.region_of(regions, L.player_start.x, L.player_start.y)
    for a in actors:
        pts = L.placed.get(a["id"], [])
        cut_off = [p.name for p in pts if p.room and L.floor.region_of(regions, p.x, p.y) != home]
        if cut_off:
            L.problem("NOTE", f"actors {a['id']}", f"{cut_off[0]} stands on floor the players can't walk to")
    on_floor = lambda pts: [p for p in pts if p.room]
    for where, owner, order in orders(plan):
        own = on_floor(L.placed.get(owner, []))
        if not own:
            continue
        their = L.floor.region_of(regions, own[0].x, own[0].y)
        targets = []
        if order.get("kind") == "move":
            targets = [order.get("to") or {}]
        elif order.get("kind") == "patrol":
            targets = order.get("points") or []
        for t in targets:
            pts = L.points(t, 1, where, "the destination")
            if pts:
                L.destinations.append((where, owner, pts[0]))
            if pts and pts[0].room and L.floor.region_of(regions, pts[0].x, pts[0].y) != their:
                spot = str(t.get("spot")) + (f" + {t.get('offset')}" if t.get("offset") else "")
                L.problem("ERROR", where, f"{owner} can't walk to {spot} (no floor connects them)")
        if order.get("kind") in ("attack", "follow"):
            target = order.get("target")
            tp = [L.player_start] if target == "players" else on_floor(L.placed.get(target, []))
            if tp and L.floor.region_of(regions, tp[0].x, tp[0].y) != their:
                L.problem("ERROR", where, f"{owner} can't reach {target} to {order['kind']} (no floor connects them)")


def orders(plan):
    """(where, actor id, order) for every order in the plan"""
    for a in plan.get("actors") or []:
        if a.get("order"):
            yield f"actors {a['id']}.order", a["id"], a["order"]
    for b, beat in enumerate(plan.get("beats") or []):
        for i, action in enumerate(beat.get("actions") or []):
            if action.get("do") == "order" and action.get("order"):
                for id_ in action.get("ids") or []:
                    yield f"beats[{b}].actions[{i}]", id_, action["order"]


def simulate_beats(L):
    """Run the beats over who's visible, on which side, frozen or not, and catch what can't work"""
    plan = L.plan
    actors = {a["id"]: a for a in plan.get("actors") or []}
    props = {p["id"]: p for p in plan.get("props") or []}
    visible = {i: not x.get("hidden") for i, x in {**props, **actors}.items()}
    faction = {i: a.get("faction") for i, a in actors.items()}
    frozen = bool((plan.get("players") or {}).get("frozen"))
    revealed_ever = set()

    def side(a, b):
        return faction.get(a) == faction.get(b) or (b == "players" and faction.get(a) == "friendly")

    def check_order(where, ids, order):
        if not order:
            return
        if order.get("kind") == "attack":
            target = order.get("target")
            if target != "players" and target in visible and not visible[target]:
                L.problem("NOTE", where, f'attack target "{target}" is hidden at this point')
            for id_ in ids:
                if id_ in faction and (target == "players" and faction[id_] == "friendly" or target in faction and side(id_, target)):
                    L.problem("NOTE", where, f'{id_} ({faction[id_]}) is ordered to attack its own side ({target})')

    for a in actors.values():
        if a.get("order") and not a.get("hidden"):
            check_order(f"actors {a['id']}.order", [a["id"]], a["order"])
        if a.get("order") and a.get("hidden"):
            pass  # given when revealed

    for b, beat in enumerate(plan.get("beats") or []):
        for i, action in enumerate(beat.get("actions") or []):
            where = f"beats[{b}].actions[{i}]"
            what = action.get("do")
            ids = list(action.get("ids") or []) + ([action["id"]] if action.get("id") else [])
            if what == "reveal":
                for id_ in ids:
                    if visible.get(id_):
                        L.problem("NOTE", where, f'reveals "{id_}", which is already visible')
                    visible[id_] = True
                    revealed_ever.add(id_)
                    if id_ in actors and actors[id_].get("order"):
                        check_order(where, [id_], actors[id_]["order"])
                    if id_ in actors and L.player_start:
                        near = [p for p in L.placed.get(id_, []) if p.dist(L.player_start) < ARRIVAL_NEAR]
                        if near:
                            L.problem("NOTE", where, f'"{id_}" appears {near[0].dist(L.player_start):.1f} m from the players: '
                                                     f'on top of them (place arrivals at an entrance)')
            elif what == "hide":
                for id_ in ids:
                    if id_ in visible and not visible[id_]:
                        L.problem("NOTE", where, f'hides "{id_}", which is already hidden')
                    visible[id_] = False
            elif what in ("order", "say", "animate"):
                for id_ in ids:
                    if id_ in visible and not visible[id_]:
                        L.problem("NOTE", where, f'{what} for "{id_}", which is hidden at this point (players won\'t see it)')
                if what == "order":
                    check_order(where, ids, action.get("order"))
            elif what == "faction":
                for id_ in ids:
                    faction[id_] = action.get("faction")
            elif what == "freezePlayers":
                on = bool(action.get("on"))
                if on == frozen:
                    L.problem("NOTE", where, f"players are already {'frozen' if on else 'free'}")
                frozen = on

    if frozen and plan.get("beats"):
        L.problem("NOTE", "beats", "the players are still frozen after the last beat (add freezePlayers off)")
    for id_, x in {**props, **actors}.items():
        if x.get("hidden") and id_ not in revealed_ever:
            L.problem("NOTE", id_, "is hidden but no beat reveals it")


# --------------------------------------------------------------------------------------------------
# Maps
# --------------------------------------------------------------------------------------------------

def scene_bounds(L, margin=4.0):
    pts = ([p for ps in L.placed.values() for p in ps if p.moved != float("inf")] + list(L.players or [])
           + [p for _, _, p in L.destinations])
    if not pts:
        return None
    return (min(p.x for p in pts) - margin, min(p.y for p in pts) - margin,
            max(p.x for p in pts) + margin, max(p.y for p in pts) + margin)


def symbols(L):
    """A map symbol for each placed group: actors A-Z (lower case while hidden), props 1-9 then #"""
    plan = L.plan
    out = {}
    letters = iter("ABCDEFGHIJKLMNOQRSTUVWXYZ")
    for a in plan.get("actors") or []:
        s = next(letters, "?")
        out[a["id"]] = s.lower() if a.get("hidden") else s
    digits = iter("123456789")
    for p in plan.get("props") or []:
        out[p["id"]] = next(digits, "#")
    return out


def text_map(L):
    bounds = scene_bounds(L)
    if not bounds or not L.floor:
        return ""
    x0, y0, x1, y1 = bounds
    step = 1.0 if (x1 - x0) <= 100 else 2.0
    cols, rows = int((x1 - x0) / step) + 1, int((y1 - y0) / step) + 1
    grid = [[" "] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            x, y = x0 + (c + 0.5) * step, y1 - (r + 0.5) * step
            if any(L.floor.is_floor(x + dx, y + dy) for dx in (-step / 4, step / 4) for dy in (-step / 4, step / 4)):
                grid[r][c] = "."

    def put(x, y, ch):
        c, r = int((x - x0) / step), int((y1 - y) / step)
        if 0 <= r < rows and 0 <= c < cols:
            grid[r][c] = ch

    syms = symbols(L)
    for p in L.players or []:
        put(p.x, p.y, "@")
    for id_, pts in L.placed.items():
        for p in pts:
            if p.moved != float("inf"):
                put(p.x, p.y, syms.get(id_, "?"))
    for _, _, p in L.destinations:
        put(p.x, p.y, "*")

    lines = [f"Map of the scene: {step:g} m per character, north up; x {x0:.0f} to {x1:.0f}, y {y0:.0f} (bottom) to {y1:.0f} (top)"]
    ruler = "".join(str(int(x0 + c * step) // 10 % 10) if int(x0 + c * step) % 10 < step else " " for c in range(cols))
    lines.append("      " + ruler)
    for r, row in enumerate(grid):
        y = y1 - (r + 0.5) * step
        label = f"{y:5.0f} " if r % 5 == 0 else "      "
        lines.append(label + "".join(row).rstrip())
    lines.append("")
    lines.append("Key: . floor, blank no floor, @ players, * order destinations")
    actors = {a["id"]: a for a in L.plan.get("actors") or []}
    for id_, s in syms.items():
        x = actors.get(id_)
        n = len(L.placed.get(id_, []))
        if x:
            lines.append(f"  {s}  {id_}: {x.get('faction')}{', hidden at the start' if x.get('hidden') else ''}, {n}x"
                         f"{', ' + x['stance'] if x.get('stance') else ''}")
        else:
            lines.append(f"  {s}  {id_} (prop), {n}x")
    return "\n".join(lines)


def png_map(L, path, px=4):
    """A picture of the scene: floor grey (by room), players white, actors by faction, props brown"""
    bounds = scene_bounds(L, margin=8.0)
    if not bounds or not L.floor:
        return False
    x0, y0, x1, y1 = bounds
    cell = L.floor.cell
    cols, rows = int((x1 - x0) / cell), int((y1 - y0) / cell)
    img = [[(24, 24, 28)] * (cols * px) for _ in range(rows * px)]
    shades = [(90, 90, 100), (110, 105, 95), (95, 110, 100), (105, 95, 110)]

    def fill(c, r, colour, size=1):
        for yy in range(r * px - size * px // 2, r * px + px + size * px // 2):
            for xx in range(c * px - size * px // 2, c * px + px + size * px // 2):
                if 0 <= yy < rows * px and 0 <= xx < cols * px:
                    img[yy][xx] = colour

    for r in range(rows):
        for c in range(cols):
            ij = L.floor.index(x0 + (c + 0.5) * cell, y1 - (r + 0.5) * cell)
            if ij:
                n = L.floor.cells[ij[1] * L.floor.w + ij[0]]
                if n:
                    fill(c, r, shades[n % len(shades)])
    colours = {"hostile": (220, 60, 50), "friendly": (70, 170, 240), "neutral": (230, 200, 60)}
    actors = {a["id"]: a for a in L.plan.get("actors") or []}
    for id_, pts in L.placed.items():
        a = actors.get(id_)
        colour = colours.get(a.get("faction"), (200, 200, 200)) if a else (150, 100, 60)
        if a and a.get("hidden"):
            colour = tuple(v // 2 for v in colour)
        for p in pts:
            if p.moved != float("inf"):
                fill(int((p.x - x0) / cell), int((y1 - p.y) / cell), colour, size=2 if a else 1)
    for p in L.players or []:
        fill(int((p.x - x0) / cell), int((y1 - p.y) / cell), (255, 255, 255), size=2)

    raw = b"".join(b"\x00" + bytes(v for px_ in row for v in px_) for row in img)
    chunk = lambda tag, data: struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", cols * px, rows * px, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    return True


# --------------------------------------------------------------------------------------------------
# Entry point for check_plan.py
# --------------------------------------------------------------------------------------------------

def check(plan):
    """A Layout with its problems, or None (and why) when the catalog has no floor for the area"""
    area_ref = plan.get("area") or {}
    game, module = str(area_ref.get("game")), str(area_ref.get("module", "")).lower()
    area = read_area(game, module)
    if not area:
        return None, f"no {module} in catalog/{game}/areas.md"
    floor = read_floor(game, module)
    L = Layout(plan, area, floor)
    L.place_all()
    check_blocking(L)
    simulate_beats(L)
    return L, None if floor else f"no floor map for {module} (catalog/{game}/floors.json): placement checks skipped"


def resolved(L):
    """Every placed copy's position, for comparing with the game (scripts/gm-scene-check.js)"""
    return {
        "players": [[round(p.x, 2), round(p.y, 2)] for p in L.players or []],
        "placed": {id_: [[round(p.x, 2), round(p.y, 2), p.room, round(p.moved, 2)] for p in pts] for id_, pts in L.placed.items()},
    }
