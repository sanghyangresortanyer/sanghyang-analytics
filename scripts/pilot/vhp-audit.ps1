<#
  VHP menu audit (screen mode: the mouse moves). For each VHP module: open it from the Run menu by
  its command id, click every menu-bar title to let VHP build the menu, open submenus, record every
  item, close the menus with Esc, and go back to the start screen with one press of the red STO.
  Leaf items (the ones that open a screen or run a process) are never clicked.

    powershell -File scripts\pilot\vhp-audit.ps1 -Out <folder> [-Ids 4,12]

  Output: <folder>\audit.json (all modules) and <folder>\peta-menu-vhp.md.
#>
param([string]$Out, [int[]]$Ids)
$ErrorActionPreference = "Stop"
$P = Join-Path $PSScriptRoot "pilot.ps1"
$Main = "VHP - Visual Hotel Program"
$env:PILOT_INPUT = "on"
New-Item -ItemType Directory -Force $Out | Out-Null
$Skip = '(?i)\b(delete|hapus|remove|void|post(ing)?|night\s*audit|midnight|close\s*(month|year|day|bill|shift|inventory)|transfer\s*to\s*g/?l|->\s*gl|cancel|reorg|purge|exit|logout)\b'

function Pilot { powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $P @args }
function Popups {
  Pilot popups | Where-Object { $_ -match "`t" } | ForEach-Object {
    $f = $_ -split "`t"
    [pscustomobject]@{ x = [int](($f[1] -split ",")[0]); y = [int](($f[1] -split ",")[1]); enabled = $f[2] -eq "aktif"; kind = $f[3]; text = $f[4] }
  }
}
# Esc is not used: a second Esc leaves the VHP module (seen 2026-11-19).
function Close-Menus { Pilot cancelmenu -Window $Main | Out-Null; Start-Sleep -Milliseconds 400 }
function Read-Bar {
  Pilot menurects -Window $Main | Where-Object { $_ -match "`t" } | ForEach-Object {
    $f = $_ -split "`t"; $r = $f[1] -split ","
    [pscustomobject]@{ text = $f[2]; x = [int](([int]$r[0] + [int]$r[2]) / 2); y = [int](([int]$r[1] + [int]$r[3]) / 2) }
  }
}
# Inside a module the menu bar has no "Run" (that is the start screen, where PhoneList and others run at once).
function In-Module { $t = @(Read-Bar | ForEach-Object { $_.text }); return ($t.Count -gt 0 -and $t -notcontains "Run") }

# Module list from the start screen's Run menu.
$start = Pilot bgmenus -Window $Main -Out (Join-Path $Out "start-menu.json")
$run = ((Get-Content (Join-Path $Out "start-menu.json") -Raw | ConvertFrom-Json) | Where-Object { $_.text -eq "Run" }).items | Where-Object { $_.enabled -and $_.id }
if ($Ids) { $run = $run | Where-Object { $Ids -contains $_.id } }

$audit = @()
foreach ($mod in $run) {
  "== $($mod.text)"
  Pilot bginvoke -Window $Main -Id $mod.id | Out-Null
  Start-Sleep -Seconds 5
  $safe = ($mod.text -replace '[^A-Za-z]', '_')
  Pilot shot -Window $Main -Out (Join-Path $Out "$safe.png") | Out-Null
  if (-not (In-Module)) { "BERHENTI: modul '$($mod.text)' tidak terbuka"; break }
  $bar = Read-Bar
  $menus = @()
  $stop = $false
  foreach ($title in $bar) {
    if (-not $title.text -or $title.text -match $Skip) { $menus += [pscustomobject]@{ title = $title.text; note = "dilewati" }; continue }
    # The title must still be at that spot, inside the module, right before the click.
    $now = Read-Bar | Where-Object { $_.text -eq $title.text }
    if (-not (In-Module) -or -not $now -or [math]::Abs($now.x - $title.x) -gt 3) { "BERHENTI: menu bar berubah sebelum klik '$($title.text)'"; $stop = $true; break }
    $f = Pilot focus -Window $Main
    if ($LASTEXITCODE -ne 0) { "BERHENTI: $f"; $stop = $true; break }
    Start-Sleep -Milliseconds 300
    $clicked = Pilot click -X $title.x -Y $title.y -Window $Main
    if ($LASTEXITCODE -ne 0) { $menus += [pscustomobject]@{ title = $title.text; note = "$clicked" }; Close-Menus; continue }
    Start-Sleep -Milliseconds 900
    $first = @(Popups)
    $items = @()
    foreach ($it in $first) {
      $entry = [ordered]@{ text = $it.text; enabled = $it.enabled; kind = $it.kind }
      if ($it.kind -eq "submenu" -and $it.enabled -and $it.text -notmatch $Skip) {
        # Opening a submenu runs nothing; it only shows the next list.
        Pilot move -X $it.x -Y $it.y | Out-Null
        Start-Sleep -Milliseconds 300
        Pilot click -X $it.x -Y $it.y | Out-Null
        Start-Sleep -Milliseconds 900
        $known = $first | ForEach-Object { $_.text }
        $entry.children = @(Popups | Where-Object { $known -notcontains $_.text } | ForEach-Object { [ordered]@{ text = $_.text; enabled = $_.enabled; kind = $_.kind } })
      }
      $items += [pscustomobject]$entry
    }
    $menus += [pscustomobject]@{ title = $title.text; items = $items }
    Close-Menus
  }
  $audit += [pscustomobject]@{ module = $mod.text; id = $mod.id; menus = $menus }
  $audit | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $Out "audit.json") -Encoding utf8
  # Back to the start screen: STO once (pilot refuses it on the start screen itself).
  Close-Menus
  Pilot bgclick -Window $Main -Name STO | Out-Null
  Start-Sleep -Seconds 3
  if ($stop) { break }
}

# Markdown map.
$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("# Peta menu VHP (audit $(Get-Date -Format 'yyyy-MM-dd HH:mm'))")
[void]$md.AppendLine("")
[void]$md.AppendLine("Cara baca: judul menu, lalu isinya; item terakhir tidak diklik (hanya dibaca). _(tidak aktif)_ = tidak bisa dipakai akun ini.")
foreach ($m in $audit) {
  [void]$md.AppendLine(""); [void]$md.AppendLine("## $($m.module)")
  foreach ($menu in $m.menus) {
    if ($menu.note) { [void]$md.AppendLine("- **$($menu.title)**: $($menu.note)"); continue }
    [void]$md.AppendLine("- **$($menu.title)**")
    foreach ($i in $menu.items) {
      [void]$md.AppendLine("  - $($i.text)$(if (-not $i.enabled) { ' _(tidak aktif)_' })")
      foreach ($c in $i.children) { [void]$md.AppendLine("    - $($c.text)$(if (-not $c.enabled) { ' _(tidak aktif)_' })") }
    }
  }
}
Set-Content (Join-Path $Out "peta-menu-vhp.md") $md.ToString() -Encoding utf8
$env:PILOT_INPUT = $null
"Selesai: $(Join-Path $Out 'peta-menu-vhp.md')"
