import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from nemo_weather.persistence import push_to_redis, save_to_disk, load_from_disk

SAMPLE_GRID = {
    "runTs": 1713340800,
    "bbox": {"latMin": -90, "latMax": 90, "lonMin": -180, "lonMax": 180},
    "resolution": 0.25,
    "shape": {"rows": 1, "cols": 1},
    "forecastHours": [0],
    "variables": {"u": "AAAA", "v": "AAAA", "swh": "AAAA", "mwdSin": "AAAA", "mwdCos": "AAAA", "mwp": "AAAA"},
}

def test_push_to_redis():
    mock_redis = MagicMock()
    push_to_redis(SAMPLE_GRID, mock_redis)
    mock_redis.set.assert_called_once()
    key = mock_redis.set.call_args[0][0]
    assert key == "weather:grid:1713340800"
    mock_redis.publish.assert_called_once_with("weather:grid:updated", "1713340800")

def test_save_and_load_disk():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp)
        save_to_disk(SAMPLE_GRID, path)
        loaded = load_from_disk(path)
        assert loaded is not None
        assert loaded["runTs"] == 1713340800

def test_load_from_disk_empty_dir():
    with tempfile.TemporaryDirectory() as tmp:
        loaded = load_from_disk(Path(tmp))
        assert loaded is None
