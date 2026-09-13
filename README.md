# modelkit

Headless test-suite / sampling tool for Forio Epicenter Excel models.

`modelkit` ships as a standalone binary. Once installed it needs nothing else on the machine.

## Usage

```sh
modelkit help                  # list the tools
modelkit help <tool>           # one tool's usage
modelkit --version
```

### `execute`

Executes a [run file](docs/runFile/run-file.md) against a model. It prints each step's decisions, then the full final state.

```sh
modelkit execute runs/savings-golden.run.json models/test.xlsx
modelkit execute runs/aigov-base.run.json models/AIGovModel.xlsx
```

The run file's `simulation` must match the model's `ModelKitID` named range, or the run is refused.

### `random`

Plays a model at random and writes the result as a [run file](docs/runFile/run-file.md). It only ever chooses what the simulation's own rules allow, so what comes out is valid the first time — there is no generate-and-retry.

```sh
modelkit random models/AIGovModel.xlsx runs/aigov.scenario.json --seed 1
modelkit random models/AIGovModel.xlsx runs/aigov.scenario.json --out runs/random.run.json
```

| Flag | Meaning |
|---|---|
| `--seed` | number or text. The same seed and model reproduce the same run |
| `--out` | write the run file here instead of stdout |

The [scenario file](docs/scenarioFile/scenario-file.md) carries the settings and how many steps the run has — a run file minus its decisions.

### `sample`

`random` many times over, into a folder: one run file per run, plus a `sample.csv` holding each run's id and the results its simulation reports.

```sh
modelkit sample models/AIGovModel.xlsx runs/aigov.scenario.json
modelkit sample models/test.xlsx runs/savings.scenario.json --runs 20 --seed abc
```

| Flag | Meaning |
|---|---|
| `--runs` | how many runs to generate. Default 100 |
| `--seed` | number or text. The same seed, model and scenario reproduce the whole sample |
| `--out` | write the folder here instead of `./sample-<timestamp>` |

Every run of a sample shares one [scenario](docs/scenarioFile/scenario-file.md), so they differ only in their decisions.

Each run also gets its own seed, `<seed>/<index>`, recorded in the run file's `origin` and in the CSV — so any single row reproduces on its own.

**Every result is read at the run's last step.** A model computes its whole horizon whatever the run's length, so the columns past the end of a short run hold the workbook's authored defaults rather than anything the run did; the CSV never reports those. Numbers are rounded to at most two decimals, and the last three rows are the `max`, `min` and `average` of every column.

A run whose decisions break its simulation's rules is skipped rather than written, and the exit code is 1 if anything was skipped. The exception is the first run: since every run shares the one scenario, if that one is invalid the scenario itself is, and the sample stops there instead of repeating the mistake 99 more times.

The last line reports how long the sample took, split into parsing the workbook — a one-off the whole sample shares — and the per-run mean, which is the figure that predicts a larger sample. AIGovModel runs at roughly **0.3s per 6-step run**, so 100 runs take about half a minute. Runs with ministries switched off are faster again, since there is less to decide.

### `maximize` and `minimize`

Searches for the run that drives one named range as high, or as low, as it will go — hill-climbing with simulated annealing, restarted so that one local optimum cannot pass for the global one. The best run comes out as an ordinary [run file](docs/runFile/run-file.md).

```sh
modelkit maximize models/AIGovModel.xlsx runs/aigov.scenario.json TrustInGovernment
modelkit minimize models/AIGovModel.xlsx runs/aigov.scenario.json JobsDisplaced --out runs/fewest-jobs-lost.run.json
```

| Flag | Meaning |
|---|---|
| `--iterations` | candidates per restart. Default 200 |
| `--restarts` | independent searches, each from a fresh random run. Default 3 |
| `--seed` | number or text. The same seed and model reproduce the whole search |
| `--out` | write the best run file here instead of stdout |

Any named range the model has is a legal objective, not only the ones a sample reports, and it is read at the run's last step like every other result.

**One candidate costs one full run of the model**, so the budget is roughly `iterations × restarts` — the default 623 runs take about three minutes on AIGovModel. Nothing is written until the search finishes, so an interrupted one leaves no artifacts.

The last line reports what share of **downhill** moves the search took, which is how you tell whether it did what it says: near 100% means it ran too hot and was a random walk, near 0% means it never explored past the first hill. Before the search starts it also says how often a single decision moves your objective at all — some are far more sensitive than others. See [docs/optimising.md](docs/optimising.md) for both.

## Developing

You don't need a build to work on modelkit. This runs the same code from source:

```sh
bun install
bun run dev execute runs/savings-golden.run.json models/test.xlsx    # = modelkit execute ...
bun test                                             # offline, see test/README.md
```

`bun run dev` doesn't touch the installed `modelkit`, so you can work on any branch and keep a stable build on your PATH.

## Building the Binaries

You will need [Bun](https://bun.sh) installed

```sh
bun install
bun run build --all    # every platform
bun run build          # this machine only -> dist/modelkit (dist\modelkit.exe on Windows)
```

`--all` cross-compiles, so one machine can build every platform.

## Installing

### macOS

This installs to `~/.local/bin`. Use the file for your Mac: the Apple Silicon build is shown, so swap in `modelkit-bun-darwin-x64` on Intel.

```sh
mkdir -p ~/.local/bin
cp dist/modelkit-bun-darwin-arm64 ~/.local/bin/modelkit
chmod +x ~/.local/bin/modelkit
```

If `~/.local/bin` isn't on your PATH yet (`echo $PATH` to check), add it once:

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
```

Open a new terminal, then check it works:

```sh
modelkit --version
```

**If macOS refuses to open it** ("cannot be opened because the developer cannot be verified"): the binary isn't signed, and macOS quarantines files that were downloaded or copied from another machine. Clear the flag:

```sh
xattr -d com.apple.quarantine ~/.local/bin/modelkit
```

### Windows

This installs to `%LOCALAPPDATA%\Programs\modelkit`. Run in PowerShell, from the folder containing the `.exe`:

```powershell
$dir = "$env:LOCALAPPDATA\Programs\modelkit"
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item modelkit-bun-windows-x64.exe "$dir\modelkit.exe"
```

Then add that folder to your user PATH. You only need to do this once:

```powershell
$dir = "$env:LOCALAPPDATA\Programs\modelkit"
$path = [Environment]::GetEnvironmentVariable("Path", "User")
if (($path -split ";") -notcontains $dir) {
  [Environment]::SetEnvironmentVariable("Path", "$path;$dir", "User")
}
```

Open a new terminal (existing ones keep the old PATH), then check it works:

```powershell
modelkit --version
```

**If Windows SmartScreen blocks it** ("Windows protected your PC"): the binary isn't signed. Choose **More info → Run anyway**, or unblock it once:

```powershell
Unblock-File "$env:LOCALAPPDATA\Programs\modelkit\modelkit.exe"
```

### Uninstalling

- **macOS:** `rm ~/.local/bin/modelkit`
- **Windows:** delete `%LOCALAPPDATA%\Programs\modelkit`, and remove it from your user PATH under _Settings → System → About → Advanced system settings → Environment Variables_.
