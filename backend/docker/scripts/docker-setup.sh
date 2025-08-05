#!/bin/bash
# scripts/docker-setup.sh - Docker setup script

set -e

echo "🐳 Setting up P2P Escrow Bot with Docker..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs/{app,nginx}
mkdir -p docker/ssl

# Copy environment file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.docker .env
    echo "⚠️  Please edit .env file with your actual API keys!"
fi

# Create SSL directory and self-signed certificates for development
if [ ! -f "docker/ssl/cert.pem" ]; then
    echo "🔐 Creating self-signed SSL certificates for development..."
    openssl req -x509 -newkey rsa:4096 -keyout docker/ssl/key.pem -out docker/ssl/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
fi

echo "✅ Setup completed!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your API keys"
echo "2. Run: docker-compose up -d"
echo "3. Check logs: docker-compose logs -f"

# =====================================================

#!/bin/bash
# scripts/docker-dev.sh - Development environment script

set -e

echo "🚀 Starting development environment..."

# Build and start development services
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d

# Show service status
echo "📊 Service Status:"
docker-compose ps

# Show logs
echo "📝 Starting to show logs (Ctrl+C to stop)..."
docker-compose logs -f bot

# =====================================================

#!/bin/bash
# scripts/docker-prod.sh - Production deployment script

set -e

echo "🚀 Deploying to production..."

# Pull latest code
git pull origin main

# Build production images
docker-compose build --no-cache

# Start services
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check health
echo "🏥 Checking service health..."
docker-compose exec bot curl -f http://localhost:3000/health || echo "❌ Health check failed"

# Show status
docker-compose ps

echo "✅ Production deployment completed!"

# =====================================================

#!/bin/bash
# scripts/docker-backup.sh - Backup script

set -e

BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "💾 Creating backup in $BACKUP_DIR..."

# Backup MongoDB
echo "📦 Backing up MongoDB..."
docker-compose exec -T mongo mongodump --host localhost --port 27017 --authenticationDatabase admin -u admin -p password123 --out /tmp/backup
docker cp $(docker-compose ps -q mongo):/tmp/backup "$BACKUP_DIR/mongodb"

# Backup environment and configs
echo "📋 Backing up configuration..."
cp .env "$BACKUP_DIR/"
cp -r docker/ "$BACKUP_DIR/"

# Create archive
echo "🗜️  Creating archive..."
tar -czf "$BACKUP_DIR.tar.gz" -C "$BACKUP_DIR" .
rm -rf "$BACKUP_DIR"

echo "✅ Backup completed: $BACKUP_DIR.tar.gz"

# =====================================================

#!/bin/bash
# scripts/docker-restore.sh - Restore script

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <backup_file.tar.gz>"
    exit 1
fi

BACKUP_FILE="$1"
RESTORE_DIR="./restore_$(date +%Y%m%d_%H%M%S)"

echo "🔄 Restoring from $BACKUP_FILE..."

# Extract backup
mkdir -p "$RESTORE_DIR"
tar -xzf "$BACKUP_FILE" -C "$RESTORE_DIR"

# Stop services
echo "⏹️  Stopping services..."
docker-compose down

# Restore MongoDB
echo "📦 Restoring MongoDB..."
docker-compose up -d mongo
sleep 5
docker cp "$RESTORE_DIR/mongodb" $(docker-compose ps -q mongo):/tmp/restore
docker-compose exec mongo mongorestore --host localhost --port 27017 --authenticationDatabase admin -u admin -p password123 /tmp/restore

# Restore configs (with confirmation)
echo "📋 Restore configuration files? (y/N)"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
    cp "$RESTORE_DIR/.env" .env
    cp -r "$RESTORE_DIR/docker/" ./
fi

# Start services
echo "🚀 Starting services..."
docker-compose up -d

# Cleanup
rm -rf "$RESTORE_DIR"

echo "✅ Restore completed!"

# =====================================================

#!/bin/bash
# scripts/docker-logs.sh - Log management script

case "$1" in
    "tail")
        docker-compose logs -f "${2:-bot}"
        ;;
    "error")
        docker-compose logs --tail=100 | grep -i error
        ;;
    "clear")
        sudo truncate -s 0 logs/app/*.log
        sudo truncate -s 0 logs/nginx/*.log
        echo "✅ Logs cleared"
        ;;
    *)
        echo "Usage: $0 {tail|error|clear} [service]"
        echo "  tail [service] - Follow logs for service (default: bot)"
        echo "  error          - Show recent errors"
        echo "  clear          - Clear all log files"
        ;;
esac