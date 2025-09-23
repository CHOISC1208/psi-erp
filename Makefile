ALEMBIC = alembic -c backend/alembic.ini
REV ?= head

.PHONY: migrate stamp downgrade

migrate:
	$(ALEMBIC) upgrade head

stamp:
	$(ALEMBIC) stamp $(REV)

downgrade:
	$(ALEMBIC) downgrade $(REV)
