# Copyright (c) 2025 AccelByte Inc. All Rights Reserved.
# This is licensed software from AccelByte Inc, for limitations
# and restrictions contact your company contract manager.

.PHONY: build clean stop

# Docker image configuration
IMAGE_NAME := ags-api-mcp-server
IMAGE_TAG := latest
FULL_IMAGE_NAME := $(IMAGE_NAME):$(IMAGE_TAG)

# Default configuration
TRANSPORT ?= stdio
PORT ?= 3000
LOG_LEVEL ?= info
NODE_ENV ?= production

# Container name
CONTAINER_NAME := $(IMAGE_NAME)

build: ## Build the Docker image
	@echo "Building Docker image $(FULL_IMAGE_NAME)..."
	docker build -t $(FULL_IMAGE_NAME) .
	@echo "Build complete!"

clean: stop ## Remove the Docker image
	@echo "Removing Docker image $(FULL_IMAGE_NAME)..."
	-docker rmi $(FULL_IMAGE_NAME) 2>/dev/null || true
	@echo "Image removed."
