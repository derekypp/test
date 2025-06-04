import pathlib


def test_doctype_present():
    path = pathlib.Path(__file__).resolve().parents[1] / "index.html"
    with open(path, 'r', encoding='utf-8') as f:
        first_line = f.readline().strip()
    assert first_line == "<!DOCTYPE html>"
