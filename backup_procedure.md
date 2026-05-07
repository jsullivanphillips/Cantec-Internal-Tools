Backups are stored every day at 03:00 AM UTC.

backup
heroku pg:backups:capture

view backups
heroku pg:backups --app your-app-name

scheduled backup 
heroku pg:backups:schedule DATABASE_URL --at "03:00 UTC" --app your-app-name

download backup to url
heroku pg:backups:url --app your-app-name

download directly
heroku pg:backups:download --app your-app-name

restore to database
heroku pg:backups:restore <BACKUP_ID> DATABASE_URL --app your-app-name