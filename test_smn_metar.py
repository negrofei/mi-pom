"""Tests parseo SMN / METAR y vigencia SPECI vs METAR."""

from datetime import datetime, timezone
from pathlib import Path
import json

from metar_parser import parse_metar_raw
from smn_client import parse_smn_metar_speci_html, parse_smn_synop_html
from surveillance import is_speci_active_vs_metar

ROOT = Path(__file__).resolve().parent
AIRPORTS = {
    str(a["icao"]).upper(): a
    for a in json.loads((ROOT / "data" / "airports.json").read_text(encoding="utf-8"))
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
        airports=AIRPORTS,
        now=now,
    )
    assert m["is_speci"] is True
    assert any(c.get("convective") == "CB" for c in m["clouds"])


def test_smn_real_html_metar_icao_to_wmo():
    """HTML real SMN: METAR con OACI; WMO sale del catálogo (SABE→87582)."""
    html = (ROOT / "testdata" / "smn_metar_sample.html").read_text(encoding="utf-8")
    now = datetime(2026, 8, 9, 19, 30, tzinfo=timezone.utc)
    metars = parse_smn_metar_speci_html(html, kind="metar", airports=AIRPORTS, now=now)
    by_icao = {m["icao"]: m for m in metars}
    assert set(by_icao) == {"SABE", "SAZA"}

    sabe = by_icao["SABE"]
    assert sabe["wmo"] == "87582"
    assert sabe["obs_iso"] == "2026-08-09T19:00:00Z"
    assert sabe["visibility_m"] == 10000  # CAVOK
    assert "CAVOK" in sabe["raw"]
    assert sabe["raw"].rstrip().endswith("=")

    saza = by_icao["SAZA"]
    assert saza["wmo"] == "87642"
    assert saza["obs_iso"] == "2026-08-09T18:00:00Z"
    assert saza["visibility_m"] == 9999
    assert any(c.get("cover") == "BKN" and c.get("base") == 3000 for c in saza["clouds"])


def test_smn_html_synop():
    now = datetime(2026, 8, 9, 18, 0, tzinfo=timezone.utc)
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
    test_smn_real_html_metar_icao_to_wmo()
    test_smn_html_synop()
    test_speci_expires_on_newer_metar()
    print("ok")
