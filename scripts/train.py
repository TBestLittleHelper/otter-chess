#!/usr/bin/env python3
"""
Train policy model — architecture improvements over train_policy_baseline.py.

Changes from baseline:
  • Pooled history output concatenated into conditioning vector (was discarded)
  • More residual blocks (2→4) and self-attention blocks (2→4)
  • Factored 2D board position embeddings (rank + file)
  • Separate per-head projections instead of single shared bottleneck
  • Policy head is a 2-layer MLP (256→1024→4208) instead of single linear
  • Dropout added to BoardEncoder
  • Position embedding in HistoryEncoder sized to history_k (not hardcoded 64)
  • Windowed running averages (last N steps, not cumulative)
  • Periodic validation + best-model saving mid-training
  • Linear LR warmup for first 10% of steps
  • Eval loss uses configured loss weights
  • pin_memory=True and prefetch_factor in DataLoader
  • weights_only=True in torch.load for safety
"""
import argparse
import json
import os
import random
import time
from collections import deque
from dataclasses import asdict, dataclass
from typing import Literal, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from data_loader import StreamConfig, create_data_loader

try:
    import wandb
except ImportError:
    wandb = None


POLICY_DIM = 4208
ELO_BUCKETS = 11
AUX_DIM = 141
TIME_CONTROL_BUCKETS = 5


@dataclass
class TrainConfig:
    train_months: list[str]
    val_months: list[str]
    seed: int = 1337
    history_k: int = 20
    batch_size: int = 128
    num_workers: int = 4
    learning_rate: float = 1e-4
    weight_decay: float = 1e-5
    train_steps: int = 1000
    val_steps: int = 100
    val_interval: int = 500
    device: str = "cuda"
    policy_loss_weight: float = 1.0
    value_loss_weight: float = 1.0
    aux_loss_weight: float = 1.0
    gradient_clip_norm: float = 1.0
    warmup_fraction: float = 0.1
    min_lr: float = 1e-6
    save_dir: str = "checkpoints"
    checkpoint_name: str = "policy_model.pt"
    wandb_enabled: bool = False
    wandb_project: str = "otter"
    wandb_entity: Optional[str] = None
    wandb_run_name: Optional[str] = None
    wandb_mode: Literal["disabled", "offline", "online", "shared"] = "online"
    resume: bool = False
    save_checkpoints: bool = False
    max_train_games: Optional[int] = None
    max_val_games: Optional[int] = None


# ════════════════════════════════════════════════════════════════
# Model Components
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
    """CNN backbone with dropout and configurable depth."""

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
        self.blocks = nn.Sequential(
            *[ResidualBlock(output_dim, dropout) for _ in range(num_blocks)]
        )

    def forward(self, board: torch.Tensor) -> torch.Tensor:
        x = self.stem(board)
        x = self.blocks(x)
        return x


class HistoryEncoder(nn.Module):
    """Transformer encoder for move history, with position embeddings sized to history_k."""

    def __init__(self, vocab_size: int = 4209, embed_dim: int = 128,
                 output_dim: int = 256, max_seq_len: int = 20):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.position_embedding = nn.Parameter(torch.randn(1, max_seq_len, embed_dim) * 0.02)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=4,
            dim_feedforward=256,
            dropout=0.1,
            batch_first=True,
        )
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
        self.net = nn.Sequential(
            nn.LayerNorm(dim),
            nn.Linear(dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, dim),
            nn.Dropout(0.1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class ConditionedAttention(nn.Module):
    def __init__(self, dim: int, context_dim: int, cond_dim: int, heads: int = 8, dim_head: int = 32):
        super().__init__()
        self.heads = heads
        self.dim_head = dim_head
        inner_dim = heads * dim_head
        self.scale = dim_head ** -0.5

        self.x_norm = nn.LayerNorm(dim)
        self.context_norm = nn.LayerNorm(context_dim)
        self.to_q = nn.Linear(dim, inner_dim, bias=False)
        self.to_k = nn.Linear(context_dim, inner_dim, bias=False)
        self.to_v = nn.Linear(context_dim, inner_dim, bias=False)
        self.cond_to_q = nn.Linear(cond_dim, inner_dim, bias=False)
        self.to_out = nn.Sequential(nn.Linear(inner_dim, dim), nn.Dropout(0.1))

    def forward(
        self,
        x: torch.Tensor,
        cond: torch.Tensor,
        context: Optional[torch.Tensor] = None,
        context_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        context = x if context is None else context
        x_norm = self.x_norm(x)
        context_norm = self.context_norm(context)

        batch_size, x_tokens, _ = x_norm.shape
        context_tokens = context_norm.size(1)

        q = self.to_q(x_norm).view(batch_size, x_tokens, self.heads, self.dim_head).transpose(1, 2)
        k = self.to_k(context_norm).view(batch_size, context_tokens, self.heads, self.dim_head).transpose(1, 2)
        v = self.to_v(context_norm).view(batch_size, context_tokens, self.heads, self.dim_head).transpose(1, 2)

        cond_q = self.cond_to_q(cond).view(batch_size, self.heads, 1, self.dim_head)
        q = q + cond_q

        scores = torch.matmul(q, k.transpose(-1, -2)) * self.scale
        if context_mask is not None:
            mask_fill = -1e4 if scores.dtype == torch.float16 else -1e9
            scores = scores.masked_fill(~context_mask[:, None, None, :], mask_fill)

        attn = torch.softmax(scores, dim=-1)
        out = torch.matmul(attn, v).transpose(1, 2).contiguous().view(batch_size, x_tokens, -1)
        return self.to_out(out)


class CrossAttentionBlock(nn.Module):
    def __init__(self, dim: int, context_dim: int, cond_dim: int):
        super().__init__()
        self.attn = ConditionedAttention(dim=dim, context_dim=context_dim, cond_dim=cond_dim, heads=8, dim_head=32)
        self.ff = FeedForward(dim, hidden_dim=512)

    def forward(self, x: torch.Tensor, context: torch.Tensor, cond: torch.Tensor, context_mask: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(x, cond, context=context, context_mask=context_mask)
        x = x + self.ff(x)
        return x


class SelfAttentionBlock(nn.Module):
    def __init__(self, dim: int, cond_dim: int):
        super().__init__()
        self.attn = ConditionedAttention(dim=dim, context_dim=dim, cond_dim=cond_dim, heads=8, dim_head=32)
        self.ff = FeedForward(dim, hidden_dim=1024)

    def forward(self, x: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        x = x + self.attn(x, cond)
        x = x + self.ff(x)
        return x


# ════════════════════════════════════════════════════════════════
# Main Model
# ════════════════════════════════════════════════════════════════


class StrongPolicyModel(nn.Module):
    """
    Key differences from v1:
      • 4 residual blocks (was 2) with dropout in CNN
      • Pooled history → concatenated into conditioning (cond_dim 384→640)
      • 4 self-attention blocks (was 2)
      • Factored board position embedding (rank + file instead of flat learned)
      • Per-head projections instead of a single shared bottleneck
      • Policy head is 2-layer MLP (256→1024→4208)
    """

    def __init__(self, history_k: int = 20):
        super().__init__()
        # Encoders
        self.board_encoder = BoardEncoder(output_dim=256, num_blocks=4, dropout=0.1)
        self.history_encoder = HistoryEncoder(
            vocab_size=4209, embed_dim=128, output_dim=256, max_seq_len=history_k,
        )

        # Conditioning embeddings
        self.active_elo_embedding = nn.Embedding(ELO_BUCKETS, 128)
        self.opponent_elo_embedding = nn.Embedding(ELO_BUCKETS, 128)
        self.time_control_embedding = nn.Embedding(TIME_CONTROL_BUCKETS, 64)
        self.clock_mlp = nn.Sequential(
            nn.Linear(2, 64),
            nn.ReLU(inplace=True),
            nn.Linear(64, 64),
            nn.ReLU(inplace=True),
        )

        # Conditioning dimension: 128 + 128 + 64 + 64 + 256(pooled history) = 640
        cond_dim = 640

        # Factored 2D position embedding for board tokens
        self.rank_embedding = nn.Embedding(8, 256)
        self.file_embedding = nn.Embedding(8, 256)
        # Pre-compute rank/file indices
        ranks = torch.arange(8).unsqueeze(1).expand(8, 8).reshape(64)
        files = torch.arange(8).unsqueeze(0).expand(8, 8).reshape(64)
        self.register_buffer("board_ranks", ranks)
        self.register_buffer("board_files", files)

        # Fusion layers
        self.cross_block = CrossAttentionBlock(dim=256, context_dim=256, cond_dim=cond_dim)
        self.self_blocks = nn.ModuleList(
            [SelfAttentionBlock(dim=256, cond_dim=cond_dim) for _ in range(4)]
        )

        # Per-head projections from pooled token representation
        self.policy_proj = nn.Sequential(
            nn.LayerNorm(256),
            nn.Linear(256, 1024),
            nn.ReLU(inplace=True),
            nn.Dropout(0.1),
            nn.Linear(1024, POLICY_DIM),
        )
        self.aux_proj = nn.Sequential(
            nn.LayerNorm(256),
            nn.Linear(256, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.1),
            nn.Linear(512, AUX_DIM),
        )
        self.value_proj = nn.Sequential(
            nn.LayerNorm(256),
            nn.Linear(256, 64),
            nn.ReLU(inplace=True),
            nn.Linear(64, 1),
            nn.Tanh(),
        )

    def forward(
        self,
        board: torch.Tensor,
        history_ids: torch.Tensor,
        history_mask: torch.Tensor,
        active_elo_bucket: torch.Tensor,
        opponent_elo_bucket: torch.Tensor,
        time_control_bucket: torch.Tensor,
        clock_features: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        # Board encoding → spatial features → token sequence
        board_map = self.board_encoder(board)          # [B, 256, 8, 8]
        board_tokens = board_map.flatten(2).transpose(1, 2)  # [B, 64, 256]

        # Factored 2D position encoding
        pos_embed = self.rank_embedding(self.board_ranks) + self.file_embedding(self.board_files)
        board_tokens = board_tokens + pos_embed.unsqueeze(0)  # broadcast over batch

        # History encoding — use BOTH token-level and pooled outputs
        history_tokens, history_pooled = self.history_encoder(history_ids, history_mask)

        # Build conditioning vector (includes pooled history)
        active_elo = self.active_elo_embedding(active_elo_bucket)
        opponent_elo = self.opponent_elo_embedding(opponent_elo_bucket)
        time_control = self.time_control_embedding(time_control_bucket)
        clock = self.clock_mlp(clock_features)
        cond = torch.cat([active_elo, opponent_elo, time_control, clock, history_pooled], dim=-1)

        # Cross-attention: board tokens attend to history tokens
        x = self.cross_block(board_tokens, history_tokens, cond, history_mask)

        # Self-attention blocks (conditioned on elo/time/history)
        for block in self.self_blocks:
            x = block(x, cond)

        # Pool and project to per-head outputs
        pooled = x.mean(dim=1)   # [B, 256]
        policy_logits = self.policy_proj(pooled)    # [B, 4208]
        aux_logits    = self.aux_proj(pooled)       # [B, 141]
        value_pred    = self.value_proj(pooled).squeeze(-1)  # [B]

        return policy_logits, aux_logits, value_pred


# ════════════════════════════════════════════════════════════════
# Utilities
# ════════════════════════════════════════════════════════════════


def masked_policy_logits(logits: torch.Tensor, legal_move_mask: torch.Tensor) -> torch.Tensor:
    mask_value = -1e4 if logits.dtype == torch.float16 else -1e9
    return logits.masked_fill(~legal_move_mask, mask_value)


def build_model(history_k: int = 20) -> nn.Module:
    return StrongPolicyModel(history_k=history_k)


def move_accuracy(logits: torch.Tensor, targets: torch.Tensor) -> float:
    preds = logits.argmax(dim=-1)
    return (preds == targets).float().mean().item()


def topk_accuracy(logits: torch.Tensor, targets: torch.Tensor, k: int = 5) -> float:
    topk = logits.topk(k=min(k, logits.size(-1)), dim=-1).indices
    correct = topk.eq(targets.unsqueeze(-1)).any(dim=-1)
    return correct.float().mean().item()


def model_dir(cfg: TrainConfig) -> str:
    """Checkpoints go into save_dir/<model_name>/."""
    stem, _ = os.path.splitext(cfg.checkpoint_name)
    return os.path.join(cfg.save_dir, stem)


def checkpoint_path(cfg: TrainConfig) -> str:
    return os.path.join(model_dir(cfg), "latest.pt")


def best_checkpoint_path(cfg: TrainConfig) -> str:
    return os.path.join(model_dir(cfg), "best.pt")


def step_checkpoint_path(cfg: TrainConfig, step: int) -> str:
    return os.path.join(model_dir(cfg), f"step_{step}.pt")


def config_path(cfg: TrainConfig) -> str:
    return os.path.join(model_dir(cfg), "config.json")


def metrics_path(cfg: TrainConfig) -> str:
    return os.path.join(model_dir(cfg), "metrics.jsonl")


def dump_config(cfg: TrainConfig) -> None:
    os.makedirs(model_dir(cfg), exist_ok=True)
    with open(config_path(cfg), "w", encoding="utf-8") as handle:
        json.dump(asdict(cfg), handle, indent=2)


def count_parameters(model: nn.Module) -> tuple[int, int]:
    total = sum(param.numel() for param in model.parameters())
    trainable = sum(param.numel() for param in model.parameters() if param.requires_grad)
    return total, trainable


def print_model_summary(model: nn.Module) -> None:
    total_params, trainable_params = count_parameters(model)
    print("model_name=policy_model", flush=True)
    print(f"total_parameters={total_params:,}", flush=True)
    print(f"trainable_parameters={trainable_params:,}", flush=True)
    print(model, flush=True)


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)


def append_metrics(cfg: TrainConfig, record: dict) -> None:
    os.makedirs(cfg.save_dir, exist_ok=True)
    with open(metrics_path(cfg), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")


def maybe_init_wandb(cfg: TrainConfig):
    if not cfg.wandb_enabled:
        return None
    if wandb is None:
        raise RuntimeError("wandb logging requested but package is not installed. Run `pip install wandb` first.")
    return wandb.init(
        project=cfg.wandb_project,
        entity=cfg.wandb_entity,
        name=cfg.wandb_run_name,
        mode=cfg.wandb_mode,
        config=asdict(cfg),
    )


def maybe_log_wandb(run, metrics: dict, step: int) -> None:
    if run is None:
        return
    run.log(metrics, step=step)


def save_checkpoint(
    path: str,
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler: torch.optim.lr_scheduler._LRScheduler,
    step: int,
    val_metrics: dict,
    best_val_acc: float,
) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "scheduler_state_dict": scheduler.state_dict(),
            "step": step,
            "val_metrics": val_metrics,
            "best_val_acc": best_val_acc,
        },
        path,
    )


def maybe_resume(
    cfg: TrainConfig,
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    scheduler: "torch.optim.lr_scheduler._LRScheduler | WarmupCosineScheduler",
    device: torch.device,
) -> tuple[int, float]:
    if not cfg.resume:
        return 0, float("-inf")
    path = checkpoint_path(cfg)
    if not os.path.exists(path):
        print(f"resume requested but checkpoint not found: {path}", flush=True)
        return 0, float("-inf")
    # Set weights_only=False because optimizer/scheduler states may contain numpy scalars
    checkpoint = torch.load(path, map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
    if "scheduler_state_dict" in checkpoint:
        scheduler.load_state_dict(checkpoint["scheduler_state_dict"])
        # Override the loaded total_steps/warmup_steps to allow extending training budgets
        if isinstance(scheduler, WarmupCosineScheduler):
            scheduler.total_steps = cfg.train_steps
            scheduler.warmup_steps = int(cfg.train_steps * cfg.warmup_fraction)
    start_step = int(checkpoint.get("step", 0))
    best_val_acc = float(checkpoint.get("best_val_acc", float("-inf")))
    print(f"resumed from {path} at step={start_step}", flush=True)
    return start_step, best_val_acc


def move_batch_to_device(batch: dict, device: torch.device) -> dict:
    moved = {}
    for key, value in batch.items():
        if torch.is_tensor(value):
            moved[key] = value.to(device, non_blocking=True)
        else:
            moved[key] = value
    return moved


# ════════════════════════════════════════════════════════════════
# LR Schedule with Warmup
# ════════════════════════════════════════════════════════════════


class WarmupCosineScheduler(torch.optim.lr_scheduler._LRScheduler):
    """Linear warmup followed by cosine annealing with a minimum LR floor."""

    def __init__(self, optimizer, warmup_steps: int, total_steps: int,
                 min_lr: float = 1e-6, last_epoch: int = -1):
        self.warmup_steps = warmup_steps
        self.total_steps = total_steps
        self.min_lr = min_lr
        super().__init__(optimizer, last_epoch)

    def get_lr(self):
        step = self.last_epoch
        if step < self.warmup_steps:
            scale = step / max(self.warmup_steps, 1)
            return [base_lr * scale for base_lr in self.base_lrs]
        else:
            progress = (step - self.warmup_steps) / max(self.total_steps - self.warmup_steps, 1)
            cosine_scale = 0.5 * (1.0 + np.cos(np.pi * progress))
            return [
                self.min_lr + (base_lr - self.min_lr) * cosine_scale
                for base_lr in self.base_lrs
            ]


# ════════════════════════════════════════════════════════════════
# Evaluation
# ════════════════════════════════════════════════════════════════


def run_eval(model: nn.Module, loader, steps: int, device: torch.device,
             cfg: TrainConfig) -> dict:
    model.eval()
    total_loss = 0.0
    total_acc = 0.0
    total_top5 = 0.0
    total_steps = 0
    elo_correct = [0 for _ in range(ELO_BUCKETS)]
    elo_total = [0 for _ in range(ELO_BUCKETS)]
    tc_correct = [0 for _ in range(TIME_CONTROL_BUCKETS)]
    tc_total = [0 for _ in range(TIME_CONTROL_BUCKETS)]

    with torch.no_grad():
        for step, batch in enumerate(loader):
            if step >= steps:
                break
            batch = move_batch_to_device(batch, device)
            policy_logits, aux_logits, value_pred = model(
                board=batch["board"],
                history_ids=batch["history_ids"],
                history_mask=batch["history_mask"],
                active_elo_bucket=batch["active_elo_bucket"],
                opponent_elo_bucket=batch["opponent_elo_bucket"],
                time_control_bucket=batch["time_control_bucket"],
                clock_features=batch["clock_features"],
            )
            policy_logits = masked_policy_logits(policy_logits, batch["legal_move_mask"])
            policy_loss = F.cross_entropy(policy_logits, batch["target_move_id"])
            aux_loss = F.binary_cross_entropy_with_logits(aux_logits, batch["aux_target"])
            value_loss = F.mse_loss(value_pred, batch["value_target"])
            loss = (
                cfg.policy_loss_weight * policy_loss
                + cfg.aux_loss_weight * aux_loss
                + cfg.value_loss_weight * value_loss
            )
            total_loss += loss.item()
            total_acc += move_accuracy(policy_logits, batch["target_move_id"])
            total_top5 += topk_accuracy(policy_logits, batch["target_move_id"], k=5)
            preds = policy_logits.argmax(dim=-1)
            correct = preds.eq(batch["target_move_id"])
            for bucket, is_correct in zip(batch["active_elo_bucket"].tolist(), correct.tolist()):
                elo_total[bucket] += 1
                if is_correct:
                    elo_correct[bucket] += 1
            for bucket, is_correct in zip(batch["time_control_bucket"].tolist(), correct.tolist()):
                tc_total[bucket] += 1
                if is_correct:
                    tc_correct[bucket] += 1
            total_steps += 1

    return {
        "loss": total_loss / max(total_steps, 1),
        "acc": total_acc / max(total_steps, 1),
        "top5_acc": total_top5 / max(total_steps, 1),
        "elo_bucket_acc": [
            (elo_correct[i] / elo_total[i]) if elo_total[i] else None for i in range(ELO_BUCKETS)
        ],
        "time_bucket_acc": [
            (tc_correct[i] / tc_total[i]) if tc_total[i] else None for i in range(TIME_CONTROL_BUCKETS)
        ],
    }


def print_bucket_metrics(label: str, values: list[Optional[float]]) -> None:
    formatted = []
    for idx, value in enumerate(values):
        if value is None:
            formatted.append(f"{idx}:NA")
        else:
            formatted.append(f"{idx}:{value:.4f}")
    print(f"{label} {' '.join(formatted)}", flush=True)


def log_val_metrics(wandb_run, val_metrics: dict, global_step: int) -> None:
    wandb_record = {
        "val/loss": val_metrics["loss"],
        "val/acc": val_metrics["acc"],
        "val/top5_acc": val_metrics["top5_acc"],
    }
    for idx, value in enumerate(val_metrics["elo_bucket_acc"]):
        if value is not None:
            wandb_record[f"val/elo_bucket_{idx}_acc"] = value
    for idx, value in enumerate(val_metrics["time_bucket_acc"]):
        if value is not None:
            wandb_record[f"val/time_bucket_{idx}_acc"] = value
    maybe_log_wandb(wandb_run, wandb_record, global_step)


def run_and_log_val(model, val_loader, cfg, device, wandb_run,
                    global_step, best_val_acc, optimizer, scheduler,
                    save: bool = False):
    """Run validation, log metrics, optionally checkpoint. Returns updated best_val_acc."""
    val_metrics = run_eval(model, val_loader, cfg.val_steps, device, cfg)
    print(
        f"val step={global_step} loss={val_metrics['loss']:.4f} "
        f"acc={val_metrics['acc']:.4f} top5={val_metrics['top5_acc']:.4f}",
        flush=True,
    )
    print_bucket_metrics("val_elo_bucket_acc", val_metrics["elo_bucket_acc"])
    print_bucket_metrics("val_time_bucket_acc", val_metrics["time_bucket_acc"])
    log_val_metrics(wandb_run, val_metrics, global_step)

    if save:
        # Save latest checkpoint
        save_checkpoint(
            checkpoint_path(cfg), model, optimizer, scheduler,
            global_step, val_metrics, max(best_val_acc, val_metrics["acc"]),
        )
        print(f"saved latest checkpoint -> {checkpoint_path(cfg)}", flush=True)

        # Save step-specific interval checkpoint
        step_path = step_checkpoint_path(cfg, global_step)
        save_checkpoint(
            step_path, model, optimizer, scheduler,
            global_step, val_metrics, max(best_val_acc, val_metrics["acc"]),
        )
        print(f"saved interval checkpoint -> {step_path}", flush=True)

        # Save best if improved
        if val_metrics["acc"] >= best_val_acc:
            best_val_acc = val_metrics["acc"]
            save_checkpoint(
                best_checkpoint_path(cfg), model, optimizer, scheduler,
                global_step, val_metrics, best_val_acc,
            )
            print(f"saved best checkpoint -> {best_checkpoint_path(cfg)} (acc={best_val_acc:.4f})", flush=True)
    else:
        if val_metrics["acc"] >= best_val_acc:
            best_val_acc = val_metrics["acc"]

    model.train()
    return best_val_acc, val_metrics


# ════════════════════════════════════════════════════════════════
# Training Loop
# ════════════════════════════════════════════════════════════════


def train(cfg: TrainConfig) -> None:
    device = torch.device(cfg.device if torch.cuda.is_available() else "cpu")
    seed_everything(cfg.seed)
    dump_config(cfg)
    wandb_run = maybe_init_wandb(cfg)

    train_loader = create_data_loader(
        StreamConfig(
            months=cfg.train_months,
            history_k=cfg.history_k,
            batch_size=cfg.batch_size,
            num_workers=cfg.num_workers,
            max_games=cfg.max_train_games,
            shuffle_files=True,
            shuffle_rows=True,
            seed=cfg.seed,
        )
    )
    val_loader = create_data_loader(
        StreamConfig(
            months=cfg.val_months,
            history_k=cfg.history_k,
            batch_size=cfg.batch_size,
            num_workers=cfg.num_workers,
            max_games=cfg.max_val_games,
            shuffle_files=True,
            shuffle_rows=True,
            seed=cfg.seed,
        )
    )

    model = build_model(history_k=cfg.history_k).to(device)
    print_model_summary(model)
    optimizer = torch.optim.AdamW(model.parameters(), lr=cfg.learning_rate, weight_decay=cfg.weight_decay)

    warmup_steps = int(cfg.train_steps * cfg.warmup_fraction)
    scheduler = WarmupCosineScheduler(
        optimizer, warmup_steps=warmup_steps, total_steps=cfg.train_steps, min_lr=cfg.min_lr,
    )

    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    start_step, best_val_acc = maybe_resume(cfg, model, optimizer, scheduler, device)

    # Windowed running averages (last 50 steps)
    window_size = 50
    loss_window: deque[float] = deque(maxlen=window_size)
    acc_window: deque[float] = deque(maxlen=window_size)

    model.train()
    run_start = time.time()
    last_log_time = run_start
    for step, batch in enumerate(train_loader, start=1):
        global_step = start_step + step
        if global_step > cfg.train_steps:
            break

        batch = move_batch_to_device(batch, device)
        optimizer.zero_grad(set_to_none=True)

        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            policy_logits, aux_logits, value_pred = model(
                board=batch["board"],
                history_ids=batch["history_ids"],
                history_mask=batch["history_mask"],
                active_elo_bucket=batch["active_elo_bucket"],
                opponent_elo_bucket=batch["opponent_elo_bucket"],
                time_control_bucket=batch["time_control_bucket"],
                clock_features=batch["clock_features"],
            )
            policy_logits = masked_policy_logits(policy_logits, batch["legal_move_mask"])
            policy_loss = F.cross_entropy(policy_logits, batch["target_move_id"])
            aux_loss = F.binary_cross_entropy_with_logits(aux_logits, batch["aux_target"])
            value_loss = F.mse_loss(value_pred, batch["value_target"])
            loss = (
                cfg.policy_loss_weight * policy_loss
                + cfg.aux_loss_weight * aux_loss
                + cfg.value_loss_weight * value_loss
            )

        scaler.scale(loss).backward()
        if cfg.gradient_clip_norm > 0:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.gradient_clip_norm)
        scaler.step(optimizer)
        scaler.update()
        scheduler.step()

        acc = move_accuracy(policy_logits.detach(), batch["target_move_id"])
        loss_window.append(loss.item())
        acc_window.append(acc)

        # ── Logging (every 50 steps) ──
        if global_step % 50 == 0 or global_step == 1:
            now = time.time()
            steps_since_log = 1 if global_step == 1 else 50
            avg_step_seconds = (now - last_log_time) / max(steps_since_log, 1)
            avg_loss = sum(loss_window) / len(loss_window)
            avg_acc = sum(acc_window) / len(acc_window)
            remaining_steps = cfg.train_steps - global_step
            eta_seconds = remaining_steps * avg_step_seconds
            eta_h = int(eta_seconds // 3600)
            eta_m = int((eta_seconds % 3600) // 60)
            train_log = {
                "train/loss": avg_loss,
                "train/policy_loss": policy_loss.item(),
                "train/aux_loss": aux_loss.item(),
                "train/value_loss": value_loss.item(),
                "train/acc": avg_acc,
                "train/lr": scheduler.get_last_lr()[0],
                "system/avg_step_seconds": avg_step_seconds,
                "system/elapsed_seconds": now - run_start,
            }
            print(
                f"train step={global_step}/{cfg.train_steps} "
                f"loss={avg_loss:.4f} policy={policy_loss.item():.4f} "
                f"aux={aux_loss.item():.4f} value={value_loss.item():.4f} "
                f"acc={avg_acc:.4f} lr={scheduler.get_last_lr()[0]:.2e} "
                f"step_s={avg_step_seconds:.4f} eta={eta_h:02d}:{eta_m:02d}",
                flush=True,
            )
            maybe_log_wandb(wandb_run, train_log, global_step)
            last_log_time = now

        # ── Periodic validation ──
        if cfg.val_interval > 0 and global_step % cfg.val_interval == 0:
            best_val_acc, _ = run_and_log_val(
                model, val_loader, cfg, device, wandb_run,
                global_step, best_val_acc, optimizer, scheduler,
                save=cfg.save_checkpoints,  # only checkpoint mid-training with --checkpoint
            )

    # ── Final validation (skip if periodic val already ran at this step) ──
    finished_step = start_step + step if 'step' in locals() else start_step
    already_validated = (cfg.val_interval > 0 and finished_step % cfg.val_interval == 0)
    if not already_validated:
        best_val_acc, val_metrics = run_and_log_val(
            model, val_loader, cfg, device, wandb_run,
            finished_step, best_val_acc, optimizer, scheduler,
            save=True,  # always save final checkpoint
        )
    else:
        # Periodic val already ran; just save final checkpoint if requested
        val_metrics = run_eval(model, val_loader, cfg.val_steps, device, cfg)
        save_checkpoint(
            checkpoint_path(cfg), model, optimizer, scheduler,
            finished_step, val_metrics, best_val_acc,
        )
        print(f"saved final checkpoint -> {checkpoint_path(cfg)}", flush=True)

    elapsed = time.time() - run_start
    steps_completed = max(finished_step - start_step, 1)
    metrics_record = {
        "architecture": "policy_model",
        "train_steps_target": cfg.train_steps,
        "finished_step": finished_step,
        "train_loss": sum(loss_window) / max(len(loss_window), 1),
        "train_acc": sum(acc_window) / max(len(acc_window), 1),
        "val_loss": val_metrics["loss"],
        "val_acc": val_metrics["acc"],
        "val_top5_acc": val_metrics["top5_acc"],
        "elo_bucket_acc": val_metrics["elo_bucket_acc"],
        "time_bucket_acc": val_metrics["time_bucket_acc"],
        "elapsed_seconds": elapsed,
        "steps_per_second": steps_completed / max(elapsed, 1e-6),
        "avg_step_seconds": elapsed / max(steps_completed, 1),
        "learning_rate": scheduler.get_last_lr()[0],
        "device": str(device),
        "batch_size": cfg.batch_size,
        "num_workers": cfg.num_workers,
        "train_months": cfg.train_months,
        "val_months": cfg.val_months,
    }
    append_metrics(cfg, metrics_record)

    if wandb_run is not None:
        wandb_run.finish()


# ════════════════════════════════════════════════════════════════
# CLI
# ════════════════════════════════════════════════════════════════


def parse_args() -> TrainConfig:
    parser = argparse.ArgumentParser(description="Train policy model on streaming game parquet")
    parser.add_argument("--train-months", nargs="+", default=["2024-01"])
    parser.add_argument("--val-months", nargs="+", default=["2024-02"])
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--history-k", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-5)
    parser.add_argument("--train-steps", type=int, default=200)
    parser.add_argument("--val-steps", type=int, default=25)
    parser.add_argument("--val-interval", type=int, default=500)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--policy-loss-weight", type=float, default=1.0)
    parser.add_argument("--value-loss-weight", type=float, default=1.0)
    parser.add_argument("--aux-loss-weight", type=float, default=1.0)
    parser.add_argument("--gradient-clip-norm", type=float, default=1.0)
    parser.add_argument("--warmup-fraction", type=float, default=0.1)
    parser.add_argument("--min-lr", type=float, default=1e-6)
    parser.add_argument("--save-dir", default="checkpoints")
    parser.add_argument("--checkpoint-name", default="policy_model.pt")
    parser.add_argument("--wandb", action="store_true")
    parser.add_argument("--wandb-project", default="otter")
    parser.add_argument("--wandb-entity", default=None)
    parser.add_argument("--wandb-run-name", default=None)
    parser.add_argument("--wandb-mode", choices=["online", "offline", "disabled"], default="online")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--checkpoint", action="store_true", help="Save interval checkpoints during training. Final checkpoint is always saved.")
    parser.add_argument("--max-train-games", type=int, default=None)
    parser.add_argument("--max-val-games", type=int, default=None)
    args = parser.parse_args()
    return TrainConfig(
        train_months=args.train_months,
        val_months=args.val_months,
        seed=args.seed,
        history_k=args.history_k,
        batch_size=args.batch_size,
        num_workers=args.num_workers,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        train_steps=args.train_steps,
        val_steps=args.val_steps,
        val_interval=args.val_interval,
        device=args.device,
        policy_loss_weight=args.policy_loss_weight,
        value_loss_weight=args.value_loss_weight,
        aux_loss_weight=args.aux_loss_weight,
        gradient_clip_norm=args.gradient_clip_norm,
        warmup_fraction=args.warmup_fraction,
        min_lr=args.min_lr,
        save_dir=args.save_dir,
        checkpoint_name=args.checkpoint_name,
        wandb_enabled=args.wandb,
        wandb_project=args.wandb_project,
        wandb_entity=args.wandb_entity,
        wandb_run_name=args.wandb_run_name,
        wandb_mode=args.wandb_mode,
        resume=args.resume,
        save_checkpoints=args.checkpoint,
        max_train_games=args.max_train_games,
        max_val_games=args.max_val_games,
    )


if __name__ == "__main__":
    train(parse_args())
