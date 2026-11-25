<#
  Pilot: lets the agent see and drive any Windows program (.exe), like a person at the mouse.
  Built for studying VHP (C:\OpenEdge\bin\prowin32.exe) but works on every window.

    pilot.ps1 windows                              visible windows: handle, process, size, title
    pilot.ps1 shot  -Out x.png [-Window "title"]   picture of the whole screen, or of one window
    pilot.ps1 tree  -Window "title" -Out x.json    buttons, menus, fields and texts of a window
                                                    (UI Automation: type, name, position)
    pilot.ps1 menus -Window "title" -Out x.json    classic menu bar with every submenu (Win32)
    pilot.ps1 focus -Window "title"                bring a window to the front
    pilot.ps1 move  -X 100 -Y 200                  move the mouse
    pilot.ps1 click -X 100 -Y 200 [-Right] [-Double] [-Force]
    pilot.ps1 type  -Text "01/01/26"               type text into the focused field
    pilot.ps1 key   -Keys "{ENTER}"                keys in SendKeys notation: ^a = Ctrl+A, %f = Alt+F
    pilot.ps1 scroll -X 100 -Y 200 -Amount -3      wheel; negative scrolls down

  Coordinates are screen pixels as in `shot` of the whole screen.
  Safety: before a click the element under the mouse is read; if its name matches a forbidden
  action (delete, post, night audit, close month/year, transfer to GL, void, cancel bill, save,
  ...) the click is refused. Only the user may allow it, by asking for -Force explicitly.
#>
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet("report", "windows", "shot", "tree", "menus", "find", "focus", "close", "move", "click", "type", "key", "scroll", "bgmenus", "bginvoke", "bgclick", "menurects", "popups", "cancelmenu")]
  [string]$Command,
  [string]$Out,
  [string]$Window,
  [int]$X,
  [int]$Y,
  [switch]$Right,
  [switch]$Double,
  [switch]$Force,
  [string]$Text,
  [string]$Keys,
  [int]$Amount = -3,
  [int]$Depth = 12,
  [string]$Name,
  [string]$Type,
  [int]$Id
)
$ErrorActionPreference = "Stop"

# Actions that change data in a hotel system; a click on an element named like this is refused.
$Forbidden = '(?i)\b(delete|hapus|remove|void|post(ing)?|night\s*audit|midnight|close\s*(month|year|day|bill|shift)|transfer\s*to\s*g/?l|->\s*gl|cancel\s*(bill|receiving|order)|save|simpan|update\s*rates?|reorg|purge|clear\s*all|logout|exit\s*vhp)\b'

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class Pilot {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int dx, int dy, int data, IntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr m, int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetMenuString(IntPtr m, uint id, StringBuilder s, int n, uint flags);
  [DllImport("user32.dll")] static extern uint GetMenuState(IntPtr m, uint id, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public class Win { public IntPtr Handle; public uint Pid; public string Title; public int Left, Top, Width, Height; }

  public static List<Win> Windows() {
    var list = new List<Win>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      if (r.R - r.L < 50 || r.B - r.T < 30) return true;
      list.Add(new Win { Handle = h, Pid = pid, Title = sb.ToString(), Left = r.L, Top = r.T, Width = r.R - r.L, Height = r.B - r.T });
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static void ShotWindow(IntPtr h, string path) {
    RECT r; GetWindowRect(h, out r);
    using (var bmp = new Bitmap(r.R - r.L, r.B - r.T)) {
      using (var g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
      bmp.Save(path, ImageFormat.Png);
    }
  }

  public static void ShotScreen(Rectangle b, string path) {
    using (var bmp = new Bitmap(b.Width, b.Height)) {
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size);
      bmp.Save(path, ImageFormat.Png);
    }
  }

  public static void Click(int x, int y, bool right, bool dbl) {
    SetCursorPos(x, y);
    uint down = right ? 0x0008u : 0x0002u, up = right ? 0x0010u : 0x0004u;
    int times = dbl ? 2 : 1;
    for (int i = 0; i < times; i++) { mouse_event(down, 0, 0, 0, IntPtr.Zero); mouse_event(up, 0, 0, 0, IntPtr.Zero); System.Threading.Thread.Sleep(60); }
  }

  public static void Scroll(int x, int y, int notches) { SetCursorPos(x, y); mouse_event(0x0800, 0, 0, notches * 120, IntPtr.Zero); }

  const uint MF_BYPOSITION = 0x400, MF_GRAYED = 0x1, MF_DISABLED = 0x2, MF_SEPARATOR = 0x800;
  static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\t", "\\t"); }
  public static string MenuJson(IntPtr h) { IntPtr m = GetMenu(h); return m == IntPtr.Zero ? "[]" : Items(m, 0); }

  // Background mode: no mouse. Progress (VHP) fills a submenu only when it is about to open, so
  // the window is told WM_INITMENUPOPUP for each submenu before reading it, as Windows does on a click.
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern int GetMenuItemID(IntPtr m, int pos);
  public static string MenuJsonDeep(IntPtr h) {
    IntPtr m = GetMenu(h); if (m == IntPtr.Zero) return "[]";
    IntPtr r; SendMessageTimeout(h, 0x0116, m, IntPtr.Zero, 0x0002, 3000, out r);   // WM_INITMENU: the bar is being opened
    m = GetMenu(h);
    return Deep(h, m, 0);
  }
  static string Deep(IntPtr h, IntPtr m, int depth) {
    if (depth > 6) return "[]";
    var parts = new List<string>();
    int n = GetMenuItemCount(m);
    for (int i = 0; i < n; i++) {
      uint st = GetMenuState(m, (uint)i, MF_BYPOSITION);
      if ((st & MF_SEPARATOR) != 0) { parts.Add("{\"separator\":true}"); continue; }
      var sb = new StringBuilder(256); GetMenuString(m, (uint)i, sb, 256, MF_BYPOSITION);
      IntPtr sub = GetSubMenu(m, i);
      string tail;
      if (sub != IntPtr.Zero) {
        IntPtr r;
        SendMessageTimeout(h, 0x0117, sub, (IntPtr)i, 0x0002, 3000, out r);   // WM_INITMENUPOPUP, abort if hung
        tail = ",\"items\":" + Deep(h, sub, depth + 1);
        SendMessageTimeout(h, 0x0125, sub, IntPtr.Zero, 0x0002, 3000, out r);  // WM_UNINITMENUPOPUP
      } else {
        tail = ",\"id\":" + GetMenuItemID(m, i);
      }
      parts.Add("{\"text\":\"" + Esc(sb.ToString().Replace("&", "")) + "\",\"enabled\":" + (((st & (MF_GRAYED | MF_DISABLED)) == 0) ? "true" : "false") + tail + "}");
    }
    return "[" + string.Join(",", parts) + "]";
  }
  // Screen rectangle of each item in the menu bar, so a hidden or lazily built title can be located.
  [DllImport("user32.dll")] static extern bool GetMenuItemRect(IntPtr h, IntPtr m, uint pos, out RECT r);
  public static string MenuBarRects(IntPtr h) {
    IntPtr m = GetMenu(h); if (m == IntPtr.Zero) return "";
    var sb = new StringBuilder();
    int n = GetMenuItemCount(m);
    for (int i = 0; i < n; i++) {
      RECT r; GetMenuItemRect(h, m, (uint)i, out r);
      var t = new StringBuilder(256); GetMenuString(m, (uint)i, t, 256, MF_BYPOSITION);
      sb.AppendLine(i + "\t" + r.L + "," + r.T + "," + r.R + "," + r.B + "\t" + t.ToString().Replace("&", ""));
    }
    return sb.ToString();
  }
  // Items of the popup menus open on screen (class #32768), read through MN_GETHMENU.
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static string OpenPopups() {
    var sb = new StringBuilder();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "#32768") return true;
      IntPtr menu; SendMessageTimeout(h, 0x01E1, IntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out menu);
      if (menu == IntPtr.Zero) return true;
      RECT wr; GetWindowRect(h, out wr);
      int n = GetMenuItemCount(menu);
      for (int i = 0; i < n; i++) {
        uint st = GetMenuState(menu, (uint)i, MF_BYPOSITION);
        if ((st & MF_SEPARATOR) != 0) continue;
        var t = new StringBuilder(256); GetMenuString(menu, (uint)i, t, 256, MF_BYPOSITION);
        RECT r; GetMenuItemRect(IntPtr.Zero, menu, (uint)i, out r);
        bool enabled = (st & (MF_GRAYED | MF_DISABLED)) == 0;
        bool sub = GetSubMenu(menu, i) != IntPtr.Zero;
        sb.AppendLine(i + "\t" + ((r.L + r.R) / 2) + "," + ((r.T + r.B) / 2) + "\t" + (enabled ? "aktif" : "tidak aktif") + "\t" + (sub ? "submenu" : "item") + "\t" + t.ToString().Replace("&", ""));
      }
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
  // Windows refuses SetForegroundWindow from a background process; joining the input of the
  // window that is in front first makes the request count as coming from the active app.
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  public static bool ForceForeground(IntPtr h) {
    IntPtr fg = GetForegroundWindow();
    if (fg == h) return true;
    uint pid; uint fgThread = GetWindowThreadProcessId(fg, out pid);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fgThread, true);
    if (IsIconic(h)) ShowWindow(h, 9);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    AttachThreadInput(me, fgThread, false);
    System.Threading.Thread.Sleep(150);
    return GetForegroundWindow() == h;
  }
  // Ends menu mode in the window (open drop-downs close) without any key, so nothing else reacts.
  public static void CancelMenus(IntPtr h) { PostMessage(h, 0x001F, IntPtr.Zero, IntPtr.Zero); }
  public static void PostCommand(IntPtr h, int id) { PostMessage(h, 0x0111, (IntPtr)id, IntPtr.Zero); }  // WM_COMMAND
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  // A click delivered to the control's own window; the real mouse does not move.
  public static void PostClick(IntPtr h, int screenX, int screenY) {
    var p = new POINT { X = screenX, Y = screenY }; ScreenToClient(h, ref p);
    IntPtr lp = (IntPtr)((p.Y << 16) | (p.X & 0xFFFF));
    PostMessage(h, 0x0201, (IntPtr)1, lp);   // WM_LBUTTONDOWN, MK_LBUTTON
    System.Threading.Thread.Sleep(50);
    PostMessage(h, 0x0202, IntPtr.Zero, lp); // WM_LBUTTONUP
  }
  static string Items(IntPtr m, int depth) {
    if (depth > 6) return "[]";
    var parts = new List<string>();
    int n = GetMenuItemCount(m);
    for (int i = 0; i < n; i++) {
      uint st = GetMenuState(m, (uint)i, MF_BYPOSITION);
      if ((st & MF_SEPARATOR) != 0) { parts.Add("{\"separator\":true}"); continue; }
      var sb = new StringBuilder(256); GetMenuString(m, (uint)i, sb, 256, MF_BYPOSITION);
      IntPtr sub = GetSubMenu(m, i);
      parts.Add("{\"text\":\"" + Esc(sb.ToString().Replace("&", "")) + "\",\"enabled\":" + (((st & (MF_GRAYED | MF_DISABLED)) == 0) ? "true" : "false")
        + (sub == IntPtr.Zero ? "" : ",\"items\":" + Items(sub, depth + 1)) + "}");
    }
    return "[" + string.Join(",", parts) + "]";
  }
}
"@
[void][Pilot]::SetProcessDPIAware()

function Find-Window([string]$part) {
  $w = [Pilot]::Windows() | Where-Object { $_.Title -like "*$part*" } | Select-Object -First 1
  if (-not $w) { throw "Jendela dengan judul '*$part*' tidak ditemukan." }
  $w
}

function Get-ElementAt([int]$px, [int]$py) {
  try { [System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($px, $py)) } catch { Write-Warning "Elemen di $px,$py tidak terbaca: $($_.Exception.Message)"; $null }
}

function Get-Tree($element, [int]$depth, [int]$max) {
  $c = $element.Current
  $r = $c.BoundingRectangle
  $node = [ordered]@{
    type = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    name = $c.Name
    id = $c.AutomationId
    enabled = $c.IsEnabled
    rect = if ($r.IsEmpty) { $null } else { @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height) }
  }
  if ($depth -lt $max) {
    $kids = @()
    $child = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetFirstChild($element)
    $count = 0
    while ($child -and $count -lt 400) {
      $kids += Get-Tree $child ($depth + 1) $max
      $child = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetNextSibling($child)
      $count++
    }
    if ($kids.Count) { $node.children = $kids }
  }
  $node
}

# Kinds of element that start an action when clicked; one without a readable name is refused,
# because what it does cannot be checked (fail closed).
$ActionKinds = '^(Button|SplitButton|MenuItem|Hyperlink|CheckBox|RadioButton)$'
# Confirmation buttons are allowed (printing to "99 Output File" needs OK) unless their dialog
# speaks of a forbidden action ("Delete this bill?", "Close month now?").
$ConfirmNames = '(?i)^\s*(ok|ya|yes|proses|process|lanjut|continue|apply|terapkan)\s*$'

function Get-TopWindow($el) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cur = $el
  for ($i = 0; $i -lt 30 -and $cur; $i++) {
    $parent = $walker.GetParent($cur)
    if (-not $parent -or [System.Windows.Automation.Automation]::Compare($parent, $root)) { return $cur }
    $cur = $parent
  }
  $cur
}

function Get-WindowTexts($win) {
  $texts = @($win.Current.Name)
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
  try { foreach ($t in $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)) { $texts += $t.Current.Name; if ($texts.Count -gt 200) { break } } } catch {}
  $texts -join " | "
}

# Returns why an action on this element is refused, or $null when it is allowed.
function Test-Action($el) {
  if (-not $el) { return "elemen di bawah mouse tidak terbaca, jadi tidak bisa dicek" }
  $name = $el.Current.Name
  $kind = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
  if ($name -match $Forbidden) { return "'$name' ($kind) termasuk tindakan yang mengubah data" }
  if ([string]::IsNullOrWhiteSpace($name) -and $kind -match $ActionKinds) { return "tombol tanpa nama ($kind), tindakannya tidak bisa dicek" }
  if ($name -match $ConfirmNames) {
    $texts = Get-WindowTexts (Get-TopWindow $el)
    if ($texts -match $Forbidden) { return "'$name' mengonfirmasi jendela yang menyebut tindakan terlarang: $texts" }
  }
  $null
}

# Read-only by default (user 2026-11-19: "seharusnya hanya baca saja"): mouse and keyboard
# commands stay off unless the user turns them on for a session with PILOT_INPUT=on.
if ($Command -in @("move", "click", "type", "key", "scroll", "bginvoke", "bgclick") -and $env:PILOT_INPUT -ne "on") {
  Write-Output "DITOLAK: mode baca saja. Mouse dan keyboard hanya aktif bila user menyalakan PILOT_INPUT=on."
  exit 2
}

function Write-Menu($items, [int]$level, [System.Text.StringBuilder]$sb) {
  foreach ($m in $items) {
    if ($m.separator) { continue }
    [void]$sb.AppendLine(("  " * $level) + "- " + $m.text + $(if (-not $m.enabled) { " _(tidak aktif)_" } else { "" }))
    if ($m.items) { Write-Menu $m.items ($level + 1) $sb }
  }
}

function Write-Controls($node, [hashtable]$groups) {
  $label = if ($node.name) { $node.name } elseif ($node.id) { "[$($node.id)]" } else { $null }
  if ($label -and $node.type -notin @("Window", "Pane", "TitleBar")) {
    if (-not $groups.ContainsKey($node.type)) { $groups[$node.type] = New-Object System.Collections.Generic.List[string] }
    if ($groups[$node.type].Count -lt 150 -and -not $groups[$node.type].Contains($label)) { $groups[$node.type].Add($label) }
  }
  foreach ($c in $node.children) { Write-Controls $c $groups }
}

switch ($Command) {
  "report" {
    if (-not $Window -or -not $Out) { throw "Pakai -Window <judul> -Out <folder>" }
    $w = Find-Window $Window
    New-Item -ItemType Directory -Force -Path $Out | Out-Null
    [Pilot]::ShotWindow($w.Handle, (Join-Path $Out "layar.png"))
    $menuJson = [Pilot]::MenuJson($w.Handle)
    Set-Content -Path (Join-Path $Out "menu.json") -Value $menuJson -Encoding utf8
    $tree = Get-Tree ([System.Windows.Automation.AutomationElement]::FromHandle($w.Handle)) 0 $Depth
    $tree | ConvertTo-Json -Depth 40 | Set-Content -Path (Join-Path $Out "isi.json") -Encoding utf8
    $proc = try { (Get-Process -Id $w.Pid).Path } catch { "?" }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("# Laporan jendela: $($w.Title)")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("- Program: $proc")
    [void]$sb.AppendLine("- Ukuran: $($w.Width)x$($w.Height), kiri-atas $($w.Left),$($w.Top)")
    [void]$sb.AppendLine("- Dibaca: $(Get-Date -Format 'yyyy-MM-dd HH:mm') (baca saja, tanpa klik)")
    [void]$sb.AppendLine("- Gambar: layar.png · menu lengkap: menu.json · isi jendela: isi.json")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## Menu")
    $menus = $menuJson | ConvertFrom-Json
    if (@($menus).Count -eq 0) { [void]$sb.AppendLine("(tidak ada menu bar Windows)") } else { Write-Menu $menus 0 $sb }
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## Isi jendela")
    $groups = @{}
    Write-Controls $tree $groups
    foreach ($k in ($groups.Keys | Sort-Object)) { [void]$sb.AppendLine("- **$k** ($($groups[$k].Count)): " + ($groups[$k] -join " · ")) }
    Set-Content -Path (Join-Path $Out "laporan.md") -Value $sb.ToString() -Encoding utf8
    "Laporan: $(Join-Path $Out 'laporan.md') ('$($w.Title)')"
  }
  "windows" {
    [Pilot]::Windows() | ForEach-Object {
      $p = try { (Get-Process -Id $_.Pid).ProcessName } catch { "?" }
      "{0}`t{1}`t{2},{3} {4}x{5}`t{6}" -f $_.Handle, $p, $_.Left, $_.Top, $_.Width, $_.Height, $_.Title
    }
  }
  "shot" {
    if (-not $Out) { throw "Pakai -Out <file.png>" }
    if ($Window) { $w = Find-Window $Window; [Pilot]::ShotWindow($w.Handle, $Out); "Disimpan: $Out (jendela '$($w.Title)', kiri-atas di $($w.Left),$($w.Top))" }
    else { $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; [Pilot]::ShotScreen($b, $Out); "Disimpan: $Out (layar penuh $($b.Width)x$($b.Height), kiri-atas $($b.Left),$($b.Top))" }
  }
  "tree" {
    if (-not $Window -or -not $Out) { throw "Pakai -Window <judul> -Out <file.json>" }
    $w = Find-Window $Window
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($w.Handle)
    Get-Tree $el 0 $Depth | ConvertTo-Json -Depth 40 | Set-Content -Path $Out -Encoding utf8
    "Disimpan: $Out ('$($w.Title)')"
  }
  "menus" {
    if (-not $Window -or -not $Out) { throw "Pakai -Window <judul> -Out <file.json>" }
    $w = Find-Window $Window
    [Pilot]::MenuJson($w.Handle) | Set-Content -Path $Out -Encoding utf8
    "Disimpan: $Out ('$($w.Title)')"
  }
  "menurects" { $w = Find-Window $Window; [Pilot]::MenuBarRects($w.Handle) }
  "popups" { [Pilot]::OpenPopups() }
  "bgmenus" {
    # Full menu tree with command ids, lazy submenus filled first; the mouse does not move.
    if (-not $Window -or -not $Out) { throw "Pakai -Window <judul> -Out <file.json>" }
    $w = Find-Window $Window
    [Pilot]::MenuJsonDeep($w.Handle) | Set-Content -Path $Out -Encoding utf8
    "Disimpan: $Out ('$($w.Title)')"
  }
  "bginvoke" {
    # Runs one menu item by its command id (from bgmenus), checked against the forbidden list.
    $w = Find-Window $Window
    $tree = [Pilot]::MenuJsonDeep($w.Handle) | ConvertFrom-Json
    $found = $null
    function Find-Id($items, $path) { foreach ($i in $items) { if ($i.separator) { continue }; $p = if ($path) { "$path > $($i.text)" } else { $i.text }; if ($i.items) { Find-Id $i.items $p } elseif ($i.id -eq $Id) { $script:found = @{ path = $p; enabled = $i.enabled } } } }
    Find-Id $tree ""
    if (-not $found) { Write-Output "DITOLAK: id $Id tidak ada di menu '$($w.Title)'"; exit 2 }
    if (-not $found.enabled) { Write-Output "DITOLAK: '$($found.path)' tidak aktif"; exit 2 }
    if ($found.path -match $Forbidden -and -not $Force) { Write-Output "DITOLAK: '$($found.path)' termasuk tindakan yang mengubah data"; exit 2 }
    [Pilot]::PostCommand($w.Handle, $Id)
    "Menu dijalankan di belakang: '$($found.path)'"
  }
  "bgclick" {
    # Presses a named control (e.g. a VHP toolbar icon) through its own window; the mouse stays put.
    if (-not $Window -or -not $Name) { throw "Pakai -Window <judul> -Name <nama>" }
    $w = Find-Window $Window
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($w.Handle)
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $el) { Write-Output "DITOLAK: '$Name' tidak ada di '$($w.Title)'"; exit 2 }
    $verdict = Test-Action $el
    if ($verdict -and -not $Force) { Write-Output "DITOLAK: $verdict"; exit 2 }
    # VHP's red STO icon: once inside a module it goes back to the start screen; on the start
    # screen it closes VHP (user 2026-11-19). Fail closed: STO is pressed only when the menu bar is
    # read twice, half a second apart, both times non-empty and without "Run" (a module's bar).
    # An empty bar while VHP switches screens is not proof of a module.
    if ($Name -eq "STO") {
      foreach ($try in 1..2) {
        $titles = @(([Pilot]::MenuJson($w.Handle) | ConvertFrom-Json) | ForEach-Object { $_.text } | Where-Object { $_ })
        if ($titles.Count -eq 0) { Write-Output "DITOLAK: menu bar VHP tidak terbaca, belum pasti di dalam modul"; exit 2 }
        if ($titles -contains "Run") { Write-Output "DITOLAK: STO di layar awal menutup VHP"; exit 2 }
        if ($try -eq 1) { Start-Sleep -Milliseconds 500 }
      }
    }
    $hwnd = [IntPtr]$el.Current.NativeWindowHandle
    if ($hwnd -eq [IntPtr]::Zero) { Write-Output "DITOLAK: '$Name' tidak punya jendela sendiri; butuh klik mouse"; exit 2 }
    $r = $el.Current.BoundingRectangle
    [Pilot]::PostClick($hwnd, [int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    "Ditekan di belakang: '$Name'"
  }
  "find" {
    # Element by exact name anywhere on screen, including open popup menus (they are top-level
    # windows of their own); prints its kind, centre and enabled state, one per line.
    if (-not $Name) { throw "Pakai -Name <teks>" }
    $conds = @(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name))
    if ($Type) { $conds += New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::$Type) }
    $cond = if ($conds.Count -gt 1) { New-Object System.Windows.Automation.AndCondition($conds) } else { $conds[0] }
    $scope = if ($Window) { [System.Windows.Automation.AutomationElement]::FromHandle((Find-Window $Window).Handle) } else { [System.Windows.Automation.AutomationElement]::RootElement }
    $hits = $scope.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($h in $hits) {
      $r = $h.Current.BoundingRectangle
      if ($r.IsEmpty) { continue }
      "{0}`t{1},{2}`t{3}" -f ($h.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''), [int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2), $(if ($h.Current.IsEnabled) { "aktif" } else { "tidak aktif" })
    }
  }
  "close" {
    # Same as the window's X button: asks the window to close; nothing is saved by this.
    $w = Find-Window $Window
    [void][Pilot]::PostMessage($w.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    "Ditutup: '$($w.Title)'"
  }
  "focus" {
    $w = Find-Window $Window
    if ([Pilot]::ForceForeground($w.Handle)) { "Di depan: '$($w.Title)'" } else { Write-Output "GAGAL: '$($w.Title)' tidak bisa dibawa ke depan"; exit 3 }
  }
  "cancelmenu" { $w = Find-Window $Window; [Pilot]::CancelMenus($w.Handle); "Menu ditutup: '$($w.Title)'" }
  "move" { [void][Pilot]::SetCursorPos($X, $Y); "Mouse di $X,$Y" }
  "click" {
    $el = Get-ElementAt $X $Y
    $verdict = Test-Action $el
    $name = if ($el) { $el.Current.Name } else { "" }
    $kind = if ($el) { $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } else { "?" }
    if ($verdict -and -not $Force) {
      Write-Output "DITOLAK di ${X},${Y}: $verdict"
      exit 2
    }
    # With -Window, the click must land on that program: another window that came to the front
    # (a console, a switcher, another app) would otherwise receive it.
    if ($Window -and $el) {
      $target = Find-Window $Window
      $owner = $el.Current.ProcessId
      $sameApp = $owner -eq $target.Pid
      if (-not $sameApp) {
        # UWP apps such as Calculator run inside ApplicationFrameHost; accept their content process too.
        $targetEl = [System.Windows.Automation.AutomationElement]::FromHandle($target.Handle)
        $top = Get-TopWindow $el
        $sameApp = $top -and [System.Windows.Automation.Automation]::Compare($top, $targetEl)
      }
      if (-not $sameApp) {
        $other = try { (Get-Process -Id $owner).ProcessName } catch { "?" }
        Write-Output "DITOLAK di ${X},${Y}: titik ini milik program lain ($other), bukan '$($target.Title)'"
        exit 2
      }
    }
    [Pilot]::Click($X, $Y, [bool]$Right, [bool]$Double)
    "Klik $(if ($Right) {'kanan '})$(if ($Double) {'ganda '})di $X,$Y pada '$name' ($kind)"
  }
  "type" { [System.Windows.Forms.SendKeys]::SendWait(($Text -replace '([+^%~(){}\[\]])', '{$1}')); "Diketik: $Text" }
  "key" {
    # Keys that press the focused control (Enter, Space) or open menus by letter (Alt) go through
    # the same check as a click, on the element that has the keyboard focus.
    if (-not $Force) {
      if ($Keys -match '%') { Write-Output "DITOLAK: kombinasi Alt bisa memilih menu tanpa terlihat; pakai klik pada menunya."; exit 2 }
      if ($Keys -match '\{ENTER\}|~|\{SPACE\}|^ $') {
        $focused = try { [System.Windows.Automation.AutomationElement]::FocusedElement } catch { $null }
        $verdict = Test-Action $focused
        if ($verdict) { Write-Output "DITOLAK ($Keys): $verdict"; exit 2 }
      }
    }
    [System.Windows.Forms.SendKeys]::SendWait($Keys); "Tombol: $Keys"
  }
  "scroll" { [Pilot]::Scroll($X, $Y, $Amount); "Gulir $Amount di $X,$Y" }
}
