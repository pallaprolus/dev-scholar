#!/bin/bash

# Check if token file exists
if [ ! -f ".publish_token" ]; then
    echo "Error: .publish_token file not found."
    echo "Please create a file named '.publish_token' in the root directory and paste your PAT inside it."
    exit 1
fi

# Read token
TOKEN=$(cat .publish_token | tr -d '\n')

# Publish
echo "🚀 Publishing version $(node -p "require('./package.json').version")..."
npx vsce publish -p "$TOKEN"
