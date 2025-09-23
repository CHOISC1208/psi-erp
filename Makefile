.PHONY: migrate stamp

migrate:
	alembic -c backend/alembic.ini upgrade head

ifndef REV
REV_ERROR := REV is required, e.g. make stamp REV=0008
endif

stamp:
ifdef REV_ERROR
	$(error $(REV_ERROR))
endif
	alembic -c backend/alembic.ini stamp $(REV)
