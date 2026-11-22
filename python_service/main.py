"""
AirGuard FastAPI Analytics & AI Microservice.

Exposes high-performance REST endpoints for environmental telemetry analysis,
CPCB vs WHO guideline calculations, multi-pollutant composite respiratory risk scores,
6-hour diurnal rolling forecasts, and clinical advisory context generation.
"""

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from .aqi_engine import (
    compute_cpcb_naqi,
    evaluate_who_guidelines,
    compute_composite_risk_score,
    stratify_vulnerable_groups,
    generate_6hour_forecast,
    get_cpcb_category,
    compute_action_impact,
)

app = FastAPI(
    title="AirGuard Environmental Analytics Service",
    description="High-precision atmospheric analytics, dual standards evaluation, and diurnal rolling forecasting.",
    version="1.0.0",
)

# Enable CORS for local Express server and development tools
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================================================================
#  Request / Response Schemas
# =====================================================================

class TelemetryInput(BaseModel):
    city: Optional[str] = Field(default="New Delhi", description="City name")
    aqi: Optional[int] = Field(default=None, description="Reported AQI value")
    pm25: Optional[float] = Field(default=None, description="PM2.5 in µg/m³")
    pm10: Optional[float] = Field(default=None, description="PM10 in µg/m³")
    no2: Optional[float] = Field(default=None, description="NO2 in µg/m³")
    o3: Optional[float] = Field(default=None, description="Ozone in µg/m³")
    so2: Optional[float] = Field(default=None, description="SO2 in µg/m³")
    co: Optional[float] = Field(default=None, description="CO in mg/m³")
    temperature: Optional[str] = Field(default=None, description="Ambient temperature")
    humidity: Optional[str] = Field(default=None, description="Ambient humidity")


class ForecastInput(BaseModel):
    city: Optional[str] = Field(default="New Delhi")
    aqi: Optional[int] = Field(default=185)
    pm25: Optional[float] = Field(default=115.0)


class AdvisoryContextInput(BaseModel):
    user_prompt: str = Field(..., min_length=1, description="User's query")
    city: Optional[str] = Field(default="New Delhi")
    aqi: Optional[int] = Field(default=185)
    pm25: Optional[float] = Field(default=115.0)
    pm10: Optional[float] = Field(default=160.0)
    family_size: Optional[str] = Field(default="3-4")
    health_concerns: Optional[str] = Field(default="none")


class ImpactInput(BaseModel):
    action: str = Field(..., min_length=1, description="Sustainability action name")
    category: Optional[str] = Field(default="Lifestyle")
    co2_saved: Optional[float] = Field(default=0.0)
    aqi: Optional[int] = Field(default=150)


# =====================================================================
#  Endpoints
# =====================================================================

@app.get("/health", status_code=status.HTTP_200_OK)
def health_check() -> Dict[str, Any]:
    """Microservice health check and metadata probe."""
    return {
        "status": "ok",
        "service": "airguard-python-analytics",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/analyze", status_code=status.HTTP_200_OK)
def analyze_telemetry(payload: TelemetryInput) -> Dict[str, Any]:
    """
    Comprehensive environmental telemetry analysis:
    - CPCB sub-index breakdown and dominant pollutant identification
    - WHO 2021 24-hour guideline compliance and exceedance multipliers
    - Composite Respiratory Risk Score (CRRS, 0.0 - 10.0 scale)
    - Vulnerability group risk stratification (children, seniors, asthma, athletes)
    """
    data_dict = payload.model_dump()
    readings = {k: v for k, v in data_dict.items() if k in ["pm25", "pm10", "no2", "o3", "so2", "co", "aqi"]}

    cpcb_result = compute_cpcb_naqi(readings)
    who_result = evaluate_who_guidelines(readings)
    risk_result = compute_composite_risk_score(readings)

    active_aqi = cpcb_result["aqi"]
    active_pm25 = float(payload.pm25 or (active_aqi * 0.6))
    vulnerability = stratify_vulnerable_groups(active_aqi, active_pm25)

    return {
        "city": payload.city,
        "cpcb": cpcb_result,
        "who": who_result,
        "composite_risk": risk_result,
        "vulnerable_groups": vulnerability,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/forecast", status_code=status.HTTP_200_OK)
def forecast_telemetry(payload: ForecastInput) -> Dict[str, Any]:
    """
    Computes a 6-hour rolling forecast curve projecting AQI and PM2.5 trends
    using solar diurnal boundary layer atmospheric physics.
    """
    current_aqi = max(1, int(payload.aqi or 150))
    current_pm25 = max(1.0, float(payload.pm25 or 75.0))

    curve = generate_6hour_forecast(current_aqi, current_pm25)

    return {
        "city": payload.city,
        "current_aqi": current_aqi,
        "current_pm25": current_pm25,
        "forecast_hours": len(curve),
        "forecast": curve,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/advisory-context", status_code=status.HTTP_200_OK)
def generate_advisory_context(payload: AdvisoryContextInput) -> Dict[str, Any]:
    """
    Generates structured, clinical-grade environmental context for the Generative AI assistant
    incorporating atmospheric telemetry, WHO exceedance ratios, and risk stratification.
    """
    aqi = int(payload.aqi or 185)
    pm25 = float(payload.pm25 or 115.0)
    who_mult = round(pm25 / 15.0, 1)

    cpcb_cat = get_cpcb_category(aqi)["label"]
    vulnerability = stratify_vulnerable_groups(aqi, pm25)

    context_summary = (
        f"Atmospheric Context for {payload.city}: AQI is {aqi} ({cpcb_cat}). "
        f"PM2.5 is {pm25} µg/m³ ({who_mult}x WHO 24h limit). "
        f"Household: {payload.family_size} people, health focus: {payload.health_concerns}. "
        f"Optimal home ventilation window: 12:30 PM - 03:30 PM (solar convection dispersion). "
        f"Pediatric Risk: {vulnerability['children']['status']}. "
        f"Cardiovascular/Asthma Alert: {vulnerability['asthma_cardiac']['status']}."
    )

    return {
        "context_summary": context_summary,
        "cpcb_category": cpcb_cat,
        "who_multiplier": who_mult,
        "recommended_ventilation_window": "12:30 PM - 03:30 PM",
        "exercise_safe": aqi <= 150,
        "vulnerability_flags": {
            "children": vulnerability["children"]["status"],
            "asthma": vulnerability["asthma_cardiac"]["status"],
            "athletes": vulnerability["outdoor_athletes"]["status"],
        },
    }


@app.post("/calculate-impact", status_code=status.HTTP_200_OK)
def calculate_action_impact(payload: ImpactInput) -> Dict[str, Any]:
    """
    Computes environmental emission savings, avoided PM2.5 lung burden,
    and clinical pulmonary benefits for completed or planned sustainability actions.
    """
    impact_data = compute_action_impact(
        action=payload.action,
        category=payload.category or "Lifestyle",
        co2_kg=payload.co2_saved or 0.0,
        aqi=payload.aqi,
    )
    return {
        "status": "success",
        "impact": impact_data,
        "calculated_at": datetime.now(timezone.utc).isoformat(),
    }

