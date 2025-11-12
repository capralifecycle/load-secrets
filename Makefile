.PHONY: all
all: build

.PHONY: build
build:
	@echo "Building..."
	npm install
	npm run build
	npm run lint

.PHONY: lint
lint:
	npm run lint

.PHONY: lint-fix
lint-fix:
	npm run lint:fix

.PHONY: lint-fix-unsafe
lint-fix-unsafe:
	npm run lint:fix-unsafe
