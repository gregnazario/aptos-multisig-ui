.PHONY: install build dev start deploy restart logs status db-push db-studio lint format test clean

# Local development
install:
	pnpm install
	pnpm rebuild better-sqlite3

build:
	pnpm build

dev:
	pnpm dev

start:
	pnpm start

# Server deployment (run on the VM)
deploy: install build db-push restart

restart:
	pm2 restart multisig || pm2 start "pnpm start" --name multisig

logs:
	pm2 logs multisig

status:
	pm2 status

# Database
db-push:
	pnpm drizzle-kit push

db-studio:
	pnpm drizzle-kit studio

# Code quality
lint:
	pnpm lint

format:
	pnpm format

test:
	pnpm test

# Pull latest and deploy
update:
	git pull
	$(MAKE) deploy

clean:
	rm -rf .next node_modules
