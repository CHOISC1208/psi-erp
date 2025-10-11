PYTHON ?= python

.PHONY: init-db

init-db:
	$(PYTHON) -m backend.app.init_db
