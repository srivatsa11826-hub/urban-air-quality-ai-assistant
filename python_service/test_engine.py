"""
Comprehensive Unit & Integration Test Suite for AirGuard Python Microservice.
Tests CPCB sub-index calculations, WHO 2021 evaluations, composite risk scores,
diurnal rolling forecasting, and FastAPI HTTP endpoints.
"""

import pytest
from fastapi.testclient import TestClient

from .aqi_engine import (
    calculate_sub_index,
    get_cpcb_category,
    compute_cpcb_naqi,
    evaluate_who_guidelines,
    compute_composite_risk_score,
    stratify_vulnerable_groups,
    generate_6hour_forecast,
    get_diurnal_factor,
    compute_action_impact,
)
from .main import app

client = TestClient(app)


# =====================================================================
#  1. CPCB NAQI Sub-Index Calculation Tests
# =====================================================================

class TestCPCBSubIndexCalculations:
    def test_pm25_sub_index_boundaries(self):
        """Test PM2.5 linear interpolation across official CPCB intervals."""
        # 0 - 30 -> 0 - 50
        assert calculate_sub_index("pm25", 0.0) == 0
        assert calculate_sub_index("pm25", 15.0) == 25
        assert calculate_sub_index("pm25", 30.0) == 50

        # 31 - 60 -> 51 - 100
        assert calculate_sub_index("pm25", 60.0) == 100

        # 61 - 90 -> 101 - 200
        assert calculate_sub_index("pm25", 90.0) == 200

        # 91 - 120 -> 201 - 300
        assert calculate_sub_index("pm25", 120.0) == 300

        # 121 - 250 -> 301 - 400
        assert calculate_sub_index("pm25", 250.0) == 400

        # > 250 -> 401 - 500
        assert calculate_sub_index("pm25", 380.0) >= 401

    def test_pm10_sub_index_boundaries(self):
        """Test PM10 linear interpolation."""
        assert calculate_sub_index("pm10", 50.0) == 50
        assert calculate_sub_index("pm10", 100.0) == 100
        assert calculate_sub_index("pm10", 250.0) == 200

    def test_no2_sub_index_boundaries(self):
        """Test NO2 linear interpolation."""
        assert calculate_sub_index("no2", 40.0) == 50
        assert calculate_sub_index("no2", 80.0) == 100
        assert calculate_sub_index("no2", 180.0) == 200

    def test_invalid_or_none_pollutant(self):
        """Test graceful handling of unknown or None inputs."""
        assert calculate_sub_index("unknown_pol", 50.0) is None
        assert calculate_sub_index("pm25", None) is None

    def test_cpcb_overall_naqi_dominant_selection(self):
        """Test that overall AQI equals max sub-index and identifies dominant pollutant."""
        readings = {
            "pm25": 115.0,  # Sub-index ~283 (Poor)
            "pm10": 80.0,   # Sub-index ~80 (Satisfactory)
            "no2": 35.0,    # Sub-index ~44 (Good)
        }
        res = compute_cpcb_naqi(readings)
        assert res["dominant_pollutant"] == "PM2.5"
        assert 250 <= res["aqi"] <= 300
        assert res["category"] == "Poor"


# =====================================================================
#  2. WHO 2021 Guideline Evaluation Tests
# =====================================================================

class TestWHOGuidelineEvaluations:
    def test_who_exceedance_multipliers(self):
        """Test WHO 2021 24h limit comparison math."""
        # PM2.5 limit is 15.0
        readings = {"pm25": 36.0, "pm10": 45.0, "no2": 50.0}
        res = evaluate_who_guidelines(readings)

        pm25_eval = res["evaluations"]["pm25"]
        assert pm25_eval["limit"] == 15.0
        assert pm25_eval["multiplier"] == 2.4
        assert pm25_eval["exceeded"] is True
        assert "2.4x WHO limit" in pm25_eval["label"]

        # PM10 exactly on limit
        pm10_eval = res["evaluations"]["pm10"]
        assert pm10_eval["multiplier"] == 1.0
        assert pm10_eval["exceeded"] is False

        # NO2 (limit 25.0) -> 50.0 = 2.0x
        no2_eval = res["evaluations"]["no2"]
        assert no2_eval["multiplier"] == 2.0
        assert no2_eval["exceeded"] is True

        assert res["overall_compliant"] is False
        assert res["max_exceedance_multiplier"] == 2.4


# =====================================================================
#  3. Composite Respiratory Risk Score & Vulnerability Tests
# =====================================================================

class TestRiskAndVulnerabilityModels:
    def test_composite_risk_score_calculation(self):
        """Test weighted composite respiratory risk score."""
        readings = {"pm25": 45.0, "pm10": 90.0, "no2": 50.0, "o3": 60.0}
        score = compute_composite_risk_score(readings)

        assert 0.0 <= score["crrs"] <= 10.0
        assert score["risk_tier"] in ["Minimal", "Mild", "Moderate", "High", "Critical"]
        assert "contributions" in score

    def test_vulnerable_group_stratification(self):
        """Test vulnerable group advice generation under high pollution."""
        groups = stratify_vulnerable_groups(aqi=245, pm25=120.0)

        assert groups["children"]["status"] == "High Hazard"
        assert "50% more air" in groups["children"]["guidance"]

        assert groups["asthma_cardiac"]["status"] == "Severe Risk"
        assert "purifiers" in groups["asthma_cardiac"]["guidance"]

        assert groups["outdoor_athletes"]["status"] == "Indoor Only"
        assert "400-600%" in groups["outdoor_athletes"]["guidance"]


# =====================================================================
#  4. Diurnal Rolling Forecast Tests
# =====================================================================

class TestDiurnalForecastEngine:
    def test_diurnal_factors(self):
        """Test solar convection peak vs night inversion factors."""
        # Midday solar convection gives lower factor (dilution)
        assert get_diurnal_factor(13) < 1.0
        # Morning inversion gives higher factor (trapped soot)
        assert get_diurnal_factor(7) > 1.0

    def test_6hour_forecast_curve(self):
        """Test 6-hour rolling forecast generation."""
        forecast = generate_6hour_forecast(current_aqi=200, current_pm25=110.0)
        assert len(forecast) == 6
        for pt in forecast:
            assert pt["predicted_aqi"] > 0
            assert pt["predicted_pm25"] > 0
            assert "target_hour" in pt
            assert "category" in pt


# =====================================================================
#  5. FastAPI Endpoint Tests (TestClient)
# =====================================================================

class TestFastAPIEndpoints:
    def test_health_endpoint(self):
        """GET /health should return 200 with service metadata."""
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "airguard-python-analytics"

    def test_analyze_endpoint(self):
        """POST /analyze should return CPCB, WHO, and CRRS analytics."""
        payload = {
            "city": "Chennai",
            "pm25": 52.0,
            "pm10": 89.0,
            "no2": 38.0,
            "o3": 35.0,
            "co": 1.2,
            "so2": 15.0,
        }
        resp = client.post("/analyze", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["city"] == "Chennai"
        assert "cpcb" in data
        assert "who" in data
        assert "composite_risk" in data
        assert "vulnerable_groups" in data

    def test_forecast_endpoint(self):
        """POST /forecast should return 6-hour forecast curve."""
        payload = {"city": "New Delhi", "aqi": 290, "pm25": 165.0}
        resp = client.post("/forecast", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["city"] == "New Delhi"
        assert data["forecast_hours"] == 6
        assert len(data["forecast"]) == 6

    def test_advisory_context_endpoint(self):
        """POST /advisory-context should return clinical context summary."""
        payload = {
            "user_prompt": "Can my child play cricket outside today?",
            "city": "Delhi",
            "aqi": 280,
            "pm25": 160.0,
            "health_concerns": "asthma",
            "family_size": "4",
        }
        resp = client.post("/advisory-context", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "Atmospheric Context for Delhi" in data["context_summary"]
        assert data["recommended_ventilation_window"] == "12:30 PM - 03:30 PM"
        assert data["exercise_safe"] is False

    def test_calculate_impact_endpoint(self):
        """POST /calculate-impact should return physiological & atmospheric benefits."""
        payload = {
            "action": "Switched commute from single-occupancy diesel car to electric metro",
            "category": "Transport",
            "co2_saved": 4.5,
            "aqi": 240,
        }
        resp = client.post("/calculate-impact", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        impact = data["impact"]
        assert impact["co2_saved_kg"] == 4.5
        assert impact["trees_equivalent"] == round(4.5 / 21.7, 2)
        assert impact["pm25_avoided_ug"] > 0
        assert "alveolar" in impact["health_benefit"]


# =====================================================================
#  6. Action Impact & Carbon Reduction Engine Tests
# =====================================================================

class TestActionImpactCalculations:
    def test_compute_action_impact_metrics(self):
        """Test calculation of avoided PM2.5 inhalation mass and tree equivalents."""
        res = compute_action_impact(
            action="Installed MERV-13 filter box in bedroom",
            category="Home",
            co2_kg=2.5,
            aqi=190,
        )
        assert res["co2_saved_kg"] == 2.5
        assert res["trees_equivalent"] == round(2.5 / 21.7, 2)
        assert res["pm25_avoided_ug"] > 0
        assert res["air_quality_impact"] == "-15% localized exposure"

