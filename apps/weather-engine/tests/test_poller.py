import datetime as dt
from unittest.mock import patch, MagicMock
from nemo_weather.poller import pick_target_run, check_run_available


def test_pick_target_run_at_14utc():
    now = dt.datetime(2026, 4, 17, 14, 0, 0)
    run = pick_target_run(now)
    assert run == dt.datetime(2026, 4, 17, 6, 0, 0)


def test_pick_target_run_at_03utc():
    now = dt.datetime(2026, 4, 17, 3, 0, 0)
    run = pick_target_run(now)
    assert run == dt.datetime(2026, 4, 16, 18, 0, 0)


@patch("nemo_weather.poller.requests.head")
def test_check_run_available_returns_true_on_200(mock_head):
    mock_head.return_value = MagicMock(status_code=200)
    run = dt.datetime(2026, 4, 17, 12, 0, 0)
    assert check_run_available(run) is True


@patch("nemo_weather.poller.requests.head")
def test_check_run_available_returns_false_on_404(mock_head):
    mock_head.return_value = MagicMock(status_code=404)
    run = dt.datetime(2026, 4, 17, 12, 0, 0)
    assert check_run_available(run) is False
