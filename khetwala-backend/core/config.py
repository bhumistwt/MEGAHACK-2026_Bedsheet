from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore',
    )

    environment: str = Field(default='development', alias='NODE_ENV')
    api_host: str = Field(default='0.0.0.0', alias='API_HOST')
    api_port: int = Field(default=8000, alias='API_PORT')
    database_url: str = Field(default='sqlite:///./khetwala.db', alias='DATABASE_URL')
    secret_key: str = Field(default='change-this-in-production', alias='SECRET_KEY')
    data_gov_api_key: str = Field(default='', alias='DATA_GOV_API_KEY')
    data_gov_base_url: str = Field(default='https://api.data.gov.in', alias='DATA_GOV_BASE_URL')
    data_gov_resource_id: str = Field(default='9ef84268-d588-465a-a308-a864a43d0070', alias='DATA_GOV_RESOURCE_ID')
    google_api_key: str = Field(default='', alias='GOOGLE_API_KEY')
    etl_enabled: bool = Field(default=True, alias='ETL_ENABLED')
    log_level: str = Field(default='INFO', alias='LOG_LEVEL')
    log_json_format: bool = Field(default=False, alias='LOG_JSON_FORMAT')
    cors_origins: str = Field(default='*', alias='CORS_ORIGINS')

    @property
    def is_development(self) -> bool:
        return self.environment.lower() == 'development'

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == 'production'

    @property
    def cors_origins_list(self) -> list[str]:
        raw = (self.cors_origins or '*').strip()
        if raw == '*':
            return ['*']
        return [origin.strip() for origin in raw.split(',') if origin.strip()]

    @property
    def datagov_api_key(self) -> str:
        return self.data_gov_api_key

    def get_api_status(self) -> dict[str, str]:
        return {
            'market': 'active' if self.data_gov_api_key else 'fallback',
            'weather': 'active',
            'predict': 'active',
            'aria': 'active' if self.google_api_key else 'fallback',
        }


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
