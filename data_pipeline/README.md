# data_pipeline

Rust tool that converts Lichess PGN dumps into the partitioned Parquet format described in
[`data/README.md`](../data/README.md). It filters for rated rapid games, buckets players by
Elo, and writes one Parquet file per `(month, elo_band)` partition.

## Build

Requires Rust and Cargo.

```bash
cd data_pipeline
cargo build --release
```

This produces `target/release/otter_pipeline` (`otter_pipeline.exe` on Windows).

## Run

```bash
./target/release/otter_pipeline <data_dir> <output_dir> [--smoke]
```

- `data_dir` — directory containing Lichess monthly dumps named `YYYY-MM.pgn.zst`
  (e.g. from [database.lichess.org](https://database.lichess.org)).
- `output_dir` — directory to write partitioned Parquet output to
  (`month=.../elo_band=.../part-*.parquet`), typically the repo's `../data` directory.
- `--smoke` — process only the first month and the first rapid game found, as a quick
  sanity check that parsing and export work end-to-end.

Months are processed in parallel via `rayon`. Example:

```bash
./target/release/otter_pipeline /path/to/lichess_dumps /path/to/project/data
```

See [`data/README.md`](../data/README.md) for the exact output schema and Elo band mapping.
