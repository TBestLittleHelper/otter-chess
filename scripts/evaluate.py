#!/usr/bin/env python3
"""
Standalone validation script — loads a checkpoint and evaluates on any month(s).
Read-only: never writes checkpoints or modifies any files.

Usage:
    python3 validation.py \
        --checkpoint ../checkpoints/policy_model_v2_3m_final/best.pt \
        --val-months 2025-02 \
        --val-steps 500
"""
import argparse
import os
import sys

import torch

from train import (
    POLICY_DIM, ELO_BUCKETS, AUX_DIM, TIME_CONTROL_BUCKETS,
    TrainConfig,
    build_model,
    create_data_loader, StreamConfig,
    run_eval,
    print_bucket_metrics,
)


def main():
    parser = argparse.ArgumentParser(description="Evaluate a checkpoint on validation data.")
    parser.add_argument("--checkpoint", type=str, required=True, help="Path to .pt checkpoint file")
    parser.add_argument("--val-months", nargs="+", required=True, help="Month(s) to validate on, e.g. 2025-02")
    parser.add_argument("--val-steps", type=int, default=500, help="Number of validation batches")
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--history-k", type=int, default=20)
    parser.add_argument("--device", type=str, default="cuda")
    parser.add_argument("--seed", type=int, default=1337)
    args = parser.parse_args()

    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    print(f"device: {device}", flush=True)
    print(f"checkpoint: {args.checkpoint}", flush=True)
    print(f"val months: {args.val_months}", flush=True)

    # Load model
    model = build_model(history_k=args.history_k).to(device)
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])
    step = ckpt.get("step", "?")
    print(f"loaded checkpoint at step={step}", flush=True)

    # Build a minimal cfg for run_eval (only the loss weights matter)
    cfg = TrainConfig(
        train_months=args.val_months,
        val_months=args.val_months,
        history_k=args.history_k,
        batch_size=args.batch_size,
        num_workers=args.num_workers,
        val_steps=args.val_steps,
        device=args.device,
        seed=args.seed,
    )

    val_loader = create_data_loader(
        StreamConfig(
            months=args.val_months,
            history_k=args.history_k,
            batch_size=args.batch_size,
            num_workers=args.num_workers,
            shuffle_files=True,
            shuffle_rows=True,
            seed=args.seed,
        )
    )

    print(f"\nrunning validation on {args.val_steps} batches...", flush=True)
    metrics = run_eval(model, val_loader, args.val_steps, device, cfg)

    print(f"\n--- Results ---")
    print(f"loss:     {metrics['loss']:.4f}")
    print(f"acc:      {metrics['acc']:.4f}")
    print(f"top5_acc: {metrics['top5_acc']:.4f}")
    print_bucket_metrics("elo_bucket_acc ", metrics["elo_bucket_acc"])
    print_bucket_metrics("time_bucket_acc", metrics["time_bucket_acc"])


if __name__ == "__main__":
    main()
