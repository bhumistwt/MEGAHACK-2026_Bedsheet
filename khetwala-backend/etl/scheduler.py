"""
Khetwala-मित्र ETL Scheduler
═══════════════════════════════════════════════════════════════════════════════

APScheduler-based ETL job scheduler for automated data sync.
Runs daily/hourly ETL pipelines in background.
"""

from datetime import datetime, timezone
from typing import Dict, Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from core.logging import get_logger
from db.session import SessionLocal

logger = get_logger("khetwala.etl.scheduler")


class ETLScheduler:
    """Manages scheduled ETL jobs."""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self._last_run: Dict[str, str] = {}

    def start(self):
        """Start the scheduler with all ETL jobs."""

        # Daily mandi price sync — 6 AM IST (00:30 UTC)
        self.scheduler.add_job(
            self._run_mandi_etl,
            trigger=CronTrigger(hour=0, minute=30),
            id="mandi_daily_sync",
            name="Daily Mandi Price Sync",
            replace_existing=True,
        )

        # Daily weather sync — 7 AM IST (01:30 UTC)
        self.scheduler.add_job(
            self._run_weather_etl,
            trigger=CronTrigger(hour=1, minute=30),
            id="weather_daily_sync",
            name="Daily Weather Sync",
            replace_existing=True,
        )

        # Weekly NDVI sync — Sunday 8 AM IST (02:30 UTC)
        self.scheduler.add_job(
            self._run_ndvi_etl,
            trigger=CronTrigger(day_of_week="sun", hour=2, minute=30),
            id="ndvi_weekly_sync",
            name="Weekly NDVI Sync",
            replace_existing=True,
        )

        self.scheduler.start()
        logger.info("ETL scheduler started with 3 jobs")

    def stop(self):
        """Shutdown scheduler gracefully."""
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("ETL scheduler stopped")

    async def _run_mandi_etl(self):
        """Execute mandi price ETL."""
        logger.info("Starting scheduled mandi ETL...")
        db = SessionLocal()
        try:
            from etl.mandi_etl import MandiETL
            etl = MandiETL(db)
            result = etl.run_daily_sync()
            self._last_run["mandi"] = datetime.now(timezone.utc).isoformat()
            logger.info("Mandi ETL complete", **result)
        except Exception as exc:
            logger.error(f"Mandi ETL failed: {exc}")
        finally:
            db.close()

    async def _run_weather_etl(self):
        """Execute weather ETL."""
        logger.info("Starting scheduled weather ETL...")
        db = SessionLocal()
        try:
            from etl.weather_etl import WeatherETL
            etl = WeatherETL(db)
            result = etl.run_full_sync(days_back=7)  # Incremental: last 7 days
            self._last_run["weather"] = datetime.now(timezone.utc).isoformat()
            logger.info("Weather ETL complete", total=sum(result.values()))
        except Exception as exc:
            logger.error(f"Weather ETL failed: {exc}")
        finally:
            db.close()

    async def _run_ndvi_etl(self):
        """Execute NDVI ETL."""
        logger.info("Starting scheduled NDVI ETL...")
        db = SessionLocal()
        try:
            from etl.ndvi_etl import NDVIETL
            etl = NDVIETL(db)
            result = etl.run_full_sync(days_back=30)
            self._last_run["ndvi"] = datetime.now(timezone.utc).isoformat()
            logger.info("NDVI ETL complete", total=sum(result.values()))
        except Exception as exc:
            logger.error(f"NDVI ETL failed: {exc}")
        finally:
            db.close()

    async def run_initial_sync(self):
        """Run initial data load on startup (if tables are empty)."""
        logger.info("Running initial data sync...")
        db = SessionLocal()
        try:
            from db.models import MandiPrice, WeatherRecord
            price_count = db.query(MandiPrice).count()
            weather_count = db.query(WeatherRecord).count()

            if price_count == 0:
                logger.info("No mandi data found, running initial sync...")
                from etl.mandi_etl import MandiETL
                MandiETL(db).run_full_sync()

            if weather_count == 0:
                logger.info("No weather data found, running initial sync...")
                from etl.weather_etl import WeatherETL
                WeatherETL(db).run_full_sync(days_back=90)

            # Always try NDVI
            from etl.ndvi_etl import NDVIETL
            NDVIETL(db).run_full_sync(days_back=60)

        except Exception as exc:
            logger.error(f"Initial sync failed: {exc}")
        finally:
            db.close()

    def get_status(self) -> Dict[str, Any]:
        """Get scheduler status for health checks."""
        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "name": job.name,
                "next_run": str(job.next_run_time) if job.next_run_time else None,
            })
        return {
            "running": self.scheduler.running,
            "jobs": jobs,
            "last_runs": self._last_run,
        }
