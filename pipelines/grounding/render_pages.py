#!/usr/bin/env python3
"""Perender halaman untuk grounding: menangkap isi yang dibuat JavaScript sebagai Markdown.

Dijalankan sesudah `grounding_fetch.py run`. Hanya merender URL yang sudah berhasil diambil alat itu,
jadi daftar host dan robots.txt sudah ditegakkan, lalu merendernya satu per satu dengan jeda dan
identitas perayap yang sama. Butuh Crawl4AI di lingkungan virtual proyek dengan versi yang dipin.
Mode penyamaran (magic, simulate_user, override_navigator, stealth) sengaja tidak dipakai.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

TAG = "[Render]"


def blueprint_scripts() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / ".agents" / "scripts" / "grounding_fetch.py").is_file():
            return parent / ".agents" / "scripts"
    raise SystemExit(f"{TAG} folder .agents/scripts tidak ditemukan di atas {Path(__file__).resolve()}")


sys.path.insert(0, str(blueprint_scripts()))
import grounding_fetch


def fetched_pages(output_dir: Path) -> list[str]:
    inventory = output_dir / "inventory" / "urls.csv"
    if not inventory.is_file():
        raise SystemExit(f"{TAG} {inventory} belum ada. Jalankan grounding_fetch.py run lebih dulu.")
    with inventory.open(encoding="utf-8", newline="") as handle:
        return [row["url"] for row in csv.DictReader(handle) if row["status"] == "200"]


async def render(config: grounding_fetch.Config, settings: dict, urls: list[str]) -> list[dict]:
    target = config.output_dir / "rendered"
    target.mkdir(parents=True, exist_ok=True)
    browser_options = {"browser_type": "chromium", "headless": True, "user_agent": config.user_agent}
    if settings.get("chrome_channel"):
        browser_options["chrome_channel"] = settings["chrome_channel"]
    run_config = CrawlerRunConfig(
        wait_until=settings.get("wait_until", "domcontentloaded"),
        delay_before_return_html=float(settings.get("settle_seconds", 1.0)),
        page_timeout=int(config.politeness["timeout_seconds"] * 1000),
        cache_mode=CacheMode.BYPASS,
        # Pemeriksa robots Crawl4AI memakai urllib.robotparser; sebelum Python 3.14 parser itu memakai aturan pertama yang
        # cocok, bukan aturan terpanjang (RFC 9309), sehingga Allow yang lebih spesifik ditolak. URL di sini sudah lolos
        # pemeriksaan RFC 9309 grounding_fetch.py, jadi pemeriksa kedua ini hanya dipakai bila parsernya sudah benar.
        check_robots_txt=sys.version_info >= (3, 14),
    )
    rows: list[dict] = []
    async with AsyncWebCrawler(config=BrowserConfig(**browser_options)) as crawler:
        for index, url in enumerate(urls):
            if index:
                await asyncio.sleep(config.politeness["delay_seconds"])  # jeda sopan dari konfigurasi
            result = await crawler.arun(url, config=run_config)
            row = {
                "url": url,
                "rendered_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": result.status_code,
                "error": "" if result.success else str(result.error_message or "gagal tanpa pesan"),
            }
            text = str(result.markdown or "") if result.success else ""
            if text.strip():
                name = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16] + ".md"
                (target / name).write_text(text, encoding="utf-8")
                row.update(markdown=f"rendered/{name}", chars=len(text), sha256=hashlib.sha256(text.encode("utf-8")).hexdigest())
            elif not row["error"]:
                row["error"] = "halaman dirender tetapi tidak menghasilkan teks"
            rows.append(row)
            print(f"{TAG} {index + 1}/{len(urls)} {url} -> {row.get('markdown') or row['error']}")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Merender halaman yang sudah diambil menjadi Markdown")
    parser.add_argument("--config", required=True, help="Berkas konfigurasi yang sama dengan grounding_fetch.py")
    parser.add_argument("--limit", type=int, help="Batasi jumlah halaman, misalnya untuk uji asap")
    args = parser.parse_args()

    config_path = Path(args.config)
    try:
        config = grounding_fetch.load_config(config_path)
    except grounding_fetch.ConfigError as error:
        print(f"{TAG} {error}", file=sys.stderr)
        return 2
    settings = json.loads(config_path.read_text(encoding="utf-8")).get("render") or {}
    urls = fetched_pages(config.output_dir)[: args.limit]
    rows = asyncio.run(render(config, settings, urls))

    index = config.output_dir / "rendered" / "index.jsonl"
    partial = index.with_name(index.name + ".part")
    partial.write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
    os.replace(partial, index)
    failed = [row for row in rows if row["error"]]
    print(f"{TAG} {len(rows) - len(failed)} halaman dirender, {len(failed)} gagal; indeks di {index}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
