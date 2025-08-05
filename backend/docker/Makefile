# P2P Escrow Bot - Docker Management Makefile

.PHONY: help build up down restart logs shell clean backup restore dev prod

# Colors for output
GREEN=\033[0;32m
YELLOW=\033[1;33m
RED=\033[0;31m
NC=\033[0m # No Color

help: ## Show this help message
	@echo "$(GREEN)P2P Escrow Bot - Docker Commands$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "$(YELLOW)%-15s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## Initial setup (create directories, SSL certs, etc.)
	@echo "$(GREEN)Setting up project...$(NC)"
	@chmod +x scripts/*.sh
	@./scripts/docker-setup.sh

build: ## Build Docker images
	@echo "$(GREEN)Building Docker images...$(NC)"
	@docker-compose build

up: ## Start all services
	@echo "$(GREEN)Starting services...$(NC)"
	@docker-compose up -d
	@make status

down: ## Stop all services
	@echo "$(RED)Stopping services...$(NC)"
	@docker-compose down

restart: ## Restart all services
	@make down
	@make up

dev: ## Start development environment
	@echo "$(GREEN)Starting development environment...$(NC)"
	@docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
	@make status

prod: ## Deploy production environment
	@echo "$(GREEN)Deploying production environment...$(NC)"
	@./scripts/docker-prod.sh

status: ## Show service status
	@echo "$(YELLOW)Service Status:$(NC)"
	@docker-compose ps

logs: ## Show logs for all services
	@docker-compose logs -f

logs-bot: ## Show bot logs
	@docker-compose logs -f bot

logs-mongo: ## Show MongoDB logs
	@docker-compose logs -f mongo

logs-nginx: ## Show Nginx logs
	@docker-compose logs -f nginx

shell: ## Open shell in bot container
	@docker-compose exec bot sh

shell-mongo: ## Open MongoDB shell
	@docker-compose exec mongo mongosh -u admin -p password123 --authenticationDatabase admin

health: ## Check service health
	@echo "$(YELLOW)Checking service health...$(NC)"
	@curl -f http://localhost:3000/health && echo "$(GREEN)✅ Bot is healthy$(NC)" || echo "$(RED)❌ Bot is not responding$(NC)"

backup: ## Create backup
	@echo "$(GREEN)Creating backup...$(NC)"
	@./scripts/docker-backup.sh

restore: ## Restore from backup (usage: make restore BACKUP=backup_file.tar.gz)
	@echo "$(GREEN)Restoring from backup...$(NC)"
	@./scripts/docker-restore.sh $(BACKUP)

clean: ## Clean up containers, images, and volumes
	@echo "$(RED)Cleaning up Docker resources...$(NC)"
	@docker-compose down -v
	@docker system prune -f
	@docker volume prune -f

clean-all: ## Remove everything including images
	@make clean
	@docker-compose down --rmi all

update: ## Update and restart services
	@echo "$(GREEN)Updating services...$(NC)"
	@git pull origin main
	@docker-compose pull
	@make build
	@make restart

monitor: ## Show resource usage
	@docker stats $(shell docker-compose ps -q)

ngrok: ## Start ngrok tunnel for development
	@docker-compose --profile ngrok up -d ngrok
	@echo "$(GREEN)Ngrok tunnel started. Web UI: http://localhost:4040$(NC)"

# Development helpers
dev-setup: setup ## Setup development environment
	@cp .env.docker .env
	@echo "$(YELLOW)Please edit .env with your development API keys$(NC)"

dev-logs: ## Follow development logs
	@docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f bot

# Database operations
db-reset: ## Reset database (WARNING: destroys all data)
	@echo "$(RED)This will destroy all data. Are you sure? [y/N]$(NC)" && read ans && [ $${ans:-N} = y ]
	@docker-compose exec mongo mongosh -u admin -p password123 --authenticationDatabase admin --eval "db.getSiblingDB('p2p-escrow').dropDatabase()"
	@echo "$(GREEN)Database reset completed$(NC)"

db-seed: ## Seed database with sample data
	@echo "$(GREEN)Seeding database...$(NC)"
	@docker-compose exec mongo mongosh -u admin -p password123 --authenticationDatabase admin p2p-escrow < docker/seed-data.js

# SSL certificate management
ssl-generate: ## Generate new SSL certificates
	@echo "$(GREEN)Generating SSL certificates...$(NC)"
	@mkdir -p docker/ssl
	@openssl req -x509 -newkey rsa:4096 -keyout docker/ssl/key.pem -out docker/ssl/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Testing
test: ## Run tests
	@docker-compose exec bot npm test

test-integration: ## Run integration tests
	@docker-compose exec bot npm run test:integration

# Maintenance
logs-clear: ## Clear all logs
	@sudo truncate -s 0 logs/app/*.log 2>/dev/null || true
	@sudo truncate -s 0 logs/nginx/*.log 2>/dev/null || true
	@echo "$(GREEN)Logs cleared$(NC)"

restart-bot: ## Restart only the bot service
	@docker-compose restart bot

# Quick aliases
start: up ## Alias for