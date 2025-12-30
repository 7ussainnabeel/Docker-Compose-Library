.PHONY: all seed secrets config schema functions deploy

# Define variables for commands to avoid repetition
SUPABASE=npx supabase

all: deploy

seed:
	@echo "🌱 Seeding database"
	@$(SUPABASE) db seed || echo "No seed file found, skipping..."

secrets:
	@echo "🔐 Setting secrets"
	@$(SUPABASE) secrets set-from-env

config:
	@echo "⚙️ Applying configuration"
	@$(SUPABASE) config push

schema:
	@echo "🚀 Deploying database schema"
	@$(SUPABASE) db push

functions:
	@echo "⚡ Deploying Edge Functions"
	@$(SUPABASE) functions deploy

deploy: schema seed functions secrets config

help:
	@echo "Available targets:"
	@echo "  all       - Run the deploy target"
	@echo "  seed      - Seed the database"
	@echo "  secrets   - Set secrets from environment"
	@echo "  config    - Apply configuration"
	@echo "  schema    - Deploy database schema"
	@echo "  functions - Deploy Edge Functions"
	@echo "  deploy    - Run schema, seed, functions, secrets, and config targets"
	@echo "  help      - Show this help message"
