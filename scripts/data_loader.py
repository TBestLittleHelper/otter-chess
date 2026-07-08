#!/usr/bin/env python3
"""
Data loader — uses the fastchess C extension instead of python-chess
for ~14x faster per-position processing throughput.
"""
import glob
import json
import os
import random
from dataclasses import dataclass
from typing import Iterator, List, Optional

import pyarrow.parquet as pq
import torch
from torch.utils.data import DataLoader, IterableDataset, get_worker_info

import fastchess

DATA_DIR = os.path.join(os.path.dirname(__file__), "../data_cloud")
VOCAB_DIR = os.path.join(os.path.dirname(__file__), "../uci_vocab_full")
BOARD_CHANNELS = 18
DEFAULT_HISTORY_K = 20
AUX_DIM = 141


# ── Vocab helpers ────────────────────────────────────────────────

def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_vocab(vocab_dir: str = VOCAB_DIR) -> tuple[dict, dict]:
    policy = load_json(f"{vocab_dir}/policy_move_to_id.json")
    history = load_json(f"{vocab_dir}/history_move_to_id.json")
    return policy, history


# ── Move canonicalization ────────────────────────────────────────

def mirror_square(square: str) -> str:
    return f"{square[0]}{9 - int(square[1])}"


def mirror_move(move_uci: str) -> str:
    return f"{mirror_square(move_uci[:2])}{mirror_square(move_uci[2:4])}{move_uci[4:]}"


def canonicalize_move(move_uci: str, turn: int) -> str:
    if turn == fastchess.BLACK:
        return mirror_move(move_uci)
    return move_uci


# ── ELO / time helpers ──────────────────────────────────────────

def elo_to_bucket(elo: int) -> int:
    if elo < 1100:
        return 0
    if elo >= 2000:
        return 10
    return 1 + (elo - 1100) // 100


def parse_clock_seconds(clock_text: str) -> int:
    if not clock_text:
        return -1
    parts = clock_text.split(":")
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return int(hours) * 3600 + int(minutes) * 60 + int(seconds)
    if len(parts) == 2:
        minutes, seconds = parts
        return int(minutes) * 60 + int(seconds)
    return -1


def parse_time_control(time_control: str) -> tuple[int, int]:
    if not time_control or "+" not in time_control:
        return -1, -1
    base_text, increment_text = time_control.split("+", 1)
    try:
        return int(base_text), int(increment_text)
    except ValueError:
        return -1, -1


def time_control_to_bucket(time_control: str) -> int:
    base_seconds, increment_seconds = parse_time_control(time_control)
    if base_seconds < 0 or increment_seconds < 0:
        return 4

    # Approximate usable time budget over a typical game horizon.
    effective_seconds = base_seconds + 40 * increment_seconds
    if effective_seconds < 60:
        return 0
    if effective_seconds < 180:
        return 1
    if effective_seconds < 600:
        return 2
    if effective_seconds < 1800:
        return 3
    return 4


def encode_clock_features(move_clock_seconds: int, time_control: str) -> torch.Tensor:
    base_seconds, increment_seconds = parse_time_control(time_control)
    if move_clock_seconds < 0 or base_seconds <= 0 or increment_seconds < 0:
        return torch.zeros(2, dtype=torch.float32)

    clock_fraction_of_base = move_clock_seconds / float(base_seconds)
    increment_fraction_of_base = increment_seconds / float(base_seconds)

    return torch.tensor(
        [clock_fraction_of_base, increment_fraction_of_base],
        dtype=torch.float32,
    )


def result_to_value_target(result: str, turn: int) -> float:
    """Return value target from the active player's perspective."""
    if result == "1-0":
        return 1.0 if turn == fastchess.WHITE else -1.0
    if result == "0-1":
        return -1.0 if turn == fastchess.WHITE else 1.0
    return 0.0


# ── History encoding ─────────────────────────────────────────────

def encode_history(history_moves: List[str], history_move_to_id: dict, history_k: int) -> tuple[torch.Tensor, torch.Tensor, int]:
    history_window = history_moves[-history_k:]
    history_ids = torch.zeros(history_k, dtype=torch.long)
    history_mask = torch.zeros(history_k, dtype=torch.bool)

    start = history_k - len(history_window)
    for index, move_uci in enumerate(history_window, start=start):
        history_ids[index] = history_move_to_id[move_uci]
        history_mask[index] = True

    return history_ids, history_mask, len(history_window)


# ── Legal move mask ──────────────────────────────────────────────

def legal_move_mask(board: fastchess.Board, policy_move_to_id: dict) -> torch.Tensor:
    mask = torch.zeros(len(policy_move_to_id), dtype=torch.bool)
    turn = board.turn
    for move_uci in board.legal_moves_uci():
        canonical = canonicalize_move(move_uci, turn)
        move_idx = policy_move_to_id.get(canonical)
        if move_idx is not None:
            mask[move_idx] = True
    return mask


# ── Auxiliary target ─────────────────────────────────────────────

def _parse_uci_squares(uci: str) -> tuple[int, int]:
    from_file = ord(uci[0]) - ord('a')
    from_rank = ord(uci[1]) - ord('1')
    to_file = ord(uci[2]) - ord('a')
    to_rank = ord(uci[3]) - ord('1')
    return from_rank * 8 + from_file, to_rank * 8 + to_file


def auxiliary_target(board: fastchess.Board, canonical_uci: str) -> torch.Tensor:
    target = torch.zeros(AUX_DIM, dtype=torch.float32)
    from_sq, to_sq = _parse_uci_squares(canonical_uci)

    moving_piece = board.piece_at(from_sq)
    captured_piece = board.piece_at(to_sq)

    if moving_piece is not None:
        target[moving_piece[0] - 1] = 1.0  # piece_type is 1-indexed
    if captured_piece is not None:
        target[6 + captured_piece[0] - 1] = 1.0

    board_after = board.copy()
    board_after.push_uci(canonical_uci)
    if board_after.is_check():
        target[12] = 1.0

    target[13 + from_sq] = 1.0
    target[77 + to_sq] = 1.0
    return target


# ── Board-to-tensor ──────────────────────────────────────────────

def board_to_tensor(board: fastchess.Board) -> torch.Tensor:
    """Convert board to (18, 8, 8) tensor via the C extension."""
    np_array = board.to_tensor(canonical=True)
    return torch.from_numpy(np_array)


# ── Parquet file discovery ───────────────────────────────────────

def parquet_files(data_dir: str, months: Optional[List[str]], elo_bands: Optional[List[int]]) -> List[str]:
    months = months or sorted(
        path.split("/month=")[1].split("/")[0]
        for path in glob.glob(f"{data_dir}/month=*")
    )
    bands = elo_bands or list(range(9))

    files: List[str] = []
    for month in months:
        for band in bands:
            files.extend(sorted(glob.glob(f"{data_dir}/month={month}/elo_band={band}/*.parquet")))
    return files


# ── Config ───────────────────────────────────────────────────────

@dataclass
class StreamConfig:
    data_dir: str = DATA_DIR
    vocab_dir: str = VOCAB_DIR
    months: Optional[List[str]] = None
    elo_bands: Optional[List[int]] = None
    history_k: int = DEFAULT_HISTORY_K
    batch_size: int = 32
    num_workers: int = 0
    max_games: Optional[int] = None
    shuffle_files: bool = False
    shuffle_rows: bool = False
    seed: int = 1337


# ── Dataset ──────────────────────────────────────────────────────

class OtterGameParquetStream(IterableDataset):
    def __init__(self, config: StreamConfig):
        super().__init__()
        self.config = config
        self.policy_move_to_id, self.history_move_to_id = load_vocab(config.vocab_dir)
        self.files = parquet_files(config.data_dir, config.months, config.elo_bands)

    def _worker_files(self) -> List[str]:
        worker = get_worker_info()
        files = list(self.files)
        worker_id = 0 if worker is None else worker.id
        num_workers = 1 if worker is None else worker.num_workers
        if self.config.shuffle_files:
            rng = random.Random(self.config.seed + worker_id)
            rng.shuffle(files)
        return files[worker_id::num_workers]

    def __iter__(self) -> Iterator[dict]:
        columns = [
            "month",
            "elo_band",
            "result",
            "white_elo",
            "black_elo",
            "time_control",
            "move_clocks",
            "moves_san",
        ]
        seen_games = 0
        for path in self._worker_files():
            parquet_file = pq.ParquetFile(path)
            for batch in parquet_file.iter_batches(columns=columns, batch_size=256):
                rows = batch.to_pylist()
                if self.config.shuffle_rows:
                    rng = random.Random(self.config.seed + seen_games + len(rows))
                    rng.shuffle(rows)
                for row in rows:
                    seen_games += 1
                    if self.config.max_games is not None and seen_games > self.config.max_games:
                        return

                    board = fastchess.Board()
                    played_canonical_history: List[str] = []
                    move_clocks = (row.get("move_clocks") or "").split("|") if row.get("move_clocks") else []
                    moves_san = (row.get("moves_san") or "").split()

                    for ply_index, san_text in enumerate(moves_san):
                        original_turn = board.turn
                        canonical_board = board if original_turn == fastchess.WHITE else board.mirror()

                        # --- Features extracted BEFORE pushing the move ---
                        board_tensor = board_to_tensor(board)
                        history_ids, history_mask, history_len = encode_history(
                            played_canonical_history,
                            self.history_move_to_id,
                            self.config.history_k,
                        )
                        lm_mask = legal_move_mask(board, self.policy_move_to_id)

                        move_clock = move_clocks[ply_index] if ply_index < len(move_clocks) else ""

                        # --- Push the move (mutates board, returns raw UCI) ---
                        raw_uci = board.push_san(san_text)
                        canonical_uci = canonicalize_move(raw_uci, original_turn)

                        yield {
                            "board": board_tensor,
                            "history_ids": history_ids,
                            "history_mask": history_mask,
                            "history_len": history_len,
                            "ply_index": ply_index,
                            "target_move_id": self.policy_move_to_id[canonical_uci],
                            "legal_move_mask": lm_mask,
                            "value_target": result_to_value_target(row["result"], original_turn),
                            "aux_target": auxiliary_target(canonical_board, canonical_uci),
                            "active_elo_bucket": elo_to_bucket(
                                row["white_elo"] if original_turn == fastchess.WHITE else row["black_elo"]
                            ),
                            "opponent_elo_bucket": elo_to_bucket(
                                row["black_elo"] if original_turn == fastchess.WHITE else row["white_elo"]
                            ),
                            "month": row["month"],
                            "elo_band": row["elo_band"],
                            "time_control": row["time_control"],
                            "time_control_bucket": time_control_to_bucket(row["time_control"]),
                            "move_clock": move_clock,
                            "clock_features": encode_clock_features(
                                parse_clock_seconds(move_clock),
                                row["time_control"],
                            ),
                            "side_to_move": 1 if original_turn == fastchess.WHITE else 0,
                        }

                        played_canonical_history.append(canonical_uci)


# ── Collate ──────────────────────────────────────────────────────

def collate_otter_batch(samples: List[dict]) -> dict:
    return {
        "board": torch.stack([sample["board"] for sample in samples]),
        "history_ids": torch.stack([sample["history_ids"] for sample in samples]),
        "history_mask": torch.stack([sample["history_mask"] for sample in samples]),
        "history_len": torch.tensor([sample["history_len"] for sample in samples], dtype=torch.long),
        "ply_index": torch.tensor([sample["ply_index"] for sample in samples], dtype=torch.long),
        "target_move_id": torch.tensor([sample["target_move_id"] for sample in samples], dtype=torch.long),
        "legal_move_mask": torch.stack([sample["legal_move_mask"] for sample in samples]),
        "value_target": torch.tensor([sample["value_target"] for sample in samples], dtype=torch.float32),
        "aux_target": torch.stack([sample["aux_target"] for sample in samples]),
        "active_elo_bucket": torch.tensor([sample["active_elo_bucket"] for sample in samples], dtype=torch.long),
        "opponent_elo_bucket": torch.tensor([sample["opponent_elo_bucket"] for sample in samples], dtype=torch.long),
        "clock_features": torch.stack([sample["clock_features"] for sample in samples]),
        "time_control_bucket": torch.tensor([sample["time_control_bucket"] for sample in samples], dtype=torch.long),
        "side_to_move": torch.tensor([sample["side_to_move"] for sample in samples], dtype=torch.long),
        "month": [sample["month"] for sample in samples],
        "elo_band": [sample["elo_band"] for sample in samples],
        "time_control": [sample["time_control"] for sample in samples],
        "move_clock": [sample["move_clock"] for sample in samples],
    }


# ── DataLoader factory ───────────────────────────────────────────

def create_data_loader(config: StreamConfig) -> DataLoader:
    dataset = OtterGameParquetStream(config)
    return DataLoader(
        dataset,
        batch_size=config.batch_size,
        num_workers=config.num_workers,
        collate_fn=collate_otter_batch,
        pin_memory=True,
        prefetch_factor=2 if config.num_workers > 0 else None,
    )


# ── Quick sanity check ───────────────────────────────────────────

if __name__ == "__main__":
    loader = create_data_loader(
        StreamConfig(months=["2024-01"], batch_size=4, num_workers=0, max_games=2)
    )
    batch = next(iter(loader))
    print("board", tuple(batch["board"].shape))
    print("history_ids", tuple(batch["history_ids"].shape))
    print("history_mask", tuple(batch["history_mask"].shape))
    print("target_move_id", tuple(batch["target_move_id"].shape))
    print("legal_move_mask", tuple(batch["legal_move_mask"].shape))
    print("value_target", tuple(batch["value_target"].shape))
    print("aux_target", tuple(batch["aux_target"].shape))
    print("active_elo_bucket", batch["active_elo_bucket"].tolist())
    print("opponent_elo_bucket", batch["opponent_elo_bucket"].tolist())
    print("time_control_bucket", batch["time_control_bucket"].tolist())
    print("clock_features", batch["clock_features"].tolist())
