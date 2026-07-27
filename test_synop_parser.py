"""Tests básicos del parseador SYNOP."""

from synop_parser import parse_synop


def test_la_quiaca():
    d = parse_synop(
        "AAXX 27164 87007 42980 02302 10154 20014 36732 4//// 58012=",
        "87007",
        year=2026,
        month=7,
        day=27,
        hour=16,
    )
    assert d.omm == "87007"
    assert d.temp_c == 15.4
    assert d.dewpoint_c == 1.4
    assert d.station_pressure == 673.2
    assert d.wind_dir == 230
    assert d.wind_speed_kt == 2.0
    assert d.total_cloud == "0"
    assert d.tendency_char == "8"


def test_with_msl_and_clouds():
    d = parse_synop(
        "AAXX 27174 87148 42670 43410 10311 20207 39937 40042 58029 84104=",
        "87148",
        year=2026,
        month=7,
        day=27,
        hour=17,
    )
    assert d.msl_pressure == 1004.2
    assert d.pressure_plot == "042"
    assert d.nh == "4"
    assert d.cl == "1"
    assert d.wind_units == "kt"


def test_nil():
    d = parse_synop("AAXX 27164 87022 NIL=", "87022")
    assert d.nil is True


if __name__ == "__main__":
    test_la_quiaca()
    test_with_msl_and_clouds()
    test_nil()
    print("ok")
