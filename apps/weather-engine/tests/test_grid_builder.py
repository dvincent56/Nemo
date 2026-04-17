import base64
import numpy as np
from nemo_weather.grid_builder import uv_to_components, reinterpolate_wave, build_grid_payload

def test_uv_to_components_passthrough():
    u = np.array([0.0], dtype=np.float32)
    v = np.array([-10.0], dtype=np.float32)
    result_u, result_v = uv_to_components(u, v)
    np.testing.assert_allclose(result_u, [0.0], atol=1e-4)
    np.testing.assert_allclose(result_v, [-10.0], atol=1e-4)

def test_reinterpolate_wave_to_025():
    wave_lats = np.array([40.0, 40.16, 40.32])
    wave_lons = np.array([-10.0, -9.84, -9.68])
    values = np.array([[1.0, 1.5, 2.0],
                       [1.5, 2.0, 2.5],
                       [2.0, 2.5, 3.0]], dtype=np.float32)
    target_lats = np.array([40.0, 40.25])
    target_lons = np.array([-10.0, -9.75])
    result = reinterpolate_wave(values, wave_lats, wave_lons, target_lats, target_lons)
    assert result.shape == (2, 2)
    np.testing.assert_allclose(result[0, 0], 1.0, atol=0.1)

def test_build_grid_payload_structure():
    payload = build_grid_payload(
        run_ts=1713340800,
        forecast_hours=[0, 3],
        u_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        v_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        swh_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        mwd_sin_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        mwd_cos_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        mwp_planes=[np.zeros((2, 2), dtype=np.float32)] * 2,
        bbox={"latMin": -90, "latMax": 90, "lonMin": -180, "lonMax": 180},
        resolution=0.25,
        shape={"rows": 2, "cols": 2},
    )
    assert payload["runTs"] == 1713340800
    assert payload["forecastHours"] == [0, 3]
    assert set(payload["variables"].keys()) == {"u", "v", "swh", "mwdSin", "mwdCos", "mwp"}
    raw = base64.b64decode(payload["variables"]["u"])
    arr = np.frombuffer(raw, dtype=np.float32)
    assert arr.shape == (2 * 2 * 2,)
