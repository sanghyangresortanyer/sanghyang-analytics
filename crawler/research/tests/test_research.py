from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.config import Settings
from app.models import ResearchRequest, calendar_window
from app.storage import Store


def test_calendar_window():
    end = datetime(2026, 11, 13, 10, 0, 0, tzinfo=UTC)
    start, window_end = calendar_window(12, end=end)
    assert window_end == end
    assert start.year == 2025
    assert start.month == 11
    assert start.day == 13

    # Naive datetime should raise ValueError
    with pytest.raises(ValueError, match="must include a timezone"):
        calendar_window(12, end=datetime(2026, 11, 13, 10, 0, 0))


def test_research_request_validation():
    req = ResearchRequest(
        url="https://sanghyang.com",
        competitor_urls=["https://mambruk.co.id", "https://mambruk.co.id", "https://astonhotels.com"],
    )
    assert req.url == "https://sanghyang.com"
    # Deduplication
    assert req.competitor_urls == ["https://mambruk.co.id", "https://astonhotels.com"]

    # Reject URLs with credentials
    with pytest.raises(ValueError):
        ResearchRequest(url="https://admin:password@malicious.com")

    # Reject non-http/https
    with pytest.raises(ValueError):
        ResearchRequest(url="ftp://ftp.example.com")


def test_settings_validation(tmp_path: Path):
    s = Settings(data_dir=tmp_path, host="127.0.0.1")
    assert s.host == "127.0.0.1"
    assert s.data_dir.is_absolute()

    # Disallow public bind
    with pytest.raises(ValueError, match="loopback"):
        Settings(host="0.0.0.0")


def test_store_initialization_and_run(tmp_path: Path):
    settings = Settings(data_dir=tmp_path, host="127.0.0.1")
    store = Store(settings)
    assert (tmp_path / "research.sqlite").exists()

    req = ResearchRequest(url="https://sanghyang.com")
    run = store.create_run(req)
    assert run is not None
    assert run["id"] is not None
    assert run["url"] == "https://sanghyang.com"
    assert run["status"] == "queued"

    retrieved = store.get_run(run["id"])
    assert retrieved["id"] == run["id"]
