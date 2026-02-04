# Docker Deployment Guide (V2)

Deploy the AGS API MCP Server V2 using Docker for easy containerization and deployment.

> **Note:** This is the V2 Docker guide. V2's stateless architecture simplifies container deployment compared to V1.

---

## V2 Architecture

V2's stateless, HTTP-only design makes it ideal for containerized deployments. See [V2_ARCHITECTURE.md](V2_ARCHITECTURE.md) for details.

---

## Building the Docker Image

### Build from Project Root

```bash
docker build -t ags-api-mcp-server:v2 .
```

The Dockerfile:
- Uses multi-stage build (optimized size)
- Runs V2 by default (`dist/v2/index.js`)
- Based on Node.js Alpine (lightweight)
- Includes health check

### Build with Custom Tag

```bash
docker build -t mycompany/ags-api-mcp-server:2.0.0 .
```

### Build with Custom Tag

```bash
docker build \
  -t ags-api-mcp-server:v2 \
  .
```

---

## Running with Docker

### Basic Run

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e MCP_AUTH=true \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

### With Custom Configuration

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e MCP_PORT=3000 \
  -e MCP_PATH=/mcp \
  -e MCP_AUTH=true \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -e OPENAPI_MAX_SEARCH_LIMIT=50 \
  -e OPENAPI_DEFAULT_RUN_TIMEOUT_MS=15000 \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

### With Environment File

Create `docker.env`:
```bash
AB_BASE_URL=https://yourgame.accelbyte.io
MCP_AUTH=true
NODE_ENV=production
LOG_LEVEL=info
```

Run with env file:
```bash
docker run -d \
  --name ags-api-mcp-server \
  --env-file docker.env \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

### With Volume for OpenAPI Specs

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -v $(pwd)/openapi-specs:/app/openapi-specs:ro \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

---

## Docker Compose

### Basic docker-compose.yml

```yaml
version: '3.8'

services:
  ags-api-mcp-server:
    build: .
    container_name: ags-api-mcp-server
    ports:
      - "3000:3000"
    environment:
      - AB_BASE_URL=https://yourgame.accelbyte.io
      - MCP_AUTH=true
      - NODE_ENV=production
      - LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    restart: unless-stopped
```

### With Volume and Resource Limits

```yaml
version: '3.8'

services:
  ags-api-mcp-server:
    build: .
    container_name: ags-api-mcp-server
    ports:
      - "3000:3000"
    environment:
      - AB_BASE_URL=https://yourgame.accelbyte.io
      - MCP_AUTH=true
      - NODE_ENV=production
      - LOG_LEVEL=info
    volumes:
      - ./openapi-specs:/app/openapi-specs:ro
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
    restart: unless-stopped
```

### Run with Docker Compose

```bash
# Start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

---

## Container Management

### View Logs

```bash
# View all logs
docker logs ags-api-mcp-server

# Follow logs (real-time)
docker logs -f ags-api-mcp-server

# Last 100 lines
docker logs --tail 100 ags-api-mcp-server

# With timestamps
docker logs -t ags-api-mcp-server
```

### Stop Container

```bash
docker stop ags-api-mcp-server
```

### Start Container

```bash
docker start ags-api-mcp-server
```

### Restart Container

```bash
docker restart ags-api-mcp-server
```

### Remove Container

```bash
# Stop and remove
docker stop ags-api-mcp-server
docker rm ags-api-mcp-server

# Force remove (running container)
docker rm -f ags-api-mcp-server
```

### Check Status

```bash
# View running containers
docker ps

# View all containers
docker ps -a

# View container details
docker inspect ags-api-mcp-server
```

---

## Health Checks

V2 includes built-in health check endpoint.

### Check Container Health

```bash
# Via Docker
docker inspect --format='{{.State.Health.Status}}' ags-api-mcp-server

# Via curl
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Health Check Configuration

Docker health check runs every 30 seconds:
- ✅ **healthy** - Endpoint returns 200
- ⚠️ **starting** - Initial 20s grace period
- ❌ **unhealthy** - Failed 5 consecutive checks

---

## Production Deployment

### Resource Limits

Set appropriate limits:

```bash
docker run -d \
  --name ags-api-mcp-server \
  --memory="512m" \
  --memory-reservation="256m" \
  --cpus="1.0" \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

### Restart Policy

```bash
docker run -d \
  --name ags-api-mcp-server \
  --restart=unless-stopped \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

Options:
- `no` - Never restart
- `on-failure` - Restart on error
- `always` - Always restart
- `unless-stopped` - Always restart unless manually stopped

### Network Configuration

```bash
# Create custom network
docker network create ags-network

# Run with custom network
docker run -d \
  --name ags-api-mcp-server \
  --network ags-network \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -p 3000:3000 \
  ags-api-mcp-server:v2
```

---

## Environment Variables

All V2 environment variables work in Docker.

### Recommended

- `AB_BASE_URL` - AccelByte environment URL (defaults to `https://development.accelbyte.io` if unset)

### Optional

- `MCP_PORT` - Server port (default: 3000)
- `MCP_PATH` - Endpoint path (default: /mcp)
- `MCP_AUTH` - Enable auth (default: true)
- `NODE_ENV` - Environment (default: development)
- `LOG_LEVEL` - Log level (default: info)

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for complete list.

---

## Kubernetes Deployment

### Basic Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ags-api-mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ags-api-mcp-server
  template:
    metadata:
      labels:
        app: ags-api-mcp-server
    spec:
      containers:
      - name: ags-api-mcp-server
        image: ags-api-mcp-server:v2
        ports:
        - containerPort: 3000
        env:
        - name: AB_BASE_URL
          value: "https://yourgame.accelbyte.io"
        - name: MCP_AUTH
          value: "true"
        - name: NODE_ENV
          value: "production"
        resources:
          requests:
            memory: "256Mi"
            cpu: "500m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: ags-api-mcp-server
spec:
  selector:
    app: ags-api-mcp-server
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

### With ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ags-api-mcp-server-config
data:
  AB_BASE_URL: "https://yourgame.accelbyte.io"
  MCP_AUTH: "true"
  NODE_ENV: "production"
  LOG_LEVEL: "info"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ags-api-mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ags-api-mcp-server
  template:
    metadata:
      labels:
        app: ags-api-mcp-server
    spec:
      containers:
      - name: ags-api-mcp-server
        image: ags-api-mcp-server:v2
        envFrom:
        - configMapRef:
            name: ags-api-mcp-server-config
        ports:
        - containerPort: 3000
```

---

## Troubleshooting

### Container Won't Start

**Check logs**:
```bash
docker logs ags-api-mcp-server
```

**Common issues**:
- Missing `AB_BASE_URL` environment variable
- Port 3000 already in use
- Invalid configuration

### Health Check Failing

**Test manually**:
```bash
docker exec ags-api-mcp-server wget -qO- http://localhost:3000/health
```

**Check application logs**:
```bash
docker logs ags-api-mcp-server
```

### Port Conflicts

**Change host port**:
```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -p 3001:3000 \
  ags-api-mcp-server:v2
```

Access at `http://localhost:3001`

### Permission Issues

**Linux - Docker socket permissions**:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### Network Issues

**Test connectivity from container**:
```bash
docker exec ags-api-mcp-server ping -c 3 yourgame.accelbyte.io
```

---

## Best Practices

### Security

1. **Don't expose port unnecessarily**: Use reverse proxy
2. **Use environment variables**: Never hardcode secrets
3. **Run as non-root**: Dockerfile already configured
4. **Use secrets management**: Kubernetes secrets, Docker secrets

### Performance

1. **Set resource limits**: Prevent resource exhaustion
2. **Use health checks**: Enable auto-restart
3. **Enable logging**: Monitor container health
4. **Use alpine base**: Smaller image size

### Deployment

1. **Use specific tags**: Avoid `latest` in production
2. **Implement CI/CD**: Automate builds and deployments
3. **Monitor containers**: Use monitoring tools
4. **Backup configurations**: Version control docker-compose.yml

---

## References

- [V2 Architecture](V2_ARCHITECTURE.md)
- [Environment Variables](ENVIRONMENT_VARIABLES.md)
- [Quick Start](QUICK_START.md)
- [Docker Documentation](https://docs.docker.com/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
