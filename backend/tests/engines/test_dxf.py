"""DXF R12 export (§8.4): structure, layers, entity counts and coordinates (read back with a tiny reader;
ezdxf read-back + audit when installed)."""
import io
from collections import Counter

import pytest

from app.engines.dxf_export import LAYERS, elevation_to_dxf, parse_dxf_entities
from app.engines.elevation import field_rects
from app.engines.models import Elevation


def elev(**over):
    d = {"name": "Lobby", "width": 6000, "height": 3600, "mullions": [0, 1500, 3000, 4500, 6000],
         "bays": [{"transoms": [1100, 2400]} for _ in range(4)], "system_id": "ser-cw50", "colour_id": "col-ral7016",
         "default_glass_type_id": "gl-dgu-24", "anchor_levels": [0, 3600],
         "fills": {"b0-f2": {"type": "panel", "panel_type_id": "pnl-acp-4"}, "b3-f0": {"type": "opening"}}}
    d.update(over)
    return Elevation(**d)


def pairs(text):
    ls = text.splitlines()
    return [(int(ls[i]), ls[i + 1]) for i in range(0, len(ls), 2)]


def test_header_tables_and_eof(cat):
    s = elevation_to_dxf(elev(), cat)
    assert s.isascii()
    p = pairs(s)
    assert p[0] == (0, "SECTION") and p[1] == (2, "HEADER") and p[-1] == (0, "EOF")
    i = p.index((9, "$ACADVER"))
    assert p[i + 1] == (1, "AC1009")
    i = p.index((9, "$INSUNITS"))
    assert p[i + 1] == (70, "4")
    assert (2, "LTYPE") in p and (2, "CONTINUOUS") in p
    layers = [p[k + 1][1] for k, x in enumerate(p) if x == (0, "LAYER")]
    assert set(layers) >= {name for name, _ in LAYERS}
    assert [x for x in p if x[1] == "LWPOLYLINE"] == []     # not part of R12
    assert [x for x in p if x[1] == "DIMENSION"] == []      # dims drawn as LINE + TEXT


def test_entities_layers_counts_and_coordinates(cat):
    e = elev()
    ents = parse_dxf_entities(elevation_to_dxf(e, cat))
    cnt = Counter((x["type"], x["layer"]) for x in ents)
    n_m = len(e.mullions)
    n_h = sum(len(b.transoms) + 2 for b in e.bays)
    n_fields = len(field_rects(e))
    assert cnt[("POLYLINE", "FOS-MULLION")] == n_m
    assert cnt[("POLYLINE", "FOS-TRANSOM")] == n_h
    assert cnt[("POLYLINE", "FOS-PANEL")] == 1
    assert cnt[("POLYLINE", "FOS-GLASS")] == n_fields - 2       # one panel, one opening
    assert cnt[("TEXT", "FOS-TEXT")] == n_fields + 1             # marks + title
    # dims: chained bays (4) + overall width + chained levels (3 between 0,1100,2400,3600) + overall height = 9
    assert cnt[("TEXT", "FOS-DIM")] == 9
    assert cnt[("LINE", "FOS-DIM")] == 9 * 3          # dimension line + 2 ticks each
    for x in ents:
        if x["type"] == "POLYLINE":
            assert len(x["vertices"]) == 4 and dict(x["codes"]).get(70) == "1"
    # mullion outline from catalogue face width (DEMO CW50: 50 mm)
    mulls = sorted((x for x in ents if x["layer"] == "FOS-MULLION"), key=lambda x: x["vertices"][0][0])
    for xm, ent in zip(e.mullions, mulls):
        xs = sorted({v[0] for v in ent["vertices"]})
        ys = sorted({v[1] for v in ent["vertices"]})
        assert xs == [pytest.approx(xm - 25), pytest.approx(xm + 25)] and ys == [0, 3600]
    # glass b1-f1 (bay 1, field 1): clear opening between member faces (transom face 50 mm)
    glass = [x for x in ents if x["layer"] == "FOS-GLASS"]
    want = {(1525.0, 1125.0), (2975.0, 1125.0), (2975.0, 2375.0), (1525.0, 2375.0)}
    assert any(set(g["vertices"]) == want for g in glass)
    marks = {dict(x["codes"])[1] for x in ents if x["type"] == "TEXT" and x["layer"] == "FOS-TEXT"}
    assert {"G1.1", "P1.3", "OPENING 4.1", "G2.2"} <= marks
    dims = {dict(x["codes"])[1] for x in ents if x["type"] == "TEXT" and x["layer"] == "FOS-DIM"}
    assert {"6000", "3600", "1500", "1100", "1300", "1200"} <= dims


def test_without_catalogue_uses_default_face(cat):
    ents = parse_dxf_entities(elevation_to_dxf(elev(system_id=None), None))
    assert sum(1 for x in ents if x["layer"] == "FOS-MULLION") == 5


def test_ezdxf_reads_it_back(cat):
    ezdxf = pytest.importorskip("ezdxf")
    doc = ezdxf.read(io.StringIO(elevation_to_dxf(elev(), cat)))
    assert doc.dxfversion == "AC1009"
    assert doc.header["$INSUNITS"] == 4
    assert {name for name, _ in LAYERS} <= {lay.dxf.name for lay in doc.layers}
    msp = doc.modelspace()
    assert len(msp.query("POLYLINE[layer=='FOS-MULLION']")) == 5
    auditor = doc.audit()
    assert not auditor.has_errors
