.PHONY: all
all: build

.PHONY: build
build:
	@echo "Building..."
	npm install
	npm run build
	npm run lint
