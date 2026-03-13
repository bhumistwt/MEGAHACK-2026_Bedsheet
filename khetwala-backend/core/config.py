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


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
