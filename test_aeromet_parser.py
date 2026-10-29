"""Tests del parseo de columna AEROMET → campos de plot SYNOP."""

from __future__ import annotations

from datetime import datetime, timezone

from aeromet_parser import parse_aeromet


NOW = datetime(2026, 10, 29, 15, 0, tzinfo=timezone.utc)


def test_aeromet_bulletin_metar_like():
    text = "AEROMET 87582 291400Z 27015KT 8000 SCT020 BKN100 22/15 Q1013="
    out = parse_aeromet(
        text,
        omm="87582",
        raw_synop="AAXX 29144 87582 ...=",
        now=NOW,
        meta={"nombre": "Ezeiza", "fir": "EZE"},
    )
    assert out is not None
    assert out["source"] == "DMA"
    assert out["temp_c"] == 22.0
    assert out["dewpoint_c"] == 15.0
    assert out["wind_dir"] == 270
    assert out["wind_speed_kt"] == 15
    assert out["visibility_m"] == 8000
    assert out["msl_pressure"] == 1013.0
    assert out["total_cloud"] == "6"  # BKN
    assert out["raw"].startswith("AAXX")
    assert "from_aeromet" in (out.get("notes") or []) or out.get("raw_aeromet")


def test_aeromet_labeled_spanish():
    text = "Temp: 18.5 C  Rocío: 12.0 C  Viento: 090/10 kt  Vis: 10000 m  Nubes: 4"
    out = parse_aeromet(text, omm="87448", now=NOW)
    assert out is not None
    assert out["temp_c"] == 18.5
    assert out["dewpoint_c"] == 12.0
    assert out["wind_dir"] == 90
    assert out["wind_speed_kt"] == 10.0
    assert out["visibility_m"] == 10000
    assert out["total_cloud"] == "4"


def test_aeromet_empty_returns_none():
    assert parse_aeromet(None, omm="87582") is None
    assert parse_aeromet("   ", omm="87582") is None
    assert parse_aeromet("NIL", omm="87582") is None


if __name__ == "__main__":
    test_aeromet_bulletin_metar_like()
    test_aeromet_labeled_spanish()
    test_aeromet_empty_returns_none()
    print("ok")
