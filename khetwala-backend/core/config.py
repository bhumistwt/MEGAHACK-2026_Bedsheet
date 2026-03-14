from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(BASE_DIR / '.env'), '.env'),
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore',
    )

    environment: str = Field(default='development', alias='NODE_ENV')
    api_host: str = Field(default='0.0.0.0', alias='API_HOST')
    api_port: int = Field(default=8000, alias='API_PORT')
    database_url: str = Field(default='sqlite:///./khetwala.db', alias='DATABASE_URL')
    secret_key: str = Field(default='', alias='SECRET_KEY')
    data_gov_api_key: str = Field(default='', alias='DATA_GOV_API_KEY')
    data_gov_base_url: str = Field(default='https://api.data.gov.in', alias='DATA_GOV_BASE_URL')
    data_gov_resource_id: str = Field(default='9ef84268-d588-465a-a308-a864a43d0070', alias='DATA_GOV_RESOURCE_ID')
    google_api_key: str = Field(default='', alias='GOOGLE_API_KEY')
    groq_api_key: str = Field(default='', alias='GROQ_API_KEY')
    llm_provider: str = Field(default='groq', alias='LLM_PROVIDER')
    groq_chat_model: str = Field(default='llama-3.3-70b-versatile', alias='GROQ_CHAT_MODEL')
    groq_audio_model: str = Field(default='whisper-large-v3-turbo', alias='GROQ_AUDIO_MODEL')
    twilio_account_sid: str = Field(default='', alias='TWILIO_ACCOUNT_SID')
    twilio_auth_token: str = Field(default='', alias='TWILIO_AUTH_TOKEN')
    twilio_phone_number: str = Field(default='', alias='TWILIO_PHONE_NUMBER')
    voice_agent_public_base_url: str = Field(default='http://127.0.0.1:8000', alias='VOICE_AGENT_PUBLIC_BASE_URL')
    voice_agent_internal_api_base_url: str = Field(default='', alias='VOICE_AGENT_INTERNAL_API_BASE_URL')
    voice_agent_feature_timeout_seconds: int = Field(default=12, alias='VOICE_AGENT_FEATURE_TIMEOUT_SECONDS')
    voice_agent_human_operator_number: str = Field(default='', alias='VOICE_AGENT_HUMAN_OPERATOR_NUMBER')
    voice_agent_max_silence_retries: int = Field(default=2, alias='VOICE_AGENT_MAX_SILENCE_RETRIES')
    etl_enabled: bool = Field(default=True, alias='ETL_ENABLED')
    log_level: str = Field(default='INFO', alias='LOG_LEVEL')
    log_json_format: bool = Field(default=False, alias='LOG_JSON_FORMAT')
    cors_origins: str = Field(default='http://localhost:8081,http://127.0.0.1:8081', alias='CORS_ORIGINS')

    @property
    def is_development(self) -> bool:
        return self.environment.lower() == 'development'

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == 'production'

    @property
    def cors_origins_list(self) -> list[str]:
        raw = (self.cors_origins or '*').strip()
        if raw == '*' and not self.is_production:
            return ['*']
        if raw == '*':
            return []
        return [origin.strip() for origin in raw.split(',') if origin.strip()]

    @property
    def datagov_api_key(self) -> str:
        return self.data_gov_api_key

    @property
    def has_llm_provider(self) -> bool:
        return bool((self.groq_api_key or '').strip() or (self.google_api_key or '').strip())

    def get_api_status(self) -> dict[str, str]:
        return {
            'market': 'active' if self.data_gov_api_key else 'fallback',
            'weather': 'active',
            'predict': 'active',
            'aria': 'active' if self.has_llm_provider else 'fallback',
            'voice_agent': 'active' if self.has_llm_provider else 'fallback',
        }


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
