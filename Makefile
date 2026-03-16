.PHONY: all
all: build

.PHONY: build
build: install
	bun run build
	bun run lint:fix
	bun run fmt

.PHONY: ci
ci: install
	bun run build
	bun run lint
	bun run fmt:check

.PHONY: install
install:
ifeq ($(CI),true)
	bun ci
else
	bun install
endif

.PHONY: upgrade-deps
upgrade-deps:
	bun run upgrade-deps
