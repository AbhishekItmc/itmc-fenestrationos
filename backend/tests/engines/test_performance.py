import random
import time

from app.engines.cutting1d import optimize_1d
from app.engines.models import Cutting1DRequest, Nesting2DRequest, Piece1D, Piece2D, Sheet2D, Stock1D
from app.engines.nesting2d import optimize_2d


def test_1d_heuristic_2000_pieces_under_2s():
    rng = random.Random(1)
    pieces = [Piece1D(id=f"p{i}", length=rng.randint(200, 3000), quantity=1) for i in range(2000)]
    rq = Cutting1DRequest(stocks=[Stock1D(id="S", length=6500)], pieces=pieces, strategy="heuristic")
    t = time.perf_counter()
    r = optimize_1d(rq)
    assert time.perf_counter() - t < 2.0
    assert r.validation.passed and r.summary.bars_used <= r.proof.lower_bound_bars * 1.05 + 1


def test_1d_auto_large_instance_skips_exact_quickly():
    rng = random.Random(2)
    pieces = [Piece1D(id=f"p{i}", length=rng.randint(200, 3000), quantity=rng.randint(1, 20)) for i in range(100)]
    t = time.perf_counter()
    r = optimize_1d(Cutting1DRequest(stocks=[Stock1D(id="S", length=6000)], pieces=pieces, strategy="auto"))
    assert time.perf_counter() - t < 3.0 and r.validation.passed


def test_2d_500_pieces_reasonable_time():
    rng = random.Random(3)
    pieces = [Piece2D(id=f"p{i}", width=rng.randint(200, 1500), height=rng.randint(200, 1500), quantity=5)
              for i in range(100)]
    t = time.perf_counter()
    r = optimize_2d(Nesting2DRequest(sheets=[Sheet2D(id="S", width=3210, height=2250)], pieces=pieces, kerf=3))
    assert time.perf_counter() - t < 10.0
    assert r.validation.passed and not r.unplaced
