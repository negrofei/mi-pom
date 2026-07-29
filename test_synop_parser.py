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
    assert d.wind_barb == "1"
    assert d.cloud_layers == []


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
    assert d.cm == "0"
    assert d.ch == "4"
    assert d.wind_units == "kt"
    assert d.cloud_layers == []


def test_section1_and_section3_clouds():
    """Debe exponer ambos grupos de nubosidad cuando coexisten."""
    d = parse_synop(
        "AAXX 27184 87178 41570 53608 10281 20216 39934 40078 57027 72582 82205 333 56706 57827 82830 84270=",
        "87178",
        year=2026,
        month=7,
        day=27,
        hour=18,
    )
    # Sección 1: 82205 → Nh=2 CL=2 CM=0 CH=5
    assert d.nh == "2"
    assert d.cl == "2"
    assert d.cm == "0"
    assert d.ch == "5"
    # Sección 3: 82830 y 84270
    assert len(d.cloud_layers) == 2
    assert d.cloud_layers[0].raw == "82830"
    assert d.cloud_layers[0].ns == "2"
    assert d.cloud_layers[0].genus == "8"
    assert d.cloud_layers[0].genus_name and "Cumulus" in d.cloud_layers[0].genus_name
    assert d.cloud_layers[0].hs == "30"
    assert d.cloud_layers[0].height_m == 900
    assert d.cloud_layers[0].height_ft == 3000  # 2953 → 3000 ft
    assert d.cloud_layers[1].raw == "84270"
    assert d.cloud_layers[1].ns == "4"
    assert d.cloud_layers[1].genus == "2"


def test_single_section3_layer():
    d = parse_synop(
        "AAXX 27163 87016 41956 23605 10249 20150 39649 4//// 57022 70522 80003 333 56007 82070=",
        "87016",
    )
    assert d.nh == "0"
    assert d.cl == "0"
    assert d.cm == "0"
    assert d.ch == "3"
    assert len(d.cloud_layers) == 1
    assert d.cloud_layers[0].ns == "2"
    assert d.cloud_layers[0].genus == "0"
    assert d.cloud_layers[0].height_m == 6000  # hs=70 → (70-50)*300
    assert d.cloud_layers[0].height_ft == 19700  # 19685 → 19700 ft


def test_nil():
    d = parse_synop("AAXX 27164 87022 NIL=", "87022")
    assert d.nil is True


if __name__ == "__main__":
    test_la_quiaca()
    test_with_msl_and_clouds()
    test_section1_and_section3_clouds()
    test_single_section3_layer()
    test_nil()
    print("ok")
