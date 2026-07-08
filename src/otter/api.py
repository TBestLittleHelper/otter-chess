import os
import json
import sys
import shutil
import urllib.request
from typing import List, Optional, Dict, Any

import torch
import fastchess

from .model import (
    StrongPolicyModel,
    POLICY_DIM,
    ELO_BUCKETS,
    AUX_DIM,
    TIME_CONTROL_BUCKETS,
)

DEFAULT_DOWNLOAD_URL = "https://github.com/peargentlabs/otter-chess/releases/download/v0.1.0/best.pt"

# Helper functions for mapping inputs to model inputs
def elo_to_bucket(elo: int) -> int:
    if elo < 1100: return 0
    if elo >= 2000: return 10
    return 1 + (elo - 1100) // 100

def time_control_to_bucket(time_control: str) -> int:
    if not time_control or "+" not in time_control: return 4
    try:
        base, inc = map(int, time_control.split("+"))
        effective = base + 40 * inc
        if effective < 60: return 0
        if effective < 180: return 1
        if effective < 600: return 2
        if effective < 1800: return 3
        return 4
    except: return 4

def mirror_square(square: str) -> str:
    return f"{square[0]}{9 - int(square[1])}"

def mirror_move(move_uci: str) -> str:
    return f"{mirror_square(move_uci[:2])}{mirror_square(move_uci[2:4])}{move_uci[4:]}"

def canonicalize_move(move_uci: str, turn: int) -> str:
    return mirror_move(move_uci) if turn == fastchess.BLACK else move_uci

def get_legal_move_mask(board, move_to_id: Dict[str, int]) -> torch.Tensor:
    mask = torch.zeros(POLICY_DIM, dtype=torch.bool)
    turn = board.turn
    for move_uci in board.legal_moves_uci():
        canon = canonicalize_move(move_uci, turn)
        if canon in move_to_id:
            mask[move_to_id[canon]] = True
    return mask

def encode_history(history_moves: List[str], history_to_id: Dict[str, int], history_k: int) -> tuple[torch.Tensor, torch.Tensor]:
    ids = torch.zeros(history_k, dtype=torch.long)
    mask = torch.zeros(history_k, dtype=torch.bool)
    window = history_moves[-history_k:]
    start = history_k - len(window)
    for i, move in enumerate(window, start=start):
        ids[i] = history_to_id.get(move, 0)
        mask[i] = True
    return ids, mask

def download_file(url: str, dest_path: str):
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError(f"Invalid URL scheme: {url}. Only http and https are allowed.")

    print(f"Downloading model weights from {url}...", flush=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    tmp_dest = dest_path + ".tmp"
    
    try:
        with urllib.request.urlopen(req) as response:
            total_size = int(response.info().get('Content-Length', 0))
            block_size = 1024 * 16
            downloaded = 0
            
            with open(tmp_dest, 'wb') as f:
                while True:
                    buffer = response.read(block_size)
                    if not buffer:
                        break
                    f.write(buffer)
                    downloaded += len(buffer)
                    if total_size > 0:
                        percent = (downloaded / total_size) * 100
                        sys.stdout.write(f"\rProgress: {percent:.1f}% ({downloaded / (1024*1024):.1f}MB / {total_size / (1024*1024):.1f}MB)")
                        sys.stdout.flush()
            print("", flush=True)
        os.rename(tmp_dest, dest_path)
        print(f"Successfully downloaded and cached weights to {dest_path}", flush=True)
    except Exception as e:
        if os.path.exists(tmp_dest):
            os.remove(tmp_dest)
        raise RuntimeError(f"Failed to download weights from {url}: {e}")


def get_base_seconds(time_control: str) -> int:
    if not time_control or "+" not in time_control: return 600
    try:
        base, inc = map(int, time_control.split("+"))
        return base
    except:
        return 600

class OtterModel:
    """High-level API for running inference with the Otter Chess Model."""

    def __init__(
        self,
        checkpoint_path: Optional[str] = None,
        device: str = "cpu",
        history_k: int = 20,
        download_url: Optional[str] = None
    ):
        self.device = torch.device(device)
        self.history_k = history_k

        # Resolve checkpoint path (cache / fallbacks / download)
        resolved_path = self._resolve_checkpoint(checkpoint_path, download_url)

        # Locate and load the bundled vocabulary files
        vocab_dir = os.path.join(os.path.dirname(__file__), "vocab")
        policy_vocab_path = os.path.join(vocab_dir, "policy_move_to_id.json")
        history_vocab_path = os.path.join(vocab_dir, "history_move_to_id.json")

        with open(policy_vocab_path, "r", encoding="utf-8") as f:
            self.policy_to_id = json.load(f)
        self.id_to_move = {v: k for k, v in self.policy_to_id.items()}

        with open(history_vocab_path, "r", encoding="utf-8") as f:
            self.history_to_id = json.load(f)

        # Initialize the model and load the checkpoint
        self.model = StrongPolicyModel(history_k=self.history_k).to(self.device)
        checkpoint = torch.load(resolved_path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

    def _resolve_checkpoint(self, checkpoint_path: Optional[str], download_url: Optional[str]) -> str:
        """Resolves the checkpoint path. Handles caching, local fallbacks, and remote downloading."""
        if checkpoint_path is not None:
            if not os.path.exists(checkpoint_path):
                raise FileNotFoundError(f"Specified checkpoint not found: {checkpoint_path}")
            return checkpoint_path

        # Cache path: ~/.cache/otter-chess/best.pt
        cache_dir = os.path.expanduser("~/.cache/otter-chess")
        cache_path = os.path.join(cache_dir, "best.pt")

        if os.path.exists(cache_path):
            return cache_path

        # If not cached, search for local fallback paths to avoid redundant downloads
        fallback_paths = [
            "/home/azureuser/sage/checkpoints/policy_model_v2_3m_final/best.pt",
            "./checkpoints/policy_model_v2_3m_final/best.pt",
            "../checkpoints/policy_model_v2_3m_final/best.pt",
        ]

        for path in fallback_paths:
            if os.path.exists(path):
                print(f"Found local fallback checkpoint at {path}. Copying to cache...", flush=True)
                os.makedirs(cache_dir, exist_ok=True)
                shutil.copy2(path, cache_path)
                return cache_path

        # If no local fallback, download from the remote URL
        url = download_url or DEFAULT_DOWNLOAD_URL
        try:
            download_file(url, cache_path)
        except Exception as e:
            # If the remote download fails (e.g. placeholder URL or offline), we print help and raise
            print("\nError resolving default model weights.", file=sys.stderr)
            print("Please ensure you have an active internet connection, or pass a custom", file=sys.stderr)
            print("local path: OtterModel(checkpoint_path='path/to/weights.pt')", file=sys.stderr)
            raise e

        return cache_path

    def predict(
        self,
        fen: str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        player_elo: int = 1500,
        opponent_elo: int = 1500,
        history_moves: Optional[List[str]] = None,
        time_control: str = "600+0",
        clock_fraction: Optional[float] = None,
        time_remaining: Optional[int] = None,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """
        Runs model inference for a given chess position.

        Args:
            fen: FEN string of the current position.
            player_elo: Elo of the active player (whose turn it is to move).
            opponent_elo: Elo of the opponent player.
            history_moves: List of prior moves in the game as UCI strings (e.g. ["e2e4", "e7e5"]).
            time_control: Time control configuration string (e.g. "600+0", "180+2").
            clock_fraction: Time remaining on the clock as a fraction between 0.0 and 1.0.
            time_remaining: Time remaining on the clock in seconds. If provided, clock_fraction is calculated automatically.
            top_k: Number of top predicted moves to return.

        Returns:
            A dictionary containing:
              - 'fen': Current FEN string.
              - 'win_probability': Predicted win probability (range [-1, 1], where 1 is win, -1 is loss).
              - 'moves': List of top predicted UCI moves and their corresponding probabilities:
                         [{'move': 'e2e4', 'probability': 0.73}, ...]
              - 'aux_predictions': Decoded auxiliary predictions (moving piece, captured piece, checks, etc.).
        """
        if history_moves is None:
            history_moves = []

        if clock_fraction is None:
            if time_remaining is not None:
                base_seconds = get_base_seconds(time_control)
                clock_fraction = min(1.0, max(0.0, time_remaining / base_seconds))
            else:
                clock_fraction = 0.5

        # Prepare fastchess board
        board = fastchess.Board(fen)
        turn = board.turn

        # Process history: canonicalize moves based on who made them
        canonical_history = []
        temp_board = fastchess.Board() # Start from start position to canonicalize
        for m in history_moves:
          original_turn = temp_board.turn
          try:
              temp_board.push_uci(m)
              canonical_history.append(canonicalize_move(m, original_turn))
          except:
              # If they pass a custom FEN history or invalid moves, fallback to raw move
              canonical_history.append(canonicalize_move(m, fastchess.WHITE))

        # Convert board representation to tensor
        board_tensor = torch.from_numpy(board.to_tensor(canonical=True)).unsqueeze(0).to(self.device)

        # Encode history
        hist_ids, hist_mask = encode_history(canonical_history, self.history_to_id, self.history_k)
        hist_ids = hist_ids.unsqueeze(0).to(self.device)
        hist_mask = hist_mask.unsqueeze(0).to(self.device)

        # Construct parameter tensors
        active_elo_tensor = torch.tensor([elo_to_bucket(player_elo)], dtype=torch.long).to(self.device)
        opponent_elo_tensor = torch.tensor([elo_to_bucket(opponent_elo)], dtype=torch.long).to(self.device)
        tc_tensor = torch.tensor([time_control_to_bucket(time_control)], dtype=torch.long).to(self.device)
        clock_tensor = torch.tensor([[clock_fraction, 0.0]], dtype=torch.float32).to(self.device)

        # Run inference
        with torch.no_grad():
            policy_logits, aux_logits, value_pred = self.model(
                board_tensor, hist_ids, hist_mask, active_elo_tensor, opponent_elo_tensor, tc_tensor, clock_tensor
            )

            # Mask legal moves
            lm_mask = get_legal_move_mask(board, self.policy_to_id).to(self.device)
            masked_logits = policy_logits.masked_fill(~lm_mask.unsqueeze(0), -1e9)

            probs = torch.softmax(masked_logits, dim=-1)[0]
            aux_probs = torch.sigmoid(aux_logits[0])

        # Get top-K policy moves
        top_vals, top_idx = torch.topk(probs, k=min(top_k, POLICY_DIM))
        predicted_moves = []
        for val, idx in zip(top_vals, top_idx):
            if val.item() < 1e-8:
                continue # Skip impossible moves
            move_canon = self.id_to_move[idx.item()]
            # Un-canonicalize if black
            move_real = mirror_move(move_canon) if turn == fastchess.BLACK else move_canon
            predicted_moves.append({
                "move": move_real,
                "probability": float(val.item())
            })

        # --- Auxiliary Head Decoding ---
        piece_names = ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King"]

        # Moving piece
        mv_probs = aux_probs[0:6]
        mv_idx = int(torch.argmax(mv_probs).item())
        mv_name = piece_names[mv_idx]
        mv_conf = float(mv_probs[mv_idx].item())

        # Captured piece
        cap_probs = aux_probs[6:12]
        cap_idx = int(torch.argmax(cap_probs).item())
        cap_name = piece_names[cap_idx]
        cap_conf = float(cap_probs[cap_idx].item())

        # Check probability
        check_conf = float(aux_probs[12].item())

        # From square
        from_probs = aux_probs[13:77]
        from_idx = int(torch.argmax(from_probs).item())
        from_sq = f"{chr(ord('a') + (from_idx % 8))}{(from_idx // 8) + 1}"
        from_conf = float(from_probs[from_idx].item())

        # To square
        to_probs = aux_probs[77:141]
        to_idx = int(torch.argmax(to_probs).item())
        to_sq = f"{chr(ord('a') + (to_idx % 8))}{(to_idx // 8) + 1}"
        to_conf = float(to_probs[to_idx].item())

        if turn == fastchess.BLACK:
            from_sq = mirror_square(from_sq)
            to_sq = mirror_square(to_sq)

        return {
            "fen": fen,
            "win_probability": float(value_pred.item()),
            "moves": predicted_moves,
            "aux_predictions": {
                "moving_piece": mv_name,
                "moving_piece_confidence": mv_conf,
                "captured_piece": cap_name,
                "captured_piece_confidence": cap_conf,
                "results_in_check_probability": check_conf,
                "from_square": from_sq,
                "from_square_confidence": from_conf,
                "to_square": to_sq,
                "to_square_confidence": to_conf,
            }
        }
