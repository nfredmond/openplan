.PHONY: help carto-install story-pack story-pack-existing check-pipeline-root

# Path to a checkout of the external map-data-pipeline project. There is no
# default: it is not part of this repository, so point this at your own copy,
# e.g. `make story-pack MAP_PIPELINE_ROOT=/path/to/map-data-pipeline`.
MAP_PIPELINE_ROOT ?=
JURISDICTION ?= sample-jurisdiction
CORRIDOR ?= sample-corridor
STORY_PACK_OUT ?= .artifacts/story-pack

help:
	@echo "Targets:"
	@echo "  make carto-install                # install pinned CARTO CLI"
	@echo "  make story-pack                   # run map pipeline + build report/web/motion manifests"
	@echo "  make story-pack-existing          # build manifests from existing exports only"

carto-install:
	./scripts/setup_carto_cli.sh

check-pipeline-root:
	@test -n "$(MAP_PIPELINE_ROOT)" || { echo "MAP_PIPELINE_ROOT is required — set it to your map-data-pipeline checkout"; exit 1; }

story-pack: check-pipeline-root
	python3 $(MAP_PIPELINE_ROOT)/integration/scripts/run_pipeline.py
	python3 ./scripts/make_story_pack.py \
		--pipeline-root $(MAP_PIPELINE_ROOT) \
		--jurisdiction $(JURISDICTION) \
		--corridor $(CORRIDOR) \
		--output-dir $(STORY_PACK_OUT)

story-pack-existing: check-pipeline-root
	python3 ./scripts/make_story_pack.py \
		--pipeline-root $(MAP_PIPELINE_ROOT) \
		--jurisdiction $(JURISDICTION) \
		--corridor $(CORRIDOR) \
		--output-dir $(STORY_PACK_OUT)
