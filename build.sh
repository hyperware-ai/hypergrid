#!/bin/bash

set -e  # Exit on error

# Default environment
ENVIRONMENT="staging"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--env] [production|staging] [-- kit_options]"
            echo ""
            echo "Environments:"
            echo "  production          - Build for production with ware.hypr publisher"
            echo "  staging  (default)  - Build for staging with test.hypr publisher"
            echo ""
            echo "Kit Options:"
            echo "  All arguments after '--' are passed directly to 'kit build'"
            echo "  Common kit options: --verbose, --release, --features=..., etc."
            echo ""
            echo "Examples:"
            echo "  $0                                    # Build for staging"
            echo "  $0 --env production                   # Build for production"
            echo "  $0 -- --verbose                       # Production build with verbose output"
            echo "  $0 --env staging -- --verbose         # Staging build with verbose output"
            echo "  $0 -- --release --features=extra      # Production with release mode and features"
            echo ""
            echo "Chaining commands:"
            echo "  $0 --env staging && kit s my-node     # Build staging then start on my-node"
            echo "  $0 && echo 'Build complete!'          # Build then run command on success"
            exit 0
            ;;
        *)
            # Pass through other arguments to kit build
            EXTRA_ARGS="$EXTRA_ARGS $1"
            shift
            ;;
    esac
done

# Validate environment
if [[ "$ENVIRONMENT" != "production" && "$ENVIRONMENT" != "staging" ]]; then
    echo "Error: Invalid environment '$ENVIRONMENT'. Must be 'production' or 'staging'."
    exit 1
fi

echo "Building HPN for $ENVIRONMENT environment..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Copy environment-specific constants
echo -e "${BLUE}Setting up $ENVIRONMENT constants...${NC}"
cp "constants/$ENVIRONMENT.rs" operator/operator/src/constants.rs
cp "constants/$ENVIRONMENT.rs" provider/provider/src/constants.rs
cp "constants/$ENVIRONMENT.ts" operator/ui/src/constants.ts
cp "constants/$ENVIRONMENT.ts" provider/ui/src/constants.ts

# Set publisher based on environment
if [[ "$ENVIRONMENT" == "staging" ]]; then
    PUBLISHER="test.hypr"
    ZIP_PUBLISHER="test"
else
    PUBLISHER="ware.hypr"
    ZIP_PUBLISHER="ware"
fi

# Update metadata.json and scripts.json with the correct publisher
echo -e "${BLUE}Updating metadata files for $ENVIRONMENT (publisher: $PUBLISHER)...${NC}"
if [[ -f "metadata.json" ]]; then
    sed -i.bak "s/\"publisher\": \"[^\"]*\"/\"publisher\": \"$PUBLISHER\"/g" metadata.json
    rm metadata.json.bak
fi



echo -e "${GREEN}Environment setup complete for $ENVIRONMENT${NC}"
echo -e "${BLUE}Building HPN packages...${NC}"

# Clean up any existing pkg directory at root (but preserve manifest.json)
if [ -d "pkg" ]; then
    echo -e "${BLUE}Cleaning existing pkg directory (preserving manifest.json)...${NC}"
    # Save manifest.json if it exists
    if [ -f "pkg/manifest.json" ]; then
        cp pkg/manifest.json /tmp/hpn_manifest_backup.json
    fi
    
    # Remove everything else in pkg
    find pkg -mindepth 1 ! -name 'manifest.json' -exec rm -rf {} + 2>/dev/null || true
else
    # Create the pkg directory if it doesn't exist
    mkdir -p pkg
fi

# Restore manifest.json if it was backed up
if [ -f "/tmp/hpn_manifest_backup.json" ]; then
    mv /tmp/hpn_manifest_backup.json pkg/manifest.json
fi

# Update publisher in metadata.json files before building
echo -e "${BLUE}Updating publisher in metadata files...${NC}"
sed -i.bak "s/\"publisher\": \"[^\"]*\"/\"publisher\": \"$PUBLISHER\"/g" operator/metadata.json
sed -i.bak "s/\"publisher\": \"[^\"]*\"/\"publisher\": \"$PUBLISHER\"/g" provider/metadata.json

# Build operator
echo -e "${BLUE}Building operator...${NC}"
cd operator
kit build $EXTRA_ARGS
cd ..

# Build provider
echo -e "${BLUE}Building provider...${NC}"
cd provider
kit build --hyperapp $EXTRA_ARGS
cd ..

# Restore original metadata files after build
mv operator/metadata.json.bak operator/metadata.json
mv provider/metadata.json.bak provider/metadata.json

# Copy operator pkg contents (except manifest.json, api, and scripts.json)
echo -e "${BLUE}Copying operator build artifacts...${NC}"
for item in operator/pkg/*; do
    basename=$(basename "$item")
    if [[ "$basename" != "manifest.json" && "$basename" != "api" && "$basename" != "scripts.json" ]]; then
        if [ -d "$item" ]; then
            # If it's the ui directory, rename it to just "ui"
            if [ "$basename" = "ui" ]; then
                cp -r "$item" pkg/ui
            else
                cp -r "$item" "pkg/$basename"
            fi
        else
            cp "$item" "pkg/$basename"
        fi
    fi
done

# Copy provider pkg contents (except manifest.json, api, and scripts.json)
echo -e "${BLUE}Copying provider build artifacts...${NC}"
for item in provider/pkg/*; do
    basename=$(basename "$item")
    if [[ "$basename" != "manifest.json" && "$basename" != "api" && "$basename" != "scripts.json" ]]; then
        if [ -d "$item" ]; then
            # If it's the ui directory, rename it to "provider-ui"
            if [ "$basename" = "ui" ]; then
                cp -r "$item" pkg/provider-ui
            else
                cp -r "$item" "pkg/$basename"
            fi
        else
            # Skip .DS_Store files
            if [ "$basename" != ".DS_Store" ]; then
                cp "$item" "pkg/$basename"
            fi
        fi
    fi
done

# Handle API files and create merged api directory
echo -e "${BLUE}Merging API files...${NC}"

# Create the api directory in pkg
mkdir -p pkg/api

# Copy WIT files from operator api directory if it exists
if [ -d "operator/pkg/api" ]; then
    echo "Copying operator API files..."
    find "operator/pkg/api" -name "*.wit" -o -name "*.wt" | while read -r file; do
        cp "$file" "pkg/api/"
    done
fi

# Copy WIT files from provider api directory if it exists
if [ -d "provider/pkg/api" ]; then
    echo "Copying provider API files..."
    find "provider/pkg/api" -name "*.wit" -o -name "*.wt" | while read -r file; do
        cp "$file" "pkg/api/"
    done
fi

# Create api.zip from the merged api directory
if [ -n "$(ls -A pkg/api 2>/dev/null)" ]; then
    echo "Creating api.zip..."
    cd pkg/api
    zip -q ../api.zip *
    cd ../..
    echo -e "${GREEN}API files merged successfully${NC}"
else
    echo -e "${RED}Warning: No WIT files found in api directories${NC}"
fi

# Verify manifest.json is present
if [ -f "pkg/manifest.json" ]; then
    echo -e "${GREEN}manifest.json preserved in pkg/${NC}"
else
    echo -e "${RED}Error: manifest.json not found in pkg/${NC}"
    echo "Please ensure this file exists in the pkg/ directory before running this script."
    exit 1
fi

# Create the package zip file for kit s
echo -e "${BLUE}Creating package zip file...${NC}"

# Create target directory if it doesn't exist
mkdir -p target

# Use the publisher from the environment for zip name (without .hypr TLD)
ZIP_NAME="hypergrid:${ZIP_PUBLISHER}.zip"
echo "Creating target/$ZIP_NAME..."

# Remove old zip if it exists
if [ -f "target/$ZIP_NAME" ]; then
    rm "target/$ZIP_NAME"
fi

# Create the zip file from pkg directory contents
cd pkg
zip -q -r "../target/$ZIP_NAME" .
cd ..

if [ -f "target/$ZIP_NAME" ]; then
    echo -e "${GREEN}Package zip created successfully${NC}"
    ZIP_SIZE=$(ls -lh "target/$ZIP_NAME" | awk '{print $5}')
    echo "Created: target/$ZIP_NAME (${ZIP_SIZE})"
else
    echo -e "${RED}Failed to create package zip${NC}"
    exit 1
fi

echo -e "${GREEN}Build complete for $ENVIRONMENT environment!${NC}"
echo -e "${BLUE}Environment: $ENVIRONMENT${NC}"
echo -e "${BLUE}Publisher: $PUBLISHER${NC}"
echo -e "${BLUE}Package contents:${NC}"
ls -la pkg/
echo -e "\n${BLUE}Target directory:${NC}"
ls -la target/