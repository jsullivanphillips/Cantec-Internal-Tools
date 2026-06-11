from app import create_app
from app.scripts.migrate_monthly_flat_locations import main

if __name__ == '__main__':
    raise SystemExit(main(['--execute']))
