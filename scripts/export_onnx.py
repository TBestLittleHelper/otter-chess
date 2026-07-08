#!/usr/bin/env python3
import os
import argparse
import torch
import torch.nn as nn
from otter.model import StrongPolicyModel

def main():
    parser = argparse.ArgumentParser(description="Export PyTorch Otter model to ONNX format")
    parser.add_argument("--checkpoint", type=str, default="/home/azureuser/sage/checkpoints/policy_model_v2_3m_final/best.pt", help="Path to PyTorch checkpoint (.pt)")
    parser.add_argument("--output", type=str, default="/home/azureuser/sage/otter final/docs/policy_model.onnx", help="Output path for the exported .onnx model")
    args = parser.parse_args()

    if not os.path.exists(args.checkpoint):
        print(f"Error: Checkpoint file not found at {args.checkpoint}")
        return 1

    print(f"Loading PyTorch checkpoint from {args.checkpoint}...")
    model = StrongPolicyModel(history_k=20)
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    print("Preparing dummy inputs for ONNX export...")
    dummy_board = torch.zeros(1, 18, 8, 8, dtype=torch.float32)
    dummy_history_ids = torch.zeros(1, 20, dtype=torch.long)
    dummy_history_mask = torch.ones(1, 20, dtype=torch.bool)
    dummy_active_elo = torch.zeros(1, dtype=torch.long)
    dummy_opponent_elo = torch.zeros(1, dtype=torch.long)
    dummy_tc = torch.zeros(1, dtype=torch.long)
    dummy_clock = torch.zeros(1, 2, dtype=torch.float32)

    dummy_inputs = (
        dummy_board,
        dummy_history_ids,
        dummy_history_mask,
        dummy_active_elo,
        dummy_opponent_elo,
        dummy_tc,
        dummy_clock
    )

    print(f"Exporting model to ONNX format at {args.output} (using legacy TorchScript exporter)...")
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    
    # We specify dynamo=False to use the legacy JIT-based exporter, bypassing dynamo strict compilation
    torch.onnx.export(
        model,
        dummy_inputs,
        args.output,
        export_params=True,
        opset_version=15, # Stable opset version supporting standard operators
        do_constant_folding=True,
        dynamo=False,     # CRITICAL: Bypass PyTorch 2.1+ dynamo/compile backend
        input_names=[
            "board",
            "history_ids",
            "history_mask",
            "active_elo",
            "opponent_elo",
            "tc",
            "clock"
        ],
        output_names=["policy_logits", "aux_logits", "value_pred"],
        dynamic_axes={
            "board": {0: "batch_size"},
            "history_ids": {0: "batch_size"},
            "history_mask": {0: "batch_size"},
            "active_elo": {0: "batch_size"},
            "opponent_elo": {0: "batch_size"},
            "tc": {0: "batch_size"},
            "clock": {0: "batch_size"},
            "policy_logits": {0: "batch_size"},
            "aux_logits": {0: "batch_size"},
            "value_pred": {0: "batch_size"}
        }
    )

    print("✓ ONNX export complete successfully!")
    return 0

if __name__ == "__main__":
    import sys
    sys.exit(main())
