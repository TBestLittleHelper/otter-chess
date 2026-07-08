use anyhow::{Context, Result};
use arrow::array::{Int64Array, StringArray};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use parquet::arrow::ArrowWriter;
use parquet::file::properties::WriterProperties;
use pgn_reader::{RawComment, Reader, SanPlus, Skip, Visitor};
use rayon::prelude::*;
use std::fs::{self, File};
use std::io::{BufReader, Write};
use std::ops::ControlFlow;
use std::path::PathBuf;
use std::sync::Arc;

const BATCH_SIZE: usize = 100_000;

#[derive(Default, Clone)]
struct GameMeta {
    month: String,
    event: String,
    white: String,
    black: String,
    result: String,
    time_control: String,
    opening: String,
    white_elo: i64,
    black_elo: i64,
}

#[derive(Clone)]
struct GameRow {
    month: String,
    elo_band: i64,
    event: String,
    white: String,
    black: String,
    result: String,
    time_control: String,
    opening: String,
    white_elo: i64,
    black_elo: i64,
    avg_elo: i64,
    moves_san: String,
    move_clocks: String,
}

fn elo_band(avg_elo: i64) -> i64 {
    match avg_elo {
        i if i < 1000 => 0,
        i if i < 1200 => 1,
        i if i < 1400 => 2,
        i if i < 1600 => 3,
        i if i < 1800 => 4,
        i if i < 2000 => 5,
        i if i < 2200 => 6,
        i if i < 2400 => 7,
        _ => 8,
    }
}

fn extract_clk(comment: &str) -> Option<String> {
    let needle = "[%clk ";
    let start = comment.find(needle)? + needle.len();
    let rest = &comment[start..];
    let end = rest.find(']')?;
    Some(rest[..end].trim().to_string())
}

struct RapidExporter {
    month: String,
    output_dir: PathBuf,
    seen_games: usize,
    rapid_games: usize,
    rows: Vec<GameRow>,
    current: GameMeta,
    flush_seq: usize,
}

#[derive(Default)]
struct MovetextData {
    keep: bool,
    san_moves: Vec<String>,
    clocks: Vec<String>,
}

impl RapidExporter {
    fn new(month: &str, output_dir: PathBuf) -> Self {
        Self {
            month: month.to_string(),
            output_dir,
            seen_games: 0,
            rapid_games: 0,
            rows: Vec::new(),
            current: GameMeta {
                month: month.to_string(),
                ..Default::default()
            },
            flush_seq: 0,
        }
    }

    fn flush(&mut self) -> Result<()> {
        if self.rows.is_empty() {
            return Ok(());
        }

        let mut by_band: [Vec<GameRow>; 9] = Default::default();
        for row in self.rows.drain(..) {
            by_band[row.elo_band as usize].push(row);
        }

        for (band, rows) in by_band.into_iter().enumerate() {
            if rows.is_empty() {
                continue;
            }

            let out_dir = self
                .output_dir
                .join(format!("month={}", self.month))
                .join(format!("elo_band={}", band));
            fs::create_dir_all(&out_dir)?;
            let out_path = out_dir.join(format!("part-{:06}.parquet", self.flush_seq));

            let schema = Arc::new(Schema::new(vec![
                Field::new("month", DataType::Utf8, false),
                Field::new("elo_band", DataType::Int64, false),
                Field::new("event", DataType::Utf8, false),
                Field::new("white", DataType::Utf8, false),
                Field::new("black", DataType::Utf8, false),
                Field::new("result", DataType::Utf8, false),
                Field::new("time_control", DataType::Utf8, false),
                Field::new("opening", DataType::Utf8, false),
                Field::new("white_elo", DataType::Int64, false),
                Field::new("black_elo", DataType::Int64, false),
                Field::new("avg_elo", DataType::Int64, false),
                Field::new("moves_san", DataType::Utf8, false),
                Field::new("move_clocks", DataType::Utf8, false),
            ]));

            let batch = RecordBatch::try_new(
                schema.clone(),
                vec![
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.month.as_str()))),
                    Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.elo_band))),
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.event.as_str()))),
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.white.as_str()))),
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.black.as_str()))),
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.result.as_str()))),
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.time_control.as_str()))),
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.opening.as_str()))),
                    Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.white_elo))),
                    Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.black_elo))),
                    Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.avg_elo))),
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.moves_san.as_str()))),
                    Arc::new(StringArray::from_iter_values(rows.iter().map(|r| r.move_clocks.as_str()))),
                ],
            )?;

            let file = File::create(&out_path)?;
            let props = WriterProperties::builder().build();
            let mut writer = ArrowWriter::try_new(file, schema, Some(props))?;
            writer.write(&batch)?;
            writer.close()?;

            println!("wrote {} games -> {}", rows.len(), out_path.display());
        }

        self.flush_seq += 1;
        Ok(())
    }
}

impl Visitor for RapidExporter {
    type Tags = GameMeta;
    type Movetext = MovetextData;
    type Output = Result<()>;

    fn begin_tags(&mut self) -> ControlFlow<Self::Output, Self::Tags> {
        ControlFlow::Continue(GameMeta {
            month: self.month.clone(),
            ..Default::default()
        })
    }

    fn tag(
        &mut self,
        tags: &mut Self::Tags,
        name: &[u8],
        value: pgn_reader::RawTag<'_>,
    ) -> ControlFlow<Self::Output> {
        let k = String::from_utf8_lossy(name);
        let v = String::from_utf8_lossy(value.as_bytes()).to_string();
        match k.as_ref() {
            "Event" => tags.event = v,
            "White" => tags.white = v,
            "Black" => tags.black = v,
            "Result" => tags.result = v,
            "TimeControl" => tags.time_control = v,
            "Opening" => tags.opening = v,
            "WhiteElo" => tags.white_elo = v.parse().unwrap_or(0),
            "BlackElo" => tags.black_elo = v.parse().unwrap_or(0),
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn begin_movetext(
        &mut self,
        tags: Self::Tags,
    ) -> ControlFlow<Self::Output, Self::Movetext> {
        self.seen_games += 1;
        self.current = tags.clone();
        let keep = tags.event == "Rated Rapid game";
        if keep {
            self.rapid_games += 1;
        }
        ControlFlow::Continue(MovetextData {
            keep,
            ..Default::default()
        })
    }

    fn san(
        &mut self,
        movetext: &mut Self::Movetext,
        san_plus: SanPlus,
    ) -> ControlFlow<Self::Output> {
        if movetext.keep {
            movetext.san_moves.push(san_plus.san.to_string());
        }
        ControlFlow::Continue(())
    }

    fn comment(
        &mut self,
        movetext: &mut Self::Movetext,
        comment: RawComment<'_>,
    ) -> ControlFlow<Self::Output> {
        if movetext.keep {
            let text = String::from_utf8_lossy(comment.as_bytes()).to_string();
            if let Some(clk) = extract_clk(&text) {
                movetext.clocks.push(clk);
            }
        }
        ControlFlow::Continue(())
    }

    fn begin_variation(
        &mut self,
        _movetext: &mut Self::Movetext,
    ) -> ControlFlow<Self::Output, Skip> {
        ControlFlow::Continue(Skip(true))
    }

    fn end_game(&mut self, movetext: Self::Movetext) -> Self::Output {
        if movetext.keep {
            let avg_elo = if self.current.white_elo > 0 && self.current.black_elo > 0 {
                (self.current.white_elo + self.current.black_elo) / 2
            } else {
                0
            };

            self.rows.push(GameRow {
                month: self.current.month.clone(),
                elo_band: elo_band(avg_elo),
                event: self.current.event.clone(),
                white: self.current.white.clone(),
                black: self.current.black.clone(),
                result: self.current.result.clone(),
                time_control: self.current.time_control.clone(),
                opening: self.current.opening.clone(),
                white_elo: self.current.white_elo,
                black_elo: self.current.black_elo,
                avg_elo,
                moves_san: movetext.san_moves.join(" "),
                move_clocks: movetext.clocks.join("|"),
            });

            if self.rows.len() >= BATCH_SIZE {
                self.flush()?;
            }
        }

        if self.seen_games % 1_000_000 == 0 {
            println!(
                "month={} seen_games={} rapid_games={} buffered_rows={}",
                self.month, self.seen_games, self.rapid_games, self.rows.len()
            );
        }

        Ok(())
    }
}

/// Discover months by scanning for YYYY-MM.pgn.zst files in data_dir.
fn discover_months(data_dir: &PathBuf) -> Result<Vec<String>> {
    let mut months = Vec::new();
    for entry in fs::read_dir(data_dir)
        .with_context(|| format!("read data dir {}", data_dir.display()))?
    {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(month) = name.strip_suffix(".pgn.zst") {
            months.push(month.to_string());
        }
    }
    months.sort();
    Ok(months)
}

fn process_month(month: &str, data_dir: &PathBuf, output_dir: &PathBuf, smoke: bool) -> Result<()> {
    let path = data_dir.join(format!("{}.pgn.zst", month));
    println!("reading {}", path.display());

    let file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
    let decoder = zstd::stream::read::Decoder::new(BufReader::new(file))?;
    let mut reader = Reader::new(decoder);
    let mut exporter = RapidExporter::new(month, output_dir.clone());

    loop {
        match reader.read_game(&mut exporter) {
            Ok(Some(_)) => {
                if smoke && exporter.rapid_games >= 1 {
                    break;
                }
            }
            Ok(None) => break,
            Err(err) => {
                eprintln!("month={} parse error: {}", month, err);
                break;
            }
        }
    }

    exporter.flush()?;
    println!(
        "done month={} seen_games={} rapid_games={}",
        month, exporter.seen_games, exporter.rapid_games
    );
    Ok(())
}

fn print_usage() {
    eprintln!("Usage: otter_pipeline <data_dir> <output_dir> [--smoke]");
    eprintln!();
    eprintln!("  data_dir    Directory containing YYYY-MM.pgn.zst files (Lichess dumps)");
    eprintln!("  output_dir  Directory to write parquet output (month=.../elo_band=.../part-*.parquet)");
    eprintln!("  --smoke     Process only the first month, first rapid game (quick sanity check)");
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    let (data_dir, output_dir, smoke) = match args.as_slice() {
        [_, data, output] => (PathBuf::from(data), PathBuf::from(output), false),
        [_, data, output, flag] if flag == "--smoke" => {
            (PathBuf::from(data), PathBuf::from(output), true)
        }
        _ => {
            print_usage();
            std::process::exit(1);
        }
    };

    let months = discover_months(&data_dir)?;
    if months.is_empty() {
        anyhow::bail!("no .pgn.zst files found in {}", data_dir.display());
    }
    println!("discovered {} months: {:?}", months.len(), months);

    fs::create_dir_all(&output_dir)?;

    if smoke {
        let month = &months[0];
        return process_month(month, &data_dir, &output_dir, true);
    }

    months.par_iter().for_each(|month| {
        if let Err(err) = process_month(month, &data_dir, &output_dir, false) {
            eprintln!("skip month={} error={}", month, err);
        }
    });

    std::io::stdout().flush().ok();
    Ok(())
}
