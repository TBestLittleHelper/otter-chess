# otter-chess

Otter is a skill-conditioned chess move prediction model. It predicts the move a
player of a given Elo rating would actually make in a position — conditioned on
game history, time control, and remaining clock — rather than the objectively
strongest move.

The model has 15.3M parameters and reaches 55.70% top-1 move accuracy, compared
to Maia 2's reported 53.25%, using 34% fewer parameters and 33% less training
data.

- Repository: https://github.com/PeargentLabs/Otter-Chess
- Play it in your browser: https://peargentlabs.github.io/Otter-Chess/play
- Weights: https://huggingface.co/peargentlabs/otter-chess

## Installation

```bash
pip install otter-chess
```

Note the import name uses an underscore, per the usual Python convention:

```python
from otter_chess import OtterModel
```

## Model weights

Weights are **not** bundled in this package — they are resolved on first use.
`OtterModel()` checks `~/.cache/otter-chess/`, then known local fallback paths,
and only then downloads `model.safetensors` from Hugging Face, caching it for
subsequent runs.

```python
from otter_chess import OtterModel

# Auto-resolve: cache -> local fallbacks -> download
model = OtterModel()

# Or point at a local checkpoint (.safetensors or .pt)
model = OtterModel(checkpoint_path="/path/to/my_weights.safetensors")

# Or override the remote source
model = OtterModel(
    download_url="https://huggingface.co/peargentlabs/otter-chess/resolve/main/model.safetensors"
)
```

`OtterModel(checkpoint_path=None, device="cpu", history_k=20, download_url=None)`

## Predicting a move

```python
result = model.predict(
    fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    player_elo=1800,                  # Elo of the side to move
    opponent_elo=1800,
    history_moves=["e2e4", "e7e5"],   # previous moves, UCI
    time_control="600+0",
    clock_fraction=0.8,               # remaining clock, 0.0-1.0
    top_k=5,
)

print(result["win_probability"])
for move in result["moves"]:
    print(move["move"], f"{move['probability']:.2%}")
```

Every argument has a default, so `model.predict()` alone evaluates the starting
position at 1500 Elo. `time_remaining` (seconds) may be passed instead of
`clock_fraction`.

### Return value

```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "win_probability": -0.0906,
  "moves": [
    { "move": "e2e4", "probability": 0.3956 },
    { "move": "g1f3", "probability": 0.1854 }
  ],
  "aux_predictions": {
    "moving_piece": "Pawn",
    "moving_piece_confidence": 0.387,
    "captured_piece": "None",
    "captured_piece_confidence": 0.747,
    "results_in_check_probability": 0.0,
    "from_square": "e2",
    "from_square_confidence": 0.387,
    "to_square": "e4",
    "to_square_confidence": 0.239
  }
}
```

`win_probability` is the value head's output over [-1, +1] from the perspective
of the side to move. `moves` is the policy head's top-`k` candidates. The
auxiliary head predicts move attributes (piece moved, piece captured, whether
the move gives check, and from/to squares).

## Requirements

Python 3.10+. Installs `torch`, `safetensors`, `fastchess`, and `numpy`.

The training, evaluation, and ONNX-export scripts in the repository need
additional packages — see `scripts/requirements.txt` there.

## License

MIT
