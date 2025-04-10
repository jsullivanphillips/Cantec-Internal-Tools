import logging
import os
from logging.handlers import RotatingFileHandler

def setup_logging(app):
    try:
        # Define the log file path
        log_file_path = os.path.join(os.path.dirname(__file__), '../..', 'app.log')
        log_file_path = os.path.abspath(log_file_path)

        # File handler
        file_handler = RotatingFileHandler(log_file_path, maxBytes=10000, backupCount=3)
        file_handler.setLevel(logging.INFO)
        file_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        file_handler.setFormatter(file_formatter)

        # Console handler
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        console_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        console_handler.setFormatter(console_formatter)

        # Add handlers to the app logger
        app.logger.addHandler(file_handler)
        app.logger.addHandler(console_handler)

        app.logger.info("Logging setup complete")  # Debug statement
    except Exception as e:
        print(f"Error setting up logging: {e}")  # Print any errors