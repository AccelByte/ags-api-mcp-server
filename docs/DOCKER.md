# Docker Deployment Guide

The MCP server can be deployed using Docker for easy containerization and deployment. This guide covers building, running, and managing Docker containers.

## Building the Docker Image

Build the Docker image from the project directory:

```bash
docker build -t ags-api-mcp-server .
```

The Dockerfile uses a multi-stage build process to create an optimized production image.

## Running with Docker

### Stdio Mode (Default)

To run in stdio mode (default), configure the MCP client to run docker directly. This is the recommended approach for MCP clients like Claude Desktop.

**Example Claude Desktop Configuration**:
```json
{
  "mcpServers": {
    "ags-api": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "TRANSPORT=stdio",
        "-e",
        "AB_BASE_URL=https://yourgame.accelbyte.io",
        "-e",
        "OAUTH_CLIENT_ID=<client_id>",
        "-e",
        "OAUTH_CLIENT_SECRET=<client_secret>",
        "-e",
        "LOG_LEVEL=info",
        "ags-api-mcp-server"
      ]
    }
  }
}
```

**Note**: The `-i` flag is required for interactive mode (stdio), and `--rm` automatically removes the container when it stops.

### HTTP Mode

To run in HTTP mode, add the `TRANSPORT=http` environment variable and expose the port:

```bash
docker run -d \
  --name ags-api-mcp-server \
  -e TRANSPORT=http \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e OAUTH_CLIENT_ID=your-client-id \
  -e OAUTH_CLIENT_SECRET=your-client-secret \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -p 3000:3000 \
  ags-api-mcp-server
```

**Note**: The `-d` flag runs the container in detached mode (background).

## Docker Container Management

### View Logs

View container logs:
```bash
docker logs ags-api-mcp-server
```

Follow logs in real-time:
```bash
docker logs -f ags-api-mcp-server
```

### Stop Container

Stop a running container:
```bash
docker stop ags-api-mcp-server
```

### Remove Container

Remove a stopped container:
```bash
docker rm ags-api-mcp-server
```

Stop and remove in one command:
```bash
docker stop ags-api-mcp-server && docker rm ags-api-mcp-server
```

### Restart Container

Restart a running container:
```bash
docker restart ags-api-mcp-server
```

### Check Container Status

View running containers:
```bash
docker ps
```

View all containers (including stopped):
```bash
docker ps -a
```

## Health Check

The Docker container includes a built-in health check that monitors the `/health` endpoint.

### Check Container Health Status

View container health status:
```bash
docker ps
```

The health status will be displayed in the STATUS column (e.g., "healthy", "unhealthy", or "starting").

### Manual Health Check

Test the health endpoint manually:
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Docker Features

The Docker image includes the following features:

- **Multi-stage build**: Optimized image size with separate build and runtime stages
- **Health checks**: Built-in monitoring of server health via `/health` endpoint
- **Port exposure**: Port 3000 is automatically exposed (configurable via `PORT` environment variable)
- **Production ready**: Configured for production deployment with optimized Node.js settings
- **Lightweight**: Based on Node.js Alpine Linux image for minimal size

## Environment Variables

All environment variables can be passed to the Docker container using the `-e` flag. See [docs/ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for a complete list of available variables.

**Example with multiple environment variables**:
```bash
docker run -d \
  --name ags-api-mcp-server \
  -e AB_BASE_URL=https://yourgame.accelbyte.io \
  -e OAUTH_CLIENT_ID=your-client-id \
  -e OAUTH_CLIENT_SECRET=your-client-secret \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=debug \
  -e TRANSPORT=http \
  -p 3000:3000 \
  ags-api-mcp-server
```

## Using Docker Compose

You can also use Docker Compose for easier management. Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  ags-api-mcp-server:
    build: .
    container_name: ags-api-mcp-server
    ports:
      - "3000:3000"
    environment:
      - TRANSPORT=http
      - AB_BASE_URL=https://yourgame.accelbyte.io
      - OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID}
      - OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET}
      - PORT=3000
      - NODE_ENV=production
      - LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

Then run:
```bash
docker-compose up -d
```

## Troubleshooting

### Container Won't Start

1. Check Docker logs:
   ```bash
   docker logs ags-api-mcp-server
   ```

2. Verify environment variables are set correctly:
   ```bash
   docker inspect ags-api-mcp-server | grep -A 20 Env
   ```

3. Ensure required environment variables are provided (especially `AB_BASE_URL`)

### Port Already in Use

If port 3000 is already in use, change the port mapping:
```bash
docker run -d \
  --name ags-api-mcp-server \
  -p 3001:3000 \
  -e PORT=3000 \
  ...
  ags-api-mcp-server
```

Then access the server at `http://localhost:3001`.

### Container Health Check Failing

1. Check if the server is running inside the container:
   ```bash
   docker exec ags-api-mcp-server wget -qO- http://localhost:3000/health
   ```

2. Review application logs for errors:
   ```bash
   docker logs ags-api-mcp-server
   ```

3. Verify the health check configuration in the Dockerfile matches your setup

### Permission Issues

If you encounter permission issues, ensure Docker has proper permissions:
```bash
# Add your user to the docker group (Linux)
sudo usermod -aG docker $USER
```

### Network Issues

If the container can't reach external services:
1. Check Docker network configuration
2. Verify firewall rules
3. Test connectivity from inside the container:
   ```bash
   docker exec ags-api-mcp-server ping -c 3 yourgame.accelbyte.io
   ```

## Best Practices

1. **Use environment variables**: Never hardcode secrets in Dockerfiles or docker-compose files
2. **Use secrets management**: For production, consider using Docker secrets or external secret management
3. **Monitor logs**: Regularly check container logs for errors or warnings
4. **Health checks**: Rely on health checks for automated monitoring and restart policies
5. **Resource limits**: Set appropriate CPU and memory limits for production deployments:
   ```bash
   docker run -d \
     --memory="512m" \
     --cpus="1.0" \
     ...
     ags-api-mcp-server
   ```

