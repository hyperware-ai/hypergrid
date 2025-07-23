#!/bin/bash

set -e  # Exit on error

echo "Building HPN packages..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Clean up any existing pkg directory at root (but preserve manifest.json and scripts.json)
if [ -d "pkg" ]; then
    echo -e "${BLUE}Cleaning existing pkg directory (preserving manifest.json and scripts.json)...${NC}"
    # Save manifest.json and scripts.json if they exist
    if [ -f "pkg/manifest.json" ]; then
        cp pkg/manifest.json /tmp/hpn_manifest_backup.json
    fi
    if [ -f "pkg/scripts.json" ]; then
        cp pkg/scripts.json /tmp/hpn_scripts_backup.json
    fi
    
    # Remove everything else in pkg
    find pkg -mindepth 1 ! -name 'manifest.json' ! -name 'scripts.json' -exec rm -rf {} + 2>/dev/null || true
else
    # Create the pkg directory if it doesn't exist
    mkdir -p pkg
fi

# Restore manifest.json and scripts.json if they were backed up
if [ -f "/tmp/hpn_manifest_backup.json" ]; then
    mv /tmp/hpn_manifest_backup.json pkg/manifest.json
fi
if [ -f "/tmp/hpn_scripts_backup.json" ]; then
    mv /tmp/hpn_scripts_backup.json pkg/scripts.json
fi

# Build operator
echo -e "${BLUE}Building operator...${NC}"
cd operator
kit build
cd ..

# Build provider
echo -e "${BLUE}Building provider...${NC}"
cd provider
kit build --hyperapp
cd ..

# Copy operator pkg contents (except manifest.json and scripts.json)
echo -e "${BLUE}Copying operator build artifacts...${NC}"
for item in operator/pkg/*; do
    basename=$(basename "$item")
    if [[ "$basename" != "manifest.json" && "$basename" != "scripts.json" ]]; then
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

# Copy provider pkg contents (except manifest.json)
echo -e "${BLUE}Copying provider build artifacts...${NC}"
for item in provider/pkg/*; do
    basename=$(basename "$item")
    if [ "$basename" != "manifest.json" ]; then
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

# Handle API zip files
echo -e "${BLUE}Merging API zip files...${NC}"

# Create a temporary directory for API processing
TEMP_API_DIR=$(mktemp -d)
mkdir -p "$TEMP_API_DIR/merged"

# Check if operator has api.zip after build
if [ -f "operator/pkg/api.zip" ]; then
    echo "Extracting operator api.zip..."
    unzip -q "operator/pkg/api.zip" -d "$TEMP_API_DIR/operator"
fi

# Extract provider api.zip
if [ -f "provider/pkg/api.zip" ]; then
    echo "Extracting provider api.zip..."
    unzip -q "provider/pkg/api.zip" -d "$TEMP_API_DIR/provider"
fi

# Copy all WIT files to merged directory
if [ -d "$TEMP_API_DIR/operator" ]; then
    find "$TEMP_API_DIR/operator" -name "*.wit" -o -name "*.wt" | while read -r file; do
        cp "$file" "$TEMP_API_DIR/merged/"
    done
fi

if [ -d "$TEMP_API_DIR/provider" ]; then
    find "$TEMP_API_DIR/provider" -name "*.wit" -o -name "*.wt" | while read -r file; do
        cp "$file" "$TEMP_API_DIR/merged/"
    done
fi

# Create the merged api.zip if there are any WIT files
if [ -n "$(ls -A "$TEMP_API_DIR/merged" 2>/dev/null)" ]; then
    echo "Creating merged api.zip..."
    cd "$TEMP_API_DIR/merged"
    zip -q ../api.zip *
    cd - > /dev/null
    cp "$TEMP_API_DIR/api.zip" pkg/api.zip
else
    echo -e "${RED}Warning: No WIT files found to merge${NC}"
fi

# Clean up temp directory
rm -rf "$TEMP_API_DIR"

# Verify manifest.json and scripts.json are present
if [ -f "pkg/manifest.json" ] && [ -f "pkg/scripts.json" ]; then
    echo -e "${GREEN}manifest.json and scripts.json preserved in pkg/${NC}"
else
    echo -e "${RED}Error: manifest.json or scripts.json not found in pkg/${NC}"
    echo "Please ensure these files exist in the pkg/ directory before running this script."
    exit 1
fi

# Create the package zip file for kit s
echo -e "${BLUE}Creating package zip file...${NC}"

# Create target directory if it doesn't exist
mkdir -p target

# Create the zip file
ZIP_NAME="hypergrid:grid-beta.zip"
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

echo -e "${GREEN}Build complete!${NC}"
echo -e "${BLUE}Package contents:${NC}"
ls -la pkg/
echo -e "\n${BLUE}Target directory:${NC}"
ls -la target/
