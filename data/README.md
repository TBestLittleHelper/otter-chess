# Training Data Specification

Otter's streaming training pipeline expects data partitioned by month and Elo rating band using Hive-style directory partitioning.

---

## Directory Structure

The files must be saved under the `data/` directory using the following folder structure:

```text
data/
└── month={YYYY-MM}/
    └── elo_band={0-8}/
        └── part-{index}.parquet
```

For example:
* `data/month=2024-01/elo_band=5/part-000000.parquet`
* `data/month=2024-01/elo_band=6/part-000000.parquet`

---

## Parquet Schema

Each `.parquet` file contains Arrow record batches with the following schema:

| Column Name | Data Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `month` | `Utf8` (String) | Month identifier | `"2024-01"` |
| `elo_band` | `Int64` | Elo band category index (see mapping below) | `5` |
| `event` | `Utf8` (String) | Lichess game speed/type category | `"Rated Rapid game"` |
| `white` | `Utf8` (String) | Username of the White player | `"Hikaru"` |
| `black` | `Utf8` (String) | Username of the Black player | `"Magnus"` |
| `result` | `Utf8` (String) | Game result | `"1-0"`, `"0-1"`, or `"1/2-1/2"` |
| `time_control` | `Utf8` (String) | Time control limit in seconds + increment | `"600+0"`, `"180+2"` |
| `opening` | `Utf8` (String) | Opening name or ECO code | `"C00"` |
| `white_elo` | `Int64` | White player rating | `2100` |
| `black_elo` | `Int64` | Black player rating | `2050` |
| `avg_elo` | `Int64` | Average Elo of white and black | `2075` |
| `moves_san` | `Utf8` (String) | Space-separated list of SAN moves | `"e4 e5 Nf3 Nc6 Bb5"` |
| `move_clocks` | `Utf8` (String) | Pipe-separated (`\|`) list of remaining clock times | `"0:10:00\|0:09:58\|0:09:55"` |

---

## Elo Band Mapping

The `elo_band` field divides players into 9 separate brackets based on their `avg_elo` rating:

| `elo_band` | Avg Elo Range |
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

---

## How to Generate Data

Data is generated from raw Lichess PGN dumps (e.g. from `database.lichess.org`). 

You can use the Rust conversion pipeline in the main repository under `data_pipeline/`:
1. Compile the pipeline in release mode: `cargo build --release`.
2. Run it on PGN files to extract rapid games and export them directly to partitioned Parquet files:
   ```bash
   ./target/release/data_pipeline --pgn /path/to/lichess.pgn --out-dir /path/to/project/data
   ```
