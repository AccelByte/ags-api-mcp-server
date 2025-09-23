#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ENV_EXAMPLE = 'env.example';
const ENV_FILE = '.env';

function setupEnvironment() {
  console.log('🔧 Setting up environment configuration...\n');

  // Check if .env already exists
  if (fs.existsSync(ENV_FILE)) {
    console.log('✅ .env file already exists');
    console.log('   If you want to reset it, delete .env and run this script again\n');
    return;
  }

  // Check if env.example exists
  if (!fs.existsSync(ENV_EXAMPLE)) {
    console.error('❌ env.example file not found');
    process.exit(1);
  }

  try {
    // Copy env.example to .env
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log('✅ Created .env file from env.example');

    // Generate a random JWT secret
    const jwtSecret = generateJWTSecret();
    const envContent = fs.readFileSync(ENV_FILE, 'utf8');
    const updatedContent = envContent.replace(
      'JWT_SECRET=your_jwt_secret_key_here',
      `JWT_SECRET=${jwtSecret}`
    );
    fs.writeFileSync(ENV_FILE, updatedContent);
    console.log('✅ Generated secure JWT secret');

    console.log('\n🎉 Environment setup complete!');
    console.log('\nNext steps:');
    console.log('1. Edit .env file with your OAuth provider settings');
    console.log('2. Run: npm run dev');
    console.log('3. Or run: npm run build && npm start');

  } catch (error) {
    console.error('❌ Error setting up environment:', error.message);
    process.exit(1);
  }
}

function generateJWTSecret() {
  const crypto = require('crypto');
  return crypto.randomBytes(64).toString('hex');
}

// Run setup if this file is executed directly
if (require.main === module) {
  setupEnvironment();
}

module.exports = { setupEnvironment };
