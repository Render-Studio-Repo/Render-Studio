$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

function Find-Python {
    $Candidates = @(
        @{ Command = "py"; Args = @("-3.12") },
        @{ Command = "py"; Args = @("-3.11") },
        @{ Command = "py"; Args = @("-3.10") },
        @{ Command = "python"; Args = @() },
        @{ Command = "python3"; Args = @() }
    )
    foreach ($Candidate in $Candidates) {
        if (-not (Get-Command $Candidate.Command -ErrorAction SilentlyContinue)) { continue }
        & $Candidate.Command @($Candidate.Args) -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { return $Candidate }
    }
    throw "Python 3.10 or newer is required. Install it from https://www.python.org/downloads/windows/ and enable Add python.exe to PATH."
}

Write-Host "Render Studio installer" -ForegroundColor Cyan
Write-Host "======================="
$Python = Find-Python
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating the private Python environment..."
    & $Python.Command @($Python.Args) -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Python could not create .venv." }
}
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
Write-Host "Installing Render Studio dependencies..."
& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
& $VenvPython -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
New-Item -ItemType Directory -Force -Path "data", "projects" | Out-Null
& $VenvPython scripts\bootstrap_render_instance.py
if ($LASTEXITCODE -ne 0) { throw "Render Studio instance bootstrap failed." }
Write-Host ""
Write-Host "Installation complete. Starting Render Studio..." -ForegroundColor Green
Start-Process powershell.exe -ArgumentList "-NoLogo", "-NoProfile", "-WindowStyle", "Hidden", "-Command", "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:8001/setup.html'"
& $VenvPython run.py
