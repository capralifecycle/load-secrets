.PHONY: all
all: build

.PHONY: build
build: install build fmt lint-fix

.PHONY: ci
ci: install build lint fmt-check

.PHONY: install
install:
ifeq ($(CI),true)
	npm ci
else
	npm install
endif

.PHONY: lint
lint:
	npm run lint

.PHONY: lint-fix
lint-fix:
	npm run lint:fix

.PHONY: lint-fix-unsafe
lint-fix-unsafe:
	npm run lint:fix-unsafe

.PHONY: fmt
fmt:
	npm run fmt

.PHONY: fmt-check
fmt-check:
	npm run fmt:check

.PHONY: upgrade-deps
upgrade-deps:
	npm run upgrade-deps


