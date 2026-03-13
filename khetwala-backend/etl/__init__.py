"""
Khetwala-मित्र ETL Pipelines
═══════════════════════════════════════════════════════════════════════════════

Automated data ingestion from multiple sources.
"""

from etl.mandi_etl import MandiETL
from etl.weather_etl import WeatherETL
from etl.ndvi_etl import NDVIETL
from etl.scheduler import ETLScheduler

__all__ = ["MandiETL", "WeatherETL", "NDVIETL", "ETLScheduler"]
