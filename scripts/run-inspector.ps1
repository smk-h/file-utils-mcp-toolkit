# MCP Inspector launch script for embedded-mcp-toolkit
# Usage: .\scripts\run-inspector.ps1
#   Or via npm: npm run inspector

# Resolve project root (script is at <root>/scripts/run-inspector.ps1)
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectRoot

# Ensure node_modules/.bin is in PATH (needed when run standalone, npm run adds it automatically)
$env:PATH = "$ProjectRoot\node_modules\.bin;$env:PATH"

# Kill any previous MCP inspector processes holding ports 6274 / 6277
$MCP_PORTS = @(6274, 6277)
foreach ($port in $MCP_PORTS) {
    $pidOnPort = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
    if ($pidOnPort) {
        foreach ($procId in $pidOnPort) {
            Write-Host "Killing process PID=$procId on port $port..." -ForegroundColor Yellow
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

$env:LOG_SAVE          = "1"

# Read entry script from package.json "bin" field (string or object)
$PackageJsonPath = "$ProjectRoot\package.json"
if (-not (Test-Path $PackageJsonPath)) {
    Write-Host "package.json not found at $PackageJsonPath" -ForegroundColor Red
    exit 1
}
$packageJson = Get-Content -Raw $PackageJsonPath | ConvertFrom-Json
$bin = $packageJson.bin
if (-not $bin) {
    Write-Host "No 'bin' field found in package.json" -ForegroundColor Red
    exit 1
}
# bin may be a string (single entry) or an object (named entries -> take the first)
if ($bin -is [string]) {
    $entry = $bin
} else {
    $entry = @($bin.PSObject.Properties.Value)[0]
}

Write-Host "=== MCP Inspector ===" -ForegroundColor Cyan
Write-Host "Project Root     : $ProjectRoot"
Write-Host "Entry Script     : $entry"
Write-Host "LOG_SAVE         : $env:LOG_SAVE"
Write-Host "====================" -ForegroundColor Cyan

mcp-inspector node $entry

Pop-Location
