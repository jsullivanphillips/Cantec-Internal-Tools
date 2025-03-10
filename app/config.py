# app/config.py
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "your_secret_key_here")
    SERVICE_TRADE_USERNAME = os.getenv("SERVICE_TRADE_USERNAME")
    SERVICE_TRADE_PASSWORD = os.getenv("SERVICE_TRADE_PASSWORD")
    # Add other configuration items here
