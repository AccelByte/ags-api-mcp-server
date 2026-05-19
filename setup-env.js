#!/usr/bin/env node

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_EXAMPLE = "env.example";
const ENV_FILE = ".env";

function setupEnvironment() {
  console.log("Setting up environment configuration...\n");

  // Check if .env already exists
  if (fs.existsSync(ENV_FILE)) {
    console.log(".env file already exists");
    console.log("If you want to reset it, delete .env and run this script again\n");
    return;
  }

  // Check if env.example exists
  if (!fs.existsSync(ENV_EXAMPLE)) {
    console.error("env.example file not found");
    process.exit(1);
  }

  try {
    // Copy env.example to .env
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log("Created .env file from env.example");

    console.log("Environment file created");

    console.log("\nEnvironment setup complete!");
    console.log("\nNext steps:");
    console.log("1. Edit .env file with your OAuth provider settings");
    console.log("2. Run: pnpm run dev");
    console.log("3. Or run: pnpm run build && pnpm start");

  } catch (error) {
    console.error("Error setting up environment:", error.message);
    process.exit(1);
  }
}


// Run setup if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupEnvironment();
}

export { setupEnvironment };
