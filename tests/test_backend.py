import os
import sys
import unittest
from unittest import mock


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "server")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import model as model_bridge
import model_server
import realtime_pipeline


class ModelTests(unittest.TestCase):
    def test_reduction_uses_pinn_response(self):
        payload = {
            "facility_id": "fac-valero",
            "receptor_id": "tract-manchester",
            "stack_lat": 29.7212,
            "stack_lng": -95.2618,
            "receptor_lat": 29.7180,
            "receptor_lng": -95.2650,
            "baseline_concentration": 2.59,
            "reduction_percent": 50,
            "wind_speed_ms": 4.0,
            "wind_dir_deg": 130
        }
        result = model_bridge.predict_benzene(payload)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["baseline_concentration"], 2.59)
        self.assertLess(result["simulated_concentration"], result["baseline_concentration"])
        self.assertGreaterEqual(result["simulated_concentration"], 0)
        self.assertIn("pinn_raw_baseline", result)

    def test_reduction_is_clamped(self):
        payload = {
            "baseline_concentration": 2.0,
            "reduction_percent": 250,
            "receptor_lat": 29.718,
            "receptor_lng": -95.265,
            "stack_lat": 29.7212,
            "stack_lng": -95.2618
        }
        result = model_bridge.predict_benzene(payload)
        self.assertEqual(result["reduction_percent"], 100)


class PipelineTests(unittest.TestCase):
    def test_cache_initialization_does_not_hold_lock(self):
        original_timestamp = realtime_pipeline._cached_state["timestamp"]
        realtime_pipeline._cached_state["timestamp"] = None

        def populate_cache():
            with realtime_pipeline._state_lock:
                realtime_pipeline._cached_state["timestamp"] = "test"

        try:
            with mock.patch.object(realtime_pipeline, "update_pipeline_cache", side_effect=populate_cache):
                state = realtime_pipeline.get_cached_realtime_state()
            self.assertEqual(state["timestamp"], "test")
        finally:
            realtime_pipeline._cached_state["timestamp"] = original_timestamp

    def test_gemini_status_never_returns_key(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "secret-value"}):
            status = model_server._gemini_status()
        self.assertTrue(status["available"])
        self.assertNotIn("secret-value", str(status))


if __name__ == "__main__":
    unittest.main()
