"""Curated site catalogue. Every coordinate carries the source it was read from.

Rules: nothing here comes from memory. Each entry was read from the cited page on 2026-11-13.
Coordinates are planetocentric latitude and east-positive longitude in the Mean-Earth/Polar-axis
frame. ``landing_utc`` is only set when the cited source gives the time; otherwise only the date.
"""
from __future__ import annotations

NSSDCA = "https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html"
NSSDCA_NOTE = ("Lunar Module position from LRO images (Wagner et al., Icarus 283, 2017); frame: "
               "Mean Earth/Polar Axis, DE421")
ALSJ_TABLE = "https://www.nasa.gov/wp-content/uploads/static/history/alsj/Scotti_AltAz.txt"
GAZETTEER = "https://planetarynames.wr.usgs.gov/Feature/"
ARTEMIS_RELEASE = "https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/"


def _apollo(num: int, name: str, lat: float, lon: float, region: str) -> dict:
    return {
        "id": f"apollo-{num}",
        "name": f"Apollo {num}",
        "group": "Apollo (1969-1972)",
        "kind": "landing",
        "lat": lat,
        "lon": lon,
        "region": region,
        "source": {"label": "NASA NSSDCA, Apollo Landing Site Coordinates", "url": NSSDCA, "note": NSSDCA_NOTE},
        "history": {"label": "NASA Apollo Lunar Surface Journal Sun/Earth tables", "url": ALSJ_TABLE},
        "apollo": num,
    }


def _feature(slug: str, name: str, gazetteer_id: int, lat: float, lon: float, diameter_km: float, kind: str,
             note: str = "") -> dict:
    return {
        "id": slug,
        "name": name,
        "group": "South-polar features",
        "kind": kind,
        "lat": lat,
        "lon": lon,
        "diameterKm": diameter_km,
        "source": {"label": f"USGS/IAU Gazetteer of Planetary Nomenclature, feature {gazetteer_id}",
                   "url": f"{GAZETTEER}{gazetteer_id}",
                   "note": "IAU centre of the named feature (not a landing site). " + note},
    }


SITES: list[dict] = [
    _apollo(11, "Apollo 11", 0.67416, 23.47314, "Mare Tranquillitatis"),
    _apollo(12, "Apollo 12", -3.0128, -23.4219, "Oceanus Procellarum"),
    _apollo(14, "Apollo 14", -3.64589, -17.47194, "Fra Mauro"),
    _apollo(15, "Apollo 15", 26.13239, 3.63330, "Hadley Rille"),
    _apollo(16, "Apollo 16", -8.9734, 15.5011, "Descartes"),
    _apollo(17, "Apollo 17", 20.1911, 30.7723, "Taurus-Littrow"),
    {
        "id": "im-1",
        "name": "IM-1 Odysseus",
        "group": "Recent landers",
        "kind": "landing",
        "lat": -80.13, "lon": 1.44,
        "region": "Near Malapert A",
        "landingUtc": "2024-02-22T23:23:53Z",
        "source": {"label": "LROC, Intuitive Machines IM-1 On The Moon!",
                   "url": "https://lroc.im-ldi.com/images/1360",
                   "note": "Came to rest at 80.13 S, 1.44 E, 2579 m elevation, in a degraded 1 km crater with 12 deg slope"},
        "referenceElevationM": 2579.0,
    },
    {
        "id": "im-2",
        "name": "IM-2 Athena (intended site)",
        "group": "Recent landers",
        "kind": "landing",
        "lat": -84.78, "lon": 29.13,
        "region": "Mons Mouton",
        "landingDate": "2025-03-06",
        "source": {"label": "LROC, IM-2 Landing Region",
                   "url": "https://www.lroc.asu.edu/images/1401",
                   "note": "Intended landing site; the lander came to rest somewhere else on Mons Mouton"},
    },
    {
        "id": "blue-ghost-1",
        "name": "Blue Ghost Mission 1",
        "group": "Recent landers",
        "kind": "landing",
        "lat": 18.56, "lon": 61.81,
        "region": "Mare Crisium",
        "landingDate": "2025-03-02",
        "source": {"label": "LROC, Firefly Blue Ghost Landing Region",
                   "url": "https://www.lroc.asu.edu/images/1400",
                   "note": "Landing region centre as published before landing"},
    },
    {
        "id": "chandrayaan-3",
        "name": "Chandrayaan-3 (Shiv Shakti)",
        "group": "Recent landers",
        "kind": "landing",
        "lat": -69.3741, "lon": 32.32,
        "region": "Near Manzinus C / Simpelius N",
        "landingDate": "2023-08-23",
        "source": {"label": "LROC, Chandrayaan-3 Landing Site",
                   "url": "https://lroc.im-ldi.com/images/1314",
                   "note": "69.3741 S, 32.32 E, 532 m elevation"},
        "referenceElevationM": 532.0,
    },
    {
        "id": "slim",
        "name": "SLIM (JAXA)",
        "group": "Recent landers",
        "kind": "landing",
        "lat": -13.3160, "lon": 25.2510,
        "region": "Shioli crater ejecta",
        "landingUtc": "2024-01-19T15:20:00Z",
        "source": {"label": "LROC, JAXA SLIM Landing",
                   "url": "https://www.lroc.asu.edu/images/1358",
                   "note": "13.3160 S, 25.2510 E, -912 m elevation"},
    },
    _feature("mons-malapert", "Mons Malapert", 16338, -85.98, -1.67, 67.00, "massif",
             "Malapert Massif is one of NASA's 13 Artemis III candidate regions; the region itself is "
             "defined by NASA, this is the centre of the named massif."),
    _feature("shackleton", "Shackleton crater", 5450, -89.67, 129.78, 20.92, "crater",
             "Crater centre (floor): in permanent shadow. 'Peak Near Shackleton' is an Artemis III candidate region."),
    _feature("haworth", "Haworth crater", 14502, -87.45, -5.17, 51.42, "crater",
             "Crater centre (floor). Haworth is an Artemis III candidate region."),
    _feature("faustini", "Faustini crater", 1919, -87.18, 84.31, 42.48, "crater",
             "Crater centre (floor). Faustini Rim A is an Artemis III candidate region."),
    _feature("amundsen", "Amundsen crater", 247, -84.44, 83.07, 103.39, "crater",
             "Crater centre (floor). Amundsen Rim is an Artemis III candidate region."),
    _feature("nobile", "Nobile crater", 4321, -85.28, 53.27, 79.27, "crater",
             "Crater centre (floor). Nobile Rim 1 and 2 are Artemis III candidate regions."),
    _feature("de-gerlache", "de Gerlache crater", 1439, -88.48, -88.34, 32.71, "crater",
             "Crater centre (floor). de Gerlache Rim 1 and 2 are Artemis III candidate regions."),
    _feature("cabeus", "Cabeus crater", 953, -85.33, -42.13, 100.58, "crater",
             "Crater centre (floor); site of the LCROSS impact."),
    _feature("shoemaker", "Shoemaker crater", 5494, -88.14, 45.91, 51.82, "crater", "Crater centre (floor)."),
    _feature("sverdrup", "Sverdrup crater", 5782, -88.32, -153.39, 32.83, "crater", "Crater centre (floor)."),
]
