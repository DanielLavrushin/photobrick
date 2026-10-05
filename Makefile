# PhotoBrick build entry point. `make` (or `make help`) lists the targets.
#
# The web app is a pnpm workspace (apps/web, packages/engine, tools/palette). The Go server in server/
# embeds the Vite build from server/internal/webui/dist, so `make build` produces one static binary.

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
ADDR    ?= 127.0.0.1:8080
GO      ?= go
PNPM    ?= pnpm

BIN     := out/photobrick
DIST    := server/internal/webui/dist
LDFLAGS := -s -w -X main.version=$(VERSION)

.DEFAULT_GOAL := help
.PHONY: help install web build go-build test lint typecheck dev run clean

help: ## List the targets
	@echo "Usage: make <target> [VERSION=...] [ADDR=host:port]"
	@echo
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN { FS = ":.*## " } { printf "  %-10s %s\n", $$1, $$2 }'

install: ## Install the JS dependencies exactly as locked
	$(PNPM) install --frozen-lockfile

# Vite empties its outDir, .gitkeep included, and //go:embed needs a file there in a fresh clone.
web: ## Build the web app into server/internal/webui/dist
	$(PNPM) build
	@touch $(DIST)/.gitkeep

# go-build runs after web finishes, also under make -j.
build: web ## Build the web app, then the server binary with it embedded (out/photobrick)
	@$(MAKE) --no-print-directory go-build

go-build: ## Build only the server binary, embedding whatever the dist directory holds
	@mkdir -p $(dir $(BIN))
	CGO_ENABLED=0 $(GO) -C server build -trimpath -ldflags "$(LDFLAGS)" -o "$(CURDIR)/$(BIN)" .

test: ## Run the JS tests (vitest) and the Go tests
	$(PNPM) test
	$(GO) -C server test ./...

lint: ## Run eslint, go vet and a gofmt check
	$(PNPM) lint
	$(GO) -C server vet ./...
	@unformatted="$$(gofmt -l server)"; \
	if [ -n "$$unformatted" ]; then echo "gofmt -w needed for:"; echo "$$unformatted"; exit 1; fi

typecheck: ## Type-check the TypeScript projects and compile the Go packages
	$(PNPM) typecheck
	$(GO) -C server build ./...

dev: ## Start the Vite dev server with hot reload (no Go server needed)
	@echo "Vite serves the app on http://localhost:5173 with hot reload. The Go server only serves the"
	@echo "production build, so it isn't needed here; 'make run' tries the embedded build instead."
	$(PNPM) dev

run: build ## Build everything, then run out/photobrick on ADDR
	./$(BIN) -addr $(ADDR)

clean: ## Remove out/ and the web build (keeps the dist placeholder)
	rm -rf $(dir $(BIN))
	find $(DIST) -mindepth 1 -maxdepth 1 ! -name .gitkeep -exec rm -rf {} +
	@touch $(DIST)/.gitkeep
