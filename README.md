# modelkit

Headless test-suite / sweep tool for Forio Epicenter Excel models.

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
