# Windows: .\bootstrap\install.ps1 [--target=all|claude|codex] [--dev] [--settings-only] [--dry-run]
node "$PSScriptRoot\install.mjs" @args
exit $LASTEXITCODE
