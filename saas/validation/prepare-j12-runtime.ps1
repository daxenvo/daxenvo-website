# Run locally in an interactive Windows PowerShell session after gh auth login.
# No secret in arguments, output, source files or shell history.
$ErrorActionPreference = 'Stop'
$repo = 'daxenvo/daxenvo-website'
$role = 'daxenvo_ai_runtime_j122.mniconjzkvvvwqoxtzwu'
$pooler = 'aws-1-eu-west-3.pooler.supabase.com'
gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) { throw 'Connectez GitHub CLI avant de continuer.' }

$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
    $password = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    $dsn = 'postgresql://{0}:{1}@{2}:5432/postgres' -f $role,$password,$pooler
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command gh -CommandType Application).Source
    $start.Arguments = "secret set J12_RUNTIME_DSN --repo $repo"
    $start.UseShellExecute = $false
    $start.RedirectStandardInput = $true
    $process = [Diagnostics.Process]::Start($start)
    try {
        $wire = [Text.Encoding]::ASCII.GetBytes($dsn)
        $process.StandardInput.BaseStream.Write($wire, 0, $wire.Length)
        $process.StandardInput.BaseStream.Close()
        $process.WaitForExit()
        $exitCode = $process.ExitCode
    } finally {
        if ($wire) { [Array]::Clear($wire, 0, $wire.Length) }
        $process.Dispose()
    }
    if ($exitCode -ne 0) { throw 'Écriture du secret GitHub impossible.' }
    Set-Clipboard -Value $password
    Read-Host 'Dans Vault de daxenvo-dev, collez comme valeur de J12_RUNTIME_PASSWORD, enregistrez, puis appuyez sur Entrée' | Out-Null
} finally {
    if ($password -and ([string](Get-Clipboard -Raw)).TrimEnd() -ceq $password) { Set-Clipboard -Value '' }
    [Array]::Clear($bytes, 0, $bytes.Length)
    $rng.Dispose()
    Remove-Variable dsn,password -ErrorAction SilentlyContinue
}
