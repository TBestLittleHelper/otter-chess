#!/usr/bin/env python3
"""
Inference script for Otter Chess AI.
Usage:
    python3 scripts/inference.py --checkpoint checkpoints/best.pt --fen "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" --elo 2000
"""
import argparse
import json
import os
import sys
from typing import List, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F

import fastchess

# Standard constants from training
POLICY_DIM = 4208
ELO_BUCKETS = 11
AUX_DIM = 141
TIME_CONTROL_BUCKETS = 5
VOCAB_DIR = os.path.join(os.path.dirname(__file__), "../uci_vocab_full")

# ════════════════════════════════════════════════════════════════
# Model Architecture (Must match train.py exactly)
# ════════════════════════════════════════════════════════════════

class ResidualBlock(nn.Module):
    def __init__(self, channels: int, dropout: float = 0.1):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)
        self.dropout = nn.Dropout2d(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        x = F.relu(self.bn1(self.conv1(x)), inplace=True)
        x = self.dropout(x)
        x = self.bn2(self.conv2(x))
        return F.relu(x + residual, inplace=True)

class BoardEncoder(nn.Module):
    def __init__(self, output_dim: int = 256, num_blocks: int = 4, dropout: float = 0.1):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(18, 64, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Dropout2d(dropout),
            nn.Conv2d(64, 128, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.Dropout2d(dropout),
            nn.Conv2d(128, output_dim, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(output_dim),
            nn.ReLU(inplace=True),
        )
        self.blocks = nn.Sequential(*[ResidualBlock(output_dim, dropout) for _ in range(num_blocks)])

    def forward(self, board: torch.Tensor) -> torch.Tensor:
        return self.blocks(self.stem(board))

class HistoryEncoder(nn.Module):
    def __init__(self, vocab_size: int = 4209, embed_dim: int = 128, output_dim: int = 256, max_seq_len: int = 20):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.position_embedding = nn.Parameter(torch.randn(1, max_seq_len, embed_dim) * 0.02)
        encoder_layer = nn.TransformerEncoderLayer(d_model=embed_dim, nhead=4, dim_feedforward=256, dropout=0.1, batch_first=True)
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=2)
        self.token_proj = nn.Linear(embed_dim, output_dim)
        self.pool_proj = nn.Linear(embed_dim, output_dim)

    def forward(self, history_ids: torch.Tensor, history_mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.embedding(history_ids)
        x = x + self.position_embedding[:, : x.size(1)]
        safe_mask = history_mask.clone()
        empty_rows = ~safe_mask.any(dim=1)
        safe_mask[:, -1] = safe_mask[:, -1] | empty_rows
        x = self.transformer(x, src_key_padding_mask=~safe_mask)
        masked = x * history_mask.unsqueeze(-1)
        pooled = masked.sum(dim=1) / history_mask.sum(dim=1, keepdim=True).clamp_min(1)
        return self.token_proj(x), self.pool_proj(pooled)

class FeedForward(nn.Module):
    def __init__(self, dim: int, hidden_dim: int):
        super().__init__()
        self.net = nn.Sequential(nn.LayerNorm(dim), nn.Linear(dim, hidden_dim), nn.GELU(), nn.Dropout(0.1), nn.Linear(hidden_dim, dim), nn.Dropout(0.1))
    def forward(self, x: torch.Tensor) -> torch.Tensor: return self.net(x)

class ConditionedAttention(nn.Module):
    def __init__(self, dim: int, context_dim: int, cond_dim: int, heads: int = 8, dim_head: int = 32):
        super().__init__()
        self.heads, self.dim_head = heads, dim_head
        inner_dim, self.scale = heads * dim_head, dim_head ** -0.5
        self.x_norm, self.context_norm = nn.LayerNorm(dim), nn.LayerNorm(context_dim)
        self.to_q, self.to_k, self.to_v = nn.Linear(dim, inner_dim, bias=False), nn.Linear(context_dim, inner_dim, bias=False), nn.Linear(context_dim, inner_dim, bias=False)
        self.cond_to_q = nn.Linear(cond_dim, inner_dim, bias=False)
        self.to_out = nn.Sequential(nn.Linear(inner_dim, dim), nn.Dropout(0.1))

    def forward(self, x: torch.Tensor, cond: torch.Tensor, context: Optional[torch.Tensor] = None, context_mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        context = x if context is None else context
        x_norm, context_norm = self.x_norm(x), self.context_norm(context)
        b, n, _ = x_norm.shape
        c_n = context_norm.size(1)
        q = self.to_q(x_norm).view(b, n, self.heads, self.dim_head).transpose(1, 2)
        k = self.to_k(context_norm).view(b, c_n, self.heads, self.dim_head).transpose(1, 2)
        v = self.to_v(context_norm).view(b, c_n, self.heads, self.dim_head).transpose(1, 2)
        q = q + self.cond_to_q(cond).view(b, self.heads, 1, self.dim_head)
        scores = torch.matmul(q, k.transpose(-1, -2)) * self.scale
        if context_mask is not None: scores = scores.masked_fill(~context_mask[:, None, None, :], -1e9)
        out = torch.matmul(torch.softmax(scores, dim=-1), v).transpose(1, 2).contiguous().view(b, n, -1)
        return self.to_out(out)

class SelfAttentionBlock(nn.Module):
    def __init__(self, dim: int, cond_dim: int):
        super().__init__()
        self.attn = ConditionedAttention(dim=dim, context_dim=dim, cond_dim=cond_dim)
        self.ff = FeedForward(dim, hidden_dim=1024)
    def forward(self, x: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(x, cond); return x + self.ff(x)

class CrossAttentionBlock(nn.Module):
    def __init__(self, dim: int, context_dim: int, cond_dim: int):
        super().__init__()
        self.attn = ConditionedAttention(dim=dim, context_dim=context_dim, cond_dim=cond_dim)
        self.ff = FeedForward(dim, hidden_dim=512)
    def forward(self, x: torch.Tensor, context: torch.Tensor, cond: torch.Tensor, context_mask: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(x, cond, context=context, context_mask=context_mask); return x + self.ff(x)

class StrongPolicyModel(nn.Module):
    def __init__(self, history_k: int = 20):
        super().__init__()
        self.board_encoder = BoardEncoder(output_dim=256, num_blocks=4)
        self.history_encoder = HistoryEncoder(max_seq_len=history_k)
        self.active_elo_embedding = nn.Embedding(ELO_BUCKETS, 128)
        self.opponent_elo_embedding = nn.Embedding(ELO_BUCKETS, 128)
        self.time_control_embedding = nn.Embedding(TIME_CONTROL_BUCKETS, 64)
        self.clock_mlp = nn.Sequential(nn.Linear(2, 64), nn.ReLU(inplace=True), nn.Linear(64, 64), nn.ReLU(inplace=True))
        cond_dim = 640
        self.rank_embedding, self.file_embedding = nn.Embedding(8, 256), nn.Embedding(8, 256)
        self.register_buffer("board_ranks", torch.arange(8).unsqueeze(1).expand(8, 8).reshape(64))
        self.register_buffer("board_files", torch.arange(8).unsqueeze(0).expand(8, 8).reshape(64))
        self.cross_block = CrossAttentionBlock(dim=256, context_dim=256, cond_dim=cond_dim)
        self.self_blocks = nn.ModuleList([SelfAttentionBlock(dim=256, cond_dim=cond_dim) for _ in range(4)])
        self.policy_proj = nn.Sequential(nn.LayerNorm(256), nn.Linear(256, 1024), nn.ReLU(inplace=True), nn.Dropout(0.1), nn.Linear(1024, POLICY_DIM))
        self.aux_proj = nn.Sequential(nn.LayerNorm(256), nn.Linear(256, 512), nn.ReLU(inplace=True), nn.Dropout(0.1), nn.Linear(512, AUX_DIM))
        self.value_proj = nn.Sequential(nn.LayerNorm(256), nn.Linear(256, 64), nn.ReLU(inplace=True), nn.Linear(64, 1), nn.Tanh())

    def forward(self, board, history_ids, history_mask, active_elo, opponent_elo, tc, clock):
        board_tokens = self.board_encoder(board).flatten(2).transpose(1, 2)
        board_tokens = board_tokens + (self.rank_embedding(self.board_ranks) + self.file_embedding(self.board_files)).unsqueeze(0)
        history_tokens, history_pooled = self.history_encoder(history_ids, history_mask)
        cond = torch.cat([self.active_elo_embedding(active_elo), self.opponent_elo_embedding(opponent_elo), self.time_control_embedding(tc), self.clock_mlp(clock), history_pooled], dim=-1)
        x = self.cross_block(board_tokens, history_tokens, cond, history_mask)
        for block in self.self_blocks: x = block(x, cond)
        pooled = x.mean(dim=1)
        return self.policy_proj(pooled), self.aux_proj(pooled), self.value_proj(pooled).squeeze(-1)

# ════════════════════════════════════════════════════════════════
# Preprocessing Helpers
# ════════════════════════════════════════════════════════════════

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

def mirror_square(square: str) -> str: return f"{square[0]}{9 - int(square[1])}"
def mirror_move(move_uci: str) -> str: return f"{mirror_square(move_uci[:2])}{mirror_square(move_uci[2:4])}{move_uci[4:]}"
def canonicalize_move(move_uci: str, turn: int) -> str:
    return mirror_move(move_uci) if turn == fastchess.BLACK else move_uci

def get_legal_move_mask(board, move_to_id):
    mask = torch.zeros(POLICY_DIM, dtype=torch.bool)
    turn = board.turn
    for move_uci in board.legal_moves_uci():
        canon = canonicalize_move(move_uci, turn)
        if canon in move_to_id: mask[move_to_id[canon]] = True
    return mask

def encode_history(history_moves: List[str], history_to_id: dict, history_k: int):
    ids = torch.zeros(history_k, dtype=torch.long)
    mask = torch.zeros(history_k, dtype=torch.bool)
    window = history_moves[-history_k:]
    start = history_k - len(window)
    for i, move in enumerate(window, start=start):
        ids[i] = history_to_id.get(move, 0)
        mask[i] = True
    return ids, mask

# ════════════════════════════════════════════════════════════════
# Main Inference Logic
# ════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=str, required=True)
    parser.add_argument("--fen", type=str, default="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    parser.add_argument("--moves", type=str, help="Space-separated UCI moves to reach position")
    parser.add_argument("--elo", type=int, default=1500)
    parser.add_argument("--time-control", type=str, default="600+0")
    parser.add_argument("--clock-fraction", type=float, default=0.5)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    # Load vocab
    with open(f"{VOCAB_DIR}/policy_move_to_id.json", "r") as f: policy_to_id = json.load(f)
    id_to_move = {v: k for k, v in policy_to_id.items()}
    with open(f"{VOCAB_DIR}/history_move_to_id.json", "r") as f: history_to_id = json.load(f)

    # Initialize model
    model = StrongPolicyModel(history_k=20).to(args.device)
    print(f"Loading checkpoint from {args.checkpoint}...")
    checkpoint = torch.load(args.checkpoint, map_location=args.device, weights_only=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    # Prepare board
    if args.moves:
        board = fastchess.Board() # Starting position
        history_ucis = []
        for m in args.moves.split():
            original_turn = board.turn
            board.push_uci(m)
            history_ucis.append(canonicalize_move(m, original_turn))
    else:
        board = fastchess.Board(args.fen)
        history_ucis = []

    turn = board.turn
    board_tensor = torch.from_numpy(board.to_tensor(canonical=True)).unsqueeze(0).to(args.device)
    hist_ids, hist_mask = encode_history(history_ucis, history_to_id, 20)
    hist_ids, hist_mask = hist_ids.unsqueeze(0).to(args.device), hist_mask.unsqueeze(0).to(args.device)
    
    elo_tensor = torch.tensor([elo_to_bucket(args.elo)], dtype=torch.long).to(args.device)
    tc_tensor = torch.tensor([time_control_to_bucket(args.time_control)], dtype=torch.long).to(args.device)
    clock_tensor = torch.tensor([[args.clock_fraction, 0.0]], dtype=torch.float32).to(args.device)

    # Predict
    with torch.no_grad():
        policy_logits, aux_logits, value_pred = model(board_tensor, hist_ids, hist_mask, elo_tensor, elo_tensor, tc_tensor, clock_tensor)
        
        # Mask legal moves
        lm_mask = get_legal_move_mask(board, policy_to_id).to(args.device)
        masked_logits = policy_logits.masked_fill(~lm_mask.unsqueeze(0), -1e9)
        # Output results
        probs = torch.softmax(masked_logits, dim=-1)[0]
        aux_probs = torch.sigmoid(aux_logits[0])
        
    top_vals, top_idx = torch.topk(probs, k=args.top_k)
    print(f"\nPosition: {board.fen()}")
    print(f"Active Elo: {args.elo} (Bucket {elo_to_bucket(args.elo)})")
    print(f"Time Control/Clock: {args.time_control} @ {args.clock_fraction*100:.0f}% remaining")
    print(f"Predicted Value (Win Prob): {value_pred.item():.3f}")
    
    # --- Auxiliary Head Decoding ---
    piece_names = ["Pawn", "Knight", "Bishop", "Rook", "Queen", "King"]
    
    # Moving piece
    mv_probs = aux_probs[0:6]
    mv_idx = int(torch.argmax(mv_probs).item())
    mv_name, mv_conf = piece_names[mv_idx], mv_probs[mv_idx].item()
    
    # Captured piece
    cap_probs = aux_probs[6:12]
    cap_idx = int(torch.argmax(cap_probs).item())
    cap_name, cap_conf = piece_names[cap_idx], cap_probs[cap_idx].item()
    
    # Check probability
    check_conf = aux_probs[12].item()
    
    # From square
    from_probs = aux_probs[13:77]
    from_idx = int(torch.argmax(from_probs).item())
    from_sq = f"{chr(ord('a') + (from_idx % 8))}{(from_idx // 8) + 1}"
    from_conf = from_probs[from_idx].item()
    
    # To square
    to_probs = aux_probs[77:141]
    to_idx = int(torch.argmax(to_probs).item())
    to_sq = f"{chr(ord('a') + (to_idx % 8))}{(to_idx // 8) + 1}"
    to_conf = to_probs[to_idx].item()
    
    if turn == fastchess.BLACK:
        from_sq = mirror_square(from_sq)
        to_sq = mirror_square(to_sq)

    print("\n--- Auxiliary Predictions ---")
    print(f"Moving Piece:   {mv_name:<6} ({mv_conf:.1%})")
    print(f"Captured Piece: {cap_name:<6} ({cap_conf:.1%})  <-- (Low confidence means likely no capture)")
    print(f"Results in Check:       ({check_conf:.1%})")
    print(f"From Square:    {from_sq:<6} ({from_conf:.1%})")
    print(f"To Square:      {to_sq:<6} ({to_conf:.1%})")

    print("\n--- Policy Head (Next Move) ---")
    print(f"{'Move':<8} | {'Prob':<8}")
    print("-" * 30)
    
    for val, idx in zip(top_vals, top_idx):
        move_canon = id_to_move[idx.item()]
        # Un-canonicalize if black
        move_real = mirror_move(move_canon) if turn == fastchess.BLACK else move_canon
        print(f"{move_real:<8} | {val.item():.2%}")

if __name__ == "__main__":
    main()
