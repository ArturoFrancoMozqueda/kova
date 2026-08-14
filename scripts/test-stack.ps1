[CmdletBinding()]
param(
    [ValidateSet("backend", "integration", "all")]
    [string]$Suite = "all",
    [switch]$KeepStack
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $repo "docker-compose.test.yml"

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop no está disponible. Inícialo y vuelve a ejecutar este comando."
}

function Invoke-Compose([string[]]$Arguments) {
    & docker compose -f $compose @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose falló: $($Arguments -join ' ')" }
}

try {
    if ($Suite -in @("backend", "all")) {
        Invoke-Compose @("up", "-d", "--wait", "db")
        $env:DATABASE_URL = "postgresql+psycopg://pos:pos@127.0.0.1:55432/pos_test"
        Push-Location (Join-Path $repo "backend")
        try {
            & uv sync
            if ($LASTEXITCODE -ne 0) { throw "uv sync falló" }
            & uv run alembic upgrade head
            if ($LASTEXITCODE -ne 0) { throw "Las migraciones fallaron" }
            & uv run pytest
            if ($LASTEXITCODE -ne 0) { throw "pytest falló" }
        }
        finally { Pop-Location }
    }

    if ($Suite -in @("integration", "all")) {
        Invoke-Compose @("up", "-d", "--build", "--wait")
        Push-Location (Join-Path $repo "frontend")
        try {
            & npm ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci falló" }
            $env:KOVA_INTEGRATION = "1"
            $env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:5174"
            & npm run test:integration
            if ($LASTEXITCODE -ne 0) { throw "La integración Playwright falló" }
        }
        finally { Pop-Location }
    }
}
finally {
    if (-not $KeepStack) {
        & docker compose -f $compose down --volumes --remove-orphans
    }
}
