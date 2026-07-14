.PHONY: help install build dev start deploy restart caddy caddy-stop logs status db-push db-studio lint format test update clean

.DEFAULT_GOAL := help

# Load configuration from .env.local (if present) and export the variables that
# the server and reverse proxy need. Only these are exported to avoid clobbering
# secrets that Next.js already loads from .env.local itself (e.g. JWT_SECRET).
-include .env.local

# Default the port when it is unset or empty (an empty environment PORT would
# otherwise defeat a plain `?=`). Values from .env.local take precedence.
ifeq ($(strip $(PORT)),)
PORT := 3000
endif

export DOMAIN PORT

help: ## Show this help message
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Local development
install: ## Install dependencies and rebuild native modules
	pnpm install
	pnpm rebuild better-sqlite3

build: ## Build the production bundle
	pnpm build

dev: ## Run the dev server
	pnpm dev

start: ## Start the production server
	pnpm start

# Server deployment (run on the VM)
deploy: install build db-push restart caddy ## Full server deploy: install, build, db-push, restart, caddy

restart: ## Restart (or start) the pm2 process
	pm2 restart multisig --update-env || pm2 start "pnpm start" --name multisig

caddy: ## Start or reload the Caddy HTTPS reverse proxy (needs DOMAIN in .env.local)
	@if [ -z "$(DOMAIN)" ]; then \
		echo "DOMAIN not set in .env.local — skipping Caddy (app is HTTP-only on port $(PORT))"; \
	else \
		caddy reload --config Caddyfile 2>/dev/null || caddy start --config Caddyfile; \
		echo "Caddy serving https://$(DOMAIN) -> localhost:$(PORT)"; \
	fi

caddy-stop: ## Stop the running Caddy instance
	caddy stop

logs: ## Tail pm2 logs for the multisig process
	pm2 logs multisig

status: ## Show pm2 process status
	pm2 status

# Database
db-push: ## Apply Drizzle schema changes to the database
	pnpm drizzle-kit push

db-studio: ## Open Drizzle Studio in the browser
	pnpm drizzle-kit studio

# Code quality
lint: ## Run the linter
	pnpm lint

format: ## Format the codebase
	pnpm format

test: ## Run the test suite
	pnpm test

# Pull latest and deploy
update: ## Pull latest main and run a full deploy
	git pull
	$(MAKE) deploy

clean: ## Remove .next and node_modules
	rm -rf .next node_modules
