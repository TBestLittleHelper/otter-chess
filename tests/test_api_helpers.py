"""Smoke tests for otter_chess.api helper functions that don't require model weights."""
from otter_chess.api import (
    canonicalize_move,
    elo_to_bucket,
    get_base_seconds,
    mirror_move,
    mirror_square,
    time_control_to_bucket,
)
import fastchess


def test_mirror_square():
    assert mirror_square("e2") == "e7"
    assert mirror_square("a1") == "a8"


def test_mirror_move():
    assert mirror_move("e2e4") == "e7e5"


def test_canonicalize_move_white_is_identity():
    assert canonicalize_move("e2e4", fastchess.WHITE) == "e2e4"


def test_canonicalize_move_black_is_mirrored():
    assert canonicalize_move("e7e5", fastchess.BLACK) == "e2e4"


def test_elo_to_bucket_bounds():
    assert elo_to_bucket(0) == 0
    assert elo_to_bucket(2500) == 10


def test_elo_to_bucket_midrange():
    assert elo_to_bucket(1150) == 1


def test_time_control_to_bucket_bullet_vs_classical():
    assert time_control_to_bucket("60+0") == 1
    assert time_control_to_bucket("1800+0") == 4


def test_time_control_to_bucket_invalid_defaults_to_middle():
    assert time_control_to_bucket("") == 4
    assert time_control_to_bucket("garbage") == 4


def test_get_base_seconds():
    assert get_base_seconds("600+0") == 600
    assert get_base_seconds("invalid") == 600
