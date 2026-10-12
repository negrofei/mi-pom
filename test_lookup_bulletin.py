"""Tests consulta multi-ICAO (parse + shape)."""

from aviationweather_client import parse_icao_ids


def test_parse_icao_ids():
    assert parse_icao_ids("sazr, SABE;sazn") == ["SAZR", "SABE", "SAZN"]
    assert parse_icao_ids("SA1, AB, SABE") == ["SABE"]
    assert parse_icao_ids("") == []
    many = []
    for i in range(50):
        many.append(f"S{chr(65 + (i // 26))}{chr(65 + (i % 26))}A")
    assert len(parse_icao_ids(",".join(many))) == 40


if __name__ == "__main__":
    test_parse_icao_ids()
    print("ok")
