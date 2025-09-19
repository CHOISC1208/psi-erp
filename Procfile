release: cd backend && alembic upgrade head
web: gunicorn -k uvicorn.workers.UvicornWorker --chdir backend app.main:app --bind 0.0.0.0:$PORT --timeout 120
