"""Tests parseo SMN / METAR y vigencia SPECI vs METAR."""

from datetime import datetime, timezone

from metar_parser import parse_metar_raw
from smn_client import parse_smn_metar_speci_html, parse_smn_synop_html
from surveillance import is_speci_active_vs_metar


AIRPORTS = {
    "SAZY": {
        "icao": "SAZY",
        "nombre": "Chapelco",
        "lat": -40.07,
        "lng": -71.13,
        "wmo": "87582",
        "fir": "DOZ",
    }
}

STATIONS = {
    "87582": {
        "omm": "87582",
        "nombre": "Chapelco",
        "lat": -40.07,
        "lng": -71.13,
        "fir": "DOZ",
    }
}

FIXTURE_METAR = """
<html><body>
<table>
<tr><td>87582</td><td>METAR SAZY 091700Z 18005KT 9999 FEW030 15/08 Q1018=</td></tr>
<tr><td>87641</td><td>SPECI SAAR 091642Z 17006KT 7000 -DZ OVC006 16/15 Q1014=</td></tr>
</table>
</body></html>
"""

FIXTURE_SYNOP = """
<html><body>
<pre>
87582
AAXX 09174 87582 41570 53615 10281 20216 39934 40078 57027=
</pre>
</body></html>
"""


def test_parse_metar_raw():
    now = datetime(2026, 8, 9, 18, 0, tzinfo=timezone.utc)
    m = parse_metar_raw(
        "METAR SAZY 091700Z 18005KT 9999 FEW030 15/08 Q1018=",
        airports=AIRPORTS,
        wmo="87582",
        now=now,
    )
    assert m is not None
    assert m["icao"] == "SAZY"
    assert m["wmo"] == "87582"
    assert m["obs_iso"] == "2026-08-09T17:00:00Z"
    assert m["visibility_m"] == 9999
    assert m["wind_speed_kt"] == 5
    assert m["is_speci"] is False
    assert any(c.get("cover") == "FEW" for c in m["clouds"])


def test_parse_speci_raw_cb():
    now = datetime(2026, 8, 9, 18, 0, tzinfo=timezone.utc)
    m = parse_metar_raw(
        "SPECI SARP 091734Z 05005KT 9999 TS SCT025 FEW045CB OVC050 20/20 Q1016=",
        airports={"SARP": {"icao": "SARP", "wmo": "87178", "nombre": "Posadas"}},
        now=now,
    )
    assert m["is_speci"] is True
    assert any(c.get("convective") == "CB" for c in m["clouds"])


def test_smn_html_metar_and_speci():
    metars = parse_smn_metar_speci_html(FIXTURE_METAR, kind="metar", airports=AIRPORTS)
    assert len(metars) == 1
    assert metars[0]["icao"] == "SAZY"
    assert metars[0]["wmo"] == "87582"

    airports2 = {
        **AIRPORTS,
        "SAAR": {"icao": "SAAR", "wmo": "87467", "nombre": "Rosario"},
    }
    specis = parse_smn_metar_speci_html(FIXTURE_METAR, kind="speci", airports=airports2)
    assert len(specis) == 1
    assert specis[0]["is_speci"] is True


def test_smn_html_synop():
    now = datetime(2026, 8, 9, 18, 0, tzinfo=timezone.utc)
    # monkey: parse uses now for year/month
    rows = parse_smn_synop_html(FIXTURE_SYNOP, stations=STATIONS, now=now)
    assert len(rows) == 1
    assert rows[0]["omm"] == "87582"
    assert rows[0]["source"] == "SMN"


def test_speci_expires_on_newer_metar():
    speci = {"obs_iso": "2026-08-09T16:42:00Z", "icao": "SAZY"}
    metar_old = {"obs_iso": "2026-08-09T16:00:00Z"}
    metar_new = {"obs_iso": "2026-08-09T17:00:00Z"}
    assert is_speci_active_vs_metar(speci, metar_old) is True
    assert is_speci_active_vs_metar(speci, metar_new) is False
    assert is_speci_active_vs_metar(speci, None) is True


if __name__ == "__main__":
    test_parse_metar_raw()
    test_parse_speci_raw_cb()
    test_smn_html_metar_and_speci()
    test_smn_html_synop()
    test_speci_expires_on_newer_metar()
    print("ok")
