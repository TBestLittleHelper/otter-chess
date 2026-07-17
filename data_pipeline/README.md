# data_pipeline

Rust tool that converts Lichess PGN dumps into the partitioned Parquet format described in
[`data/README.md`](../data/README.md). It filters for rated rapid games, buckets players by
Elo, and writes one Parquet file per `(month, elo_band)` partition.

## How it Works

When executed, the pipeline performs the following steps:

1. **Discovery**: Scans `<data_dir>` for compressed Lichess dumps matching the pattern `YYYY-MM.pgn.zst` to identify months of data to process.
2. **Parallel Execution**: Processes each month's file in parallel across CPU cores using `rayon`.
3. **Streaming & Decompression**: Reads the compressed `.pgn.zst` files on the fly (decompressing in memory) and streams the games through a zero-allocation PGN parser.
4. **Filtering**: Checks the `Event` header of each game, discarding all formats except `"Rated Rapid game"`.
5. **Feature Extraction**: Extracts the following attributes for every matching game:
   - **Metadata**: White/Black usernames, player Elos, game result, time control config, and opening code.
   - **SAN Moves**: The sequence of game moves recorded in Standard Algebraic Notation (joined by spaces).
   - **Clocks**: The remaining clock time at each move extracted from comments (joined by `|`).
6. **Elo Bucketing**: Computes the average Elo of both players and classifies the game into one of the 9 partitioned brackets (`elo_band=0` to `8`).
7. **Batched Writing**: Buffers games in memory and flushes them in batches of 100,000. It writes these batches to disk under the partitioned Hive structure (`month=.../elo_band=.../`) as highly compressed Parquet files using Arrow writers.

## Build

Requires Rust and Cargo.

```bash
cd data_pipeline
cargo build --release
```

This produces `target/release/otter_pipeline` on Linux/macOS (or `otter_pipeline.exe` on Windows).

---

## Raw Data Preparation

The raw Lichess PGN dumps (`YYYY-MM.pgn.zst`) are extremely large (ranging from 5GB to over 30GB compressed per month) and are therefore **not included** in this repository.

To obtain the raw data:
1. Visit the [Lichess Open Database](https://database.lichess.org).
2. Choose the month(s) you wish to train/validate on (e.g. Standard Rated games from January 2024).
3. Download the `.pgn.zst` files into a local folder of your choice (e.g. a temporary `/path/to/lichess_dumps` folder).

Alternatively, you can download standard monthly files directly using `curl`:
```bash
# Create a temporary directory for raw dumps
mkdir raw_dumps

# Download January 2024 dump (approx 5.5 GB compressed)
curl -o raw_dumps/2024-01.pgn.zst https://database.lichess.org/standard/lichess_db_standard_rated_2024-01.pgn.zst
```

> [!NOTE]
> You do **not** need to manually decompress the downloaded `.pgn.zst` files. The Rust exporter pipeline decompresses and parses the archive stream on-the-fly in memory.

---

## Run

```bash
./target/release/otter_pipeline <data_dir> <output_dir> [--smoke]
```

* **`<data_dir>`** — Directory containing raw monthly Lichess PGN database dumps compressed with Zstandard, matching the filename format `YYYY-MM.pgn.zst` (e.g. downloaded from [database.lichess.org](https://database.lichess.org)).
* **`<output_dir>`** — Path where the generated data files will be written. This is typically the repository's `../data` folder.
* **`--smoke`** — Flag to run a smoke test. It processes only the first month, extracts the first rapid game, prints its metadata/moves, and immediately exits.

---

## Output Format & Directory Partitioning

The pipeline generates directories and files using Hive-style partitioning. Under the specified `<output_dir>`, the files are structured as follows:

```text
<output_dir>/
└── month={YYYY-MM}/
    └── elo_band={0-8}/
        └── part-{index}.parquet
```

* **`month={YYYY-MM}`**: The month of the games (e.g. `month=2024-01`).
* **`elo_band={0-8}`**: The rating band computed from the average of White and Black's Elo ratings.
* **`part-{index}.parquet`**: Columnar Parquet shards. The `index` is a 6-digit, zero-padded, incrementing integer starting from `000000` (flushed every 100,000 rapid games per month/band partition).

---

## Parquet Schema Specification

Each exported `.parquet` file contains Arrow Record Batches with the following column structure:

| Column Name | Arrow/Parquet Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `month` | `Utf8` (String) | Month identifier | `"2024-01"` |
| `elo_band` | `Int64` | Elo band index (0 to 8) | `6` |
| `event` | `Utf8` (String) | Lichess game category (always `"Rated Rapid game"`) | `"Rated Rapid game"` |
| `white` | `Utf8` (String) | Username of the White player | `"Hikaru"` |
| `black` | `Utf8` (String) | Username of the Black player | `"Magnus"` |
| `result` | `Utf8` (String) | Game outcome | `"1-0"`, `"0-1"`, or `"1/2-1/2"` |
| `time_control` | `Utf8` (String) | Base time limit in seconds + increment in seconds | `"600+0"`, `"180+2"` |
| `opening` | `Utf8` (String) | ECO opening code | `"C00"` |
| `white_elo` | `Int64` | White player rating | `2100` |
| `black_elo` | `Int64` | Black player rating | `2050` |
| `avg_elo` | `Int64` | Average Elo of both players | `2075` |
| `moves_san` | `Utf8` (String) | Space-separated moves in Standard Algebraic Notation | `"e4 e5 Nf3 Nc6 Bb5"` |
| `move_clocks` | `Utf8` (String) | Pipe-separated (`\|`) remaining clocks in `H:MM:SS` format | `"0:10:00\|0:09:58\|0:09:55\|0:09:50\|0:09:47"` |

---

## Average Elo Band Mapping

Average Elo rating of the two players is classified into 9 bands:

| Band Index | Average Elo Range |
| :---: | :--- |
| **`0`** | $< 1000$ |
| **`1`** | $1000 - 1199$ |
| **`2`** | $1200 - 1399$ |
| **`3`** | $1400 - 1599$ |
| **`4`** | $1600 - 1799$ |
| **`5`** | $1800 - 1999$ |
| **`6`** | $2000 - 2199$ |
| **`7`** | $2200 - 2399$ |
| **`8`** | $\ge 2400$ |
